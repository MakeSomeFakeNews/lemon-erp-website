# 开发指南

本章是二次开发的操作手册：先是后端、前端的编码规范，然后以一个完整的示例模块「行政办公 → 用车申请」串联起新增模块、单据开发公共组件、单据编号与打印、接入审批流、菜单授权等常见任务，最后是定时任务、缓存、新租户初始化、供应商门户、业务参数、自定义字段、国际化等专题。

## 内容清单

| 页面 | 内容 |
| --- | --- |
| [后端开发规范](./backend) | 分层与拆分、统一返回 `R`、异常、校验分组、枚举约定、SQL 约定（`StatusTransitions`、`Queries`）、分页上限、`@PreAuthorize`、`@OperLog`、Controller 的职责、接口类型化、事务边界、跨模块访问数据、制单人自动填充、`Decimals` |
| [前端开发规范](./frontend) | 列表页结构、`useTable`、`FormDrawer`、`SubPage`、`useDict` / `DictTag`（系统字典与业务字典）、`@/constants/enums` 状态常量、`useAction`、`useLineItems` / `LineItemsTable`、`utils/number.js`、下拉框与表格的显示约定、拆分大页面、`v-perm`、深色模式样式 |
| [新增一个业务模块](./new-module) | 从建 Gradle 模块、建表与字典（系统字典 / 业务字典）、写实体 / Mapper / Service / Controller，到前端页面与菜单的完整步骤 |
| [单据开发公共组件](./doc-components) | `ApprovalFlow` / `ApprovalSupport`、`StatusTransitions`、`DataScopes`、`DetailLines`、`Queries`、`Decimals`、制单人自动填充，前端 `useAction`、`useLineItems` + `LineItemsTable`；带明细行单据的完整示例 |
| [单据编号与打印](./doc-no-print) | `DocNoService` 取号、`DocNoCatalog` 声明、`printDocs` 打印、`PRINT_TYPES` 登记打印模板，后端 JasperReports 生成 PDF、JRXML 与套打 |
| [接入审批流](./approval) | `FlowBusiness` 声明、`ApprovalFlow` + `ApprovalSupport` 提交与撤回、`FLOW.onFinished` 回写状态、内置流程模型 |
| [扩展审批人类型、运算符、字段类型](./workflow-extend) | 新增 `AssigneeStrategy`、`ConditionOperator`、`FormFieldType`、节点类型的前后端改动 |
| [新增菜单与授权](./menu) | 在菜单管理或 `init.sql` 中登记模块、分组、页面、按钮，给内置角色授权 |
| [新增定时任务](./job) | 实现 `JobHandler`，参数、站内消息提醒、多租户 |
| [新增缓存](./cache) | 使用 `CacheService`、键命名、失效、登记到缓存监控 |
| [新租户初始化](./tenant-init) | 实现 `TenantInitializer` 为新租户复制基础数据 |
| [供应商门户接口开发](./portal) | 门户账号、`/portal/**` 接口、`requireSupplierId`、`portal:*` 权限 |
| [新增业务参数](./biz-rule) | 用 `BizRuleProvider` 登记按租户的业务控制和计算规则（开关、整数、小数、下拉、表格），业务代码通过 `BizRules` 读取，一组参数用 record 类型化读取 |
| [业务实体接入自定义字段](./custom-field) | 自定义字段的存储与权限，`useCustomFields` / `CustomFieldsForm` / `useCustomColumns` / `CustomFieldsView` 接入表单、列表、详情 |
| [国际化](./i18n) | 前端 vue-i18n 语言包与 `$t`、菜单和字典译文，后端 `MessageSource` 资源包、`BizException` 消息键、校验注解 `{键}`、`Accept-Language`，新增语言与检查脚本 |

## 新功能的开发流程

一个典型的业务功能（带审批的单据）从零到上线的步骤：

1. **建表**：在 `sql/init.sql` 中建表（带 `tenant_id`、`dept_id`、`create_by`，唯一约束带 `tenant_id`），插入字典（程序按取值判断的用系统字典，租户可扩充的分类用业务字典）；已有环境另写增量 SQL。
2. **后端**：枚举（`model` 包，与系统字典对应）→ 实体（继承 `BaseEntity`，状态字段用枚举）→ Mapper 与 mapper XML → Service（`@Transactional`、`DataScopes` 数据权限、`StatusTransitions` 状态流转、`DetailLines` 明细、`DictLookup` 业务字典校验、取单据号）→ Controller（只做 `@PreAuthorize`、`@OperLog`、校验和调用 Service）；提示和校验信息用消息键，登记在本模块的 `i18n/<模块>.properties`、`<模块>_en.properties` 中。
3. **单据编号**：在本模块的 `XxxDocNos` 中声明 `DocNoCatalog`。
4. **审批**：在 `XxxFlowBusinesses` 中声明 `FlowBusiness`，Service 中声明 `ApprovalFlow`，提交时 `approvalSupport.submit`，在 `FlowFinishedEvent` 监听器中用 `FLOW.onFinished` 回写状态；在 `init.sql` 中内置一个未发布的流程模型。
5. **前端**：`npm run gen:enums` 生成状态常量 → `api/<模块>/*.js` 接口 → `views/<模块>/<页面>/index.vue` 列表页（单条操作用 `useAction`）→ 表单（`FormDrawer`，明细用 `useLineItems` + `LineItemsTable`）和详情（`SubPage`）组件 → 打印（`printDocs` + `PRINT_TYPES`）；页面文字用 `$t`，键加到 `locales/zh-CN`、`locales/en-US` 两个语言包。
6. **菜单与授权**：登记模块目录、分组、页面和按钮权限，给需要的内置角色授权；内置菜单和字典在 `locales/en-US/menu.js`、`dict.js` 中加英文译文。
7. **扩展点**（按需）：首页待办 `TodoProvider`、附件与自定义字段 `RecordTypeProvider`、主数据引用检查 `ReferenceChecker`、定时提醒 `JobHandler`、新租户基础数据 `TenantInitializer`、业务控制规则 `BizRuleProvider`。
8. **自测**：用 admin 和只有部分权限、不同数据权限的账号分别验证菜单、按钮、接口权限和数据隔离；开启 `LEMON_TENANT_ENABLED=true` 验证多租户；运行 `npm run i18n:check`（同时检查枚举常量是否与后端一致）、`python3 scripts/check_i18n.py`，并切换为英文界面检查。

## 代码风格要点

- 状态、种类、方式等取值用枚举，实体字段直接用枚举类型，比较用 `==`，不写 `"XXX".equals(...)` 这样的字符串字面量；修改到老代码中已有的字符串比较时顺手改为枚举或常量。前端用 `@/constants/enums` 中的常量，不写 `'DRAFT'`。
- 事务边界在 Service；Controller 只接收参数、校验、声明权限和日志；只注入本模块的 Mapper，其他模块的数据通过其 Service 或 framework 契约读写；接口不返回 `Map`。
- 自定义 SQL 只写在 mapper XML 中，Java 中不写 SQL 字符串（包括 `.apply`、`.inSql`、`.setSql`）；单表简单条件可以用 `Wrappers`。
- 依赖版本只写在 `gradle/libs.versions.toml`。
- 不硬编码返回前端或显示在界面上的中文：后端用消息键（`BizException`、校验注解 `{键}`、`Messages.get`），前端用 `$t` / `t`；存入数据库的内容（站内消息、操作日志标题等）保持中文并在行内写 `i18n-ignore`。
- 编译保持零警告。
