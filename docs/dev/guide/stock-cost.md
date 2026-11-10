---
order: 18.5
---

# 实时库存成本

仓库模块按物料维护**移动加权平均成本**，随每一次库存变动在同一事务中即时计价：库存查询的均价与库存金额、经营历史、库存流水的成本价、进销存报表的销售成本和毛利都来自这里。它是**业务参考成本**，不生成凭证；财务记账仍以月末成本核算（fin 模块 `FinCostService`）为准。本页说明计价模型、写入时机、各类业务的成本来源、生产成本口径，以及新增一种出入库业务时如何传入成本。用户视角的说明见用户手册 [库存查询 · 实时库存成本](../../manual/wms/stock#实时库存成本)。

## 数据结构

| 表 / 字段 | 说明 |
| --- | --- |
| `wms_material_cost` | 每个物料一行（唯一键 物料 + 租户）：`qty` 计价数量、`amount` 库存金额、`unit_cost` 移动加权单价（6 位小数）。全公司不分仓库，不含供应商寄售仓。只能经 `StockService` 修改 |
| `wms_stock_flow.biz_price` | 业务单价：来源单据的不含税单价（本位币），如采购价、销售价；手工单据为空 |
| `wms_stock_flow.cost_price` / `cost_amount` | 本次变动的成本单价、成本金额（2 位小数，**与数量同号**，出库为负）；供应商寄售仓为空 |
| `wms_stock_flow.partner_id` / `partner_name` | 往来单位与名称快照。wms 不关联 scm 的表，名称由调用方传入 |
| `wms_stock_flow.cost_estimated` | 1 表示升级前的历史流水，成本是升级脚本回填的近似值 |
| `wms_stock_doc.partner_id` / `partner_name` | 业务单据生成的出入库单的往来单位 |
| `wms_stock_doc_item.cost_price` / `biz_price` | 明细的成本单价（手工其他入库填写的、业务单据传入的）与业务单价 |
| `wms_check_item.cost_price` | 盘盈成本价，为空按确认时的均价 |
| `mes_wo_doc.cost_basis` / `material_cost` / `labor_cost` / `overhead_cost` | 完工入库的成本口径（`FinishCostBasis`：`STANDARD` / `ACTUAL` / `AVERAGE`）和转入产品的料工费；退料单的 `material_cost` 为冲减额（负数），`stock_cost_adjust` 为其中计入库存的部分 |
| `mes_work_order.close_cost` / `close_stock_cost` | 工单关闭时尚未转入产品的成本，以及其中追加到产品库存的部分 |

## 计价模型：`MovingAverage`

`wms/model/MovingAverage` 是纯函数，便于单元测试：

```java
MovingAverage.Result r = MovingAverage.apply(state, qty, specifiedUnitCost, refCost);
// r.next()：变动后的 qty / amount / unitCost；r.unitCost()、r.amount()：本次流水的成本单价与金额（与数量同号）
```

- **入库**：按指定单价计价，为空时按当前均价；`amount += round2(qty × 单价)`，单价 = 金额 / 数量（`PRICE_SCALE = 6`，四舍五入）。
- **出库**：按当前均价，指定单价时（如采购退货）按指定单价，但不超过剩余金额；**出完**（结余 ≤ 0）时剩余金额全部转出，不留尾差；成本数量少于出库数量（账实不符）时超出部分按单价计价。
- **结余为 0** 时保留最后的单价，下次未指定单价的入库按它计价；从未有过单价时取物料的参考成本价（`average(state, refCost)`）。
- `allocate(total, qtys, weights)` 把一个金额按权重分摊到多行并返回各行单价，最后一行取尾差（拆卸、委外追加成本使用）。

## 写入时机：`StockService.apply` → `StockCostService.price`

所有库存变动都经 `StockService.apply(bizType, changes)`。它在更新库存**之前**调用 `StockCostService.price`（`Propagation.MANDATORY`，必须在调用方事务内）：

1. 过滤供应商寄售仓（`unvaluedWarehouses`，`WarehouseType.CONSIGN_IN`）的变动，返回 `Priced.NONE`；
2. 按物料 ID 升序（`TreeSet`）对 `wms_material_cost` 加行锁（`WmsMaterialCostMapper.selectForUpdate`，`SELECT ... FOR UPDATE` 写在 XML 中）。还没有成本记录的物料先初始化：数量 = 当前计价库存合计（`selectValuedQty`，所以必须在库存变动之前），单价 = 参考成本价；并发初始化遇到 `DuplicateKeyException` 后重新加锁读取；
3. 逐条计价：`TRANSFER`（含在途调拨的调出和收货）不改变状态，按均价记金额；在途调拨收货的调入行由调用方传入调出时的成本单价（`StockChange.unitCost`），调出、调入金额相抵；`IN` / `OUT` 用 `StockChange.unitCost()`；`CHECK` 盘盈用填写的成本价、盘亏按均价；
4. 写回有变化的物料（`updateCost`），并把成本单价、金额连同业务单价、往来单位写入流水。

固定的加锁顺序避免了两张单据交叉锁物料造成死锁；成本记录与库存在同一事务中更新，单据失败时一起回滚。

调用方通过 `StockChange` 传入成本信息：

```java
StockChange.of(warehouseId, locationId, materialId, batchNo, qty, serials)
        .withCost(unitCost, bizPrice, partnerId, partnerName);   // unitCost 为空 = 按当前均价
```

出入库单走 `WmsStockDocService`：业务模块构造 `StockDocRequest` 时用 `StockDocItemRequest.withCost(costPrice, bizPrice)` 给每行带上成本，用 `StockDocRequest.withPartner(partnerId, partnerName)` 带上往来单位；`StockDocRules.changes` 把它们转成 `StockChange`。手工单据只有入库（寄售入库除外）保留 `costPrice`，业务单价只接受业务单据传入（`generated(sourceNo, req)`，期初入库导入也算业务生成）。

## 各类业务的成本来源

| 业务 | 成本单价 | 代码 |
| --- | --- | --- |
| 采购入库 / 退货 | 行不含税金额（本位币，含促销、返利、整单优惠分摊）/ 数量，同时作为业务单价；退货按退货单价冲减 | scm `ScmStockCosts.enrich` |
| 销售出库 | 当前均价（`unitCost` 为空），业务单价为不含税售价 | `ScmStockCosts.enrich` |
| 销售退货 | 该订单原销售出库的实际成本（`StockCostService.docUnitCosts`），没有时按均价 | `ScmStockCosts.originalOutCosts` |
| 其他入库 | 表单填写的成本价（4 位小数）；有 `wms:stock:cost` 时前端默认 `GET /wms/stock/unit-cost` 返回的均价，没有时不带出、为空按确认时的均价；保存成本为 0 的行前二次确认 | `StockDocForm.vue` |
| 期初入库 | 导入行的 `costPrice`，为空取参考成本价 | `WmsOpeningStockService` |
| 盘点 | 盘盈 `wms_check_item.cost_price`（空则确认时的均价；前端输入 4 位小数，有 `wms:stock:cost` 时以均价作为输入提示），盘亏均价 | `WmsCheckService` |
| 组装 / 拆卸 | 组装：成套件 = 子件出库成本合计（`docAmount`）/ 数量；拆卸：成套件出库成本按 子件数量 × 均价 的权重 `allocate` 到子件 | `WmsAssemblyService` |
| 在途调拨收货 | 调出流水的成本单价（`StockCostService.transferOutCosts(docId, materialIds)`，取该调拨单的负数流水），没有时按均价。在途期间计价数量不变，按调出时的单价收货使调出、调入金额相抵，按流水汇总的库存金额不会与物料实时成本偏离 | `WmsStockDocService.receive` |
| 冲销 | 原单各物料的实际成本单价反向（`StockDocRules.reverseChanges(..., costs)`）；调拨冲销不按原单成本，两边统一按均价（金额相抵） | `StockDocReverser` |
| 生产领料 / 补料、其他出库、各类领用 | 当前均价 | — |
| 生产退料 | 该工单该物料的领料（含补料）平均成本 | `MesStockCosts.returnUnitCosts` |
| 完工入库 | 见下节 | `MesStockCosts.finishCost` |
| 报废入库 | 表单填写的成本价（`WoDocItemRequest.costPrice`，需要 `wms:stock:cost`），否则均价；不分摊工单成本 | `MesWoDocService` |
| 委外收回（加工商退回子件） | 该委外订单该子件的发料平均成本（`outsourceIssueUnitCosts`，按来源单号汇总委外发料流水） | `MesOutsourceService` |
| 委外件收货 / 退货 | 采购入库先按加工费（不含税单价）计价；mes 监听 `TradeDocConfirmedEvent`，在同一事务中按 核销数量 × 发料平均成本 调用 `StockCostService.addCost` 追加（退货为负）。委外用料只为物料属性为委外的明细自动生成；自制件偶尔委外时由用户在订单详情「委外加工明细」中选择明细（`GET /mes/outsource/{orderId}/candidates` 列出有默认 BOM、未生成用料、未收货的明细，`POST /mes/outsource/{orderId}/lines` 即 `MesOutsourceService.addLines` 按默认 BOM 生成），之后发料、核销、成本相同 | `MesOutsourceService.onTradeDocConfirmed` |

`StockCostService.addCost(kind, docId, extra)` 给已确认单据追加成本：更新物料的金额和单价（数量不变）、按数量把追加额分摊到该单据该物料的流水（最后一条取尾差）、回写明细的成本单价；物料已没有计价数量时不追加，库存金额不会被减成负数，返回实际追加额。

## 生产成本口径

`MesStockCosts.finishCost(wo, bizDate, qty)` 在完工数量回写之前调用：

1. **标准成本**：framework 契约 `framework/finance/StandardCostProvider` 由 fin 的 `FinStandardCostProvider` 实现，取生效期间不晚于业务日期所在期间的最近一个已发布标准成本版本，单价大于 0 时按它计价，料工费按版本中的构成拆分（为空时整个单价计为材料）。mes 只依赖 framework，用 `ObjectProvider` 获取（没有 fin 时跳过）。
2. **实际成本** = 材料 + 人工 + 制造费用：
   - 材料 `WoFinishCost.amount`：净领料成本 = 领料 + 补料出库成本 − 退料入库成本。非最后一次完工按 BOM 用量取 min(本次应耗, 尚未被之前完工耗用的已领数量) × 净领料单价；最后一次（累计达到工单数量）取「净领料成本 − 之前已转入的材料成本」，超领由它承担；领用的物料都不在 BOM 中时按剩余数量平均。
   - 工费 `WoConversionCost.amount`：与月末核算同口径，工时 × 工作中心人工费率 / 制造费用率。有报工工时的工序按累计报工工时，非最后一次取 min(本次数量, 该工序尚未转出的合格数) × 工序工费 / 累计合格数；没有报工工时的工序按 标准工时 × 完工数量（月末核算此时没有工费）；最后一次取剩余。
3. 既没有已计价的领料也没有工费时为 `AVERAGE`，按当前均价入库，入库后把实际计价金额记为材料成本（`docAmount`）。

每张完工入库单记录口径和料工费，之后的完工按这些记录扣除已转入部分。

- **完工后退料**（`afterReturn`）：按退料后的净领料把累计完工当作一次重新计算应承担的材料成本，已转入的超出部分冲减产品成本（不低于 0）。月末核算（`CostCalculator`）口径一致：本期之前已完工满数量的工单，之后的退料等剩余成本（含上期结转的在产品余额）在当期计入产品成本，不留在在产品中。
- **提前关闭**（`closeCost` 预览、`applyClose` 执行）：未转入 = 净领料成本 − 已转入材料（不为负）+ 已发生工费 − 已转入工费。有完工时追加到产品，没有完工时为在制品损失、不进入库存。关闭确认框先调 `GET /mes/wo/{id}/close-cost`（`WoCloseCostView`，金额需要 `wms:stock:cost`）。
- 冲减和追加都只计入仍在库的部分：比例 = min(产品当前计价数量 `valuedQty`, 工单完工数量) / 完工数量，写到最后一张完工入库单的流水上（`addCost`）。已出库的部分不再调整，因为实时成本没有销售成本账。
- 已按标准成本完工的工单，这两项都不处理，差异在财务「成本差异」中分析。

## 寄售仓与调拨

供应商寄售仓的库存不计价。为保证计价数量始终等于自有库存，`StockDocRules.checkConsignTransfer` 禁止寄售仓与自有仓互相调拨（`wms.error.supplierConsignmentTransferNotAllowed`），只允许同一供应商的寄售仓之间调拨。寄售货物转为自有走寄售结算（采购入库到自有仓 + 寄售消耗出库），退回供应商用其他出库。

在途调拨收货（`POST /wms/transfer/{id}/receive`，请求体 `TransferReceiveRequest` 的 `receiveDate`，可省略）可指定收货日期：为空取当天，不能早于调拨单的 `biz_date`（`wms.error.receiveDateBeforeTransferDate`），按收货日期做结账校验并保存到 `wms_stock_doc.receive_date`。按仓库统计的收发存（`WmsInOutMapper`）、经营历史（`WmsStockFlowMapper.historyDate`）、库龄（`FinStockAgeMapper`）和 BI 库存金额（`BiJxcMapper`）中，调入流水（数量为正）的日期取 `COALESCE(receive_date, biz_date)`。

## 查询与权限

| 功能 | 接口 / 代码 |
| --- | --- |
| 库存查询的均价、库存金额 | `WmsStockMapper.xml` 的 `avgCost` 片段（没有成本记录或数量为 0 且无单价时取参考成本价），寄售仓为空；合计 `GET /wms/stock/total` |
| 当前均价（表单默认值） | `GET /wms/stock/unit-cost?materialIds=`，只要求 `wms:stock:cost`（均价是系统计算的成本，只能新增 / 修改入库单、盘点单的人拿不到）；前端没有该权限时不调用 |
| 经营历史 | `GET /wms/stock/history`（`WmsStockQueryService.history`，前端 `components/wms/StockHistory.vue`）：期初 + 日期范围内的流水（最多 5000 条），不选仓库时排除调拨和寄售仓；日期取单据业务日期，在途调拨的调入流水取收货日期（`wms_stock_doc.receive_date`） |
| 库存流水 | 流水分页返回 `bizPrice`、`costPrice`、`costAmount`、`partnerName`、`costEstimated` |

单价和金额由按钮权限 `wms:stock:cost`（「查看成本金额」）控制，**后端不返回**（置空），不是只在前端隐藏；前端用 `hasPerm('wms:stock:cost')` 决定是否显示列。系统计算的成本（当前均价、出库成本、确认后的实际入库成本、盘点差异金额）只给有该权限的人；没有该权限、但要录入成本价的人只能看到自己填写的值：

- **盘点单详情**（`WmsCheckService.detail`）：`costVisible` = 有 `wms:stock:cost`，或盘点单**未完成**且有 `wms:check:add` / `wms:check:edit`；为假时置空 `costPrice`。当前均价 `avgCost`（`fillAvgCost`）和已完成单据的差异金额 `diffAmount`（按流水 `selectSlotCosts` 汇总）只在有 `wms:stock:cost` 时填充；按库存生成明细时同样只对有该权限的人带出均价。前端差异金额列按 `hasPerm('wms:stock:cost')` 显示；已完成单据没填成本价的盘盈行，成本价列显示 `diffAmount ÷ 盘盈数量`（实际计价单价），不再显示「默认当前均价」。
- **出入库单详情**（`WmsStockDocService.detail`）：没有 `wms:stock:cost` 时总是置空 `bizPrice`；`costPrice` 只在入库单为**草稿**且有 `wms:in:add` / `wms:in:edit` 时保留（填写其他入库的成本价），确认后的入库单、出库单都置空。

进销存报表（bi 模块 `BiJxcMapper.xml`）：`flowCost` 片段按 `wms_doc_id` 关联库存流水，汇总单据各物料的成本金额与数量；`saleUnitCost` = `COALESCE(实时出库成本单价, 当月核算单价, 参考成本价)`。资产状况、商品分析的库存金额用 `latestCost`（实时均价 → 最近一期核算单价 → 参考成本价）。详见 [进销存报表开发](./jxc-report)。

## 近似成本与升级

升级前的流水没有实时计价。升级脚本按以下方式回填并标记 `cost_estimated = 1`：采购入库 / 退货取单据不含税单价，其他流水取所在月份及之前最近一期的成本核算单价，没有时取参考成本价。物料的实时成本按当前库存 × 最近一期核算单价初始化，历史完工入库的流水成本回填为材料成本（工费为 0，`cost_basis` 为空）。前端在这些行的成本价前显示「近似」标签；经营历史的期初含这类流水时返回 `openingEstimated`。工单详情的「领料 / 完工记录」（`WoDocsTab.vue`）中，`cost_basis` 为空但 `material_cost` 不为空的完工入库显示料工费合计和橙色「近似」标签（`mes.wo.cost.estimated` / `estimatedTip`），不再显示「-」。

采购入库按各自的业务单价回填、出库和物料成本按核算单价，两者累计会有差额，导致经营历史的结余金额与库存查询的库存金额不一致。因此升级脚本最后把物料库存金额与流水成本累计对齐：对流水全部是回填近似成本（没有升级后业务、没有成本为空的流水）、且流水累计数量（不含供应商寄售仓）等于 `wms_material_cost.qty` 的物料，`amount` 取流水 `cost_amount` 累计，`unit_cost` 重算为 `amount / qty`（6 位小数）。已对齐的不再变化，可重复执行；累计数量为 0、金额为负的物料不处理。

## 与月末成本核算的关系

| | 实时库存成本 | 月末成本核算 |
| --- | --- | --- |
| 模块 | wms（`StockCostService`），生产部分在 mes（`MesStockCosts`） | fin（`FinCostService`、`CostCalculator`） |
| 计价方法 | 移动加权平均 | 物料的计价方法：月末一次加权、移动加权、先进先出 |
| 结果 | `wms_material_cost`、流水的 `cost_price` / `cost_amount` | `fin_material_cost`、成本结转凭证 |
| 用途 | 库存金额、经营历史、进销存报表毛利 | 财务报表、毛利分析、存货科目 |

月末成本结转凭证中，项目领料（`biz_type = 'PROJECT'` 的出库单，来源单号为项目编号）借记合同履约成本时按项目辅助核算：`FinCostSourceMapper.selectProjectMovements` 按 物料 × 项目 汇总领用数量（出库单 `source_no` 关联 `pm_project.code`），`CostVoucherWriter.splitByProject` 按「数量 × 本期单价」拆分，对应不到项目的部分不带项目，数量全部对应到项目时舍入尾差计入最后一个项目，每个项目一条借方分录（`VoucherLine.withProject`），与项目月结按项目贷记合同履约成本的口径一致。

两者互不读取对方的结果：月末核算按流水数量和单据金额重新计价，不使用流水上的成本价。口径差异（月末一次加权的出库单价要到月末才确定、没有报工工时的工序、关闭工单的处理等）会导致金额不一致，账面以月末核算为准。

## 新增一种出入库业务时

1. 确定成本来源：有准确来源成本的（如退回按原出库成本）传 `unitCost`；没有更准确来源的出库不传，按均价。
2. 生成出入库单时用 `StockDocItemRequest.withCost(costPrice, bizPrice)`、`StockDocRequest.withPartner(...)`；直接调用 `StockService.apply` 的用 `StockChange.withCost(...)`。
3. 需要在入库后再调整成本的（类似委外追加子件成本），在同一事务中调用 `StockCostService.addCost`，不要直接改 `wms_material_cost`。
4. 新的仓库类型如果不属于本公司存货，加入 `unvaluedWarehouses` 的判断，并检查调拨规则。
5. 涉及金额返回前端的接口按 `wms:stock:cost` 置空单价金额。
