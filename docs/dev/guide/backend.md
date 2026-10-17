---
order: 1
---

# 后端开发规范

本页汇总后端代码的约定。示例均摘自源码或基于源码中的真实 API。

## 分层与命名

| 层 | 包 | 约定 |
| --- | --- | --- |
| Controller | `modules.<模块>.controller` | 类名 `<模块前缀><功能>Controller`，路径以模块名开头（`/wms/warehouse`）；只做参数接收、权限、日志，返回 `R` |
| Service | `modules.<模块>.service` | 业务逻辑、事务、数据权限、状态校验；可以继承 MyBatis-Plus 的 `ServiceImpl`，也可以直接注入 Mapper |
| Mapper | `modules.<模块>.mapper` | 继承 `BaseMapper<实体>`；自定义 SQL 写在 `resources/mapper/<模块>/<Mapper名>.xml` |
| Entity | `modules.<模块>.entity` | 继承 `BaseEntity`（树形用 `TreeEntity`），`@TableName`，Lombok `@Data` + `@EqualsAndHashCode(callSuper = true)` |
| DTO | `modules.<模块>.dto` | 请求体、视图对象，优先用 record |
| Model | `modules.<模块>.model` | 枚举、常量、本模块的数据权限规则 |

类名、表名都以模块前缀开头（`WmsWarehouse` → `wms_warehouse`、`ScmOrderService`），质量管理类以 `Qms` 开头、表以 `qms_` 开头。

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
                                        @RequestParam(required = false) Integer status) {
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
if (!Integer.valueOf(1).equals(supplier.getStatus())) {
    throw new BizException("scm.error.supplierDisabled", supplier.getName());   // 参数填入 {0}
}
// 指定错误码
throw new BizException(R.FORBIDDEN, "framework.error.supplierPortalOnlySupplierAccounts");
```

```properties
# lemon-scm/src/main/resources/i18n/scm.properties（默认，简体中文）
scm.error.purchaseContractDoesNotExistAccess=采购合同不存在或没有权限
scm.error.supplierDisabled=供应商「{0}」已停用

# scm_en.properties（英文，键与占位符必须一致）
scm.error.purchaseContractDoesNotExistAccess=Purchase contract does not exist or access denied
scm.error.supplierDisabled=Supplier "{0}" is disabled
```

返回给前端时按请求头 `Accept-Language` 取对应语言的消息，`getMessage()` 为中文（用于日志）。**不要在 Java 中硬编码返回前端的中文提示**，也不要拼接句子（`"合同当前状态不能" + action`），写成带 `{0}` 参数的完整消息。资源包、参数、单引号转义等规则见 [国际化](./i18n)。

`GlobalExceptionHandler`（`@RestControllerAdvice`）统一转换：

| 异常 | 返回 |
| --- | --- |
| `BizException` | `R.fail(code, 按请求语言取的消息)` |
| `AccessDeniedException` / `AuthorizationDeniedException` | 403「没有权限，请联系管理员」 |
| `BindException`（校验失败） | 各字段错误信息用「; 」连接 |
| `HttpMessageNotReadableException` | 「请求参数格式不正确」 |
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

状态、种类、方式等取值一律用枚举，并与字典对应：

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

- 实体字段直接用枚举类型（`private ContractStatus status;`），MyBatis 按枚举名称（`name()`）存储为字符串，数据库列为 `VARCHAR`；
- Controller 的查询参数也可以直接用枚举（`@RequestParam(required = false) ContractStatus status`），Spring 按名称转换；
- 比较用 `==`：`if (contract.getStatus() != ContractStatus.DRAFT)`；
- **不要写 `"DRAFT".equals(order.getStatus())` 这样的字符串字面量比较**。只能用字面量的地方（mapper XML 中的 SQL）除外；修改到老代码中已有的字符串比较时顺手改为枚举或常量；
- 字典 `sys_dict_data.dict_value` 与枚举名称一致，前端用 `DictTag` 显示标签。

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

状态流转用带原状态条件的 UPDATE，防止并发重复操作：

```xml
<update id="transit">
    UPDATE scm_purchase_contract SET status = #{to}, update_time = NOW() WHERE id = #{id} AND status = #{from}
</update>
```

```java
private void transit(Long id, ContractStatus from, ContractStatus to) {
    if (contractMapper.transit(id, from, to) == 0) {
        throw new BizException("scm.error.contractStatusHasChangedRefreshTry");
    }
}
```

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

## 事务

- 写操作的 Service 方法加 `@Transactional`；一个业务动作涉及多张表、多个模块（如出入库 + 生成应付单）时在同一事务中完成。
- `DocNoService.next` 声明为 `Propagation.MANDATORY`，**必须在事务中调用**，流水号与单据一起提交或回滚，不会跳号。
- 同步事件的监听器与发布方在同一事务中，抛异常会回滚整个操作；只需提交后执行的用 `@TransactionalEventListener`。
- 清理缓存等必须在提交后执行的动作，参照 `TokenService.afterCommit` 注册 `TransactionSynchronization`。
- 可安全重试的失败（如流程引擎乐观锁冲突）用 Spring 的 `@Retryable`（`org.springframework.resilience.annotation`），重试必须在事务之外。

## 获取当前用户

```java
LoginUser user = SecurityUtils.getLoginUser();
entity.setDeptId(user.deptId());
entity.setCreateBy(user.userId());
```

需要按部门隔离的数据在新增时写入 `dept_id`、`create_by`。异步线程、定时任务中没有登录用户，用 `SecurityUtils.getUserIdOrNull()`。

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
