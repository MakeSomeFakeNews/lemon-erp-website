---
order: 1
---

# 模块划分与依赖规则

柠檬ERP 按「通用层 → 框架层 → 业务模块 → 启动模块」分层，业务模块之间只允许单向依赖。依赖关系由各模块 `build.gradle` 中的 `project(...)` 声明，Gradle 在编译期强制：没有声明依赖的模块，其类在编译时根本不可见。

## 分层

| 模块 | 职责 | 可以依赖 |
| --- | --- | --- |
| `lemon-common` | 统一返回、异常、实体基类、校验分组、工具类 | Spring Boot Web、Validation、Security、MyBatis-Plus |
| `lemon-framework` | 安全认证、数据权限、多租户、缓存、日志、文件、Excel、定时任务契约，以及业务模块之间的契约接口和事件 | `lemon-common`、Redis、AspectJ、JSqlParser、JJWT、ip2region |
| `lemon-modules/*` | 业务功能 | `lemon-framework` 和按需声明的其他业务模块 |
| `lemon-admin` | 启动类、配置文件，组装全部业务模块打包 | 全部业务模块、MySQL 驱动 |

框架层不依赖任何业务模块，因此只能定义接口、事件和通用能力，具体实现由业务模块提供。

## 业务模块依赖关系

以各模块 `build.gradle` 为准（均为 `api project(...)`，依赖会传递）：

| 模块 | 直接依赖 | 说明 |
| --- | --- | --- |
| `lemon-system` | framework | 系统管理 |
| `lemon-monitor` | system | 系统监控（另依赖 OSHI） |
| `lemon-dashboard` | monitor | 首页工作台 |
| `lemon-workflow` | framework | 流程中心（另依赖 Flowable），不依赖任何业务模块 |
| `lemon-wms` | framework | 仓库管理 |
| `lemon-scm` | wms | 供应链管理 |
| `lemon-mes` | scm、wms | 生产制造、质量管理 |
| `lemon-fin` | mes、scm、wms | 财务管理 |
| `lemon-hr` | fin、system、wms | 人力资源 |
| `lemon-crm` | fin、scm、wms | 客户关系（校验负责人通过 framework 的 `UserLookup`，不依赖 system） |
| `lemon-pm` | fin、hr、scm、wms | 项目管理（system 经 hr 传递；校验项目经理、成员通过 `UserLookup`） |
| `lemon-bi` | fin、scm | 商务智能 |

可以概括为两条主线和一个独立模块：

- 业务主线：`wms ← scm ← mes ← fin ← hr / crm / pm / bi`（箭头指向被依赖方，`pm` 还依赖 `hr`）；
- 系统主线：`system ← monitor ← dashboard`，`hr` 也依赖 `system`（`pm` 经 `hr` 传递）；
- `workflow` 只依赖 framework，与所有业务模块解耦。

`lemon-admin` 依赖全部业务模块，启动类 `LemonErpApplication` 位于 `com.lemon.erp` 包，组件扫描覆盖所有模块；`@MapperScan("com.lemon.erp.modules.*.mapper")` 扫描各模块的 Mapper，`mybatis-plus.mapper-locations: classpath*:mapper/**/*.xml` 加载各模块的 mapper XML。

## 依赖规则

1. **只允许单向依赖**：新增跨模块引用前，先确认不会形成环。例如 wms 不能引用 scm 的类，因为 scm 已经依赖 wms。
2. **下游调用上游**：下游模块可以直接注入上游模块的 Service（例如 fin 注入 scm 的查询服务），上游不感知下游。**只能注入其他模块的 Service，不能注入其他模块的 Mapper**；需要修改上游的数据时（如财务生成运费应付单后回写发运单），调用上游 Service 提供的方法（`ScmShipmentService.bindFreightBill`），见 [业务联动](./integration#下游处理后回写上游)。
3. **上游需要下游的能力时**，在 `lemon-framework` 中定义契约，由下游模块实现：
   - **接口**：上游注入接口，下游实现为 Spring Bean。例如供应链校验客户信用额度时需要应收余额，框架层定义 `PartnerBalanceProvider`，财务模块的 `FinPartnerBalanceProvider` 实现；
   - **事件**：上游发布事件，下游用 `@EventListener` 监听。例如人力资源发布 `EmployeeLeftEvent`，系统模块停用账号、客户关系和项目移交数据、工作流移交待办。
4. **只在本模块内使用的事件放在本模块**：例如 scm 的 `TradeDocConfirmedEvent`（出入库确认）由 fin 监听生成应收应付单，fin 依赖 scm，因此事件定义在 scm 中即可。
5. **报表类查询直接关联上游表**：例如成本核算读取仓库流水、采购金额、工单数据，直接在 fin 的 mapper XML 中 JOIN 上游表，不在上游模块增加只为财务服务的接口。这类跨模块 JOIN 只允许读，写操作必须经过数据所属模块的 Service。

框架层中的契约接口与实现方：

| 契约（framework 包） | 用途 | 实现模块 |
| --- | --- | --- |
| `security.LoginUserLoader` | 加载登录用户的角色、权限、数据权限 | system（`SysLoginUserLoader`） |
| `workflow.identity.FlowIdentityProvider` | 工作流查询用户、角色、部门链 | system（`SysFlowIdentityProvider`） |
| `workflow.FlowApi` | 业务单据发起、撤销流程，查询状态 | workflow（`FlowApiImpl`） |
| `setting.SettingService` | 读取系统参数 | system（`SysConfigService`） |
| `rule.BizRules` | 读取当前租户的业务参数 | system（`SysBizRuleService`） |
| `message.MessageSender` | 发送站内消息 | system（`SysMessageService`） |
| `record.ChangeLogger` | 记录字段变更历史 | system（`SysChangeLogService`） |
| `portal.PortalAccounts` | 管理供应商 / 经销商门户账号 | system（`SysPortalAccountService`） |
| `org.UserAccountProvisioner` | 为新员工开通登录账号 | system |
| `org.UserLookup` | 按 ID 查询登录账号的简要信息（`find`、`require`、`requireActive`、`nameOf`），客户关系、项目校验负责人、成员 | system（`SysUserLookup`） |
| `dict.DictLookup` | 按当前租户的字典校验业务字典的取值（`contains`、`check(字典, 值, 字段名称键)`） | system（`SysDictService`） |
| `finance.PartnerBalanceProvider` | 客户应收余额（信用额度校验） | fin |
| `finance.ExchangeRateProvider` | 外币记账汇率 | fin（`FinCurrencyService`） |
| `period.BizPeriodGuard` | 会计期间已结账时禁止新增 / 确认业务单据 | fin（`FinBizPeriodGuard`） |
| `quality.SupplierQualityProvider` | 供应商来料合格率、索赔统计 | mes（`MesSupplierQualityProvider`） |
| `org.LaborCostProvider` | 生产岗位平均小时人工成本 | hr（`HrSalaryService`） |

框架层还提供了不需要业务模块实现、直接注入使用的通用组件，如审批的 `workflow.ApprovalSupport`（基于 `FlowApi`）、`data.StatusTransitions`、`data.DetailLines`、`data.Queries`、`security.datascope.DataScopes`，见 [单据开发公共组件](../guide/doc-components)。

另外还有一类「多实现」的扩展接口，每个业务模块各自实现、由框架或系统模块汇总：`TodoProvider`（首页待办）、`JobHandler`（定时任务）、`RecordTypeProvider`（附件与变更历史的业务类型）、`ReferenceChecker`（主数据删除前的引用检查）、`TenantInitializer`（新租户基础数据）、`BizRuleProvider`（业务参数定义）、`DocNoCatalog` Bean（单据编号类型）、`FlowBusiness` Bean（审批流程）。详见 [业务联动](./integration)。

## 新增模块

新增业务模块的完整步骤（建 `build.gradle`、登记 `settings.gradle` 和 `lemon-admin/build.gradle`、包结构、mapper XML 位置）见 [新增一个业务模块](../guide/new-module)。
