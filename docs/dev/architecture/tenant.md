---
order: 5
---

# SaaS 多租户

柠檬ERP 支持以 SaaS 方式为多家企业提供服务：共享数据库、共享表，业务数据按 `tenant_id` 隔离。开关为 `lemon.tenant.enabled`（环境变量 `LEMON_TENANT_ENABLED`），默认关闭。

| 模式 | 行为 |
| --- | --- |
| 关闭（默认） | 只有平台租户（ID 1），所有数据的 `tenant_id` 都是 1，行为与单租户系统完全一致；不注册租户拦截器，登录不显示「租户」输入框，租户管理菜单隐藏 |
| 开启 | 登录时填写租户名称；租户拦截器自动为 SQL 追加租户条件；平台租户可在「系统管理 → 租户管理」开通租户、在「租户套餐」中限定租户可用的菜单 |

即使不打算开启 SaaS，新写的代码也要遵守本页的约定，这样以后开启时不需要改代码。

## 隔离方式

- 业务表都有 `tenant_id BIGINT NOT NULL DEFAULT 1` 列，唯一约束为「原有列 + `tenant_id`」，编码、单号在租户内唯一（如 `UNIQUE KEY uk_warehouse_code (code, tenant_id)`）。
- 开启后注册 MyBatis-Plus 的 `TenantLineInnerInterceptor`（处理器 `LemonTenantLineHandler`）：所有 SQL，包括 mapper XML 中的 JOIN、子查询、UNION，都自动追加 `tenant_id = 当前租户`；INSERT 自动填充 `tenant_id`。实体类中不需要 `tenantId` 字段，业务代码不需要关心租户。
- 平台共享的表没有 `tenant_id` 列，登记在 `TenantProperties.ignoreTables`：菜单（`sys_menu`）、字典（`sys_dict_type`、`sys_dict_data`）、定时任务（`sys_job`、`sys_job_log`）、租户与套餐（`sys_tenant`、`sys_tenant_package`、`sys_tenant_package_menu`）、系统参数（`sys_config`），以及只以全局唯一 ID 关联的关系表（`sys_user_role`、`sys_role_menu`、`sys_role_dept`）。
- Flowable 的 `ACT_*` / `FLW_*` 表不由拦截器处理，引擎按自己的 `TENANT_ID_` 隔离（见下文「工作流」）。

## 当前租户 TenantContext

`framework/tenant/TenantContext` 保存当前线程的租户 ID：

| 场景 | 由谁设置 |
| --- | --- |
| 已登录的请求 | `JwtAuthenticationFilter` 按会话中的租户设置，请求结束后清除 |
| 登录接口 | `AuthService.login` 按填写的租户名称设置 |
| `@Async` 异步方法 | `TenantTaskDecorator` 把提交任务时的租户传递到异步线程（Spring Boot 自动应用到默认线程池） |
| 定时任务 | `SysJobService` 按租户逐个执行（每个租户在自己的租户上下文中，某个租户失败不影响其他租户，日志汇总各租户结果） |
| 未开启 SaaS | 以上场景中均为平台租户 |

开启 SaaS 后，**没有租户上下文时访问租户表直接报错**（`TenantContext.require()` 抛出「当前操作缺少租户上下文」），避免漏加条件读写到其他租户的数据。

需要切换租户时：

```java
// 以指定租户执行，结束后恢复原租户
List<HrShift> shifts = TenantContext.callAs(TenantContext.PLATFORM_TENANT_ID,
        () -> shiftMapper.selectList(Wrappers.emptyWrapper()));
TenantContext.runAs(tenantId, () -> doSomething());

// 不加租户条件执行，只用于平台的跨租户统计、清理
long total = TenantContext.callIgnore(() -> mapper.selectCount(null));
```

::: warning 自建线程与 @Scheduled
自己创建的线程、`@Scheduled` 方法没有租户上下文，开启 SaaS 后访问租户表会报错。异步处理用 `@Async`，定时任务实现 `JobHandler`（由调度器按租户执行），见 [新增定时任务](../guide/job)。
:::

## 平台租户

平台租户 ID 为 1（`TenantContext.PLATFORM_TENANT_ID`，`init.sql` 中的「柠檬科技」），是系统的运营方：

- 不受套餐限制，可以管理租户和套餐；
- 超级管理员 = 平台租户中的 `admin` 角色；
- 菜单、字典、参数设置、租户与套餐、服务监控、缓存监控、定时任务是平台专属功能（`PlatformFeatures`，按权限前缀 `sys:menu:`、`sys:dict:`、`sys:config:`、`sys:tenant`、`monitor:server:`、`monitor:cache:`、`monitor:job:` 判断），不能加入套餐，其他租户的用户即使被分配也不生效。

## 租户套餐与租户管理员

- **租户套餐**限定租户可用的菜单。其他租户的 `admin` 角色是租户管理员，菜单与套餐一致、随套餐修改自动同步；其他角色的权限也以套餐为上限。
- **新建租户**（`SysTenantService.create`，在新租户的上下文中执行）：
  1. 开通根部门、租户管理员账号（首次登录需修改密码）；
  2. 从平台复制内置岗位角色，菜单取与套餐的交集；
  3. 按 `@Order` 顺序调用各模块的 `TenantInitializer`，从平台复制基础数据：会计科目和币种（fin）、班次（hr）、预警规则（bi）、流程模型（workflow，复制为未发布的草稿，审批角色换成新租户中对应的角色）。
- **租户生命周期**：停用或到期后无法登录，已登录的会话立即失效；删除只删除租户记录，业务数据保留；账号数量达到上限后不能再新增用户或录用开通账号。

新模块需要为新租户准备基础数据时，实现 `TenantInitializer`，见 [新租户初始化](../guide/tenant-init)。

## 工作流

- 流程定义按租户部署（部署时 `tenantId` 为当前租户 ID），同一流程标识在各租户独立编号版本；
- 流程实例、任务继承流程定义的租户；按 ID 访问流程实例时都带上租户条件（`FlowTenant.current()`）。

## 缓存

缓存键以租户内唯一的值（用户名、编码等）作为 key 时，需要带上租户 ID。例如登录失败计数：

```java
// PasswordPolicy：平台租户为 login:fail:{username}，其他租户为 login:fail:{tenantId}:{username}
return TenantContext.isPlatform() ? FAIL_KEY + username : FAIL_KEY + TenantContext.require() + ":" + username;
```

以全局唯一 ID 作为 key（如 `login:perms:{userId}`）或缓存平台共享数据（如字典 `dict:{type}`）时不需要。

## 编写新代码的约定

| 约定 | 原因 |
| --- | --- |
| 新建业务表加 `tenant_id BIGINT NOT NULL DEFAULT 1`，唯一约束末尾加 `tenant_id` | 编码、单号在租户内唯一 |
| 平台共享的新表登记到 `TenantProperties.ignoreTables` | 没有 `tenant_id` 列，不能追加条件 |
| 不写 `INSERT ... SELECT`，改为先查询再批量 `INSERT ... VALUES`（示例 `BiEtlService`） | 拦截器对它处理不完整：SELECT 有 JOIN 时追加的列名有歧义，UNION 不加条件 |
| 不用 `TRUNCATE`，开启 SaaS 时改用带条件的 `DELETE`（示例 `SysOperLogService.clean`） | `TRUNCATE` 会清空所有租户的数据 |
| 缓存键按租户内唯一值作 key 时带上租户 ID | 不同租户可以有同名用户、同编码数据 |
| 不在自建线程、`@Scheduled` 中访问租户表 | 没有租户上下文会报错 |
| 新租户需要的基础数据实现 `TenantInitializer` | 新租户开通后即可使用 |

`SysOperLogService.clean` 的写法：

```java
public void clean() {
    if (tenantProperties.isEnabled()) {
        operLogMapper.deleteAll();   // DELETE FROM sys_oper_log WHERE id > 0，租户条件由拦截器追加
    } else {
        operLogMapper.truncate();    // 单租户时可以 TRUNCATE
    }
}
```

## 登录

开启 SaaS 后：

- `GET /auth/config` 返回 `tenantEnabled: true`，登录页显示「租户」输入框；
- 用户名只在租户内唯一，登录请求需要带 `tenantName`；
- 租户不存在、已停用或已到期时登录失败。
