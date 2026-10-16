---
order: 10
---

# 日志与审计

柠檬ERP 提供三类审计记录：操作日志（谁在什么时候调用了哪个增删改接口）、登录日志（登录成功与失败）、字段变更历史（关键单据和主数据的字段修改前后的值）。另外是 Spring Boot 的应用运行日志。

## 操作日志

### 使用

在 Controller 的增删改方法上加 `@OperLog`：

```java
@PostMapping
@PreAuthorize("@ss.hasPerm('wms:warehouse:add')")
@OperLog(title = "仓库管理", type = OperType.INSERT)
public R<Void> create(@Validated(Create.class) @RequestBody WmsWarehouse warehouse) {
    warehouseService.create(warehouse);
    return R.ok();
}
```

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `title` | 必填 | 模块标题，如「仓库管理」「采购合同-提交」 |
| `type` | `OTHER` | 操作类型 `OperType`：`OTHER`(0)、`INSERT`(1)、`UPDATE`(2)、`DELETE`(3)、`GRANT`(4)、`EXPORT`(5)、`FORCE`(6)、`CLEAN`(7)、`IMPORT`(8)，与字典 `sys_oper_type` 对应 |
| `saveParams` | `true` | 是否记录请求参数（上传文件等接口设为 false） |
| `saveResult` | `true` | 是否记录返回结果 |

### 实现

1. `OperLogAspect` 环绕 `@OperLog` 方法：执行前取当前用户名（退出登录等操作执行后上下文可能已失效），执行后收集类名方法名、请求方式、URL、客户端 IP、参数、结果、是否成功、错误信息、耗时；
2. 参数中过滤掉 `ServletRequest`、`ServletResponse`、`MultipartFile`、`BindingResult`；参数和结果转为 JSON 后**脱敏**，超过 2000 字符截断；
3. 发布 `OperLogEvent`；记录日志本身失败只打印警告，不影响业务；
4. monitor 模块的 `SysOperLogService` 用 `@Async @EventListener` 监听，查询 IP 归属地后异步写入 `sys_oper_log`（租户由 `TenantTaskDecorator` 传递到异步线程）。

脱敏规则：

| 字段 | 处理 |
| --- | --- |
| `password`、`oldPassword`、`newPassword` | 完全隐藏为 `******` |
| 薪资类金额：`baseSalary`、`salary`、`postAllowance`、`otherAllowance`、`perfBonusBase`、`socialBase`、`housingBase`、`grossPay`、`netPay`、`fromSalary`、`toSalary` | 完全隐藏 |
| `idCard`、`bankAccount`、`phone`、`mobile`、`emergencyPhone` | 保留前 3 位和后 4 位，中间用 `*` 代替；7 位及以下全部隐藏 |

新增包含敏感信息的字段时，在 `OperLogAspect` 的对应集合中登记。

### 查询与清理

「系统监控 → 操作日志」：列表不返回请求参数、返回结果、错误信息等大字段，详情接口再按主键查询。「清空」在单租户模式下执行 `TRUNCATE`，SaaS 模式下执行带租户条件的 `DELETE`（只删除本租户的日志）。

## 登录日志

`AuthService` 在登录成功和每一种失败（租户不存在、账号锁定、验证码错误、密码错误、账号停用）时发布 `LoginLogEvent`（用户名、IP、浏览器、操作系统、状态、提示信息、时间），monitor 模块异步写入 `sys_login_log`，并通过 `IpLocationService` 解析 IP 归属地。

## IP 与归属地

- **客户端 IP**：`ServletUtils.getClientIp` 取 `request.getRemoteAddr()`（IPv6 回环地址转为 `127.0.0.1`）。后端开启了 `server.forward-headers-strategy: native`，请求来自内网代理（10/8、172.16/12、192.168/16、127/8 等）时 Tomcat 采用 `X-Forwarded-For` 中的地址；外部直接伪造该请求头无效。代理不在内网时，用 `server.tomcat.remoteip.internal-proxies` 配置代理地址（正则）。
- **归属地**：`IpLocationService` 使用 ip2region 离线库 `lemon-framework/src/main/resources/ip2region/ip2region_v4.xdb`（约 11MB），启动时整体加载到内存，单次查询为微秒级，不调用任何外部接口。内网地址显示「内网IP」；只内置 IPv4 库，公网 IPv6 显示「未知」；国内地址显示为「广东省深圳市 电信」，国外为「美国 加利福尼亚」。
- 本地开发时在本机访问，看到的是 `127.0.0.1` / 内网IP，属于正常现象。

更新 IP 库的方法见 [常见问题](../deploy/faq)。

## 字段变更历史

修改物料、客户、供应商、订单、员工档案、项目、凭证等关键数据时，记录有变化的字段（修改人、时间、旧值、新值），在详情或「资料」中查看。

后端在修改后调用 `ChangeLogger`（由 system 模块实现，与业务修改在同一事务中写入）：

```java
WmsMaterial before = materialMapper.selectById(id);
// ... 执行修改 ...
changeLogger.log("wms_material", id, before, materialMapper.selectById(id),
        ChangeLogger.fields("name", "物料名称", "spec", "规格型号", "unit", "单位"));
```

- `bizType` 是业务记录类型编码，需要在 `RecordTypeProvider` 中登记，查看变更历史时按其 `viewPerm` 和数据权限校验，见 [文件与附件](./file)；
- `before` / `after` 通过 getter 或 record 访问器读取字段，只记录 `fields` 中列出且值有变化的字段。

前端在详情中放置 `ChangeLogPanel` 组件：

```vue
<ChangeLogPanel biz-type="wms_material" :biz-id="material.id" />
```

## 应用运行日志

后端使用 Spring Boot 默认的 Logback 配置，日志输出到控制台；prod 配置中 `logging.level.root: info`。生产环境建议输出到文件并按大小滚动：

```bash
java -jar lemon-erp.jar --spring.profiles.active=prod \
  --logging.file.name=/var/log/lemon-erp/app.log \
  --logging.logback.rollingpolicy.max-file-size=100MB \
  --logging.logback.rollingpolicy.max-history=30
```

未知异常由 `GlobalExceptionHandler` 以 ERROR 级别记录完整堆栈，返回给前端的只有「系统繁忙，请稍后重试」，排查问题时查看应用日志。
