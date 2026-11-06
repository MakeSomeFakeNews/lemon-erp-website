---
order: 19
---

# 进销存报表开发

「供应链 → 进销存报表」包括销售报表、进货报表、经营状况、资产状况、商品分析、客户分析（RFM）。页面挂在供应链菜单下，代码在 bi 模块；与商务智能的多维分析不同，进销存报表**实时查询业务表**，不依赖数据仓库同步。本页说明它的代码结构、口径、汇总维度的扩展方式和穿透查询。

## 代码位置

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 接口 | `bi/controller/BiJxcController`（`/bi/jxc/*`） | 销售 / 进货的汇总、明细、导出，经营状况、资产状况、商品分析（`goods/top`、`slow`、`overstock`、`shortage`、`turnover`）、RFM |
| 查询条件 | `bi/dto/JxcQuery` | 日期范围（必填）、往来单位、业务员、物料、分类、品牌、区域、仓库、关键字，穿透的 `dim` + `key`，商品分析的阈值 |
| 返回结构 | `bi/dto/JxcViews` | `Summary`（行、合计、是否截断）、`SummaryRow`、`DetailRow`、`Business`、`Assets`、`GoodsRow`、`Rfm` 等 |
| 汇总维度 | `bi/model/JxcDimension` | 销售、进货各自可用的维度 |
| Service | `BiJxcService`（销售、进货、经营状况）、`BiJxcAnalysisService`（资产状况、商品分析、RFM）、`RfmScorer`（RFM 打分，纯计算） | |
| SQL | `resources/mapper/bi/BiJxcMapper.xml` | 只读 JOIN scm、wms、fin 的表 |
| 前端页面 | `views/jxc/{sales,purchase,business,assets,goods,rfm}/index.vue` | 菜单组件路径 `jxc/sales/index` 等 |
| 前端组件 | `components/bi/jxc/JxcTradeReport.vue`（销售 / 进货汇总，`report="sales"` / `"purchase"`）、`JxcDetail.vue`（明细子页）、`jxc.js`（日期快捷选项、维度列表、汇总行名称） | 销售报表、进货报表两个页面只是 `<JxcTradeReport report="..." />` |
| 接口封装 | `api/bi/jxc.js` | `jxcSummary`、`jxcDetail`、`jxcExport`、`jxcBusiness`、`jxcAssets`、`jxcGoods`、`jxcRfm` |
| 语言包 | `locales/<语言>/jxc.js` | 维度名称在 `jxc.dim.<维度>` |

菜单：分组「进销存报表」（ID 966，供应链下）及 6 个页面（370–375），权限 `bi:jxc:sales`、`bi:jxc:purchase`、`bi:jxc:business`、`bi:jxc:asset`、`bi:jxc:goods`、`bi:jxc:rfm`；SaaS 功能模块为 `JXC_REPORT`（依赖销售、采购），见 [新增菜单与授权](./menu#功能模块与行业模板)。

## 数据口径

销售 / 进货的汇总和明细都来自 `scm_trade_doc` + `scm_trade_doc_item`，`BiJxcMapper.xml` 中的公共片段：

| 片段 | 内容 |
| --- | --- |
| `tradeFrom` | 明细 JOIN 单据、订单（业务员取 `scm_order.salesman_id`）、物料；销售 LEFT JOIN 客户和当月的 `fin_material_cost`，进货 LEFT JOIN 供应商 |
| `tradeWhere` | 单据种类（销售：`SALES_OUT`、`SALES_RETURN`；进货：`PURCHASE_IN`、`PURCHASE_RETURN`）、日期范围和各项筛选；仓库按 `COALESCE(i.warehouse_id, d.warehouse_id)` |
| `sign` | 出库（入库）为 1、退货为 -1，净额 = 出库（入库）− 退货 |
| `measures` | 出库 / 退货 / 净数量与金额、价税合计、成本、按参考成本计算的行数（`missingCost`）、单据数 |
| `dimKey` | 汇总维度的分组键（见下文） |

- 金额为本位币，销售额 / 进货额为**不含税**（`i.amount - i.tax_amount`），另列价税合计；
- 销售成本与财务「毛利分析」一致：数量 × 单据所在月份的成本核算单价（`fin_material_cost.unit_cost`），没有核算时取物料的参考成本价，并统计按参考成本计算的行数；
- 毛利、毛利率、均价在 `BiJxcService.fillSummary` 中计算（`Decimals` 统一精度），SQL 只做求和；
- 汇总最多返回 `SUMMARY_LIMIT`（1000）行，合计（`selectTotal`）仍为全部；明细导出最多 `EXPORT_LIMIT`（5000）行；
- 日期范围由 `checkRange` 校验：销售、进货、商品分析不超过 366 天，经营状况、RFM 不超过 731 天。

### 数据权限

各方法用 `@DataPermission(table = "scm_trade_doc", deptColumn = "dept_id", userColumn = "create_by")`，按出入库单的制单人部门 + 制单人过滤（经营状况、商品分析、RFM 相同）。汇总全公司数据的部分要求「全部数据」权限：资产状况调用 `BiDecisionService.requireAllData()`，经营状况的资金流只在 `SecurityUtils.getDataScope().all()` 时返回（否则为 `null`，前端不显示）。资产状况的现金、银行余额调用 fin 的 `FinCashierService.daily`（含未记账凭证）。

前端明细中点击单据号打开出入库单详情（`components/scm/TradeDocDetail.vue`），详情接口还要求对应出入库单的查看权限（如 `scm:salesOut:list`）。

## 汇总维度：JxcDimension

```java
public enum JxcDimension {
    CATEGORY(true, true),   // 物料分类（业务字典 wms_material_category）
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
7. **验证**：汇总合计与其他维度一致；点击汇总行打开的明细只包含该仓库的行；明细导出、汇总导出正常。

::: warning 注意
`dim` 在 XML 中按枚举名称比较（`dim == 'CATEGORY'`），这是 mapper XML 中允许的字面量；Java 和前端一律用 `JxcDimension` 枚举 / 常量。`BiJxcService.prepare` 的 `switch` 中 `default` 分支什么也不做：新维度漏掉第 3 步时不会报错，但穿透会忽略键、返回整个筛选范围的明细，新增维度时不要漏掉。
:::

## 穿透查询：汇总 → 明细 → 单据

汇总与明细使用**同一个 `JxcQuery`**，前端打开明细时把汇总页的查询条件原样带上，再加上被点击的汇总行：

```js
// components/bi/jxc/JxcTradeReport.vue
detailRef.value.open({ params: params(), dim: groupBy.value, key: row.groupKey, label: groupLabel(groupBy.value, row, dict) })
// 合计行：不带 dim / key，列出全部明细
detailRef.value.open({ params: params() })
```

`GET /bi/jxc/{sales|purchase}/detail?...&dim=&key=&current=&size=` 由 `BiJxcService.prepare` 把 `dim` + `key` 转换为筛选条件：

| 维度 | 转换 |
| --- | --- |
| 分类、品牌、区域 | `setCategory` / `setBrand` / `setRegion`；键为空时 `markNone`（筛选「未设置」） |
| 客户、供应商 | `setPartnerId` |
| 业务员 | `setSalesmanId`；键为空时 `markNone`（没有业务员） |
| 商品 | `setMaterialId` |
| 日、月 | 把日期范围收窄到当天 / 当月，与原范围取交集（`narrow`） |

键格式不对时抛 `bi.error.jxcInvalidKey`；进货报表忽略业务员、区域条件。明细 `selectDetail` 分页返回出入库明细（退货为负数），`JxcDetail.vue` 中点击单据号用 `TRADE_PATHS[record.kind]` 打开 `TradeDocDetail`。

导出：汇总在前端直接用当前结果 `writeExcel`（汇总超过 1000 行时 `Summary.truncated = true`，页面提示只显示净额最大的 1000 行）；明细调用 `/export` 取最多 5000 行再 `writeExcel`，超过时 `DetailExport.truncated = true`，前端提示只导出了前 5000 行。

## 经营状况、商品分析、RFM

| 功能 | 实现 |
| --- | --- |
| 经营状况 | `BiJxcService.business` 复用 `doSummary`：按 `MONTH` 得到走势（没有数据的月份补 0 行），按 `SALESMAN`、`CUSTOMER` 得到员工销售、客户分布（前 10 + 其他）；资金流来自 `fin_settlement`（已生效的收付款单）和 `fin_advance`（预收预付） |
| 资产状况 | 当前时点：资金（`FinCashierService.daily`）、库存金额（`selectInventory`：当前库存 × 最近一期核算单价，没有时取参考成本价，不含供应商寄售仓）、应收应付与预收预付余额（`selectBalances`）、往来余额前 10（`selectTopBalances`）；净资产 = 资金 + 库存 + 应收 + 预付 − 应付 − 预收 |
| 商品分析 | `BiJxcAnalysisService` 的 `top`（排序依据 `GoodsRankBy`）、`slow`（阈值 `slowQty`，默认 0）、`overstock`（可销天数阈值 `overstockDays`，默认 90）、`shortage`（当前可用库存 vs 安全库存 + 未出库的销售订单，列出在途采购）、`turnover`（期初期末按库存流水推算）；均为分页查询 |
| 客户 RFM | `selectRfm` 取期间有销售出库的客户的最近购买日期、出库单数、净销售额，`RfmScorer.score` 按五分位打 1–5 分（⌈5 × 不优于它的客户占比⌉，并列同分），得分不低于平均分为「高」，`RfmSegment.of(r, f, m)` 分为八类 |

`RfmScorer` 是不依赖 Spring 的纯计算类，修改打分规则时可以单独验证。

## 新增一张进销存报表

1. 在 `BiJxcMapper.xml` 中写查询，销售 / 进货类的查询复用 `tradeFrom`、`tradeWhere`、`measures` 片段，保证口径一致；跨模块只允许读。
2. 在 `BiJxcService` 或 `BiJxcAnalysisService` 中加方法：查询出入库单的加 `@DataPermission(table = "scm_trade_doc", ...)`，汇总全公司数据的调用 `BiDecisionService.requireAllData()`；日期范围用 `checkRange` 限制跨度。
3. 在 `BiJxcController` 中加接口和权限 `bi:jxc:<功能>`，返回结构放在 `JxcViews` 中（不返回 `Map`）。
4. 前端在 `views/jxc/<页面>/index.vue` 建页面，接口加到 `api/bi/jxc.js`，文字加到 `locales/<语言>/jxc.js`；日期范围用 `jxc.js` 的 `thisMonth()`、`rangePresets()`。
5. 在 `init.sql` 中把页面登记到分组 966 下，给内置角色授权，在 `locales/en-US/menu.js` 中加英文名称；页面在分组 966 下会自动归入功能模块 `JXC_REPORT`，不需要改 `SysFeatureCatalog`。
