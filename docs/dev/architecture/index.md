# 架构设计

本章介绍柠檬ERP 后端与前端的核心机制。二次开发前建议通读，了解每个机制「在哪里实现、业务代码需要做什么、不需要做什么」。

## 设计原则

- **分层单向依赖**：`lemon-common` → `lemon-framework` → 业务模块 → `lemon-admin`，业务模块之间也只允许单向依赖，由 Gradle 强制。上游需要下游的能力时，由框架层定义接口或事件、下游模块实现。
- **横切能力放在框架层，业务代码只做声明**：接口权限用 `@PreAuthorize`，操作日志用 `@OperLog`，数据权限用 `@DataPermission`，多租户由 MyBatis-Plus 拦截器自动追加条件，审批流程用 `FlowBusiness` 声明。
- **业务模块不直接依赖第三方引擎**：工作流只通过 `framework/workflow` 的 `FlowApi` 和事件接入，Flowable 只出现在 `lemon-workflow` 模块中。
- **SQL 集中在 mapper XML**：Java 代码中不写 SQL 字符串，统计在数据库中完成，避免 N+1。

## 核心机制一览

| 机制 | 实现位置 | 业务代码需要做的事 | 详细说明 |
| --- | --- | --- | --- |
| 模块与依赖 | 各模块 `build.gradle` | 新增依赖前确认不形成环 | [模块划分与依赖规则](./modules) |
| 认证与会话 | `framework/security`（`TokenService`、`JwtAuthenticationFilter`） | 无；需要当前用户时用 `SecurityUtils` | [认证与会话](./auth) |
| 权限 | `sys_menu` + `@ss`（`PermissionService`）+ `v-perm` | 接口加 `@PreAuthorize`，按钮加 `v-perm`，菜单登记到 `sys_menu` | [权限模型](./permission) |
| 数据权限 | `framework/security/datascope` | 查询方法加 `@DataPermission`，表里有部门列和用户列 | [数据权限](./data-scope) |
| 多租户 | `framework/tenant` + `TenantLineInnerInterceptor` | 新表加 `tenant_id`，唯一约束带 `tenant_id` | [SaaS 多租户](./tenant) |
| 工作流 | `framework/workflow` + `lemon-workflow` | 声明 `FlowBusiness`、调用 `FlowApi`、监听 `FlowFinishedEvent` | [工作流引擎集成](./workflow) |
| 业务联动 | 上游 Service 调用 / Spring 事件 / 框架层契约接口 | 下游调用上游、监听上游事件 | [业务联动](./integration) |
| 缓存 | `framework/cache/CacheService` | 键带前缀，登记到缓存监控 | [缓存](./cache) |
| 定时任务 | `framework/job/JobHandler` + `SysJobService` | 实现 `JobHandler` 注册为 Bean | [定时任务](./job) |
| 日志与审计 | `@OperLog`、登录日志、`ChangeLogger` | 增删改接口加 `@OperLog` | [日志与审计](./log) |
| 文件与附件 | `FileStorageService`、`RecordTypeProvider` | 登记业务记录类型，前端放 `AttachmentPanel` | [文件与附件](./file) |

## MyBatis-Plus 拦截器链

所有 SQL 都经过 `MybatisPlusConfig` 中注册的拦截器，顺序决定了条件的叠加方式：

| 顺序 | 拦截器 | 作用 |
| --- | --- | --- |
| 1 | `TenantLineInnerInterceptor`（只在 `lemon.tenant.enabled=true` 时注册） | 为租户表追加 `tenant_id = 当前租户`，INSERT 自动填充 `tenant_id` |
| 2 | `LazyDataPermissionInterceptor` | 只在当前线程启用了数据权限规则时改写 SQL，追加部门 / 用户条件 |
| 3 | `PaginationInnerInterceptor` | 分页与 count，单页最多 500 条（`MAX_PAGE_SIZE`） |
| 4 | `BlockAttackInnerInterceptor` | 拦截不带 WHERE 的 UPDATE / DELETE |

数据权限在分页之前，分页的 count 查询也会带上数据权限条件；租户条件最先追加，之后的数据权限、count、防全表操作都基于带租户条件的 SQL。

另外 `MetaObjectHandler` 在 INSERT 时自动填充 `createTime`、`updateTime`，UPDATE 时填充 `updateTime`（实体继承 `BaseEntity` 即可）。

## 统一返回与异常

- 接口统一返回 `R<T>`：`code`（200 成功、401 未登录、403 无权限、404、500 业务错误）、`msg`、`data`；分页数据为 `PageResult<T>`（`records`、`total`）。
- 业务校验失败抛 `BizException(message)`，由 `GlobalExceptionHandler` 转为 `R.fail`，前端拦截器统一弹出提示。
- 未知异常只记录日志，返回「系统繁忙，请稍后重试」，不把 SQL、堆栈等内部信息返回给前端；被框架包装的 `BizException` 会被解开按业务异常处理。
- 参数校验失败、请求体格式错误、唯一索引冲突（「数据已存在，请刷新后重试」）、上传过大等都有对应的友好提示。

## 前端架构

- 登录后请求 `/auth/info`（用户、角色、权限）和 `/auth/menus`（目录 + 菜单树），按菜单的 `component` 字段动态注册路由，见 [权限模型](./permission)。
- `utils/request.js` 是唯一的 HTTP 客户端：自动附带 `Authorization: Bearer` 令牌；`code` 为 200 时直接返回 `data`；401 跳转登录页；其他错误统一 `message.error` 提示并给错误打上 `handled` 标记，页面中不需要再 catch 提示。
- 布局分为顶部模块导航（`sys_menu` 一级目录）+ 侧边栏（当前模块的分组和页面）+ 多标签页；`/m` 下的移动作业页面使用全屏的移动端布局。
- 亮色 / 深色两套主题，通过 `html[data-theme='dark']` 切换全局 CSS 变量（`--app-*`）。
