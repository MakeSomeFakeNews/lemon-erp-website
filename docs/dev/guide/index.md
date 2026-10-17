# 开发指南

本章是二次开发的操作手册：先是后端、前端的编码规范，然后以一个完整的示例模块「行政办公 → 用车申请」串联起新增模块、单据编号与打印、接入审批流、菜单授权等常见任务，最后是定时任务、缓存、新租户初始化、供应商门户、业务参数、自定义字段等专题。

## 内容清单

| 页面 | 内容 |
| --- | --- |
| [后端开发规范](./backend) | 统一返回 `R`、异常、校验分组、枚举约定、SQL 约定、分页上限、`@OperLog`、`@PreAuthorize`、事务 |
| [前端开发规范](./frontend) | 列表页结构、`useTable`、`FormDrawer`、`SubPage`、`useDict` / `DictTag`、`v-perm`、深色模式样式 |
| [新增一个业务模块](./new-module) | 从建 Gradle 模块、建表、写实体 / Mapper / Service / Controller，到前端页面与菜单的完整步骤 |
| [单据编号与打印](./doc-no-print) | `DocNoService` 取号、`DocNoCatalog` 声明、`printDocs` 打印、`PRINT_TYPES` 登记打印模板，后端 JasperReports 生成 PDF、JRXML 与套打 |
| [接入审批流](./approval) | `FlowBusiness` 声明、`FlowApi` 发起与撤回、监听 `FlowFinishedEvent` 回写状态、内置流程模型 |
| [扩展审批人类型、运算符、字段类型](./workflow-extend) | 新增 `AssigneeStrategy`、`ConditionOperator`、`FormFieldType`、节点类型的前后端改动 |
| [新增菜单与授权](./menu) | 在菜单管理或 `init.sql` 中登记模块、分组、页面、按钮，给内置角色授权 |
| [新增定时任务](./job) | 实现 `JobHandler`，参数、站内消息提醒、多租户 |
| [新增缓存](./cache) | 使用 `CacheService`、键命名、失效、登记到缓存监控 |
| [新租户初始化](./tenant-init) | 实现 `TenantInitializer` 为新租户复制基础数据 |
| [供应商门户接口开发](./portal) | 门户账号、`/portal/**` 接口、`requireSupplierId`、`portal:*` 权限 |
| [新增业务参数](./biz-rule) | 用 `BizRuleProvider` 登记按租户的业务控制规则，业务代码通过 `BizRules` 读取 |
| [业务实体接入自定义字段](./custom-field) | 自定义字段的存储与权限，`useCustomFields` / `CustomFieldsForm` / `useCustomColumns` / `CustomFieldsView` 接入表单、列表、详情 |

## 新功能的开发流程

一个典型的业务功能（带审批的单据）从零到上线的步骤：

1. **建表**：在 `sql/init.sql` 中建表（带 `tenant_id`、`dept_id`、`create_by`，唯一约束带 `tenant_id`），插入字典；已有环境另写增量 SQL。
2. **后端**：实体（继承 `BaseEntity`，状态字段用枚举）→ Mapper 与 mapper XML → Service（`@Transactional`、数据权限、状态校验、取单据号）→ Controller（`@PreAuthorize`、`@OperLog`、校验）。
3. **单据编号**：在本模块的 `XxxDocNos` 中声明 `DocNoCatalog`。
4. **审批**：在 `XxxFlowBusinesses` 中声明 `FlowBusiness`，提交时 `flowApi.start`，监听 `FlowFinishedEvent` 回写状态；在 `init.sql` 中内置一个未发布的流程模型。
5. **前端**：`api/<模块>/*.js` 接口 → `views/<模块>/<页面>/index.vue` 列表页 → 表单（`FormDrawer`）和详情（`SubPage`）组件 → 打印（`printDocs` + `PRINT_TYPES`）。
6. **菜单与授权**：登记模块目录、分组、页面和按钮权限，给需要的内置角色授权。
7. **扩展点**（按需）：首页待办 `TodoProvider`、附件与自定义字段 `RecordTypeProvider`、主数据引用检查 `ReferenceChecker`、定时提醒 `JobHandler`、新租户基础数据 `TenantInitializer`、业务控制规则 `BizRuleProvider`。
8. **自测**：用 admin 和只有部分权限、不同数据权限的账号分别验证菜单、按钮、接口权限和数据隔离；开启 `LEMON_TENANT_ENABLED=true` 验证多租户。

## 代码风格要点

- 状态、种类、方式等取值用枚举，实体字段直接用枚举类型，比较用 `==`，不写 `"XXX".equals(...)` 这样的字符串字面量；修改到老代码中已有的字符串比较时顺手改为枚举或常量。
- 自定义 SQL 只写在 mapper XML 中，Java 中不写 SQL 字符串（包括 `.apply`、`.inSql`、`.setSql`）；单表简单条件可以用 `Wrappers`。
- 依赖版本只写在 `gradle/libs.versions.toml`。
- 编译保持零警告。
