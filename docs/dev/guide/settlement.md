---
order: 20
---

# 应收应付核销开发

本页说明 fin 模块中应收应付单的核销模型：收付款自动核销、核销折让 / 抹零（含外币）、多收转预收预付、收付款中冲抵预收预付、实收为 0、收付款草稿与确认、往来汇总、来源单据穿透、外币预收预付、冲账单与凭证、应付坏账，以及扩展时要改的地方。代码在 `lemon-modules/lemon-fin`（包 `com.lemon.erp.modules.fin`），前端在 `lemon-web/src/components/fin`、`views/fin`。

## 核销模型

应收单、应付单共用 `fin_bill`（`kind` = `AR` / `AP`，`BillKind`），红字单据（退货、质量索赔、返利、冲账单等）金额为负数。返利红字单据的生成见[其他收支、调拨与返利开发](./cash-rebate#返利协议)。单据上的累计字段：

| 字段 | 含义 |
| --- | --- |
| `amount` / `amount_fc` | 本位币金额 / 原币金额（本位币单据两者相同），`exchange_rate` 为记账汇率 |
| `settled_amount` / `settled_fc` | 已核销（本位币 / 原币），**包含折让、预收预付冲抵、坏账** |
| `discount_amount` | 其中收付款时的折让 / 抹零（本位币），列表显示用 |
| `bad_debt_amount` | 其中坏账核销（应收）/ 无法支付转销（应付） |
| `status` | `BillStatus`：未核销 / 部分核销 / 已核销 |

金额为 0 的单据（整单赠品等）没有可核销的金额，也没有分录：生成时直接为 `SETTLED`，`FinBillService` 批量生成凭证时跳过（`FinBill.zeroAmount()`，否则会报「凭证至少需要两条分录」导致同批回滚），结账检查（`FinCloseCheckService`）的「未生成凭证」不计入 `amount = 0` 的单据，前端 `BillPage.vue` 显示「金额为 0 无需凭证」且不能勾选。

所有核销都经过 `FinBillMapper.addSettled`（条件更新：蓝字 `0 ≤ settled + x ≤ amount`，红字反向），失败即超过未核销金额，抛出 `fin.error.settledAmountExceedsOutstandingAmount`；原币另由 `addSettledFc` 累加。能减少单据余额的来源：

| 来源 | 记录 | 代码 |
| --- | --- | --- |
| 收付款核销（含折让） | `fin_settlement` + `fin_settlement_item`（`amount` / `amount_fc` 核销，`discount` / `discount_fc` 折让） | `FinSettlementService` |
| 预收预付冲抵 | `fin_advance_apply`（`amount` 预收预付一方本位币、`amount_fc` 原币、`bill_amount` 单据一方本位币） | `FinAdvanceService.apply` |
| 坏账 / 无法支付转销 | `bad_debt_amount` + `BAD_DEBT` 凭证 | `FinBillService.writeOffBadDebt` |
| 票据收票、背书、开票 | 生成结算方式为 `NOTE` 的收付款单 | `FinNoteService` |

账龄（`FinBillMapper.xml` 的 aging）、往来对账单（`FinPartnerLedgerMapper.xml`）按 `si.amount + si.discount` / `s.amount + s.discount_amount` 计入核销，保证与单据的已核销一致。

## 收付款单

`POST /fin/settlement/{receipt|payment}`（修改草稿 `PUT .../{id}`），请求 `SettlementRequest`：

| 字段 | 说明 |
| --- | --- |
| `items` | `SettlementItemRequest(billId, amount, discount)`；`amount` 为核销金额（实收实付，红字单据为负数，有折让时可以为 0），`discount` 与单据同号，`amount + discount` 不超过未核销 |
| `totalAmount` | 本次收付款总额，可为空（= 核销合计）；不能小于核销合计（`fin.error.settlementTotalLessThanSettled`） |
| `toAdvance` | 总额大于核销合计时必须为 `true`（否则 `fin.error.overpaidChooseAdvance`），多出部分转预收预付 |
| `exchangeRate` | 外币时的收付款汇率 |
| `advances` | `SettlementAdvanceRequest(advanceId, amount)`，冲抵的预收预付（原币），见[收付款中冲抵预收预付](#收付款中冲抵预收预付) |
| `confirm` | 开启「收付款先存草稿」时 `true` 保存并确认，否则存草稿；未开启时忽略，见[草稿与确认](#草稿与确认) |

`FinSettlementService.create` 的要点：

- 同一张收付款单只能核销同一往来单位、同一币种的单据；实收实付（`fin_settlement.amount_fc` = 核销合计 − 冲抵的预收预付）**不能小于 0**，可以为 0（红字冲账单、退货或预收预付恰好抵消欠款）；
- 收付款单的 `amount` / `amount_fc` 只是核销合计（实收实付），折让合计记 `discount_amount` / `discount_fc`，多收部分记 `advance_amount`（原币），都不含在 `amount` 中；
- `save` 先校验并保存为 `DRAFT`，生效时（`doConfirm` → `effectuate`）才核销，见[草稿与确认](#草稿与确认)；不走审批时立即核销：`addSettled(本位币核销 + 本位币折让)`、`addSettledFc(原币核销 + 原币折让)`、`addDiscount`，然后 `toAdvance`；
- 付款审批（`fin_payment`，`ApprovalFlow` `PAYMENT_FLOW`）时确认只校验未核销金额（`checkOutstanding`），审批通过后（`onFlowFinished`）才核销并生成预付单；审批变量 `amount` 为实际付出的本位币 = `s.amount`（核销合计，外币为原币 × 收付款汇率）+ `advance × settleRate`（多付转预付），不能只取核销合计，否则可以把大额付款做成预付绕过金额条件；
- 删除（未生成凭证）已生效的单据时按明细反向 `addSettled` / `addSettledFc` / `addDiscount`，`revokeForSettlement` 撤销收付款中的冲抵，并 `FinAdvanceService.delete(advanceId)` 删除转入的预收预付单（已冲抵或凭证已审核时会失败，整体回滚）；草稿、已拒绝的没有核销过，直接删除。

### 自动核销（前端）

新增页 `components/fin/SettlementForm.vue`（`SettlementPage.vue` 的子组件）：选择往来单位后 `GET /fin/bill/{ar|ap}/unsettled` 列出未核销单据（后端按 单据日期 → 到期日 → ID 排序），默认勾选与第一张同币种的全部单据，「本次收款」在用户没改过时等于勾选单据的未核销合计。

「自动核销」调用 `components/fin/fin.js` 的 `allocateSettle(bills, target, remainingOf)`：

1. 红字单据（`remainingOf(b) < 0`）由内部的 `offsetRed` 冲抵：冲抵总额不超过蓝字单据（`remainingOf(b) > 0`）的余额合计，按 单据日期 → 到期日 → ID 从早到晚冲抵，冲不完的红字单据（或其剩余部分）不填，留待下次核销；目标金额按冲抵额相应增加；
2. 蓝字单据按 单据日期 → 到期日 → ID 从早到晚分配，直到目标金额用完；
3. 返回各单据的核销金额和剩余（多收）金额。

「全部核销」调用 `settleAllAmounts(bills, remainingOf)`：蓝字单据全部按余额填满，红字单据同样经 `offsetRed` 冲抵，核销合计不会为负数；页面随后把本次金额同步为核销合计。因此冲账、退货金额大于勾选的欠款时，两个按钮都会得到核销合计为 0 的结果，可以直接提交，不需要手工改红字单据的金额。

`remainingOf` 传入「未核销 − 已填折让」，所以先填折让再自动核销时折让保留。票据收票、背书的 `BillSettleTable.vue` 共用 `allocateSettle`。页面按 `diff = 本次金额 − 核销合计` 显示「多收」提示和「转为预收 / 预付款」勾选框，`diff < 0` 时禁止提交。

### 折让记录

`GET /fin/settlement/{kind}/discounts`（权限 `fin:{kind}:list`，`SettlementDiscountRow` / `FinSettlementItemMapper.selectDiscountPage`）：已生效（`APPROVED`）收付款中 `discount <> 0` 的核销明细，可按往来单位、日期范围、收付款单号 / 原单据号查询，前端 `SettlementDiscounts.vue`（收付款页面的「折让记录」标签页，可导出）。

## 收付款中冲抵预收预付

issue #50。收付款表单可以勾选该单位未冲抵完的预收 / 预付款与核销单据一起冲抵，复用 `FinAdvanceService` 的冲抵逻辑，但凭证并入收付款凭证。

**数据**

| 表 / 字段 | 含义 |
| --- | --- |
| `fin_settlement_advance`（`FinSettlementAdvance`） | 收付款单选用的预收预付及冲抵金额（原币），草稿、审批中也有记录；`FinSettlementAdvanceMapper.selectBySettlement` 带出预收预付单号和余额 |
| `fin_settlement.advance_offset` | 冲抵合计（原币） |
| `fin_settlement_item.advance_offset` | 分配到这张单据的冲抵金额；明细的 `amount` / `amount_fc` **只记实收实付的部分**，所以账龄、提成回款等读取核销明细的口径不变 |
| `fin_advance_apply.settlement_id` | 在收付款中冲抵的记录关联收付款单（在预收预付页面冲抵的为空），`settleNo` 为非表字段 |

**流程**

1. 表单通过 `GET /fin/settlement/{kind}/advances?partnerId=`（权限 `fin:{kind}:add`，`FinAdvanceService.open` / `FinAdvanceMapper.selectOpen`，`used_fc < amount_fc`，按日期从早到晚）列出可冲抵的预收预付，前端 `components/fin/SettlementAdvances.vue` 只允许勾选与核销单据同币种的；
2. 提交 `SettlementRequest.advances`（`SettlementAdvanceRequest(advanceId, amount)`）。`save` 校验：属于该往来单位（`fin.error.advanceNotBelongPartner`）、不重复、同币种（`fin.error.settlementAdvanceCurrencyMismatch`）、不超过余额（`fin.error.totalOffsetAmountExceedsAdvanceBalance`）、冲抵合计不超过核销合计（`fin.error.advanceOffsetExceedsSettled`）、不能与 `toAdvance` 同时使用（`fin.error.advanceOffsetWithOverpaid`）；冲抵金额按单据日期分配到蓝字单据，写 `fin_settlement_item.advance_offset`；本次实收实付 `amount_fc` = 核销合计 − 冲抵合计；
3. **生效**（`effectuate`：确认、未开启草稿时的保存，或付款审批通过，同一事务）先调用 `applyAdvances` → `FinAdvanceService.applyForSettlement(advanceId, 收付款日期, 分配的单据行, settlementId)`：与 `apply` 共用 `doApply`（校验、`addSettled`、`addUsed`、外币折算），但不生成凭证，冲抵记录写 `settlement_id`；再核销实收实付和折让；
4. **凭证**（`generateVouchers`）：收款 借 结算账户（实收）、收款折让、`ADVANCE_RECEIVED` 预收账款（Σ `fin_advance_apply.amount`，按预收汇率）/ 贷 应收账款（核销 + 折让 + Σ `bill_amount`）；付款反之（贷 `PREPAYMENT`）；外币差额计入 `FINANCE_EXPENSE`。生成后把这些冲抵记录的 `voucher_id` 指向收付款凭证；`FinVoucherService` 删除凭证时把冲抵记录的 `voucher_id` 清空；
5. **删除**已生效的收付款单（凭证未生成或已删除）时 `FinAdvanceService.revokeForSettlement(settlementId)`：反向 `addSettled` / `addSettledFc` / `addUsed`，删除冲抵记录，任一条件更新失败抛 `fin.error.dataChangedRefresh`；
6. 被草稿或审批中的付款单选用（存在 `fin_settlement_advance` 记录）的预收预付不能删除：`FinAdvanceService.delete` 抛 `fin.error.advanceSelectedBySettlement`。

付款审批时，确认前按最新余额校验（`checkOutstanding`，单据的核销 + 折让 + 冲抵、预收预付的余额），审批变量 `amount` 只含实付（`s.amount`）和多付转预付，冲抵部分不需要付钱，不计入。

## 实收为 0 的收付款

核销合计 − 冲抵合计可以为 0（欠款 1000 与冲账 −1000 合在一张单上，或欠款全部由预收冲抵），但**必须有核销明细**。没有资金分录时凭证只有往来科目一借一贷的冲抵（`partnerLine` 按蓝字、红字分两行），全部由预收冲抵时为 借 预收账款 / 贷 应收账款。

前端 `SettlementForm.vue`：`canSubmit` 只要求勾选了单据（`items` 为空时不校验金额），提交时 `items` 为空先调用 `autoSettle` 按本次金额自动核销——`allocateSettle` 在核销合计为 0 时，未分配到的勾选单据保留核销 0 而不是清空，否则没有核销明细；金额校验 `amountsValid` 为 实收实付 ≥ 0、本次金额 ≥ 实收实付、多收须转预收且不能与冲抵同时使用。页面在实收为 0 时显示 `zeroTip` / `zeroWithAdvance` 提示。

## 草稿与确认

业务参数 `fin.settlement.draft`（`FinBizRules.SETTLEMENT_DRAFT`，默认关闭，`publicKeys` 前端可读）。收付款状态复用 `framework/workflow/ApproveStatus`，新增 **`DRAFT`**（字典 `sys_approve_status` 增加「草稿」）：

| 状态 | 含义 |
| --- | --- |
| `DRAFT` | 草稿：只有核销明细和选用的预收预付，**没有核销**，不进入对账单、往来汇总、账龄、折让记录和凭证（这些查询都按 `status = 'APPROVED'` 或单据的 `settled_amount`） |
| `APPROVING` | 付款审批中，同样没有核销 |
| `APPROVED` | 已生效 |
| `REJECTED` | 付款审批驳回 / 撤回，没有核销，可以修改或删除 |

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `POST /fin/settlement/{kind}` | `fin:{kind}:add` | `create`：`save` 先存为 `DRAFT`，`confirmOnSave(req)`（未开启草稿，或 `req.confirm() == true`）时 `doConfirm` |
| `PUT /fin/settlement/{kind}/{id}` | `fin:{kind}:add` | `update`：只能改 `DRAFT` / `REJECTED`（`fin.error.settlementNotEditable`），票据结算的不能改；删除原明细和选用的预收预付后重新 `save`，清空原流程实例；之后同样按 `confirmOnSave` 处理（已拒绝的付款保存即重新提交审批） |
| `POST /fin/settlement/{kind}/{id}/confirm` | `fin:{kind}:confirm` | `confirm`：只能确认 `DRAFT`（`fin.error.settlementNotDraft`） |

- 开启草稿时请求带 `confirm: true`（「保存并确认」）还需要确认权限：`FinSettlementController.checkConfirmPerm` 不满足时抛 `fin.error.noPermissionConfirmSettlement`；未开启时保存即生效，只需新增权限（与原来一致）；
- `doConfirm`：收款或付款没有可用的审批流程时 `effectuate` 后 `StatusTransitions.change(DRAFT → APPROVED)`；付款有审批流程时 `checkOutstanding` 后 `DRAFT → APPROVING` 并发起流程，审批通过（`onFlowFinished`）再 `effectuate`；
- 票据业务生成的收付款（`createForNote`）不存草稿，直接 `doConfirm`；
- 删除：`DRAFT` / `REJECTED` 没有核销过，直接删除明细和选用记录；`APPROVED` 恢复核销、撤销冲抵、删除多收转入的预收预付；`APPROVING` 不能删除。

前端 `SettlementForm.vue` 用 `useBizRules({ 'fin.settlement.draft': false })` 决定按钮：开启时为「保存草稿」（`confirm: false`）和带 `v-perm="fin:{kind}:confirm"` 的「保存并确认」，否则为原来的「确认收款 / 付款」（`confirm: true`）。`open({ id })` 修改时按原单据回填核销金额（`amount_fc + advance_offset`）、折让和冲抵金额，外币保留原汇率。`SettlementPage.vue` 中草稿、已拒绝（非票据）的单据有「修改」，草稿有「确认」（`useAction`），详情页底部同样。按钮权限 `fin:receipt:confirm`（菜单 1853）、`fin:payment:confirm`（1863），内置授权会计、出纳。按收付款区分的文字集中在 `components/fin/settlementConf.js`（原来在 `SettlementPage.vue` 中，往来汇总也要用）。

## 往来汇总

应收管理 / 应付管理的「往来汇总」页签（前端 `components/fin/PartnerSummary.vue`、展开明细 `PartnerSummaryDetail.vue`，嵌在 `BillPage.vue` 中）：

| 接口 | 说明 |
| --- | --- |
| `GET /fin/bill/{ar,ap}/summary` | 分页，参数 `partnerId`、`keyword`（单位编码或名称）、`ownerId`（客户的 `owner_id`，供应商没有）、`onlyBalance`（默认 true），返回 `PartnerSummaryRow` |
| `GET /fin/bill/{ar,ap}/summary/total` | 同样条件的合计行 |

权限同应收 / 应付的查看（`fin:{ar,ap}:list`）。实现在 `FinPartnerLedgerService.summary` / `summaryTotal`，SQL 为 `FinPartnerLedgerMapper.xml` 的 `summaryRows` 片段：

- `opening`：`source_type = 'MANUAL'`（期初 / 手工）的 `amount − settled_amount`；
- `bill_balance`：其他来源的 `amount − settled_amount`（红字为负数；`settled_amount` 含收付款、折让、预收预付冲抵、坏账）；
- `advance_balance`：`fin_advance` 的 `amount − used_amount`，取负数；
- `bad_debt`：`bad_debt_amount` 合计，已含在已核销中，单列参考；
- `net` = `opening + bill_balance + advance_balance`，按 `net DESC` 排序；全部为本位币。

与往来对账单一致：对账单截至今天的期末余额 = `net + bad_debt`（对账单不扣坏账；外币单据另有收付汇率与记账汇率的差额）。草稿、审批中的收付款没有改变单据的 `settled_amount`，所以不影响汇总。

展开明细复用已有接口：`GET /fin/bill/{kind}/unsettled`、预收预付分页（需要 `fin:advance:list`）、收付款分页（需要 `fin:{receipt,payment}:list`，取最近 20 笔）。行上的「收款 / 付款」调用 `SettlementForm.open({ partnerId, partnerName })`；「对账单」跳转 `/fin/partner-statement?kind=AR&partnerId=&partnerName=`，`views/fin/partner-statement/index.vue` 读取参数后直接查询并清除地址参数。

## 来源单据穿透

应收应付单列表、往来汇总明细、收付款表单、收付款详情的核销明细中，来源单号用公共组件 `components/common/SourceDocLink.vue` 显示：

```vue
<SourceDocLink :type="record.sourceType" :id="record.sourceId" :no="record.sourceNo"
               :bill-kind="record.kind" :project-id="record.projectId" />
```

打开方式登记在同目录的 `sourceDocs.js`（`SOURCE_DOCS`，按 `BillSource`）：

| 方式 | 来源 | 实现 |
| --- | --- | --- |
| `trade` | 销售出库 / 退货、采购入库 / 退货、采购运费（打开采购入库单）、销售运费 / 销售退货运费 / 采购退货运费（打开登记运费的出入库单；其他收支单现付的运费也以出入库单为来源） | 在当前页面打开 `components/scm/TradeDocDetail.vue` |
| `ticket` / `project` | 服务收费 / 项目开票（按应收单上的 `projectId`） | 打开 `crm/TicketDetail.vue` / `pm/ProjectDetail.vue` |
| `path` | 发运单、订单尾差（按 `billKind` 区分采购 / 销售订单）、返利（区分销售 / 采购返利）、冲账单、票据 | 跳转到页面并带 `?id=`，目标页面用 `composables/useRouteOpen` 打开详情 |
| `path` + `byNo` | 质量索赔、固定资产（页面没有详情抽屉） | 跳转并带 `?keyword=单号` 筛选 |

`perm` 为目标页面的查看权限（可按单据计算），`sourceTarget(doc, hasPerm)` 在没有登记、缺少 ID / 单号、没有权限时返回 `null`，组件只显示单号。详情组件按需 `import()`，列表中每行一个链接也不会预先加载。

`useRouteOpen({ id, keyword, reload })`：`?id=` 时在 `onMounted` 中打开详情，`?keyword=` 时在 setup 阶段写入查询条件（首次加载即带上），处理后用 `router.replace` 去掉参数；页面已打开时监听参数变化再处理一次。已接入的页面：`scm/shipment`、采购 / 销售订单（`components/scm/OrderPage.vue` 原有的 `?id=` 处理，未使用 `useRouteOpen`）、`scm/rebate` 与 `purchase-rebate`（`RebatePage.vue`）、`fin/offset`、`fin/note`、`qms/claim`、`fin/asset`。

**新增来源类型**时：在 `sourceDocs.js` 登记打开方式和权限，目标页面加 `useRouteOpen`；后端返回的应收应付单 / 核销明细要带 `sourceType`、`sourceId`、`sourceNo`（项目开票还要 `projectId`）。

## 外币折算 `ForeignAmounts`

收付款核销、折让、预收预付冲抵都用 `ForeignAmounts.toBase(bill, fc, discountFc)` 把原币折算为单据一方的本位币：

- 本位币单据：原样返回；
- 外币单据：按单据记账汇率 `exchange_rate` 折算，**原币核销完**（`fc + discountFc` 等于剩余原币）时本位币取剩余（`amount − settled_amount`），尾差计入核销金额（只有折让时计入折让），避免留下几分钱；
- 返回 `[核销本位币, 折让本位币]`。

收付款凭证中往来科目按这些本位币记账，银行按 原币合计 × 收付款汇率（`fin_settlement.amount`），差额计入财务费用（汇兑损益）；折让科目按折让本位币记账，所以汇兑损益只来自实收实付部分。

## 多收转预收预付

`FinSettlementService.toAdvance` 在同一事务中调用 `FinAdvanceService.create(new AdvanceRequest(...))`：往来单位、日期、结算账户、结算方式与收付款单相同，金额为 `advance_amount`，外币时币种和汇率取收付款单的；备注为消息 `fin.text.overpaidAdvanceRemark`（按默认语言存库）。新预收预付单的 ID 回写 `fin_settlement.advance_id`。预收预付登记即生成 `ADVANCE` 凭证（借 银行 / 贷 预收账款），因此收付款凭证只包含核销部分。

## 外币预收预付

`fin_advance` 增加 `currency`、`exchange_rate`、`amount_fc`、`used_fc`：`amount` / `used_amount` 为本位币（原币 × 登记汇率），`AdvanceRequest.amount` 是原币，`exchangeRate` 为空时取 `ExchangeRateProvider.rate(币种, 日期)`。冲抵 `FinAdvanceService.apply`：

- 只能冲抵同币种的单据（`fin.error.advanceCurrencyMismatch`），冲抵金额为原币；
- 单据一方：`ForeignAmounts.toBase` → `addSettled`，记入 `fin_advance_apply.bill_amount`；
- 预收预付一方：`applyBases` 按登记汇率折算，本次冲抵完全部原币余额时最后一行取剩余本位币，记入 `fin_advance_apply.amount`；`FinAdvanceMapper.addUsed` 同时校验本位币与原币不超额；
- 凭证 借 预收账款（预收一方本位币）/ 贷 应收账款（单据一方本位币），差额贷记 `FINANCE_EXPENSE`（负数即借方）。

预收预付是非货币性项目，期末调汇不处理。资产状况等按截至日倒推应收应付时，预收预付冲抵取 `bill_amount`（与单据的已核销一致）。

## 冲账单

`FinOffsetService` / `FinOffsetController`（`/fin/offset`），表 `fin_offset`，单号规则 `FinOffsetService.DOC_NO = "CZ"`（在 `FinDocNos` 中声明），状态 `OffsetStatus`（`DRAFT` 待复核 / `REVIEWED` 已复核，系统字典 `fin_offset_status`），冲账项目为业务字典 `fin_offset_item`（保存时 `DictLookup.check`，`OTHER` 为内置）。

| 操作 | 接口 | 权限 | 说明 |
| --- | --- | --- | --- |
| 列表 / 详情 | `GET /fin/offset`、`/{id}` | `fin:offset:list` | `FinOffsetMapper.selectPageList` / `selectDetail` 关联红字单据的核销金额、凭证号和状态 |
| 新增 / 修改 | `POST` / `PUT /{id}` | `fin:offset:add` / `edit` | `OffsetRequests.Save`；修改用条件更新，只能改待复核的。`handlerId` 不传时：新增取当前用户，修改保留原经办人（原来也没有时取当前用户） |
| 删除 | `DELETE /{ids}` | `fin:offset:remove` | 只能删待复核的 |
| 复核 | `POST /{id}/review` | `fin:offset:review` | 见下文 |
| 取消复核 | `POST /{id}/cancel-review` | `fin:offset:review` | 见下文 |

**复核**（`@Transactional`）：业务参数 `fin.offset.reviewSeparate`（`FinBizRules.OFFSET_REVIEW_SEPARATE`，默认关）开启时校验复核人不是制单人 → `FinBillService.createOffsetBill` 生成红字单据（`BillSource.OFFSET`，金额为冲账金额的负数，税额 0，到期日 = 冲账日期，冲账单上的科目存 `fin_bill.expense_account_id`）→ `StatusTransitions.change` 改为已复核并记录 `bill_id`、复核人 → `FinBillService.generateVouchers` 立即生成凭证（来源为应收 / 应付）。`FinBillService.lines` 对 `OFFSET` 单据单独出分录：

| 方向 | 分录 | 默认科目（`AccountRole`） |
| --- | --- | --- |
| 应收冲账 | 借 冲账单科目 / 贷 应收账款（客户） | `OFFSET_AR` 6601 销售费用 |
| 应付冲账 | 借 应付账款（供应商）/ 贷 冲账单科目 | `OFFSET_AP` 6401 主营业务成本 |

**取消复核**：`FinBillService.deleteOffsetBill` 要求红字单据未核销且没有核销明细，凭证已记账时报 `fin.error.offsetVoucherPosted`，否则 `FinVoucherService.deleteOwned` 删除凭证（只能删未审核的，已审核时提示先反审核）并删除单据，冲账单回到待复核。

冲账单的红字单据在收付款中与其他红字单据一样冲抵，核销合计可以为 0；此时收付款凭证没有资金分录，`FinSettlementService.generateVouchers` 把往来科目按蓝字、红字分两行冲抵（`partnerLine`）。往来单位被冲账单引用时不能删除（`FinRefMapper.xml`）。

## 折让与冲账的凭证科目

`AccountRole` 新增四个用途（「收入与费用」组），业务代码通过 `FinAccountRuleService.accountId(AccountRole.X)` 取科目：

| 用途 | 默认 | 用在 |
| --- | --- | --- |
| `RECEIPT_DISCOUNT` 收款折让 / 抹零 | 6603 | 收款凭证 借方 |
| `PAYMENT_DISCOUNT` 付款折让 / 抹零 | 6603 | 付款凭证 贷方 |
| `OFFSET_AR` 应收冲账的费用科目 | 6601 | 应收冲账单凭证 借方（冲账单未选科目时） |
| `OFFSET_AP` 应付冲账的对方科目 | 6401 | 应付冲账单凭证 贷方（冲账单未选科目时） |
| `PURCHASE_REBATE` 采购返利的对方科目 | 6401 | 采购返利红字应付单凭证 贷方，见[其他收支、调拨与返利开发](./cash-rebate#结算与财务处理) |

收付款凭证分录：收款 借 结算账户（实收本位币）、`RECEIPT_DISCOUNT`（折让本位币）/ 贷 应收账款（核销本位币 + 折让本位币）；付款反之；外币差额计入 `FINANCE_EXPENSE`。业务生成凭证时金额为 0 的分录不生成，所以没有折让时不会出现折让行。

## 坏账与无法支付转销

`POST /fin/bill/{ar|ap}/{id}/bad-debt`（`FinPeriodCloseController`，权限 `fin:ar:baddebt` / `fin:ap:baddebt`），`FinBillService.writeOffBadDebt(kind, id, amount, date, reason)`：只能处理金额为正、已生成凭证（手工单除外）的本位币单据，计入 `settled_amount` 与 `bad_debt_amount`，生成 `BAD_DEBT` 凭证（不能在凭证管理中直接删除）：

- 应收：借 营业外支出 `NON_OPERATING_EXPENSE` / 贷 应收账款；
- 应付：借 应付账款 / 贷 营业外收入 `NON_OPERATING_INCOME`。

前端 `components/fin/BillPage.vue` 按 `kind` 取按钮文字和弹窗说明（应付为「无法支付转销」），按钮权限 `` `fin:${kind}:baddebt` ``。

## 固定资产购置与现金流量表

新增固定资产（`FinAssetService`，请求 `AssetRequest`）有三种入账方式，只对新增的非期初资产生效：

- 填 `supplierId`：生成来源 `ASSET` 的应付单（借 固定资产、进项税额 / 贷 应付账款），之后照常收付款核销；
- 不填供应商、填 `payAccountId`（库存现金 / 银行存款范围内的末级科目，`FinAccountService.requireCashAccount` 校验）：直接生成未审核的购置凭证（`VoucherSource.ASSET`，日期为开始使用日期，借 固定资产（带使用部门）、进项税额 / 贷 付款账户）；与供应商同填或用于期初资产时报 `fin.error.assetPayAccountOnlyWithoutSupplier`；
- 都不填（捐赠、投资投入、自建转入）：不生成单据，由财务手工做凭证。

现金流量表（`FinAnalysisService.cashFlow`）按对方科目归类，以下两处与资产购置有关：

- 付款凭证的对方科目是应付账款时，按 `FinAnalysisMapper.selectAssetPayments`（已记账付款凭证中，核销来源为 `ASSET` 的应付单金额 / 核销总额）的比例拆出一部分归入「购建固定资产、无形资产和其他长期资产支付的现金」，其余仍为「购买商品、接受劳务支付的现金」；
- 现金流出凭证中借记了长期资产（固定资产、在建工程、无形资产）时，同一凭证中的进项税额也归入购建固定资产（直接付款购置凭证的口径）。

一张凭证多个对方科目时按金额比例分摊（`FinAnalysisService.allocate`），尾差计入**最后一个基数不为 0** 的对方科目，保证各项目合计等于现金变动额、期末余额与账面一致。

## 关键类与文件

| 位置 | 内容 |
| --- | --- |
| `service/FinSettlementService` | 收付款新增、修改、确认（草稿）、核销、折让、多收转预收、冲抵预收预付、审批回调、删除、凭证、折让记录 |
| `service/ForeignAmounts` | 外币核销、折让、冲抵的本位币折算 |
| `service/FinAdvanceService` | 预收预付登记（含外币）、冲抵（`apply`、收付款中的 `applyForSettlement` / `revokeForSettlement`）、删除 |
| `service/FinPartnerLedgerService`、`mapper/fin/FinPartnerLedgerMapper.xml` | 往来对账单、往来汇总（`summary` / `summaryTotal`） |
| `entity/FinSettlementAdvance`、`mapper/fin/FinSettlementAdvanceMapper.xml` | 收付款选用的预收预付 |
| `service/FinOffsetService`、`controller/FinOffsetController` | 冲账单 |
| `service/FinBillService` | `createOffsetBill`、`deleteOffsetBill`、`writeOffBadDebt`、`lines`（冲账单分录） |
| `model/AccountRole`、`model/BillSource`、`model/OffsetStatus` | 凭证用途、单据来源 `OFFSET`、冲账单状态 |
| `service/FinBizRules` | `fin.offset.reviewSeparate`、`fin.settlement.draft` |
| `mapper/fin/FinSettlementItemMapper.xml`、`FinOffsetMapper.xml`、`FinBillMapper.xml`、`FinAdvanceMapper.xml`、`FinPartnerLedgerMapper.xml` | 折让记录、冲账单列表、核销条件更新、账龄、往来对账 |
| 前端 `components/fin/SettlementPage.vue`、`SettlementForm.vue`、`SettlementAdvances.vue`、`SettlementDiscounts.vue`、`settlementConf.js`、`fin.js`（`allocateSettle`、`settleAllAmounts`） | 收付款列表、新增 / 修改、冲抵预收预付、折让记录、按收付款区分的文字、自动核销 / 全部核销 |
| 前端 `components/fin/PartnerSummary.vue`、`PartnerSummaryDetail.vue` | 往来汇总页签 |
| 前端 `components/common/SourceDocLink.vue`、`sourceDocs.js`，`composables/useRouteOpen.js` | 来源单据穿透 |
| 前端 `views/fin/advance/index.vue`、`views/fin/offset/index.vue`、`components/fin/BillPage.vue` | 预收预付、冲账单、应收应付（坏账按钮） |

## 扩展

- **新的减少单据余额的方式**：一律经 `FinBillMapper.addSettled` / `addSettledFc` 条件更新，外币用 `ForeignAmounts.toBase` 折算；如果它不经过收付款明细，还要同步账龄（`FinBillMapper.xml` aging 的截至日核销子查询）、往来对账单、进销存报表资产状况中按截至日倒推的逻辑，否则历史日期的余额会不一致。
- **新的冲账方向或分录**：在 `FinBillService.lines` 的 `OFFSET` 分支中处理，科目用途登记到 `AccountRole`，并在前端凭证科目设置的语言包中补充名称。
- **新的冲账项目**：不需要改代码，在「业务字典」的「冲账项目」中维护；只有程序按取值判断的项目才需要设为内置。
- 菜单：冲账单 377（`fin:offset:*` 按钮 3770–3773），应付坏账按钮 1843，都在「应收应付」分组 932 下，内置角色的授权见 `sql/init.sql`。
