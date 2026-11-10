---
order: 20
---

# 应收应付核销开发

本页说明 fin 模块中应收应付单的核销模型：收付款自动核销、核销折让 / 抹零（含外币）、多收转预收预付、外币预收预付、冲账单与凭证、应付坏账，以及扩展时要改的地方。代码在 `lemon-modules/lemon-fin`（包 `com.lemon.erp.modules.fin`），前端在 `lemon-web/src/components/fin`、`views/fin`。

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

`POST /fin/settlement/{receipt|payment}`，请求 `SettlementRequest`：

| 字段 | 说明 |
| --- | --- |
| `items` | `SettlementItemRequest(billId, amount, discount)`；`amount` 为核销金额（实收实付，红字单据为负数，有折让时可以为 0），`discount` 与单据同号，`amount + discount` 不超过未核销 |
| `totalAmount` | 本次收付款总额，可为空（= 核销合计）；不能小于核销合计（`fin.error.settlementTotalLessThanSettled`） |
| `toAdvance` | 总额大于核销合计时必须为 `true`（否则 `fin.error.overpaidChooseAdvance`），多出部分转预收预付 |
| `exchangeRate` | 外币时的收付款汇率 |

`FinSettlementService.create` 的要点：

- 同一张收付款单只能核销同一往来单位、同一币种的单据；核销合计（`fin_settlement.amount_fc`）**不能小于 0**，可以为 0（红字冲账单、退货恰好抵消欠款）；
- 收付款单的 `amount` / `amount_fc` 只是核销合计（实收实付），折让合计记 `discount_amount` / `discount_fc`，多收部分记 `advance_amount`（原币），都不含在 `amount` 中；
- 不走审批时立即调用 `settle` 核销：`addSettled(本位币核销 + 本位币折让)`、`addSettledFc(原币核销 + 原币折让)`、`addDiscount`，然后 `toAdvance`；
- 付款审批（`fin_payment`，`ApprovalFlow` `PAYMENT_FLOW`）时保存只校验未核销金额，审批通过后（`onPaymentFinished`）才核销并生成预付单；审批变量 `amount` 为实际付出的本位币 = `s.amount`（核销合计，外币为原币 × 收付款汇率）+ `advance × settleRate`（多付转预付），不能只取核销合计，否则可以把大额付款做成预付绕过金额条件；
- 删除（未生成凭证）时按明细反向 `addSettled` / `addSettledFc` / `addDiscount`，并 `FinAdvanceService.delete(advanceId)` 删除转入的预收预付单（已冲抵或凭证已审核时会失败，整体回滚）。

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
| `service/FinSettlementService` | 收付款新增、核销、折让、多收转预收、审批回调、删除、凭证、折让记录 |
| `service/ForeignAmounts` | 外币核销、折让、冲抵的本位币折算 |
| `service/FinAdvanceService` | 预收预付登记（含外币）、冲抵、删除 |
| `service/FinOffsetService`、`controller/FinOffsetController` | 冲账单 |
| `service/FinBillService` | `createOffsetBill`、`deleteOffsetBill`、`writeOffBadDebt`、`lines`（冲账单分录） |
| `model/AccountRole`、`model/BillSource`、`model/OffsetStatus` | 凭证用途、单据来源 `OFFSET`、冲账单状态 |
| `service/FinBizRules` | `fin.offset.reviewSeparate` |
| `mapper/fin/FinSettlementItemMapper.xml`、`FinOffsetMapper.xml`、`FinBillMapper.xml`、`FinAdvanceMapper.xml`、`FinPartnerLedgerMapper.xml` | 折让记录、冲账单列表、核销条件更新、账龄、往来对账 |
| 前端 `components/fin/SettlementPage.vue`、`SettlementForm.vue`、`SettlementDiscounts.vue`、`fin.js`（`allocateSettle`、`settleAllAmounts`） | 收付款列表、新增、折让记录、自动核销 / 全部核销 |
| 前端 `views/fin/advance/index.vue`、`views/fin/offset/index.vue`、`components/fin/BillPage.vue` | 预收预付、冲账单、应收应付（坏账按钮） |

## 扩展

- **新的减少单据余额的方式**：一律经 `FinBillMapper.addSettled` / `addSettledFc` 条件更新，外币用 `ForeignAmounts.toBase` 折算；如果它不经过收付款明细，还要同步账龄（`FinBillMapper.xml` aging 的截至日核销子查询）、往来对账单、进销存报表资产状况中按截至日倒推的逻辑，否则历史日期的余额会不一致。
- **新的冲账方向或分录**：在 `FinBillService.lines` 的 `OFFSET` 分支中处理，科目用途登记到 `AccountRole`，并在前端凭证科目设置的语言包中补充名称。
- **新的冲账项目**：不需要改代码，在「业务字典」的「冲账项目」中维护；只有程序按取值判断的项目才需要设为内置。
- 菜单：冲账单 377（`fin:offset:*` 按钮 3770–3773），应付坏账按钮 1843，都在「应收应付」分组 932 下，内置角色的授权见 `sql/init.sql`。
