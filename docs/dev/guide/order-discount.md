---
order: 18.5
---

# 整单优惠、尾差与买赠

采购 / 销售订单、销售报价和出入库直接开单可以填写**整单优惠**（含税金额，抹零也用它）。整单优惠不作为单独的一行，而是在内部分摊进各行的行金额，所以下游的应收应付、库存成本、毛利、提成不需要感知它；代价是行金额不再等于 数量 × 单价，分批出入库、退货、订单变更、关闭时都要按「行金额」精确结算。对用户而言优惠只在合计处体现，明细、价格记忆、价格参考仍按优惠前单价，见[显示口径](#显示口径-不改变价格体系)。本页说明这套计算的实现和关键类、字段。用户操作见手册[销售订单 - 整单优惠与抹零](../../manual/scm/sales#整单优惠与抹零)。

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
| `scm_trade_doc.discount_amount` | 本单分摊的整单优惠（本位币，含税），优惠前合计 = 价税合计 + 本项；退货单为原单优惠分摊 |
| `scm_trade_doc.discount_adjust` | 采购入库修改的订单优惠与按订单分摊之差（本位币，含税），0 为与订单一致，见[采购入库的订单优惠](#采购入库的订单优惠) |
| `scm_trade_doc_item.gross_price` | 优惠前含税单价（本位币），为空同单价（`price` 仍是扣除分摊后的成交单价） |
| `scm_trade_doc_item.discount_share` | 本行分摊的整单优惠（本位币，含税） |
| `scm_inquiry_supplier.whole_discount` | 询价单供应商的整单优惠承诺 |

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

## 显示口径：不改变价格体系

分摊只用于内部计算（部分出入库、退货、毛利、采购成本），**整单优惠不改变价格体系**（issue #43）：

- **明细显示优惠前**：订单、出入库单的明细、打印显示优惠前的单价和金额。订单行按 `OrderLineAmounts.grossPrice(item)` = (行金额 + 分摊额) / 数量；出入库明细在生成时记录 `gross_price`（本位币，外币按单据汇率折算）和本行分摊额 `discount_share`，前端 `components/scm/scm.js` 的 `grossPrice(i)`（优先取 `grossPrice`，否则按订单口径计算）/ `grossAmount(i)` = `amount + discountShare` 统一换算；
- **合计处扣减**：出入库单记录本单分摊的优惠 `scm_trade_doc.discount_amount`（= 各行 `discount_share` 之和），详情 / 打印为「优惠前合计 − 整单优惠 = 优惠后合计」；订单为 `totalAmount + wholeDiscount` − `wholeDiscount`。打印模板的合计取优惠前合计（`print.name.grossTotal` / `discountedTotal`）；
- **退货**：按扣除优惠后的成交价退款（`returned` 本来就按 `qty × price`），退货单的 `discount_share` 为 `OrderLineAmounts.returnShare(item, qty, amount)` = 按优惠前单价计的金额 − 实际退货金额（不小于 0），即退回的那部分原单优惠，详情显示「原单优惠分摊」「退款金额」；
- **价格记忆、价格参考、供货价格**：`ScmPriceMemoryService` 登记 `COALESCE(gross_price, price)`；`ScmPricingMapper` 的销售 / 进货历史取 `COALESCE(i.gross_price, i.price)` 和 `amount + discount_share`，进货数量的均价同口径；`ScmSupplierPriceMapper` 的采购历史同样取优惠前单价。客户下次开单不会带出分摊后的零碎单价；
- **促销、返利抵扣**仍直接改变单价（成交价），按改变后的价格记忆；订单详情只在 `origPrice` 与优惠前单价不同时（有促销、返利）显示划线原价；
- **引用订单开单**：`TradeDocItems.vue` 的明细按 `grossPrice` 显示，合计 = Σ `qty × grossPrice`，另按成交价估算 `netAmount`，差额显示为「订单优惠」/「原单优惠分摊」（界面名称是「订单优惠」，不叫「分摊」，以免让人以为单价被改了；退货保留「原单优惠分摊」，与打印模板的字段名一致，改名会影响已上传的 JRXML），金额以后端保存结果为准。详情（`TradeDocDetail.vue`）中引用订单的单据叫「订单优惠」，直接开单的叫「整单优惠」。小程序订单详情（`pkg-crm/order/detail.vue`）同口径。

### 采购入库的订单优惠

issue #68：明细单价始终是订单 / 供应商送货单上的优惠前单价，不改单价；订单优惠作为整单减少应付，存货成本按各行金额比例冲减。引用订单的采购入库可以按供应商实际给的优惠修改本单的订单优惠：

- 表单合计区默认带出本次按订单计算的优惠（最后一批为订单剩余的优惠），可修改（`TradeDocRequest.orderDiscount`，含税、订单币种，不能为负（`scm.error.orderDiscountNegative`）、不能超过本单优惠前价税合计（`scm.error.orderDiscountExceedsTotal`，上限按含税合计，与订单整单优惠的口径一致）；为空按订单），修改后前端提示与订单不一致并提供「恢复按订单」；
- 后端 `ScmTradeDocService.applyOrderDiscount` 按各行优惠前金额比例重新分摊（`WholeDiscounts.allocate`，尾差在金额最大的一行），改写本单各行金额、税额、分摊额，应付、实时库存成本、月末成本核算、入库凭证都按修改后的金额；差额记入 `scm_trade_doc.discount_adjust`，详情显示「已修改，比按订单分摊多 / 少 ¥x」；
- **不回写订单**：订单的已入库金额、已消耗分摊额、关闭尾差仍按订单计算（否则后面几批会把差额补回来），代价是之后引用该订单的退货按订单成交价退款；
- 无订单的小额采购用直接开单的整单优惠，直接开单传 `orderDiscount` 会被拒绝（`scm.error.orderDiscountNeedsOrder`）；只有采购入库可以修改（`scm.error.orderDiscountOnlyPurchaseIn`），销售出库的优惠由销售订单（审批）确定，出库时改会绕过审批，退货按原单计算。

升级脚本 `20261110_trade_discount_freight.sql` 按订单明细的分摊额回填已有出入库明细的 `gross_price`、`discount_share` 和单据的 `discount_amount`，并对含整单优惠的往来单位 × 物料重算价格记忆。

## 询价的整单优惠承诺

询价单录入供应商报价时可以填写整单优惠承诺（`scm_inquiry_supplier`：`inquiry_id` × `supplier_id` 唯一，`whole_discount` 按该供应商全部报价行 数量 × 单价 的合计计算，不能超过合计，`InquiryQuoteRequest.wholeDiscount`），重新录入时覆盖；详情接口返回 `offers`，比价表头显示「报价合计」和优惠。定标生成采购订单时 `ScmInquiryService.awardedDiscount` 计算带入订单的 `wholeDiscount`：全部中标取全额（不超过中标金额），部分中标按 round2(承诺 × 中标金额 / 报价合计)，再由订单按常规规则分摊。删除询价单时一并删除承诺。

## 分批出入库与退货：`OrderLineAmounts`

出入库单（`ScmTradeDocService.create`）在回写订单数量后重新读取订单行，按下面的规则计算本行金额（订单币种），再用 `ScmOrderItemMapper.addAmounts` 原子累加 `done_amount` / `return_amount` / `done_share`：

| 方法 | 规则 |
| --- | --- |
| `outbound(item, qty)` | 本次数量不少于未完成数量（完成该行的一批）时取 `amount − done_amount`，超发部分按单价另加；其他批次按 `qty × price`。累计金额精确等于行金额 |
| `returned(item, qty)` | 按 `qty × price`，不超过剩余的已出入库净额；退回全部实际完成数量时取剩余净额 |
| `outboundShare(item, qty)` | 本次消耗的分摊额：剩余分摊额 × 本次数量 / 未完成数量，完成一批取剩余 |
| `replenishShare(item, qty)` | 补发 / 补收的退货退回已消耗的分摊额（负数）；退款的退货不退回（优惠已经实现） |
| `grossPrice(item)` | 优惠前单价 (行金额 + 分摊额) / 数量，没有分摊时即单价 |
| `returnShare(item, qty, amount)` | 退货单本行显示的原单优惠分摊：`qty × grossPrice − amount`，不小于 0 |

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
- 列表显示优惠：`$t('scm.wholeDiscount.value', { amount })`；详情、打印的明细用 `grossPrice` / `grossAmount`，合计处列出优惠前合计、整单优惠（出入库单读 `discountAmount`）、优惠后合计；订单详情的「关闭尾差调整」读 `detail.closeAdjust`；
- 直接开单只在不引用订单时提交 `wholeDiscount`（`TradeDocForm.vue`），引用订单时按订单已分摊的金额出入库。

## 其他入口

- **智能录入**：`ScmExtractSupport` 的提取字段增加 `wholeDiscount`（「整单优惠、抹零或折让金额」），提示词要求明细填优惠前单价，合计校验按优惠后的金额；
- **外部订单导入**：`ScmOrderImportService` 支持「整单优惠」列，同一外部单号各行相同或只填一行（`scm.error.importWholeDiscountMismatch`）；
- **经销商门户**：下单不能填优惠（价格取价目表），内勤在审核前编辑草稿订单填写；
- **报表**：进销存报表、经营分析的销售毛利把整单优惠单独列出：货款（优惠前，行金额 + 不含税的 `discount_share`）− 整单优惠 = 净额（成交金额），明细可把整单优惠作为底部调整行（issue #93，见[明细的调整项显示方式](./jxc-report#明细的调整项显示方式)）；价格参考类查询改取优惠前单价；收付款折让、冲账单、订单尾差调整只调整应收应付，只体现在资产状况中，见[进销存报表开发](./jxc-report)。

## 扩展时注意

::: warning 注意
- 新增会改写订单行金额的逻辑（例如新的折扣类型）时，放在 `WholeDiscounts.apply` 之前，保持「整单优惠最后」的顺序，并同步修改 `OrderForm.vue` 的分摊基数；
- 新的出入库来源（如新的移动端入口）必须走 `ScmTradeDocService` 回写订单，不要自己按 `qty × price` 生成应收应付，否则累计金额会与订单行金额差几分钱；
- 订单行上新增需要累计的金额字段时，用 `ScmOrderItemMapper` 中的原子累加 SQL（`col = col + #{delta}`），并在锁定订单之后执行。
:::
