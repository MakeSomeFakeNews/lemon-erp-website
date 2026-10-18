---
order: 1
---

# 后端开发规范

本页汇总后端代码的约定。示例均摘自源码或基于源码中的真实 API。

## 分层与命名

| 层 | 包 | 约定 |
| --- | --- | --- |
| Controller | `modules.<模块>.controller` | 类名 `<模块前缀><功能>Controller`，路径以模块名开头（`/wms/warehouse`）；只做参数接收与校验、权限、操作日志，调用一个 Service 方法并返回 `R`，见下文 [Controller 的职责](#controller-的职责) |
| Service | `modules.<模块>.service` | 业务逻辑、事务、数据权限、状态校验；只注入本模块的 Mapper，其他模块的数据通过所属模块的 Service 读写 |
| Mapper | `modules.<模块>.mapper` | 继承 `BaseMapper<实体>`；自定义 SQL 写在 `resources/mapper/<模块>/<Mapper名>.xml` |
| Entity | `modules.<模块>.entity` | 继承 `BaseEntity`（树形用 `TreeEntity`），`@TableName`，Lombok `@Data` + `@EqualsAndHashCode(callSuper = true)` |
| DTO | `modules.<模块>.dto` | 请求体、查询结果、接口返回结构，用 record 或带 setter 的类，不用 `Map`，见 [接口类型化](#接口类型化) |
| Model | `modules.<模块>.model` | 枚举、常量、本模块的数据权限规则 |

类名、表名都以模块前缀开头（`WmsWarehouse` → `wms_warehouse`、`ScmOrderService`），质量管理类以 `Qms` 开头、表以 `qms_` 开头。

一个 Service 超过约 500 行、承担多种职责时按职责拆开，原 Service 只做编排。现有的拆分可以参考：

| 原 Service | 拆出的类 | 说明 |
| --- | --- | --- |
| `FinCostService`（成本核算） | `fin/service/cost` 包：`CostSourceLoader` 取数、`CostCalculator` 计算、`CostVoucherWriter` 生成凭证，`Valuation` / `MovingValuation` / `FifoValuation` 逐笔计价 | `FinCostService` 只做期间校验、编排和保存；`CostCalculator` 是不依赖 Spring 的纯计算，入参、结果都是强类型的 record（`CostSource`、`CostRows`） |
| `ScmOrderService`（采购 / 销售订单） | `ScmOrderAssembler` 订单组装、`ScmOrderPricingService` 定价（合同价、促销、返利、限价）、`ScmOrderCreditChecker` 信用检查、`ScmOrderNotifier` 门户通知，`PromotionCalculator` 促销计算、`CreditRules` 信用规则 | |
| `WmsStockDocService`（出入库单） | `StockDocValidator` 校验、`StockDocReverser` 红字冲销、`StockDocRules` 纯规则 | |
| `MesWorkOrderService`（生产工单） | `WoLineService` 用料与工序、`WoReportService` 报工、`WoChangeService` 改量与拆分、`WoBomExpander` 虚拟件展开；MRP 的净需求计算 `MrpCalculator` | |

不访问数据库、只根据参数计算结果的规则（如 `StockDocRules`、`CreditRules`、`CostCalculator`、`MrpCalculator`）写成 `final` 类的静态方法或普通类，不注册为 Bean，便于单独验证。

## 统一返回 R

所有接口返回 `com.lemon.erp.common.result.R<T>`：

```java
public class R<T> {
    public static final int OK = 200;
    public static final int UNAUTHORIZED = 401;
    public static final int FORBIDDEN = 403;
    public static final int NOT_FOUND = 404;
    public static final int ERROR = 500;

    private int code;
    private String msg;
    private T data;

    public static <T> R<T> ok();
    public static <T> R<T> ok(T data);
    public static <T> R<T> fail(String msg);
    public static <T> R<T> fail(int code, String msg);
}
```

分页接口返回 `R<PageResult<T>>`，`PageResult` 是 `record PageResult<T>(List<T> records, long total)`，由 MyBatis-Plus 的分页结果转换：

```java
@GetMapping
@PreAuthorize("@ss.hasPerm('wms:warehouse:list')")
public R<PageResult<WmsWarehouse>> page(@RequestParam(defaultValue = "1") long current,
                                        @RequestParam(defaultValue = "10") long size,
                                        @RequestParam(required = false) String keyword,
                                        @RequestParam(required = false) EnableStatus status) {
    return R.ok(warehouseService.page(current, size, keyword, status));
}
```

分页参数统一叫 `current`、`size`，前端 `useTable` 按这两个名字传参。

## 异常

业务校验失败直接抛 `BizException`，不要返回 `R.fail`。第一个参数是国际化**消息键**（登记在本模块的 `i18n/<模块>.properties` 和 `<模块>_en.properties` 中），其余是消息参数：

```java
if (contract == null) {
    throw new BizException("scm.error.purchaseContractDoesNotExistAccess");
}
if (contract.getStatus() != ContractStatus.DRAFT) {
    // 参数填入 {0}；参数本身需要翻译时先 Messages.get 再传入
    throw new BizException("scm.error.operationNotAllowedContractSCurrent", Messages.get("scm.label.edit"));
}
// 指定错误码
throw new BizException(R.FORBIDDEN, "framework.error.supplierPortalOnlySupplierAccounts");
```

```properties
# lemon-scm/src/main/resources/i18n/scm.properties（默认，简体中文）
scm.error.purchaseContractDoesNotExistAccess=采购合同不存在或没有权限
scm.error.operationNotAllowedContractSCurrent=合同当前状态不能{0}

# scm_en.properties（英文，键与占位符必须一致；单引号写成两个）
scm.error.purchaseContractDoesNotExistAccess=Purchase contract does not exist or access denied
scm.error.operationNotAllowedContractSCurrent=Operation "{0}" is not allowed in the contract''s current status
```

返回给前端时按请求头 `Accept-Language` 取对应语言的消息，`getMessage()` 为中文（用于日志）。**不要在 Java 中硬编码返回前端的中文提示**，也不要拼接句子（`"合同当前状态不能" + action`），写成带 `{0}` 参数的完整消息。资源包、参数、单引号转义等规则见 [国际化](./i18n)。

`GlobalExceptionHandler`（`@RestControllerAdvice`）统一转换：

| 异常 | 返回 |
| --- | --- |
| `BizException` | `R.fail(code, 按请求语言取的消息)` |
| `AccessDeniedException` / `AuthorizationDeniedException` | 403「没有权限，请联系管理员」 |
| `BindException`（校验失败） | 各字段错误信息用「; 」连接 |
| `HttpMessageNotReadableException` | 枚举、数字等字段取值不合法时「字段 xxx 的取值“yyy”不正确」，其他情况「请求参数格式不正确」 |
| `MethodArgumentTypeMismatchException` | 「参数「xxx」格式不正确」 |
| `MissingServletRequestParameterException` | 「缺少参数「xxx」」 |
| `DuplicateKeyException` | 「数据已存在，请刷新后重试」（并发写入时唯一索引兜底） |
| `MaxUploadSizeExceededException` | 「上传文件过大」 |
| 其他异常 | 记录 ERROR 日志，返回「系统繁忙，请稍后重试」；异常链中包含 `BizException` 时按业务异常处理 |

以上通用提示都在 `common.properties` 的 `common.text.*` 中，同样按请求语言返回。注意：HTTP 状态码大多仍为 200，前端按 `code` 判断结果。未登录（401）和 Spring Security 层面的拒绝（403）由 `SecurityConfig` 返回对应的 HTTP 状态码。

## 参数校验与校验分组

使用 Jakarta Bean Validation，错误信息 `message` 写成消息键 `{模块.valid.名称}`，由 Bean Validation 通过 Spring 的 `messageSource` 按请求语言插值（见 [国际化](./i18n#校验注解)）。`lemon-common` 提供两个校验分组，都继承 `Default`（未指定分组的约束在两个分组中都生效）：

- `com.lemon.erp.common.validation.Create`：新增
- `com.lemon.erp.common.validation.Update`：修改

只在新增或修改时生效的约束指定分组，例如用户密码只在新增时必填、物料编码只在修改时必填（新增时留空自动生成）：

```java
public class SysUser extends BaseEntity {
    @NotBlank(message = "{system.valid.passwordRequired}", groups = Create.class)
    private String password;
}

public class WmsMaterial extends BaseEntity {
    @NotBlank(groups = Update.class, message = "{wms.valid.materialCodeRequired}")
    private String code;
}
```

Controller 中新增用 `@Validated(Create.class)`、修改用 `@Validated(Update.class)`，请求体是 record 等没有分组的对象时用 `@Valid`：

```java
@PostMapping
@PreAuthorize("@ss.hasPerm('wms:warehouse:add')")
@OperLog(title = "仓库管理", type = OperType.INSERT) // i18n-ignore
public R<Void> create(@Validated(Create.class) @RequestBody WmsWarehouse warehouse) { ... }

@PutMapping("/{id}")
@PreAuthorize("@ss.hasPerm('wms:warehouse:edit')")
@OperLog(title = "仓库管理", type = OperType.UPDATE) // i18n-ignore
public R<Void> update(@PathVariable Long id, @Validated(Update.class) @RequestBody WmsWarehouse warehouse) { ... }

@PutMapping("/{id}/status")
@PreAuthorize("@ss.hasPerm('wms:warehouse:edit')")
@OperLog(title = "仓库管理-修改状态", type = OperType.UPDATE) // i18n-ignore
public R<Void> changeStatus(@PathVariable Long id, @Valid @RequestBody StatusRequest req) { ... }
```

修改接口的 ID 从路径取，不信任请求体中的 `id`。`createTime`、`updateTime` 在 `BaseEntity` 中是只读属性（`JsonProperty.Access.READ_ONLY`），前端传入也会被忽略。

Excel 导入同样复用新增的校验：`importExecutor.run(req, service::create, Create.class)`。

## 枚举约定

状态、种类、来源、方式等取值一律用枚举。有字典的枚举与**系统字典**一一对应（字典值 = 枚举名称），没有字典的内部取值（如工单来源、费用来源、面试方式）同样定义枚举。枚举放在本模块的 `model` 包，文件名与枚举同名：

```java
/** 采购合同状态，与字典 scm_contract_status 对应 */
public enum ContractStatus {
    DRAFT,
    APPROVING,
    /** 生效：期限内采购订单可以引用 */
    ACTIVE,
    CLOSED
}
```

- 实体和请求 DTO 的字段直接用枚举类型（`private ContractStatus status;`），MyBatis-Plus 按枚举名称（`name()`）存储为字符串，数据库列为 `VARCHAR`，JSON 中也是名称；
- Controller 的查询参数也直接用枚举（`@RequestParam(required = false) ContractStatus status`），Spring 按名称转换；请求体中的取值不合法时，全局异常处理返回「字段 status 的取值“XXX”不正确」；
- 比较用 `==`：`if (contract.getStatus() != ContractStatus.DRAFT)`；条件构造器中也传枚举：`.eq(ScmOrder::getStatus, OrderStatus.APPROVED)`；
- **不要写 `"DRAFT".equals(order.getStatus())` 这样的字符串字面量比较**，也不要在 `Set.of("A", "B")`、`case "A" ->` 中写字面量。只能用字面量的地方（mapper XML 中的 SQL）除外；修改到老代码中已有的字符串比较时顺手改为枚举或常量。

**状态判断封装在枚举中**。多个状态的组合、允许的流转、等级分数线等写成枚举的常量集合和方法，业务代码不再维护以字符串为键的映射表：

```java
public enum OrderStatus {
    DRAFT, APPROVING, APPROVED, PARTIAL, COMPLETED, CLOSED;

    /** 可以入库 / 出库的状态 */
    public static final Set<OrderStatus> EXECUTABLE = Collections.unmodifiableSet(EnumSet.of(APPROVED, PARTIAL));

    /** 可以入库 / 出库 */
    public boolean isExecutable() {
        return EXECUTABLE.contains(this);
    }

    /** 未审核（草稿、审批中） */
    public boolean isUnaudited() {
        return this == DRAFT || this == APPROVING;
    }
}

// 使用
if (!order.getStatus().isExecutable()) { ... }
orderMapper.update(Wrappers.<ScmOrder>lambdaUpdate().set(ScmOrder::getStatus, OrderStatus.CLOSED)
        .eq(ScmOrder::getId, id).in(ScmOrder::getStatus, OrderStatus.EXECUTABLE));
```

**启用 / 停用状态用 `EnableStatus`**。物料、仓库、库位、客户、供应商、科目、币种、BOM、工作中心、检验方案、岗位、社保方案、用户、角色、部门、菜单、字典、租户、定时任务、流程模型等约 30 个启停字段统一用 `lemon-common` 的 `com.lemon.erp.common.enums.EnableStatus`（`ENABLED`、`DISABLED`，对应字典 `sys_common_status`）。它是唯一**不按名称存储**的枚举：数据库列、JSON、查询参数中仍是数字 1 / 0，与字典取值、已有数据和前端保持一致。

```java
// 实体、请求 DTO：字段直接用 EnableStatus（数据库列仍为 TINYINT 1 / 0）
private EnableStatus status;

// 比较用 == 或枚举方法，不写 Integer.valueOf(1).equals(...)、status == 1
if (warehouse.getStatus() == EnableStatus.DISABLED) { ... }
if (EnableStatus.isEnabled(user.getStatus())) { ... }   // null 视为未启用
entity.setStatus(EnableStatus.ENABLED);
.eq(WmsWarehouse::getStatus, EnableStatus.ENABLED)

// 查询参数：?status=1 / ?status=0
@RequestParam(required = false) EnableStatus status

// 启停接口统一用 StatusRequest：{"status": 1 | 0}
public record StatusRequest(@NotNull(message = "{common.valid.statusRequired}") EnableStatus status) { }
warehouseService.changeStatus(id, req.status());
```

- 读写方式：`code` 字段同时标注 MyBatis-Plus 的 `@EnumValue`（按 1 / 0 读写数据库）和 Jackson 的 `@JsonValue`（输出数字）；反序列化由 `@JsonCreator` 的 `EnableStatus.fromJson` 处理，接受数字 1 / 0、字符串 `"1"` / `"0"`（也接受常量名 `ENABLED` / `DISABLED`），空字符串为 `null`；查询参数、路径变量由 `framework/config/WebMvcConfig.addFormatters` 注册的转换器同样按 1 / 0 转换；
- 非法值：`fromJson` / `of(Integer)` 抛出 `InvalidEnumValueException`，请求体中由 `GlobalExceptionHandler` 提示「字段 status 的取值“2”不正确」，查询参数中提示「参数「status」格式不正确」，不再需要 `@Min` / `@Max` 校验；
- 其他方法：`EnableStatus.of(Integer)`（null 返回 null）、`EnableStatus.of(boolean)`、实例方法 `isEnabled()` / `isDisabled()`、`getCode()`；
- 只有启用 / 停用改用 `EnableStatus`；成功 / 失败（登录日志、操作日志的状态）、显示 / 隐藏（菜单的 `visible`）以及「是否主联系人」「是否内置」「是否必填」等是否标志仍是 `Integer` 1 / 0；
- 前端不在 `@/constants/enums` 中生成该枚举（`gen-enums.mjs` 跳过带 `@JsonValue` 的枚举，按名称生成会与接口数据不一致），使用 `@/utils/constants` 的 `STATUS_ENABLED`（1）/ `STATUS_DISABLED`（0），显示用字典 `sys_common_status` 的 `<DictTag>`。

**跨模块共用的取值放在 framework**：审批状态 `framework/workflow/ApproveStatus`（字典 `sys_approve_status`）、站内消息类别 `framework/message/MessageCategory`（字典 `sys_message_category`）、流程变量类型 `FlowBusiness.VariableType`。

**业务字典的字段保持字符串**。业务字典（客户等级、物料分类、假期类型等，见 [字典](../architecture/tenant#字典)）的取值由租户维护、可以新增，不能定义为枚举；字段用 `String`，保存时用 `DictLookup.check` 按当前租户的字典校验。程序依赖的内置取值集中定义为常量（如 `hr/model/HrDictValues.LEAVE_ANNUAL`），并在 `init.sql` 中标记为内置（`builtin = 1`），租户不能删除、不能改键值。

**前端同步**：前端比较状态时使用由后端枚举生成的 `@/constants/enums`。新增或修改枚举后在 `lemon-web` 中运行 `npm run gen:enums` 重新生成，`npm run i18n:check` 会检查生成的文件是否与后端一致，见 [前端开发规范](./frontend#状态与类型常量)。只有「文件名与枚举同名的顶层枚举」会被生成，类内部的嵌套枚举、用 `@JsonValue` 自定义取值的枚举（`EnableStatus`）不会。

## SQL 约定

| 约定 | 说明 |
| --- | --- |
| 自定义 SQL 只写在 mapper XML 中 | Java 中不写 SQL 字符串，包括 `.apply`、`.inSql`、`.setSql`；单表简单条件可以用 `Wrappers.lambdaQuery()` / `lambdaUpdate()` |
| 统计在数据库中完成 | 用 `GROUP BY` / `COUNT` 聚合，不把明细查到内存中计算（示例 `DashboardMapper.xml`、各模块的 `XxxTodoMapper.xml`） |
| 批量写入用单条多值 INSERT | `INSERT ... VALUES (...), (...)`，不在循环中逐条插入（示例 `SysRoleMenuMapper.insertBatch`） |
| 关联查询用 JOIN | 一次查出，避免 N+1（示例 `SysRoleMapper.selectRoleNamesByUserId`） |
| 不对索引列套函数 | 写 `login_time >= #{begin}`，不写 `DATE(login_time) = #{day}` |
| 列表不返回大字段和敏感字段 | 列表只查需要的列，详情接口再按主键查询（示例 `SysOperLogService.page` 用 `select(..., f -> !LIST_EXCLUDED.contains(...))` 排除参数、结果） |
| 索引 | WHERE、JOIN、ORDER BY 用到的列建索引，关联表的反向查询也要建索引 |
| 不写 `INSERT ... SELECT`、不用 `TRUNCATE` | 多租户拦截器处理不完整，见 [SaaS 多租户](../architecture/tenant) |
| 兼容 MySQL 8 | `init.sql` 和 mapper XML 中的 SQL 使用 MySQL 8 语法；增量脚本要可重复执行（`NOT EXISTS`、按编码关联，不依赖自增 ID） |

状态流转用带原状态条件的 UPDATE（`UPDATE ... SET status = 目标 WHERE id = ? AND status = 原状态`），并发操作时只有一个请求成功，另一个更新 0 行并提示刷新。不需要为每张单据在 mapper XML 中写 `transit`，直接用 `framework/data/StatusTransitions`：

```java
// 失败（状态已被他人改变）时抛出 BizException(消息键)
StatusTransitions.change(loanMapper, FinLoan::getId, id, FinLoan::getStatus,
        LoanStatus.DRAFT, LoanStatus.APPROVING, "fin.error.loanStatusHasChangedRefresh");

// 同时设置其他字段；返回是否成功，不抛异常
boolean ok = StatusTransitions.tryChange(contractMapper, ScmPurchaseContract::getId, id, ScmPurchaseContract::getStatus,
        ContractStatus.APPROVING, ContractStatus.ACTIVE, w -> w.set(ScmPurchaseContract::getApproveTime, LocalDateTime.now()));
```

`StatusTransitions` 等单据开发的公共组件见 [单据开发公共组件](./doc-components)。

只取前几条时用 `framework/data/Queries`（由分页插件按数据库方言生成 LIMIT，不查总数），不要在 Java 中写 `.last("LIMIT 1")`：

```java
FinCostRun run = Queries.first(costRunMapper, Wrappers.<FinCostRun>lambdaQuery().eq(FinCostRun::getPeriod, period));
List<ScmOrder> recent = Queries.limit(orderMapper, Wrappers.<ScmOrder>lambdaQuery().orderByDesc(ScmOrder::getId), 10);
```

需要 `SELECT ... FOR UPDATE` 行锁时写在 mapper XML 中（示例 `WmsMaterialMapper.xml`）。

## 分页上限与防全表操作

- 分页单页最多 500 条（`MybatisPlusConfig.MAX_PAGE_SIZE`），`size` 传更大的值也只返回 500 条。前端导出按每页 500 条循环读取。
- 不带 WHERE 的 UPDATE / DELETE 会被 `BlockAttackInnerInterceptor` 拦截。确实需要删除全部数据时写 `WHERE id > 0`（示例 `SysOperLogMapper.deleteAll`）。

## 接口权限 @PreAuthorize

每个接口都要声明权限，权限标识与菜单表中的按钮权限一致：

```java
@PreAuthorize("@ss.hasPerm('scm:contract:add')")
@PreAuthorize("@ss.hasAnyPerm('scm:purchase:add', 'scm:purchase:edit', 'scm:contract:list')")
```

- 列表、详情用 `:list`，新增 `:add`，修改 `:edit`，删除 `:remove`，其他操作按动作命名（`:approve`、`:confirm`、`:close`、`:export`、`:import` 等）；
- 只需要登录的下拉选项接口可以不加，但不能返回敏感数据；
- 按 ID 操作的接口除了功能权限，还要在 Service 中用数据权限校验记录是否可访问（见 [数据权限](../architecture/data-scope)）。

## 操作日志 @OperLog

增删改接口都加 `@OperLog`，查询接口不加：

```java
@OperLog(title = "采购合同", type = OperType.INSERT)
@OperLog(title = "采购合同-提交", type = OperType.UPDATE)
@OperLog(title = "附件-上传", type = OperType.INSERT, saveParams = false)
@OperLog(title = "物料管理-导入", type = OperType.IMPORT)
```

`title` 用「功能」或「功能-动作」；上传文件等参数无意义的接口设 `saveParams = false`。操作日志标题存入数据库，**保持中文、不使用消息键**，源码中在行尾写 `// i18n-ignore`（国际化检查脚本跳过该行）。密码、薪资、证件号、手机号等字段会自动脱敏，见 [日志与审计](../architecture/log)。

## Controller 的职责

Controller 只做这几件事：

1. 接收参数（路径、查询参数、请求体），用 `@Validated` / `@Valid` 校验；
2. 声明权限 `@PreAuthorize`，增删改加 `@OperLog`；
3. 调用**一个** Service 方法，把结果包装为 `R` 返回。

不要在 Controller 中写业务逻辑：不注入 Mapper、不拼装查询条件、不做状态判断、不在多个 Service 之间编排、不解析上传的文件（Excel、XML、图片的读取和校验放在 Service 中，Controller 只把 `MultipartFile` 传进去）。一个功能的逻辑需要放在多个 Controller 中复用时，说明它应该在 Service 里。

```java
@PostMapping("/{id}/submit")
@PreAuthorize("@ss.hasPerm('fin:loan:add')")
@OperLog(title = "员工借款提交", type = OperType.UPDATE) // i18n-ignore
public R<Boolean> submitLoan(@PathVariable Long id) {
    return R.ok(loanService.submit(id));   // 是否走审批、状态流转都在 Service 中
}
```

一个 Controller 只对应一组相关的接口，过大时按业务拆开（例如财务的借款、报销、发票、银行对账、期末结账各有自己的 Controller），拆分时接口地址、权限标识和操作日志标题保持不变。

## 接口类型化

接口的返回值和 Service 的公共方法不使用 `Map<String, Object>`，定义明确的类型：

| 场景 | 写法 | 示例 |
| --- | --- | --- |
| 在 Java 中组装的返回结构 | record | `ScmPriceViews.PromotionPreview`、`BiScreen.Factory` |
| mapper XML 查询的结果 | 带 setter 的类（Lombok `@Data`），MyBatis 按列名映射；加 `@JsonInclude(JsonInclude.Include.NON_NULL)` 时为空的列不输出 | `ScmPriceViews.OrderPriceHistory` |
| 一个功能的多个返回结构 | 放在同一个 `XxxViews`（或功能名）的 `final` 类中作为嵌套类型 | `ScmPriceViews`、`BankViews`、`CashierViews`、`BiScreen` |
| 请求体 | record，校验注解写在组件上；多个请求体可以放在 `XxxRequests` 中 | `SrmRequests.Contract`、`QmsRequests` |

mapper XML 中引用嵌套类型时用 `$` 分隔：

```xml
<select id="selectHistory" resultType="com.lemon.erp.modules.scm.dto.ScmPriceViews$OrderPriceHistory">
```

```java
@GetMapping("/history")
@PreAuthorize("@ss.hasAnyPerm('scm:price:list', 'scm:sales:list', 'scm:purchase:list')")
public R<List<ScmPriceViews.OrderPriceHistory>> history(...) { ... }
```

字段名与原先 Map 中的键一致，返回给前端的 JSON 结构不变。定时任务、内部统计中只在方法内部使用的查询结果可以继续用 `Map`。

## 事务

**事务边界放在 Service 层**：

- 修改数据的 Service 公共方法加 `@Transactional`。只要一个操作会写两次及以上（多张表，或「先插入 / 更新、再补一次更新」，如保存单据后回写流程实例 ID、生成凭证后回写凭证 ID），就必须在事务中，否则中途失败会留下不完整的数据。Controller、`JobHandler`、事件发布方不加事务。
- 一个业务动作涉及多个模块（如出入库 + 生成应付单）时在同一事务中完成：上游在事务中发布同步事件，下游的 `@EventListener` 在同一事务中执行，抛异常会回滚整个操作；只需提交后执行的（发消息、调用外部系统）用 `@TransactionalEventListener`。
- `DocNoService.next` 声明为 `Propagation.MANDATORY`，**必须在事务中调用**，流水号与单据一起提交或回滚，不会跳号。
- 校验放在写入之前：先校验再插入，不要插入后才发现数据不合法再抛异常。
- **批量处理每条单独提交**：定时任务、批量导入等逐条处理的场景，用 `TransactionTemplate` 让每条记录各自一个事务，一条失败不影响其他，最后汇总失败的记录（示例 `MesEcnService.effectDue`：到期的工程变更逐张生效，失败的记入结果，任务记为失败）：

  ```java
  for (MesEcn ecn : ecnMapper.selectDue(today)) {
      try {
          transactionTemplate.executeWithoutResult(s -> effect(ecn));
          effected++;
      } catch (RuntimeException e) {
          failures.add(ecn.getEcnNo() + "：" + e.getMessage());
      }
  }
  ```

- **缓存在提交后清理**：修改字典、业务参数等缓存数据时，立即清理一次，并在事务提交后再清理一次，避免并发请求在提交前把旧值重新加载进缓存（`TransactionSynchronizationManager.registerSynchronization` 的 `afterCommit`，参照 `SysDictService`、`SysBizRuleService`、`TokenService` 中的 `afterCommit`）。
- 同一个类内部调用带 `@Transactional` 的方法时注解不生效（Spring AOP），需要独立事务时放到另一个 Bean 中或用 `TransactionTemplate`。
- 可安全重试的失败（如流程引擎乐观锁冲突）用 Spring 的 `@Retryable`（`org.springframework.resilience.annotation`），重试必须在事务之外（审批接口的重试注解加在 Controller 方法上，示例 `WfTaskController`）。

## 跨模块访问数据

- **只注入本模块的 Mapper**。读写其他模块的表一律调用所属模块 Service 提供的方法，不要注入其他模块的 Mapper，也不要在本模块的 mapper XML 中 `UPDATE` / `DELETE` 其他模块的表。
- **下游回写上游**：例如物流发运单发货后 scm 发布 `ShipmentShippedEvent`，fin 监听生成运费应付单，再调用 `ScmShipmentService.bindFreightBill(发运单ID, 应付单ID)` 回写发运单（与发货在同一事务）；同样的还有 `QmsClaimService.bindBill`、`ScmRebateService.bindBill`、`MesEquipmentService.bindVoucher` / `unbindVouchers`。被调用的方法写在数据所属的模块中，注释说明由谁、在什么时机调用。
- **上游需要下游的能力**：由 `lemon-framework` 定义接口或事件，下游模块实现（如客户关系、项目校验负责人用 `framework/org/UserLookup`，由系统模块的 `SysUserLookup` 实现，客户关系模块因此不再依赖系统模块；业务字典校验用 `framework/dict/DictLookup`）。
- **只读的跨模块 JOIN 可以保留**：报表、商务智能、首页统计等只读查询可以在 mapper XML 中直接 JOIN 上游模块的表，不必为此在上游增加接口。

契约接口与事件的完整清单见 [模块划分与依赖规则](../architecture/modules) 和 [业务联动](../architecture/integration)。

## 获取当前用户

```java
LoginUser user = SecurityUtils.getLoginUser();
entity.setDeptId(user.deptId());
```

需要按部门隔离的数据在新增时写入 `dept_id`。**制单人 `create_by` 不需要手工赋值**：`MybatisPlusConfig` 中的 `CreateByInnerInterceptor` 在插入实体时，`createBy` 为空则自动填当前登录用户（定时任务等没有登录用户时保持为空）。实体的 `createBy` 字段加 `@JsonProperty(access = JsonProperty.Access.READ_ONLY)`，前端传入的值不会被接收。用 mapper XML 多值 `INSERT` 插入的数据不经过实体，仍需自己赋值。

异步线程、定时任务中没有登录用户，用 `SecurityUtils.getUserIdOrNull()`。

## 金额与数量

金额、数量的计算用 `common/util/Decimals`，精度与数据库一致：金额 2 位、数量和单价 4 位，四舍五入（HALF_UP）：

| 方法 | 说明 |
| --- | --- |
| `nz(v)` | null 视为 0 |
| `sum(items, Item::getAmount)` / `sum(values)` | 求和，null 视为 0 |
| `money(v)` / `qty(v)` | 保留 2 位 / 4 位 |
| `percent(part, whole, scale)` | part / whole × 100，whole 为 0 或 null 时返回 null |
| `positive(v)` | 是否大于 0 |
| `HUNDRED`、`MONEY_SCALE`、`QTY_SCALE`、`PRICE_SCALE`、`ROUNDING` | 常量 |

```java
BigDecimal total = Decimals.money(Decimals.sum(items, ScmOrderItem::getAmount));
BigDecimal yield = Decimals.percent(good, good.add(scrap), 2);
```

税率、比例类数值统一按**百分数**存储（`DECIMAL(5, 2)`，13 表示 13%，包括发票明细的 `fin_invoice_line.tax_rate`），计算时除以 `Decimals.HUNDRED`；导入外部数据（如数电票 XML 中的 0.13、13%）时先换算为百分数再保存。成本、工资、个税等精度要求不同的计算保持各自的写法。

## 日期时间

`JacksonConfig` 统一了 JSON 格式：`LocalDateTime` 输出 `yyyy-MM-dd HH:mm:ss`，读取时兼容空格或 `T` 分隔、秒和毫秒可选；Mapper 返回 Map 时的 `java.util.Date` / `Timestamp` 按服务器时区输出 `yyyy-MM-dd HH:mm:ss`，`java.sql.Date` 输出 `yyyy-MM-dd`。`LocalDate` 为 `yyyy-MM-dd`。字段上的 `@JsonFormat` 优先。

## 国际化

- 返回前端的文字一律使用消息键：业务异常 `new BizException("模块.error.xxx", 参数…)`、校验注解 `message = "{模块.valid.xxx}"`、其他文字 `Messages.get("模块.text.xxx", 参数…)`；键同时登记在本模块的 `<模块>.properties`（中文）和 `<模块>_en.properties`（英文）中。
- 编码规则目录、业务参数、记录类型、流程业务名称和变量、首页待办标题、定时任务名称、`OptionEnum` 选项等登记给框架的名称同样写消息键，由输出方 `Messages.get` 翻译。
- 存入数据库的内容（站内消息、操作日志标题、任务执行结果、自动生成的摘要和备注、推送到第三方平台的消息）保持中文，行内写 `// i18n-ignore`；需要复用资源包中的名称时用 `Messages.get(Messages.DEFAULT_LOCALE, 键)`。
- 定时任务、异步线程中没有请求语言，`Messages.get` 返回中文。
- 提交前运行 `python3 scripts/check_i18n.py`，确保「后端国际化检查通过」。详见 [国际化](./i18n)。

## 其他约定

- Spring Boot 4 默认使用 Jackson 3：`ObjectMapper` 在 `tools.jackson.databind` 包，注解仍在 `com.fasterxml.jackson.annotation`。
- 依赖注入使用构造器注入（Lombok `@RequiredArgsConstructor` + `private final` 字段）。
- 跨模块引用前确认不形成依赖环，见 [模块划分与依赖规则](../architecture/modules)。
- 编译保持零警告：处理未检查的类型转换、过时 API 等 javac 警告。
