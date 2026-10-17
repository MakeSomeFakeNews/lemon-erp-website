# 架构设计

本章介绍柠檬ERP 后端与前端的核心机制。二次开发前建议通读，了解每个机制「在哪里实现、业务代码需要做什么、不需要做什么」。

![柠檬ERP 技术架构图](/images/arch/tech.png)

各模块之间的业务联动见用户手册的 [业务架构图](/manual/guide/#业务架构)。

## 设计原则

- **分层单向依赖**：`lemon-common` → `lemon-framework` → 业务模块 → `lemon-admin`，业务模块之间也只允许单向依赖，由 Gradle 强制。上游需要下游的能力时，由框架层定义接口或事件、下游模块实现。
- **模块只写自己的表**：只注入本模块的 Mapper，修改其他模块的数据调用所属模块的 Service 或 framework 契约；跨模块的 SQL JOIN 只用于只读的报表和统计。
- **分层职责清晰**：Controller 只做参数、权限、日志；事务边界、业务规则在 Service；接口返回明确的类型（record / DTO），不返回 `Map`；状态、类型用枚举，前端常量由后端枚举生成。
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
| 业务联动 | 上游 Service 调用 / Spring 事件 / 框架层契约接口 | 下游调用上游、监听上游事件；回写上游数据调用上游 Service | [业务联动](./integration) |
| 字典 | `SysDictService`（系统字典 / 业务字典）+ `framework/dict/DictLookup` | 状态等用系统字典 + 枚举；租户可扩充的分类用业务字典，保存时 `DictLookup.check` | [SaaS 多租户 → 字典](./tenant#字典) |
| 单据开发公共组件 | `framework/workflow`（`ApprovalSupport`）、`framework/data`（`StatusTransitions`、`DetailLines`、`Queries`）、`DataScopes`、`Decimals`；前端 `useAction`、`useLineItems`、`LineItemsTable`、`constants/enums` | 新单据直接使用，不重复实现 | [单据开发公共组件](../guide/doc-components) |
| 缓存 | `framework/cache/CacheService` | 键带前缀，登记到缓存监控 | [缓存](./cache) |
| 定时任务 | `framework/job/JobHandler` + `SysJobService` | 实现 `JobHandler` 注册为 Bean | [定时任务](./job) |
| 日志与审计 | `@OperLog`、登录日志、`ChangeLogger` | 增删改接口加 `@OperLog` | [日志与审计](./log) |
| 文件与附件 | `FileStorageService`、`RecordTypeProvider` | 登记业务记录类型，前端放 `AttachmentPanel` | [文件与附件](./file) |
| 第三方集成 | `modules/system/im`（`ImClient`、`ImHttp`）+ `SysIm*Service` | 无；业务通知用 `MessageSender` 发送即自动推送到钉钉 / 企业微信 / 飞书 | [第三方集成](./im) |
| 单据打印 | `modules/system/print`（JasperReports）+ `utils/print.js` | 页面调用 `printDocs`，在 `PRINT_TYPES` 中登记 | [单据编号与打印](../guide/doc-no-print) |
| 业务参数 | `framework/rule` + `SysBizRuleService` | 实现 `BizRuleProvider` 登记，注入 `BizRules` 读取 | [新增业务参数](../guide/biz-rule) |
| 自定义字段 | `SysCustomFieldService` + `useCustomFields` | 登记业务记录类型，表单 / 列表 / 详情接入 | [业务实体接入自定义字段](../guide/custom-field) |
| 国际化 | 前端 vue-i18n（`src/locales`）；后端 `MessageSource` 资源包（各模块 `i18n/*.properties`）+ `I18nConfig`（`Accept-Language`） | 页面文字用 `$t`，提示和校验用消息键，内置菜单和字典加英文译文 | [国际化](../guide/i18n) |

## MyBatis-Plus 拦截器链

所有 SQL 都经过 `MybatisPlusConfig` 中注册的拦截器，顺序决定了条件的叠加方式：

| 顺序 | 拦截器 | 作用 |
| --- | --- | --- |
| 1 | `TenantLineInnerInterceptor`（只在 `lemon.tenant.enabled=true` 时注册） | 为租户表追加 `tenant_id = 当前租户`，INSERT 自动填充 `tenant_id` |
| 2 | `LazyDataPermissionInterceptor` | 只在当前线程启用了数据权限规则时改写 SQL，追加部门 / 用户条件 |
| 3 | `PaginationInnerInterceptor` | 分页与 count，单页最多 500 条（`MAX_PAGE_SIZE`） |
| 4 | `BlockAttackInnerInterceptor` | 拦截不带 WHERE 的 UPDATE / DELETE |
| 5 | `CreateByInnerInterceptor`（`MybatisPlusConfig` 内部类） | 插入实体时 `createBy` 为空则填当前登录用户（在生成 SQL 之前赋值；没有登录用户时保持为空） |

数据权限在分页之前，分页的 count 查询也会带上数据权限条件；租户条件最先追加，之后的数据权限、count、防全表操作都基于带租户条件的 SQL。

另外 `MetaObjectHandler` 在 INSERT 时自动填充 `createTime`、`updateTime`，UPDATE 时填充 `updateTime`（实体继承 `BaseEntity` 即可；用条件构造器 `lambdaUpdate()` 更新时不经过实体，不会自动填充 `updateTime`）。制单人 `createBy` 不能放在 `MetaObjectHandler` 中填充（没有 `@TableField(fill = ...)` 的字段，INSERT 语句在填充之前就已按是否为空生成），所以由 `CreateByInnerInterceptor` 处理；用 mapper XML 多值 INSERT 插入的数据不经过实体，需要自己赋值。

## 统一返回与异常

- 接口统一返回 `R<T>`：`code`（200 成功、401 未登录、403 无权限、404、500 业务错误）、`msg`、`data`；分页数据为 `PageResult<T>`（`records`、`total`）。
- 业务校验失败抛 `BizException(消息键, 参数…)`，由 `GlobalExceptionHandler` 按请求语言取消息后转为 `R.fail`，前端拦截器统一弹出提示。
- 请求体中枚举、数字等字段取值不合法时，提示具体字段和取值（「字段 xxx 的取值“yyy”不正确」）。
- 未知异常只记录日志，返回「系统繁忙，请稍后重试」，不把 SQL、堆栈等内部信息返回给前端；被框架包装的 `BizException` 会被解开按业务异常处理。
- 参数校验失败、请求体格式错误、唯一索引冲突（「数据已存在，请刷新后重试」）、上传过大等都有对应的友好提示。
- 返回的 `msg` 按请求头 `Accept-Language` 输出中文或英文（前端按界面语言发送），没有请求头、定时任务和异步线程中为中文，见 [国际化](../guide/i18n)。

## 前端架构

- 登录后请求 `/auth/info`（用户、角色、权限）和 `/auth/menus`（目录 + 菜单树），按菜单的 `component` 字段动态注册路由，见 [权限模型](./permission)。
- `utils/request.js` 是唯一的 HTTP 客户端：自动附带 `Authorization: Bearer` 令牌和界面语言的 `Accept-Language`；`code` 为 200 时直接返回 `data`；401 跳转登录页；其他错误统一 `message.error` 提示并给错误打上 `handled` 标记，页面中不需要再 catch 提示。
- 布局分为顶部模块导航（`sys_menu` 一级目录）+ 侧边栏（当前模块的分组和页面）+ 多标签页；`/m` 下的移动作业页面使用全屏的移动端布局。
- 亮色 / 深色两套主题，通过 `html[data-theme='dark']` 切换全局 CSS 变量（`--app-*`）。
- 状态、类型常量 `src/constants/enums.js` 由后端 Java 枚举生成（`npm run gen:enums`），前后端取值保持一致；页面中的通用写法抽成组合式函数和组件（`useTable`、`useFormDrawer`、`useAction`、`useLineItems`、`LineItemsTable`），数字格式统一用 `utils/number.js`，见 [前端开发规范](../guide/frontend)。
- 下拉框弹层按内容宽度展开、长选项换行，表格省略单元格悬停显示全文，由 `main.js`、`style.css`、`utils/ellipsisTitle.js` 全局处理。
- 简体中文 / 英文两种界面语言（vue-i18n），语言包在 `src/locales/<语言>/<模块>.js`；菜单和字典在数据库中保存中文，英文译文在 `locales/en-US/menu.js`、`dict.js`；切换语言后刷新页面，Ant Design 和 dayjs 同步切换语言包。
