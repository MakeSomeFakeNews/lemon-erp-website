---
order: 18.5
---

# 整单优惠、尾差与买赠

采购 / 销售订单、销售报价和出入库直接开单可以填写**整单优惠**（含税金额，抹零也用它）。整单优惠不作为单独的一行，而是分摊进各行的行金额，所以下游的应收应付、库存成本、毛利、提成不需要感知它；代价是行金额不再等于 数量 × 单价，分批出入库、退货、订单变更、关闭时都要按「行金额」精确结算。本页说明这套计算的实现和关键类、字段。用户操作见手册[销售订单 - 整单优惠与抹零](../../manual/scm/sales#整单优惠与抹零)。

## 数据结构

| 表 / 字段 | 含义 |
| --- | --- |
| `scm_order.whole_discount` | 整单优惠（订单币种，含税），已从各行金额中扣除；直接开单记在隐式订单上 |
| `scm_quotation.whole_discount` | 报价的整单优惠，已从价税合计中扣除，明细单价不变；转订单时带到订单上再分摊 |
| `scm_order_item.discount_share` | 分摊到本行的整单优惠（行金额已扣除） |
| `scm_order_item.orig_price` | 原价（促销、返利、整单优惠之前），编辑草稿时按原价录入 |
| `scm_order_item.done_amount` | 已出入库金额（订单币种；补发的退货扣减） |
| `scm_order_item.return_amount` | 已退款的退货金额（不补发的退货另计） |
| `scm_order_item.done_share` | 已出入库部分消耗的分摊额 |
| `scm_order_change.old_whole_discount` / `new_whole_discount` | 变更前后的整单优惠，`new` 为空表示不变 |
| `scm_order.close_adjust`、`scm_order_item.close_adjust` | 关闭时的尾差调整（订单币种），已计入 `done_amount` |
| `scm_order_item.close_adjust_net` | 尾差的不含税金额（本位币），采购订单计入月末成本核算 |
| `scm_order_item.gift` | 1 为买赠的赠品行（单价 0） |

`ScmTradeDoc.wholeDiscount`（直接开单时取隐式订单的优惠）、`ScmTradeDocItem.gift` 是非表字段，只用于列表、详情展示。

## 分摊：`WholeDiscounts`

纯计算类，没有依赖：

```java
// 按金额比例分摊：每行减少 round2(优惠 × 行金额 / 合计)，尾差放在金额最大的一行，
// 结果合计精确等于 原合计 − 优惠；优惠为负或超过合计时抛 BizException
List<BigDecimal> allocate(List<BigDecimal> amounts, BigDecimal discount)

// 订单明细应用整单优惠：改写 amount、taxAmount、price（= amount / qty，4 位小数），
// origPrice 为空时记入优惠前单价，分摊额累加到 discountShare
void apply(List<ScmOrderItem> items, BigDecimal discount)
```

- **顺序固定**：促销（`ScmPromotionService`，折扣 → 满减 → 买赠）→ 返利抵扣 → 整单优惠。`ScmOrderPricingService.applyWholeDiscount(req, items)` 在订单新建、修改、直接开单生成隐式订单时最后调用；赠品行金额为 0，不参与分摊。
- **直接保存行金额**：分摊后行金额是权威值，单价只是 行金额 / 数量 的展示值（4 位小数，乘回去不一定等于行金额）。凡是需要金额的地方都取 `amount`，不要用 `qty × price` 重算。
- 草稿编辑时前端按 `origPrice` 回填单价，保存时整单重新应用促销、返利和整单优惠；限价（`checkPriceLimit`）按原价校验。
- 报价单（`ScmQuotationService`）只用 `allocate` 计算分摊后的税额和合计，明细单价不变；转订单时把 `wholeDiscount` 传给订单，由订单按同样规则分摊。报价审批的最低折扣率按「分摊后行金额 / (目录价 × 数量)」计算，与转成订单后的成交价一致。

## 分批出入库与退货：`OrderLineAmounts`

出入库单（`ScmTradeDocService.create`）在回写订单数量后重新读取订单行，按下面的规则计算本行金额（订单币种），再用 `ScmOrderItemMapper.addAmounts` 原子累加 `done_amount` / `return_amount` / `done_share`：

| 方法 | 规则 |
| --- | --- |
| `outbound(item, qty)` | 本次数量不少于未完成数量（完成该行的一批）时取 `amount − done_amount`，超发部分按单价另加；其他批次按 `qty × price`。累计金额精确等于行金额 |
| `returned(item, qty)` | 按 `qty × price`，不超过剩余的已出入库净额；退回全部实际完成数量时取剩余净额 |
| `outboundShare(item, qty)` | 本次消耗的分摊额：剩余分摊额 × 本次数量 / 未完成数量，完成一批取剩余 |
| `replenishShare(item, qty)` | 补发 / 补收的退货退回已消耗的分摊额（负数）；退款的退货不退回（优惠已经实现） |

补发的退货扣减 `done_amount`，补发的最后一批又按 `outbound` 取回差额；退款的退货记 `return_amount`，不影响补完时的尾差。这套规则对所有订单都生效（不只是有整单优惠的），因为促销、返利分摊同样会让行金额不等于 数量 × 单价。

出入库、关闭、订单变更生效都先用 `ScmOrderMapper.selectStatusForUpdate` 锁定订单行，同一订单上串行执行，保证读到的已出入库数量、金额是最终值。外币订单按原币计算，再按订单汇率折算本位币生成应收应付。

## 订单变更：重新分摊

`ScmOrderChangeService` 按 `OrderLineAmounts.reallocate(lines, discount)` 计算变更后的每一行：

- 已出入库部分（数量、`done_amount`、`consumedShare`）不变，未出入库部分 = 未出入库数量 × **优惠前单价**（`grossPrice(item)` = (行金额 + 分摊额) / 数量）；变更单的单价也按优惠前单价录入和保存（`oldPrice` 存 `grossPrice`）；
- 没有影响金额的变更（只改交期）或已出完且没改的行用 `ChangeLine.kept` 保持原金额、原分摊额；
- 剩余的优惠 = 新的整单优惠 − 已消耗的分摊额 − 不变行的分摊额，用 `WholeDiscounts.allocate` 按未出入库部分的金额比例分摊；剩余优惠小于 0 时抛 `scm.error.wholeDiscountBelowDone`，超过未出入库部分金额时抛 `scm.error.wholeDiscountExceedsOpen`；
- 提交时试算，审批通过**生效时按届时的出入库情况重新计算**（审批期间可能又有出入库）。

没有整单优惠的订单也走同一路径（优惠为 0）：已出入库部分不受改价影响。前端 `OrderChangeDrawer.vue` 的 `newTotal` 是同口径的试算，有优惠时列名改为「新优惠前单价」「优惠前金额」。

审批变量（`ScmFlowBusinesses`）：采购 / 销售订单 `wholeDiscount`；订单变更 `wholeDiscount`（变更后）、`wholeDiscountDelta`；销售报价 `wholeDiscount`、`wholeDiscountRate`（优惠 / 优惠前合计，%）。小程序审批详情中这几个变量全为 0 时不显示。

## 关闭时的尾差：`ScmOrderCloseAdjuster`

`ScmOrderService.close` 锁定订单、改为已关闭后调用 `closeAdjuster.adjust(order)`（`Propagation.MANDATORY`，与关闭同一事务）：

1. 逐行 `OrderLineAmounts.closeAdjust(item, repriced)`：只处理 0 < 已出入库数量 < 订单数量 的行。应得金额 = round2(行金额 × 已出入库数量 / 订单数量)；生效过变更（`version > 1`）的订单为 行金额 − round2(未出入库数量 × 单价)（已出入库部分不受改价影响）。差额 = 应得 − `done_amount`；
2. 差额写入 `close_adjust`、`close_adjust_net` 并计入 `done_amount`（`ScmOrderItemMapper.addCloseAdjust`），之后的退货按调整后的金额退回；订单合计写入 `scm_order.close_adjust`；
3. 采购订单：差额的不含税本位币金额按 `ScmTradeDocItemMapper.selectLastWmsDocs` 找到该行最近一张采购入库的仓库单据，`StockCostService.addCost(IN, docId, 物料 → 金额)` 追加到实时库存成本；
4. 有差额时发布 `OrderCloseAdjustedEvent`（同事务）。

fin 的 `FinBillService.onOrderCloseAdjusted` 生成应收 / 应付单，来源 `BillSource.ORDER_ADJUST`（字典 `fin_bill_source`「订单尾差调整」），正数蓝字、负数红字，日期为关闭当天（`periodGuard.checkOpen`，期间已结账时关闭失败），到期日按往来单位账期，外币订单带币种、汇率和原币金额。凭证：应收 借 应收账款 / 贷 主营业务收入（按物料分类）、销项税额；应付 借 存货（按物料分类，取 `close_adjust_net`）、进项税额 / 贷 应付账款。月末成本核算通过 `FinCostSourceMapper.selectPurchaseAdjusts` 把采购尾差计入调整单日期所在期间的采购金额（不影响数量），总账存货与成本核算一致。

订单没有反关闭；关闭后的退货只能退款（`scm.error.closedOrderNoReplenish`）。

## 直接开单的买赠：`DirectGifts`

销售出库直接开单时，隐式订单按促销规则生成赠品行（`gift = 1`，单价 0），出库明细要对应到这些赠品行：

- 请求中带了赠品行（`TradeDocItemRequest.gift = true`）：各赠品物料的数量合计须等于促销计算的数量（`scm.error.giftQtyMismatch`），按顺序对应到订单赠品行，必要时拆行、序列号随数量拆分；没有适用的买赠时报 `giftNotApplicable`，物料不符报 `giftNotInPromotion`；
- 请求中没有赠品行：从表头仓库按先到期先出（排除已过期、冻结）自动选择库位批次补上，库存不足报 `giftStockShort`，赠品需要序列号报 `giftNeedsSerial`；
- 赠品行只能用于销售出库直接开单（`giftOnlySalesOut`），不能只有赠品（`directDocNeedsGoods`）。

赠品随单出库扣库存、结转成本，应收不含赠品；价格记忆不登记单价为 0 的赠品行。前端 `components/scm/giftRows.js` 的 `syncGifts(items, gifts, warehouseId)` 按 `/scm/promotion/preview` 的结果把赠品同步到明细末尾：数量与促销一致的赠品保留用户选的库位批次，其余按先到期先出重新带出（库存不够时剩余数量留在最后一行），促销中已没有的赠品行删除；`TradeDocItems.vue` 在商品、数量、单价、客户、日期变化时重新预览，表头仓库变化时重新选择赠品库位。小程序快速开单（`lemon-mp` 的 `pkg-wms/sale/gifts.js`）规则相同。

## 前端

- `components/scm/WholeDiscountBar.vue`：`<WholeDiscountBar v-model:value="form.wholeDiscount" :total="优惠前合计" :symbol="symbol" />`，显示合计、优惠输入（不超过合计）、「抹零」下拉（抹去分 / 角分 / 个位：把优惠后合计按分的整数向下取整到 0.1 / 1 / 10，差额累加到优惠）和优惠后合计。只负责录入，分摊在后端完成；
- `total` 要与后端的分摊基数一致：销售订单有促销预览时为预览的成交价按行舍入后求和（`OrderForm.vue` 的 `discountBase`），直接开单为合计 − 促销优惠（`TradeDocItems.vue`），报价为明细合计；
- 列表、详情、打印显示优惠：`$t('scm.wholeDiscount.value', { amount })`；订单详情的「关闭尾差调整」读 `detail.closeAdjust`；
- 直接开单只在不引用订单时提交 `wholeDiscount`（`TradeDocForm.vue`），引用订单时按订单已分摊的金额出入库。

## 其他入口

- **智能录入**：`ScmExtractSupport` 的提取字段增加 `wholeDiscount`（「整单优惠、抹零或折让金额」），提示词要求明细填优惠前单价，合计校验按优惠后的金额；
- **外部订单导入**：`ScmOrderImportService` 支持「整单优惠」列，同一外部单号各行相同或只填一行（`scm.error.importWholeDiscountMismatch`）；
- **经销商门户**：下单不能填优惠（价格取价目表），内勤在审核前编辑草稿订单填写；
- **报表**：进销存报表、毛利取出入库单的行金额，已含分摊；收付款折让、冲账单、订单尾差调整只调整应收应付，只体现在资产状况中，见[进销存报表开发](./jxc-report)。

## 扩展时注意

::: warning 注意
- 新增会改写订单行金额的逻辑（例如新的折扣类型）时，放在 `WholeDiscounts.apply` 之前，保持「整单优惠最后」的顺序，并同步修改 `OrderForm.vue` 的分摊基数；
- 新的出入库来源（如新的移动端入口）必须走 `ScmTradeDocService` 回写订单，不要自己按 `qty × price` 生成应收应付，否则累计金额会与订单行金额差几分钱；
- 订单行上新增需要累计的金额字段时，用 `ScmOrderItemMapper` 中的原子累加 SQL（`col = col + #{delta}`），并在锁定订单之后执行。
:::
