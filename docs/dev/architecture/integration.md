---
order: 7
---

# 业务联动

ERP 的价值在于单据之间的自动联动：出入库更新库存、生成应收应付，业务单据生成凭证，审批结果回写单据。柠檬ERP 在模块单向依赖的前提下，用三种方式实现联动。

## 三种联动方式

| 方式 | 适用场景 | 示例 |
| --- | --- | --- |
| 下游直接调用上游的 Service | 下游模块需要上游的能力 | 供应链的采购入库调用仓库的 `WmsStockDocService` 生成并确认入库单；所有模块调用 wms 的 `DocNoService` 取单据号 |
| 上游发布事件、下游监听 | 上游的业务动作需要触发下游的处理，上游不感知下游 | 采购入库确认后 scm 发布 `TradeDocConfirmedEvent`，fin 监听生成应付单；fin 删除凭证时发布 `VoucherDeletedEvent`，hr 的工资表监听后解除关联 |
| 框架层定义接口、下游实现 | 上游需要同步拿到下游的数据或能力 | scm 校验客户信用额度时注入 `PartnerBalanceProvider`，由 fin 实现；仓库等模块注入 `BizPeriodGuard` 检查会计期间，由 fin 实现 |

## 同步事件与事务

柠檬ERP 的领域事件都用 Spring 的 `ApplicationEventPublisher` 在业务事务中**同步**发布，监听方用 `@EventListener`：

```java
// fin：出入库确认后生成应收 / 应付单，与出入库在同一事务
@EventListener
public void onTradeDocConfirmed(TradeDocConfirmedEvent e) {
    TradeKind kind = TradeKind.valueOf(e.kind());
    String billKind = kind.getOrderKind() == OrderKind.SALES ? BILL_AR : BILL_AP;
    ...
}
```

- 监听器与发布方在同一事务中执行，监听器抛出异常会让整张单据回滚，保证账实一致（例如期间已结账时生成应付单失败，采购入库也不会成功）；
- 下游可以通过抛出 `BizException` 阻止上游的操作（例如销售订单反审核时发布 `OrderStatusChangedEvent`，已生成生产计划时监听方抛异常阻止反审核）；
- 只需在提交后执行的副作用（发消息、调用外部系统）用 `@TransactionalEventListener`。

## 事件清单

| 事件 | 定义位置 | 发布时机 | 监听方 |
| --- | --- | --- | --- |
| `TradeDocConfirmedEvent` | scm | 采购入库 / 退货、销售出库 / 退货确认（库存已更新） | fin 生成应付 / 应收单；mes 处理委外 |
| `OrderStatusChangedEvent` | scm | 订单反审核、关闭等状态变化 | mes 检查或关闭生产计划；scm 释放库存预留 |
| `OrderDeletedEvent` | scm | 草稿订单删除 | crm 商机解除对订单的引用；scm 报价、询价、请购解除引用 |
| `ShipmentShippedEvent` | scm | 物流发运单发货 | fin 生成运费应付单 |
| `RebateSettledEvent` / `RebateUnsettledEvent` | scm | 销售返利结算 / 撤销 | fin 生成 / 删除红字应收单 |
| `WorkOrderClosedEvent` | mes | 生产工单关闭 | mes 撤销未完成的补料申请 |
| `MaintenanceFinishedEvent` | mes | 设备维修保养完成 | fin 生成费用凭证 |
| `SupplierClaimConfirmedEvent` / `SupplierClaimCancelledEvent` | mes | 供应商质量索赔确认 / 撤销 | fin 冲减应付 |
| `VoucherDeletedEvent` | fin | 删除凭证 | hr 工资表、培训，fin 资产、费用，pm 项目月结解除与凭证的关联 |
| `EmployeeLeftEvent` | framework/org | 人事异动（离职）生效 | system 停用账号；crm、pm 按交接人移交数据；workflow 移交待办；hr 处理劳动合同 |
| `EmployeeDeptChangedEvent` | framework/org | 员工调岗 | system 同步登录账号的部门 |
| `FlowFinishedEvent` | framework/workflow | 审批流程结束 | 各业务模块回写单据状态 |
| `FlowTaskAssignedEvent` | framework/workflow | 审批任务分配 | workflow 发送待办消息 |
| `OperLogEvent` / `LoginLogEvent` | framework/log | 操作 / 登录 | monitor 异步写入日志表 |

事件只在本模块内或下游使用时定义在本模块中（如 scm 的事件只有依赖 scm 的模块能监听）；需要被上游或平行模块监听的事件放在 framework 中（如 `EmployeeLeftEvent`：system、workflow 不依赖 hr）。

## 主要联动链路

```
采购订单 ─审核─▶ 采购入库 / 退货 ──▶ 仓库入库 / 出库单（保存即确认，更新库存、批次、序列号）
                       │ TradeDocConfirmedEvent
                       ▼
                    应付单 ─▶ 付款核销 ─▶ 凭证
销售订单 ─审核─▶ 销售出库 / 退货 ──▶ 仓库出库 / 入库单 ──▶ 物流发运
                       └─▶ 应收单 ─▶ 收款核销 ─▶ 凭证
销售订单 ─▶ 生产计划 ─▶ MRP ─▶ 生产工单（领料 / 退料 / 补料 / 完工入库 ─▶ 仓库单据）
                            └▶ 采购订单（按默认供应商合并）
组装拆卸单 ─确认─▶ 仓库出库单（子件 / 成套件）+ 入库单（成套件 / 子件）
期初库存导入 ─▶ 期初入库单 ─▶ 存货期初数量；期初往来导入 ─▶ 手工应收 / 应付单
仓库流水 + 采购金额 + 工单料工费 ─▶ 成本核算（按物料的计价方法）─▶ 成本结转凭证
销售出库 / 退货 + 当期成本 + 收款核销 ─▶ 销售提成（fin）─确认─▶ 工资表的「销售提成」
考勤 + 请假 + 绩效 + 报工计件 + 销售提成 ─▶ 工资表 ─▶ 计提凭证 / 发放凭证
发票（手工登记 / 导入数电票 XML、发票清单）─勾稽─▶ 应收 / 应付单
线索 ─▶ 客户 + 商机 ─赢单─▶ 销售订单
项目工时 + 项目领料 + 费用 ─▶ 项目成本；项目开票 ─▶ 应收单
全部业务表 ─ETL─▶ 数据仓库（bi_fact_*）─▶ 多维分析 / 报表 / 仪表盘
报工 / 设备 / 出入库 / 发货通知 / 销售订单 / 收款 / 检验 / 不合格品 ─实时查询─▶ 数据大屏（只读，不经数据仓库）
```

联动的约定：

- 由业务单据生成的仓库单据**保存即确认**，`wms_stock_doc.source_no` 记录来源单号；库存不足、序列号不在库等错误会让整张业务单据回滚。
- 仓库的手工出入库只能选「其他入库 / 其他出库」，采购、销售、生产、项目、委外等类型只由对应的业务单据生成（`WmsConstants.MANUAL_TYPES`），否则会绕过应收应付和成本归集。
- 采购入库 / 退货、销售出库 / 退货、工单领料 / 退料 / 完工入库都是保存即确认，不能修改删除，错误通过退货、退料冲回。
- 多规格物料的款式（`is_template = 1`）只用于生成 SKU 和按规格矩阵录入订单，`StockService.apply` 拒绝款式的库存变动，所有出入库都落在具体的 SKU 上。

- 组装拆卸单在仓库模块内完成：确认时在同一事务中生成并确认出入库单（出入库类型 `ASSEMBLY`，来源单号为组装拆卸单号），成本核算按子件成本结转成套件。
- 销售提成的代码在 fin（统计销售出库、成本、收款核销），工资表由 hr 直接调用 `FinCommissionService.confirmedAmounts(期间)` 取已确认的提成（hr 依赖 fin，属于「下游调用上游」）。

## 自动凭证的科目

业务单据生成凭证（应收应付、收付款、预收预付、票据、费用报销、借款、资产折旧、工资、成本结转、期末结转、项目月结等）时，科目不写死编码，一律由「凭证科目设置」决定：

```java
// pm 项目月结：合同履约成本、工资费用（按职位类别）
Long contractCost = accountRules.accountId(AccountRole.CONTRACT_COST);
Long expense = accountRules.accountId(AccountRole.SALARY_EXPENSE, positionCategory);
```

- `fin/model/AccountRole` 枚举列出全部用途（分组：往来、存货与成本、收入与费用、税费、资产、薪酬、期末），每个用途带默认科目编码（`init.sql` 预置的科目）；存货（`INVENTORY`）、主营业务收入（`REVENUE`）、主营业务成本（`COST_OF_SALES`）可按物料分类，工资费用（`SALARY_EXPENSE`）可按职位类别分别设置；
- `FinAccountRuleService.accountId(用途[, 维度取值])` 的取值顺序：用途 + 维度取值的设置 → 用途的设置 → 默认科目编码（带维度的用途还可以按维度给默认值，如半成品、成品的存货默认为库存商品 1405，低值易耗品为周转材料 1411；生产岗位的工资费用为制造费用 5101，销售岗位为销售费用 6601）；
- 设置保存在 `fin_account_rule`（按租户），设置的科目必须是启用的末级科目，被设置引用的科目不能删除、不能增加下级；修改只影响之后生成的凭证；
- 其他模块（hr 工资、pm 项目月结等）同样注入 `FinAccountRuleService` 取科目；新增自动凭证的用途时在 `AccountRole` 中登记，「凭证科目设置」页面自动列出。

凭证分录的辅助核算（部门、客户、供应商、项目、存货）在「会计科目」上设置（`fin_account.aux_items`，可多选，下级默认沿用上级），分录上各占一列（`dept_id`、`customer_id`、`supplier_id`、`project_id`、`material_id`），可同时填写。手工凭证使用设置了辅助核算的科目时对应项目必填；业务生成的凭证按单据自动带出客户、供应商等，不受科目设置约束。

## 存货计价

成本核算（`FinCostService`）按物料上设置的计价方法（`wms/model/CostMethod`）计算出库成本：

| 计价方法 | 说明 |
| --- | --- |
| `WEIGHTED` 月末一次加权平均（默认） | 本期出库按（期初 + 本期入库）的平均单价计价 |
| `MOVING` 移动加权平均 | 按出入库发生顺序逐笔计价（`MovingValuation`），每次入库后重算平均单价 |
| `FIFO` 先进先出 | 按发生顺序逐笔计价（`FifoValuation`），出库先消耗最早的批次；期末结存批次保存在 `fin_cost_layer`，作为下一期的期初批次 |

逐笔计价的两种方法共用 `Valuation` 接口（按金额入库、按当前成本入库、出库、采购退货冲减、期末结存）。逐笔计价得到期末结存后，本期出库总成本 = 期初 + 本期入库 − 期末结存，再按数量分摊到生产领用、销售、其他出库，因此凭证、工单材料成本与月末加权的处理方式一致。修改计价方法从下一次核算生效；撤销核算时一并删除当期的先进先出批次。

## 多实现的扩展接口

以下接口由每个业务模块各自实现、由框架或系统模块统一汇总，新模块按需实现即可接入对应的平台功能：

| 接口 | 汇总方 | 作用 | 示例 |
| --- | --- | --- | --- |
| `todo.TodoProvider` | dashboard（首页待办） | 按当前用户权限返回待处理事项，数量为 0 的不显示 | `WmsTodoProvider`（数量在 `WmsTodoMapper.xml` 中一次查询） |
| `job.JobHandler` | system（`SysJobService`） | 定时任务 | `WmsBatchExpiryJob` |
| `record.RecordTypeProvider` | system（附件、变更历史、自定义字段） | 登记可挂附件、记录变更历史、扩展自定义字段的业务类型 | `WmsRecordTypes` |
| `ref.ReferenceChecker` | `ReferenceGuard` | 删除物料、仓库、客户、供应商、用户、部门前检查本模块单据是否引用 | 每个模块一个 `XxxReferenceChecker` + `XxxRefMapper.xml` |
| `tenant.TenantInitializer` | system（新建租户） | 新租户基础数据 | `FinTenantInitializer` |
| `rule.BizRuleProvider` | system（`SysBizRuleService`，「业务参数」页面） | 登记本模块按租户配置的业务控制规则 | `ScmBizRules`、`FinBizRules` |
| `DocNoCatalog`（Bean） | 编码规则页面 | 声明本模块的单据编号类型 | `ScmDocNos` |
| `FlowBusiness`（Bean） | workflow | 声明本模块接入审批的流程及流程变量 | `ScmFlowBusinesses` |

### 主数据删除保护

删除主数据前调用 `ReferenceGuard.checkDeletable`，任一模块报告有引用时拒绝删除（提示「已被 XX 使用，不能删除，可以停用」）：

```java
// 第三个参数是显示在提示中的名称，按请求语言取（wms.text.material=物料「{0} {1}」）
referenceGuard.checkDeletable(RefType.MATERIAL, id, Messages.get("wms.text.material", material.getCode(), material.getName()));
```

`ReferenceChecker.findReference` 返回的是引用它的单据名称的**消息键**（由实现的模块登记），`ReferenceGuard` 用 `Messages.get` 取消息后拼成提示。

上游模块（如仓库）看不到下游模块（如生产、客户关系）的表，因此由下游模块实现 `ReferenceChecker`。新增业务表引用主数据时，在本模块的 `XxxRefMapper.xml` 中加一条查询。

### 站内消息

注入 `MessageSender` 发送站内消息，在业务事务中调用，事务回滚时消息一并回滚：

```java
messageSender.sendToPermission("wms:stock:list", Message.of("REMIND",
        "批次即将到期：" + code, "有效期至 " + expiryDate, "/wms/trace") // i18n-ignore 站内消息存库
        .dedup("batch-expiry:" + materialId + ":" + batchNo));
```

站内消息存入数据库并推送到钉钉等平台，标题和内容保持中文，不按触发用户的语言生成（见 [国际化](../guide/i18n)）。

| 方法 | 说明 |
| --- | --- |
| `send(userIds, message)` | 发送给指定用户 |
| `sendToPermission(perm, message)` | 发送给拥有该权限的全部启用用户；没有人拥有时发给超级管理员 |
| `Message.of(category, title, content, link)` | `category` 取字典 `sys_message_category`：`APPROVAL` 审批、`REMIND` 提醒、`ALERT` 预警、`SYSTEM` 系统；`link` 为点击后跳转的前端路由 |
| `message.dedup(key)` | 同一用户已有相同去重键的消息时不再发送（定时提醒每天只发一次） |

站内消息写入后，`SysMessageService` 发布 `MessageSentEvent`，事务提交后由 `SysImPushService` 异步推送给已绑定的钉钉 / 企业微信 / 飞书成员，并按类别发到群机器人；`link` 会转为平台客户端内的免登链接。业务代码不需要额外处理，见 [第三方集成](./im#消息推送)。
