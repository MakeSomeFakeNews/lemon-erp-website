---
order: 19
---

# 进销存报表开发

「供应链 → 进销存报表」包括销售报表、进货报表、经营状况、资产状况、商品分析、客户分析（RFM）。页面挂在供应链菜单下，代码在 bi 模块；与商务智能的多维分析不同，进销存报表**实时查询业务表**，不依赖数据仓库同步。本页说明它的代码结构、口径、汇总维度的扩展方式和穿透查询。

## 代码位置

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 接口 | `bi/controller/BiJxcController`（`/bi/jxc/*`） | 销售 / 进货的汇总、单据列表（`docs`）、明细、导出，经营状况、资产状况、商品分析（`goods/top`、`slow`、`overstock`、`shortage`、`turnover`）、RFM |
| 查询条件 | `bi/dto/JxcQuery` | 日期范围（必填）、往来单位、业务员、物料、分类、品牌、区域、仓库、关键字，穿透的 `dim` + `key`、单据 `docId`（单据列表 → 该单的明细），明细的调整项显示方式 `adjustMode`，商品分析的阈值 |
| 返回结构 | `bi/dto/JxcViews` | `Summary`（行、合计、是否截断）、`SummaryRow`、`DetailRow` / `DetailPage` / `DetailExport`（明细，带调整行 `adjustments` 和合计 `summary`）、`DocRow` / `DocPage` / `DocExport`（单据列表）、`Business`、`Assets`、`GoodsRow`、`Rfm` 等 |
| 汇总维度 | `bi/model/JxcDimension` | 销售、进货各自可用的维度 |
| Service | `BiJxcService`（销售、进货、经营状况）、`BiJxcAnalysisService`（资产状况、商品分析、RFM）、RFM 的打分分群在 scm 模块的 `RfmCalculator`（纯计算，与客户关系共用），参数读取 `ScmRfmService` | |
| SQL | `resources/mapper/bi/BiJxcMapper.xml` | 只读 JOIN scm、wms、fin 的表 |
| 前端页面 | `views/jxc/{sales,purchase,business,assets,goods,rfm}/index.vue` | 菜单组件路径 `jxc/sales/index` 等 |
| 前端组件 | `components/bi/jxc/JxcTradeReport.vue`（销售 / 进货汇总，`report="sales"` / `"purchase"`）、`JxcDocs.vue`（单据列表子页）、`JxcDetail.vue`（明细子页）、`jxc.js`（日期快捷选项、维度列表、汇总行名称、穿透操作 `drillActions` / `drillColumn` / `drillsToLines`） | 销售报表、进货报表两个页面只是 `<JxcTradeReport report="..." />` |
| 接口封装 | `api/bi/jxc.js` | `jxcSummary`、`jxcDetail`、`jxcExport`、`jxcDocs`、`jxcDocsExport`、`jxcBusiness`、`jxcAssets`、`jxcGoods`、`jxcRfm` |
| 语言包 | `locales/<语言>/jxc.js` | 维度名称在 `jxc.dim.<维度>` |

菜单：分组「进销存报表」（ID 966，供应链下）及 6 个页面（370–375），权限 `bi:jxc:sales`、`bi:jxc:purchase`、`bi:jxc:business`、`bi:jxc:asset`、`bi:jxc:goods`、`bi:jxc:rfm`；SaaS 功能模块为 `JXC_REPORT`（依赖销售、采购），见 [新增菜单与授权](./menu#功能模块与行业模板)。

## 数据口径

销售 / 进货的汇总和明细都来自 `scm_trade_doc` + `scm_trade_doc_item`，`BiJxcMapper.xml` 中的公共片段：

| 片段 | 内容 |
| --- | --- |
| `tradeFrom` | 明细 JOIN 单据、订单（业务员取 `scm_order.salesman_id`）、物料；销售 LEFT JOIN 客户和当月的 `fin_material_cost`，进货 LEFT JOIN 供应商 |
| `tradeWhere` | 单据种类（销售：`SALES_OUT`、`SALES_RETURN`；进货：`PURCHASE_IN`、`PURCHASE_RETURN`）、日期范围和各项筛选；仓库按 `COALESCE(i.warehouse_id, d.warehouse_id)` |
| `sign` | 出库（入库）为 1、退货为 -1，净额 = 出库（入库）− 退货 |
| `lineDiscount` / `lineGoods` | 行的不含税整单优惠 `ROUND(discount_share × 100 ÷ (100 + tax_rate), 2)`（`discount_share` 为含税分摊额，按行税率折算、每行舍入到分）/ 行的货款 = 不含税金额 + `lineDiscount`（整单优惠前） |
| `measures` | 出库 / 退货 / 净数量，出库货款、退货货款（`lineGoods`）、整单优惠、净额、价税合计、成本、按参考成本计算的行数（`missingCost`）、单据数 |
| `dimKey` | 汇总维度的分组键（见下文） |

- 金额为本位币、**不含税**，另列价税合计（优惠后）；金额口径见下文[金额口径](#金额口径)；
- 销售成本与财务「毛利分析」一致：数量 × 单据所在月份的成本核算单价（`fin_material_cost.unit_cost`），没有核算时取物料的参考成本价，并统计按参考成本计算的行数；
- 货款、销售金额、毛利、毛利率、均价在 `BiJxcService.fillSummary` 中计算（`Decimals` 统一精度），SQL 只做求和；货款由 净额 + 整单优惠 得出（各自舍入后相加），保证 货款 − 整单优惠 = 净额，各层合计都由行累加；均价 = 净额 ÷ 净数量；
- 明细行在「汇总到底部」时显示优惠前单价 `gross_price`，「分摊到各行」时显示成交单价，见[明细的调整项显示方式](#明细的调整项显示方式)；
- 汇总最多返回 `SUMMARY_LIMIT`（1000）行，合计（`selectTotal`）仍为全部；明细、单据列表导出最多 `EXPORT_LIMIT`（5000）行；
- 日期范围由 `checkRange` 校验：销售、进货、商品分析不超过 366 天，经营状况、RFM 不超过 731 天。

### 金额口径

issue #93：单据是存放成本、销售金额、毛利的基本单元，销售报表、进货报表和财务「经营分析」的销售毛利（`FinAnalysisService` / `FinAnalysisMapper.xml`）统一为：

- 出库（入库）货款 − 退货货款 = **货款**（整单优惠前，不含税）；货款 − **整单优惠**（不含税）= **净额**（销售收入 / 进货金额，与记账一致，保留以便与利润表对账）；
- 销售：**销售金额** = 净额 − 本公司承担运费 − 收款折让 / 抹零 − 坏账核销；**毛利** = 销售金额 − 成本，毛利率 = 毛利 ÷ 销售金额。客户代垫运费不影响毛利。运费、折让、坏账在利润表中分别计入销售费用、财务费用、营业外支出，利润表的毛利 = 净额 − 成本，所以两者不同，页面说明中写明；
- 进货：扣折让后净进货额 = 净额 − 付款折让（参考，付款折让计入财务费用，不冲减存货成本）；
- 字段（`JxcViews.SummaryRow`，汇总行、单据行、明细行同名）：`goodsAmount`、`discount`（`discountTaxed` 为含税）、`netAmount`、`freight`、`settleDiscount`、`badDebt`、`salesAmount`、`cost`、`profit`、`margin`，进货 `netAfterDiscount`；汇总的出库 / 退货货款为 `bizAmount` / `returnAmount`；
- 运费、折让、坏账按单据归属、按行金额比例分摊，所以按类别、品牌、商品汇总时只含所属明细的部分。

原来的「扣折让后毛利」「扣折让、坏账后毛利」「扣折让、坏账、运费后毛利」（`profitAfterDiscount`、`profitAfterBadDebt`、`profitAfterFreight`）已去掉：新的 `profit` 就是原来的「扣折让、坏账、运费后毛利」，调整项逐项列出，中间两步不再单独返回。AI 工具 `fin_gross_margin` 同样返回销售金额。

### 坏账与运费

销售报表与经营分析的销售毛利（两个 mapper 各有同样的片段）返回 `badDebt`、`freight`（issue #38、#72）：

- 片段 `badDebtFreight`：LEFT JOIN 销售出库单应收单（`fin_bill.kind = 'AR' AND source_type = 'SALES_OUT'`）上的 `bad_debt_amount` 合计（按该应收单的不含税比例折算），以及该出库单已发货（`status <> 'PENDING'`）、本公司承担（`freight_bearer = 'COMPANY'`）的发运运费合计（只在出库单没有登记运费时，即 `d.freight = 0`，出库单已登记运费时发运单从出库单带出，不重复计算）；客户承担的代垫运费不计入；
- 片段 `freightAmount`：本公司承担的运费 = 上述发运运费 + 出库单上本公司承担的运费（`kind = 'SALES_OUT' AND freight_bearer = 'COMPANY'`）+ 销售退货客户代垫的运费（`kind = 'SALES_RETURN'` 的 `freight`，按退货单计入）；
- 片段 `docShare` 按行金额 / 单据价税合计（合计为 0 时按数量）分摊到明细（坏账只有出库单有，退货单的运费同样按行分摊）；
- 坏账、运费都跟随出库单的业务日期归属（看每张单据的真实收益），不按核销日期，按期间与利润表不一定一致。

### 收付款折让

issue #89。收付款时的折让 / 抹零（`fin_bill.discount_amount`，见[应收应付核销开发 · 折让对报表的影响](./settlement#折让对报表的影响)）不改变出入库单金额，净额不变，销售从销售金额中扣除，进货另列参考：

- 片段 `settleDiscount`（`BiJxcMapper.xml`、`FinAnalysisMapper.xml` 各一份）：LEFT JOIN 该出入库单生成的应收应付单（按 `source_id` 关联）的 `discount_amount` 合计——销售取 `AR` 的 `SALES_OUT` / `SALES_RETURN` / `SALES_FREIGHT` / `SALES_RETURN_FREIGHT`（货款，以及客户代垫运费、退货运费），进货取 `AP` 的 `PURCHASE_IN` / `PURCHASE_RETURN` / `PURCHASE_FREIGHT` / `PURCHASE_RETURN_FREIGHT`；按单据自身的不含税比例 `(amount − tax_amount) ÷ amount` 折算（与坏账相同），再用 `docShare` 按行金额分摊；
- 同一单据多次收付款累计、作废收付款时扣回，外币单据已按记账汇率折算为本位币；跟随出入库单的业务日期归属，不按收付款日期；退货的红字单据折让为负数（少退给客户，销售金额增加）；
- 返回字段 `settleDiscount`；进货另有 `netAfterDiscount`（汇总，扣折让后净进货额）/ `amountAfterDiscount`（单据列表、明细，扣折让后金额），只作参考——付款折让按准则计入财务费用，不冲减已入库存货的成本，实时成本和月末核算都不调整；
- 商品分析（畅销、滞销等）按商品的销售额 / 毛利排序，折让是收款层面的调整，不在其中；需要看商品分摊后的折让用销售报表按商品汇总。

### 明细的调整项显示方式

issue #93。销售报表、进货报表的商品明细（整张单据的明细、按客户 / 业务员 / 日期等穿透的明细、全部明细、按商品 / 类别穿透的明细）和经营分析「销售毛利 → 单据明细」都有参数 `adjustMode`（枚举 `fin/model/AdjustMode`，bi 依赖 fin，两边共用；未指定时 `AdjustMode.orDefault` 为 `BOTTOM`）：

| 方式 | 明细行 | 调整行 |
| --- | --- | --- |
| `BOTTOM` 汇总到底部（默认，issue 倾向的常见做法） | 优惠前单价（`gross_price`）、价税合计和货款；行上的销售金额 = 货款，毛利 = 货款 − 成本，不分摊调整项 | 接口另返回 `adjustments`（`fin/dto/AdjustRow`），按 `AdjustItem` 的顺序：`DISCOUNT` 整单优惠、`FREIGHT` 本公司承担运费、`SETTLE_DISCOUNT` 收款 / 付款折让 / 抹零、`BAD_DEBT` 坏账核销；`AdjustRow.of` 只列出有金额的类别，金额为负、成本 0、毛利 = 金额，退货方向相反，整单优惠另带含税金额 `taxedAmount`；进货只有整单优惠和付款折让，没有成本、毛利 |
| `ALLOCATE` 分摊到各行 | 整单优惠、运费、折让、坏账按行分摊，销售金额 = 净额 − 运费 − 折让 − 坏账 | 无 |

- 调整行取自同一条件的合计（`selectTotal`），所以按商品、类别、品牌、仓库、关键字筛选只看到单据的一部分时，就是所选明细分摊的部分（整单优惠按所选行的分摊额，运费、折让、坏账按所选明细占单据的金额比例），与按商品、类别汇总时的行一致；
- 两种方式下 明细行 + 调整行 的合计相同，都等于接口返回的 `summary`（= 汇总行）；
- 返回结构：明细 `GET /bi/jxc/{sales,purchase}/detail` 返回 `DetailPage(records, total, adjustments, summary)`，导出 `/export` 返回 `DetailExport(rows, truncated, adjustments, summary)`；经营分析的 `grossMarginDetail` 增加 `adjustMode` 参数，返回 `adjustments`，合计为 `total`；
- 调整行放在表格底部的汇总区（`a-table-summary`），而不是追加到分页数据的最后一页：每一页都能看到调整行和合计，分页总数只是商品行数。明细统一按行取数（`BiJxcService.fillDetail` 按显示方式计算行），mapper 中不再 `UNION ALL`；
- #91 在整张单据明细末尾追加的折让行（`discountLine`、`JxcQuery.isWholeDocs()`）已并入调整行，不再单独列出；从单据列表进入某张单据的明细时，底部调整行即该单的调整项（退货单的整单优惠为正数，即少退的优惠）；
- 前端：`composables/useAdjustMode` 把选择记在本机浏览器（`localStorage` 的 `lemon.adjustMode`），三处明细共用；`components/bi/jxc/JxcDetail.vue` 右上角切换，底部渲染调整行和合计行，导出为 明细行 + 调整行（汇总到底部时）+ 合计行，列随显示方式变化；经营分析的销售毛利拆为 `components/fin/GrossMarginPanel.vue`（`views/fin/analysis/index.vue` 引用），汇总表列出货款、整单优惠、销售收入、运费、折让、坏账、销售金额、成本、毛利、毛利率，顶部卡片为销售收入、销售金额、销售成本、毛利、毛利率，调整项不为 0 时各加一张卡片；`AdjustMode`、`AdjustItem` 由 `npm run gen:enums` 生成到 `@/constants/enums`。

### 数据权限

各方法用 `@DataPermission(table = "scm_trade_doc", deptColumn = "dept_id", userColumn = "create_by")`，按出入库单的制单人部门 + 制单人过滤（经营状况、商品分析、RFM 相同）。汇总全公司数据的部分要求「全部数据」权限：资产状况调用 `BiDecisionService.requireAllData()`，经营状况的资金流只在 `SecurityUtils.getDataScope().all()` 时返回（否则为 `null`，前端不显示）。资产状况的现金、银行余额调用 fin 的 `FinCashierService.daily`（含未记账凭证）。

前端明细中点击单据号打开出入库单详情（`components/scm/TradeDocDetail.vue`），详情接口还要求对应出入库单的查看权限（如 `scm:salesOut:list`）。

## 汇总维度：JxcDimension

```java
public enum JxcDimension {
    CATEGORY(true, true),   // 物料分类（wms_material_category，按字典类型读取完整路径）
    BRAND(true, true),      // 品牌（业务字典 wms_material_brand）
    REGION(true, false),    // 客户区域
    CUSTOMER(true, false),
    SALESMAN(true, false),  // 订单的 salesman_id
    SUPPLIER(false, true),
    MATERIAL(true, true),
    DAY(true, true),
    MONTH(true, true);
    // 构造参数：销售报表可用、进货报表可用；supports(salesReport)、isDate()
}
```

汇总接口 `GET /bi/jxc/{sales|purchase}?groupBy=<维度>&begin=&end=...`，`BiJxcService.summary` 先用 `dim.supports(sales)` 校验维度，再把维度名称传给 `selectSummary`。XML 中按维度选择分组键、显示名称和排序：

```xml
<sql id="dimKey">
    <choose>
        <when test="dim == 'CATEGORY'">COALESCE(m.category, '')</when>
        <when test="dim == 'BRAND'">COALESCE(m.brand, '')</when>
        <when test="dim == 'REGION'">COALESCE(p.region, '')</when>
        <when test="dim == 'CUSTOMER' or dim == 'SUPPLIER'">d.partner_id</when>
        <when test="dim == 'SALESMAN'">o.salesman_id</when>
        <when test="dim == 'MATERIAL'">i.material_id</when>
        <when test="dim == 'DAY'">d.biz_date</when>
        <otherwise>YEAR(d.biz_date) * 100 + MONTH(d.biz_date)</otherwise>
    </choose>
</sql>
```

- 分组键 `groupKey` 统一为字符串：分类、品牌、区域是字典值或文本，往来单位、业务员、商品是 ID，日为 `YYYY-MM-DD`，月为 `YYYYMM`；可能为空的文本列用 `COALESCE(列, '')` 合成一组，Service 中把空串转为 `null`（「未设置」）；
- `groupName`：往来单位、业务员、商品在 SQL 中取名称（同时加入 `GROUP BY`），分类、品牌在前端按字典显示；
- 排序：日、月按日期升序，其他按净额降序。

### 新增一个汇总维度

以销售报表「按仓库」汇总（`WAREHOUSE`）为例：

1. **枚举**：在 `JxcDimension` 中增加 `WAREHOUSE(true, true)`（两个参数分别表示销售、进货报表是否可用）。
2. **分组键与名称**：在 `BiJxcMapper.xml` 的 `dimKey` 中增加 `<when test="dim == 'WAREHOUSE'">COALESCE(i.warehouse_id, d.warehouse_id)</when>`；在 `selectSummary` 的 `groupName` 中取仓库名称（`LEFT JOIN wms_warehouse w ON w.id = COALESCE(i.warehouse_id, d.warehouse_id)`，与 `SALESMAN` 的 `LEFT JOIN sys_user` 写法相同，只在该维度时 JOIN），并在 `GROUP BY` 的 `<choose>` 中加上名称列。
3. **穿透条件**：在 `BiJxcService.prepare` 的 `switch` 中把汇总行的键转换为筛选条件，例如 `case WAREHOUSE -> q.setWarehouseId(Long.valueOf(key));`（`JxcQuery.warehouseId` 和 `tradeWhere` 中的条件已经存在）。新维度对应的筛选字段不存在时，在 `JxcQuery` 中加字段、在 `tradeWhere` 中加条件；键为空（「未设置」）也要能穿透的，参照 `noCategory` 在 `JxcQuery.markNone` 中加一个只能由穿透设置的标记（`@Setter(AccessLevel.NONE)`，不从请求接收），并在 `prepare` 中把该维度加入 `markNone` 的判断。
4. **前端常量**：运行 `npm run gen:enums`，`constants/enums.js` 中的 `JxcDimension` 出现 `WAREHOUSE`；在 `components/bi/jxc/jxc.js` 的 `SALES_DIMS` / `PURCHASE_DIMS` 中按显示顺序加入。
5. **汇总行名称**：`jxc.js` 的 `groupLabel` 默认显示 `row.groupName`，字典类维度（如分类、品牌）在其中按字典取标签；纯文本键（如日、区域）直接显示键。
6. **语言包**：在 `locales/zh-CN/jxc.js`、`locales/en-US/jxc.js` 的 `dim` 中加 `WAREHOUSE`（汇总列标题、维度切换按钮、导出文件名都用 `jxc.dim.<维度>`）。
7. **默认穿透**：新维度与商品直接相关（点击汇总行应到商品明细）时，加入 `jxc.js` 的 `LINE_DIMS`；否则默认到单据列表，不用修改。
8. **验证**：汇总合计与其他维度一致；点击汇总行打开的明细只包含该仓库的行，单据列表的行数、合计与汇总行一致；明细、单据、汇总导出正常。

::: warning 注意
`dim` 在 XML 中按枚举名称比较（`dim == 'CATEGORY'`），这是 mapper XML 中允许的字面量；Java 和前端一律用 `JxcDimension` 枚举 / 常量。`BiJxcService.prepare` 的 `switch` 中 `default` 分支什么也不做：新维度漏掉第 3 步时不会报错，但穿透会忽略键、返回整个筛选范围的明细，新增维度时不要漏掉。
:::

## 穿透查询：汇总 → 单据 / 明细 → 单据详情

汇总行有两种穿透（issue #88），操作列的【单据】【商品明细】两个图标（`jxc.js` 的 `drillActions`，操作列 `drillColumn`，`TableActions` 显示，中间竖线分隔）：

| 穿透 | 接口 | 前端 | 内容 |
| --- | --- | --- | --- |
| 商品明细 | `GET /bi/jxc/{sales,purchase}/detail` | `JxcDetail.vue` | 出入库明细，每行一种物料，退货为负数，分页 |
| 单据 | `GET /bi/jxc/{sales,purchase}/docs` | `JxcDocs.vue` | 该汇总项下的出入库单 / 退货单，每张一行，分页，返回 `DocPage(records, total, summary)` |

点击汇总行的默认穿透由 `drillsToLines(dim)` 决定：按类别、品牌、商品（与商品直接相关，`LINE_DIMS`）汇总时到商品明细，按客户 / 供货商、区域、业务员、日、月汇总时到单据列表。经营状况的员工销售、客户分布和客户 RFM 同样提供两种穿透、默认到单据（需要 `bi:jxc:sales`）；商品分析本身按商品分行，一张单据中同一商品通常只有一行，只穿透商品明细。汇总页头部「全部单据」「全部明细」不带 `dim` / `key`。

汇总、单据列表与明细使用**同一个 `JxcQuery`**，前端打开子页时把汇总页的查询条件原样带上，再加上被点击的汇总行：

```js
// components/bi/jxc/JxcTradeReport.vue
const opts = { params: params(), dim: groupBy.value, key: row.groupKey, label: groupLabel(groupBy.value, row, dict) }
drillsToLines(groupBy.value) ? detailRef.value.open(opts) : docsRef.value.open(opts)
// 「全部单据」「全部明细」：不带 dim / key
docsRef.value.open({ params: params() })
```

`?dim=&key=` 由 `BiJxcService.prepare` 转换为筛选条件（明细、单据列表相同）：

| 维度 | 转换 |
| --- | --- |
| 分类、品牌、区域 | `drillCategory` / `setBrand` / `setRegion`；键为空时 `markNone`（筛选「未设置」）。分类的筛选条件 `category` 包含下级分类，汇总却按物料的分类编码分组（下级分类单独成行），所以穿透用 `drillCategory` 只取该分类本身（`categoryExact`），与汇总口径一致 |
| 客户、供应商 | `setPartnerId` |
| 业务员 | `setSalesmanId`；键为空时 `markNone`（没有业务员） |
| 商品 | `setMaterialId` |
| 日、月 | 把日期范围收窄到当天 / 当月，与原范围取交集（`narrow`） |

键格式不对时抛 `bi.error.jxcInvalidKey`；进货报表忽略业务员、区域条件。明细 `selectDetail` 分页返回出入库明细（退货为负数），`JxcDetail.vue` 中点击单据号用 `TRADE_PATHS[record.kind]` 打开 `TradeDocDetail`。

### 单据列表

`BiJxcService.docs` / `exportDocs` 复用明细的取数（`tradeFrom` / `tradeWhere`）、筛选条件、`dim` + `key` 的转换和 `@DataPermission`，在 `BiJxcMapper.xml` 中按出入库单 `GROUP BY`（`selectDocs` 分页、`selectDocList` 导出，共用片段 `docSelect`；整单优惠取明细行的 `discount_share`）。每张单据一行（`DocRow`）：单号、类型、日期、往来单位、业务员、表头仓库、行数、数量、货款、整单优惠（不含税，货款 − 整单优惠 = 净额；原来是含税参考值）、净额、价税合计、本公司运费、收款折让、坏账核销、销售金额、成本、毛利、毛利率，以及按参考成本计算的行数；进货报表为货款、整单优惠、净额、价税合计、付款折让、扣折让后金额，没有成本相关列。

- **口径与汇总一致**：金额为该单中属于汇总项的明细行合计，退货为负数，整单优惠取这些行的分摊额，收付款折让、坏账和运费按行分摊（`docShare`）。按类别、品牌、商品汇总时只计入单据中匹配的明细行，所以各单据加起来等于汇总行，单据数等于汇总行的 `docCount`；
- 返回全部单据的合计 `summary`（`SummaryRow`，与汇总行相同），前端显示为合计行；
- **单据 → 明细**：明细接口加 `docId`（`JxcQuery.docId`）条件，同时保留汇总项的 `dim` + `key`（按类别等汇总时只列匹配的商品，底部调整行按这些商品的比例；按客户等汇总时为整张单据，底部调整行即该单的调整项），在 `JxcDocs.vue` 中打开新的 `JxcDetail` 子页；操作列也可以直接打开单据详情 `TradeDocDetail`；
- 子页层级：汇总 → 单据子页（标题「客户A · 单据」）→ 明细子页（标题「客户A / 单号 · 明细」），每层都有返回按钮；
- `GET /bi/jxc/{sales,purchase}/docs/export` 最多返回 `EXPORT_LIMIT`（5000）行（`DocExport(rows, truncated, summary)`），前端 `writeExcel` 并在最后追加合计行。

导出：汇总在前端直接用当前结果 `writeExcel`（汇总超过 1000 行时 `Summary.truncated = true`，页面提示只显示净额最大的 1000 行）；明细调用 `/export`（带调整行和合计）、单据列表调用 `/docs/export`（带合计）取最多 5000 行再 `writeExcel`，超过时 `truncated = true`，前端提示只导出了前 5000 行。

## 经营状况、商品分析、RFM

| 功能 | 实现 |
| --- | --- |
| 经营状况 | `BiJxcService.business` 复用 `doSummary`：按 `MONTH` 得到走势（没有数据的月份补 0 行），按 `SALESMAN`、`CUSTOMER` 得到员工销售、客户分布（前 10 + 其他）；金额、占比和图表用销售金额 `salesAmount`，与毛利同一口径；资金流来自 `fin_settlement`（已生效的收付款单）和 `fin_advance`（预收预付） |
| 资产状况 | 当前时点：资金（`FinCashierService.daily`）、库存金额（`selectInventory`：当前库存 × 最近一期核算单价，没有时取参考成本价，不含供应商寄售仓）、应收应付与预收预付余额（`selectBalances`）、往来余额前 10（`selectTopBalances`）；净资产 = 资金 + 库存 + 应收 + 预付 − 应付 − 预收 |
| 商品分析 | `BiJxcAnalysisService` 的 `top`（排序依据 `GoodsRankBy`）、`slow`（阈值 `slowQty`，默认 0）、`overstock`（可销天数阈值 `overstockDays`，默认 90）、`shortage`（当前可用库存 vs 安全库存 + 未出库的销售订单，列出在途采购）、`turnover`（期初期末按库存流水推算）；均为分页查询 |
| 客户 RFM | `selectRfm` 取期间有销售出库的客户的最近订货日期、出库单数、净销售额（不含税）；`ScmRfmService.settings(params)` 合并页面传入的参数（`mode`、`recencyDays`、`frequency`、`monetary`，不传的取业务参数 `scm.rfm.*`）并校验范围；`RfmCalculator.calculate(metrics, settings, months)` 计算：R = 最近订货距今天数、F = 每月订货次数（出库单数 ÷ `months`，`months(begin, asOf)` = 天数 ÷ 30.4375）、M = 平均每次订货金额（净销售额 ÷ 出库单数）；固定阈值（`RfmMode.THRESHOLD`）下 R ≤ 天数、F ≥ 次 / 月、M ≥ 元 / 次为高，平均分（`AVERAGE`）下五分位得分（⌈5 × 不优于它的客户占比⌉，并列同分，按单数和净额打分）不低于平均分为高；`RfmSegment.of(recent, frequent, valuable)` 分为八类。返回结果带实际使用的 `settings` 和统计月数 `months` |

`RfmCalculator` 是不依赖 Spring 的纯计算类，修改打分规则时可以单独验证。客户关系的客户分析（`CrmAnalysisService.rfm`，`GET /crm/analysis/rfm?mode=&recencyDays=&frequency=&monetary=`）用同一个计算类和参数，统计近一年，金额不含税（价税合计 − 税额）扣除退货，与进销存报表的客户 RFM 一致（两处共用同一个 M 阈值），分层返回 `RfmSegment` 枚举（前端按 `jxc.rfm.seg.*` 翻译）。客户分析的成交趋势（`CrmAnalysisMapper.selectMonthlySales`）、行业分布（近一年，期间与 RFM 一致：今天往前一年 + 1 天）和客户详情的近一年销售额（`CrmCustomerMapper.selectSummary`）与 RFM 同一口径：不含税净销售额 = 销售出库的（价税合计 − 税额）− 销售退货的（价税合计 − 税额），界面上标注「不含税」。前端两个页面共用分群参数条 `components/bi/RfmSettingsBar.vue`：切换方式、修改阈值后 `@apply(params)` 重新查询，「恢复默认」传 `{}`，有 `sys:bizRule:edit` 时「保存为默认」写入业务参数。

## 新增一张进销存报表

1. 在 `BiJxcMapper.xml` 中写查询，销售 / 进货类的查询复用 `tradeFrom`、`tradeWhere`、`measures` 片段，保证口径一致；跨模块只允许读。
2. 在 `BiJxcService` 或 `BiJxcAnalysisService` 中加方法：查询出入库单的加 `@DataPermission(table = "scm_trade_doc", ...)`，汇总全公司数据的调用 `BiDecisionService.requireAllData()`；日期范围用 `checkRange` 限制跨度。
3. 在 `BiJxcController` 中加接口和权限 `bi:jxc:<功能>`，返回结构放在 `JxcViews` 中（不返回 `Map`）。
4. 前端在 `views/jxc/<页面>/index.vue` 建页面，接口加到 `api/bi/jxc.js`，文字加到 `locales/<语言>/jxc.js`；日期范围用 `jxc.js` 的 `thisMonth()`、`rangePresets()`。
5. 在 `init.sql` 中把页面登记到分组 966 下，给内置角色授权，在 `locales/en-US/menu.js` 中加英文名称；页面在分组 966 下会自动归入功能模块 `JXC_REPORT`，不需要改 `SysFeatureCatalog`。
