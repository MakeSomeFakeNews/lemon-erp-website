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
仓库流水 + 采购金额 + 工单料工费 ─▶ 成本核算 ─▶ 成本结转凭证
考勤 + 请假 + 绩效 + 报工计件 ─▶ 工资表 ─▶ 计提凭证 / 发放凭证
线索 ─▶ 客户 + 商机 ─赢单─▶ 销售订单
项目工时 + 项目领料 + 费用 ─▶ 项目成本；项目开票 ─▶ 应收单
全部业务表 ─ETL─▶ 数据仓库（bi_fact_*）─▶ 多维分析 / 报表 / 仪表盘
```

联动的约定：

- 由业务单据生成的仓库单据**保存即确认**，`wms_stock_doc.source_no` 记录来源单号；库存不足、序列号不在库等错误会让整张业务单据回滚。
- 仓库的手工出入库只能选「其他入库 / 其他出库」，采购、销售、生产、项目、委外等类型只由对应的业务单据生成（`WmsConstants.MANUAL_TYPES`），否则会绕过应收应付和成本归集。
- 采购入库 / 退货、销售出库 / 退货、工单领料 / 退料 / 完工入库都是保存即确认，不能修改删除，错误通过退货、退料冲回。

## 多实现的扩展接口

以下接口由每个业务模块各自实现、由框架或系统模块统一汇总，新模块按需实现即可接入对应的平台功能：

| 接口 | 汇总方 | 作用 | 示例 |
| --- | --- | --- | --- |
| `todo.TodoProvider` | dashboard（首页待办） | 按当前用户权限返回待处理事项，数量为 0 的不显示 | `WmsTodoProvider`（数量在 `WmsTodoMapper.xml` 中一次查询） |
| `job.JobHandler` | system（`SysJobService`） | 定时任务 | `WmsBatchExpiryJob` |
| `record.RecordTypeProvider` | system（附件、变更历史） | 登记可挂附件、记录变更历史的业务类型 | `WmsRecordTypes` |
| `ref.ReferenceChecker` | `ReferenceGuard` | 删除物料、仓库、客户、供应商、用户、部门前检查本模块单据是否引用 | 每个模块一个 `XxxReferenceChecker` + `XxxRefMapper.xml` |
| `tenant.TenantInitializer` | system（新建租户） | 新租户基础数据 | `FinTenantInitializer` |
| `DocNoCatalog`（Bean） | 编码规则页面 | 声明本模块的单据编号类型 | `ScmDocNos` |
| `FlowBusiness`（Bean） | workflow | 声明本模块接入审批的流程及流程变量 | `ScmFlowBusinesses` |

### 主数据删除保护

删除主数据前调用 `ReferenceGuard.checkDeletable`，任一模块报告有引用时拒绝删除（提示「已被 XX 使用，不能删除，可以停用」）：

```java
referenceGuard.checkDeletable(RefType.MATERIAL, id, "物料「" + material.getCode() + " " + material.getName() + "」");
```

上游模块（如仓库）看不到下游模块（如生产、客户关系）的表，因此由下游模块实现 `ReferenceChecker`。新增业务表引用主数据时，在本模块的 `XxxRefMapper.xml` 中加一条查询。

### 站内消息

注入 `MessageSender` 发送站内消息，在业务事务中调用，事务回滚时消息一并回滚：

```java
messageSender.sendToPermission("wms:stock:list", Message.of("REMIND",
        "批次即将到期：" + code, "有效期至 " + expiryDate, "/wms/trace")
        .dedup("batch-expiry:" + materialId + ":" + batchNo));
```

| 方法 | 说明 |
| --- | --- |
| `send(userIds, message)` | 发送给指定用户 |
| `sendToPermission(perm, message)` | 发送给拥有该权限的全部启用用户；没有人拥有时发给超级管理员 |
| `Message.of(category, title, content, link)` | `category` 取字典 `sys_message_category`：`APPROVAL` 审批、`REMIND` 提醒、`ALERT` 预警、`SYSTEM` 系统；`link` 为点击后跳转的前端路由 |
| `message.dedup(key)` | 同一用户已有相同去重键的消息时不再发送（定时提醒每天只发一次） |
