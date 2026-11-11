---
order: 18
---

# 开单取价与价格参考

销售订单、销售报价、出入库直接开单选择商品后自动带出的单价，统一由供应链模块的 `ScmPricingService` 计算（「开单默认价」）；单价下方的「价格参考」弹窗展示同一商品的历史成交价，可以点选填入。本页说明取价链路的实现、价格数据的来源，以及新增一种价格来源时要改的地方。

## 价格数据

| 数据 | 表 / 字段 | 维护位置 | 代码 |
| --- | --- | --- | --- |
| 价格列（零售价、批发价1–8） | `wms_material.retail_price`、`wholesale_price1`–`8` | 物料表单、「销售 → 商品价格」批量调价 | `wms/model/PriceLevels`（0 零售价，1–8 批发价，`price(material, level)` / `setPrice`） |
| 价格列设置（名称、是否启用） | `wms_price_level`（按租户） | 「物料管理 → 价格列设置」（`wms:material:priceLevel`） | `WmsPriceLevelService`：`list()`、`enabledLevels()`；新租户由 `WmsTenantInitializer` 初始化，默认启用零售价、批发价1–3 |
| 客户价格等级 | `scm_customer.price_level`（0–8，对应价格列） | 客户表单 | 为空按零售价 |
| 客户执行价（客户 × 物料） | `scm_customer_price` | 客户列表「执行价」（`CustomerPriceDrawer.vue`），Excel 导入导出（`customerPrices.js`） | `ScmCustomerPriceService.ofMaterials(customerId, materialIds)`、`export`、`importRows` |
| 销售价目表（客户专属 / 客户等级、有效期、起订量） | `scm_price_list` | 「销售 → 价目表」 | `ScmPriceListService.quote(materialId, customerId, qty, date)` |
| 采购合同价 | `scm_purchase_contract_item` | 「采购寻源 → 采购合同」 | `ScmPurchaseContractService.active(supplierId, date)` |
| 供货价格（阶梯价） | `scm_supplier_price` | 供应商「供货价格」 | `ScmQueryService.supplierPrice(supplierId, materialId)` + `effectivePrice(price, qty)` |
| 价格记忆（往来单位 × 物料的最新 / 最低 / 最高价） | `scm_price_memory` | 销售出库、采购入库确认时自动登记 | `ScmPriceMemoryService`，见 [业务联动 - 价格记忆](../architecture/integration#价格记忆) |
| 参考成本价 | `wms_material.ref_cost` | 物料表单 | |

所有价格都是**含税、基本单位、本位币**。价格列设置中停用的列在物料表单、列表、导入导出、客户价格等级的选择中隐藏，已填写的值保留，但不参与取价。

## 开单默认价

接口 `GET /scm/pricing/default?kind=SALES|PURCHASE&partnerId=&materialIds=&qtys=&date=`（`ScmPricingController.defaults`），**按行返回** `PricingViews.DefaultPrice(materialId, price, taxRate, source)`：结果与 `materialIds` 一一对应（顺序、个数相同），`materialIds` 可以重复：

- `qtys` 与 `materialIds` 一一对应，用于价目表起订量和供货阶梯价，缺少或不大于 0 时按 1（`lineQty`）；同一物料多行、数量不同时按各行数量分别匹配；`date` 为空取今天；
- 同一「物料 + 数量」只计算一次（循环内用 `物料ID|数量` 作键缓存）；
- 没有任何价格时 `price`、`source` 为空；`taxRate` 为空表示该来源没有税率，前端保持行上原来的税率；
- `source` 是枚举 `scm/model/PriceSource`，前端显示为单价下方的来源文字。

### 取价顺序

`ScmPricingService.defaults` 按顺序尝试，取到第一个有值的来源即返回：

| 顺序 | 销售（客户） | `PriceSource` | 采购（供应商） | `PriceSource` |
| --- | --- | --- | --- | --- |
| 1 | 客户执行价 | `CUSTOMER_PRICE` | 单据日期有效的采购合同价 | `CONTRACT_PRICE` |
| 2 | 销售价目表（有效期、起订量，客户专属价优先于客户等级价） | `PRICE_LIST` | 供货价格（按数量取阶梯价） | `SUPPLIER_PRICE` |
| 3 | 客户价格等级对应的批发价（等级为零售价、列已停用或未填写时跳过） | `PRICE_LEVEL` | 最近进价（价格记忆） | `LAST_PRICE` |
| 4 | 零售价（零售价列已停用时跳过） | `RETAIL` | 参考成本价 | `REF_COST` |
| 5 | 该客户最近售价（价格记忆） | `LAST_PRICE` | | |

`PriceSource` 枚举常量的书写顺序不代表优先级，优先级只由 `salesPrice` / `purchasePrice` 中的判断顺序决定，并写在 `PriceSource` 和 `ScmPricingService` 的类注释中。

### 实现结构

```java
public List<DefaultPrice> defaults(OrderKind kind, Long partnerId, List<Long> materialIds, List<BigDecimal> qtys, LocalDate date) {
    // 1. 先按物料批量加载：物料、价格记忆，以及销售的客户执行价、启用的价格列 / 采购的生效合同
    Map<Long, WmsMaterial> materials = materialService.mapByIds(ids);
    Map<Long, ScmPriceMemory> memory = memoryService.ofMaterials(kind, partnerId, ids);
    ...
    // 2. 按行取价：结果与 materialIds 一一对应，同一物料 + 数量只算一次
    Map<String, DefaultPrice> cache = new HashMap<>();
    for (int i = 0; i < materialIds.size(); i++) {
        Long id = materialIds.get(i);
        BigDecimal qty = lineQty(qtys, i);
        result.add(cache.computeIfAbsent(id + "|" + qty.toPlainString(), k -> salesPrice(id, materials.get(id),
                customerPrices.get(id), partnerId, qty, day, level, enabledLevels, memory.get(id))));
    }
}

private DefaultPrice salesPrice(...) {
    if (customerPrice != null) {
        return new DefaultPrice(id, customerPrice.getPrice(), customerPrice.getTaxRate(), PriceSource.CUSTOMER_PRICE);
    }
    ScmPriceList listPrice = priceListService.quote(id, customerId, qty, date);
    if (listPrice != null) {
        return new DefaultPrice(id, listPrice.getPrice(), listPrice.getTaxRate(), PriceSource.PRICE_LIST);
    }
    ...
    return new DefaultPrice(id, null, null, null);
}
```

- `ScmPricingService` 只负责「从哪里取、按什么顺序」，各来源的查询仍在所属的 Service 中（价目表 `ScmPriceListService`、合同 `ScmPurchaseContractService`、价格列 `WmsPriceLevelService` 等）；物料、价格列来自 wms，scm 依赖 wms，属于下游调用上游。
- 能按物料批量查询的来源（执行价、价格记忆、合同）在循环之前一次加载成 `Map`，循环中只取值；价目表（`quote`）、供货价格（`supplierPrice`）沿用原有的单物料查询，在循环中按物料调用。
- 后端也直接复用 `defaults`：客户寄售结算（`ScmConsignService`，按结算的业务日期、各行售出数量一次取价）和外部订单导入（`ScmOrderImportService`，按下单日期、行数量逐行取价）不填单价时调用 `defaults(OrderKind.SALES, ...)`，与开单默认价一致（以前只查价目表，不认客户执行价和价格等级）；`price` 为空时报 `scm.error.materialHasNoDefaultSalesPrice` / `materialHasNoDefaultSalesPrice2`；`taxRate` 不为空时覆盖行税率。经销商门户订货仍只按价目表（`ScmPriceListService.quote`）取价，可订货清单就是价目表。
- 开单默认价只给出建议价格，**不做校验**：最低售价 / 最高采购价的控制仍在订单保存或直接开单生成隐式订单时由 `ScmOrderPricingService.checkPriceLimit` 执行。

### 前端调用

`api/scm/pricing.js` 的 `defaultPrices({ kind, partnerId, materialIds, qtys, date })`。销售订单（`OrderForm.vue`）、销售报价（`QuotationForm.vue`）、出入库直接开单（`TradeDocItems.vue`）的约定相同：

- 选择商品后带出该行的单价、税率（税率经 `useTaxRates().sourceRate(发票类型, p.taxRate)`：表头选了发票类型时以发票类型为准，见下文[税率](#税率)），并在行上记 `priceAuto = true`、`priceSource = source`；多行一次请求，按下标取结果（`res[i]?.materialId === row.materialId ? res[i] : undefined`），不要按物料 ID 建 `Map`，否则同一物料多行会拿到同一个价格；
- 默认价是基本单位、本位币，销售订单按行上的单位和订单币种换算后填入（`OrderForm.vue` 的 `fetchSalesPrices`）；采购订单目前不调用这个接口，仍按合同价、供货价取价；
- 往来单位或单据日期变化时，对 `priceAuto` 仍为 `true` 的行重新取价（只覆盖没有手工改过的单价）；
- 用户手工修改单价、或在价格参考中选用价格后，`priceAuto = false`，不再自动覆盖；
- 单价下方显示来源：`$t(`pricing.source.${record.priceSource}`)`（语言包 `locales/<语言>/pricing.js` 的 `source`）。

## 税率

issue #82。明细税率的默认值与发票类型集中在两处：后端 `scm/service/ScmTaxRates`，前端 `components/scm/taxRate.js` 的 `useTaxRates()`。

**默认税率**：业务参数「默认税率」（`scm.defaultTaxRate`，`ScmBizRules.DEFAULT_TAX_RATE`，DECIMAL 0 ~ 100，默认 13，前端可读），替代原来前后端写死的 13%：新建采购 / 销售订单、报价单、出入库直接开单、订单变更新增行、外部订单导入、商机产品、采购合同、招标投标（供应商门户账号不能读取业务参数，门户的招标详情返回 `defaultTaxRate`）、供货价格、价目表等，明细或价格资料没有填写税率且没有其他来源时取它；物料的供货价格、价目表、客户执行价、采购合同、最近成交价带出的税率仍优先（规则不变），买赠赠品行（`PromotionCalculator.calculate` 的 `giftTaxRate` 由调用方传入）、返利红字单据的税额也按它。小程序快速开单读取同一参数显示新明细的税率，也可选发票类型（见 [小程序开发](./miniapp)）。

**发票类型**：业务字典「发票类型」`scm_invoice_kind`（开票类型，每个租户一份，默认 增值税专票 13% / 9% / 6%、增值税普票 13% / 3% / 1%、不开票 0%，租户可在「业务字典」中自行增加），每个取值的**扩展值**是税率（`sys_dict_data.ext_value`，由 `ScmTaxRates` 声明的 `DictExtension` 定义，见 [SaaS 多租户 - 字典](../architecture/tenant#字典)）。没有复用系统字典 `fin_invoice_type`：它描述发票介质（专票 / 普票 / 数电票），同一类型对应多个税率，且系统字典租户不能新增取值。

- 采购 / 销售订单、销售报价单、出入库（直接开单，含草稿）的表头可选发票类型（`scm_order` / `scm_quotation` / `scm_trade_draft` 的 `invoice_kind`），保存时用 `DictLookup.check` 校验（`ScmTaxRates.checkInvoiceKind`），未修改的已停用旧值不再校验；
- 选择后前端把明细税率（赠品、引用合同锁定税率的行除外）统一调整为该税率，之后仍可逐行修改；选了发票类型时价格来源带出的税率不再覆盖，以发票类型为准；
- 后端在明细未填写税率时按 发票类型的税率 → 默认税率 兜底（`ScmOrderAssembler`、报价单、订单变更、赠品）；
- 报价转销售订单带出发票类型；出入库单不另存，显示所属订单（直接开单为隐式订单）的发票类型，引用订单时表单中只读；草稿中直接开单的发票类型存在草稿上，审核时记到隐式订单；
- 详情、打印（表头字段「发票类型」，出入库单打印增加「税率」列，`printTemplates.js` 已登记）同步显示；
- 明细表的税率列头有「统一设置税率」（`TaxRateTitle`，快捷选项为默认税率和各发票类型的税率），作为不用发票类型时的批量方式（订单、报价单、出入库直接开单，以及询价单的报价录入）。

| 位置 | 方法 / 组件 | 说明 |
| --- | --- | --- |
| 后端 `ScmTaxRates` | `defaultRate()` | 业务参数「默认税率」 |
| | `rateOf(发票类型)` | 发票类型的税率（`DictLookup.extValues(INVOICE_KIND_DICT)`），为空、已停用或没有税率时为 `null` |
| | `fallback(发票类型)` | 明细未填写税率时的税率：发票类型的税率 → 默认税率 |
| | `resolve(税率, 发票类型)` | 填写了用填写的，否则按 `fallback` |
| | `checkInvoiceKind(值, 未修改的值)` | 校验并规范发票类型（空白为 `null`） |
| 前端 `useTaxRates()` | `defaultRate`、`kinds`、`ready` | 默认税率（经 `useBizRules` 读取）、发票类型字典项、读取完成的 Promise |
| | `rateOf(kind)`、`fallback(kind)` | 同后端；新明细的税率用 `fallback(form.invoiceKind)` |
| | `sourceRate(kind, rate)` | 价格来源带出的税率：选了发票类型时为发票类型的税率，否则为带出的税率（没有时 `undefined`，保持行上原值） |
| 前端 `taxRate.js` | `applyTaxRate(rows, rate)` | 批量设置明细税率（跳过 `gift` 行），返回调整的行数 |
| 前端组件 | `InvoiceKindSelect.vue` | 发票类型下拉（每项显示税率，当前值已停用时仍显示），触发 `change(kind, rate)`，由表单调用 `applyTaxRate` |
| | `TaxRateTitle.vue` | 税率列头的「统一设置税率」，触发 `apply(rate)` |

`TaxRateTitle` 放在列头插槽中：直接用 `a-table` 的写在 `#headerCell`，用 `LineItemsTable` 的写在 `#header` 插槽（见 [前端开发规范 - 单据明细](./frontend#单据明细-uselineitems-lineitemstable)）：

```vue
<LineItemsTable :items="form.items" :columns="columns">
  <template #header="{ column }">
    <TaxRateTitle v-if="column.key === 'taxRate'" :title="column.title" @apply="applyAllTaxRate" />
  </template>
  ...
</LineItemsTable>
```

```js
import { applyTaxRate, useTaxRates } from '@/components/scm/taxRate'

const tax = useTaxRates()
const newRow = () => ({ materialId: undefined, qty: undefined, price: undefined, taxRate: tax.fallback(form.value.invoiceKind) })
function onInvoiceKindChange(kind, rate) {
  if (rate == null) return // 清空发票类型时明细税率不变
  message.success(t('scm.taxRate.invoiceKindApplied', { n: applyTaxRate(form.value.items, rate), rate }))
}
function applyAllTaxRate(rate) {
  message.success(t('scm.taxRate.applied', { n: applyTaxRate(form.value.items, rate), rate }))
}
```

只需要默认税率的页面（采购合同、招标代录、供货价格、价目表、商机、询价报价录入）直接用 `tax.defaultRate.value` 作为新明细的税率。

## 价格参考

接口 `GET /scm/pricing/reference?materialId=&partnerId=&kind=&keyword=&start=&end=`（`ScmPricingService.reference`），返回 `PricingViews.Reference`，每个分区最多 `REFERENCE_LIMIT`（200）行：

| 分区 | 数据 | 需要的权限（任一） | 数据权限 |
| --- | --- | --- | --- |
| `quotations` 报价历史 | `scm_quotation_item` | `scm:sales:list`、`scm:salesOut:list`、`scm:quotation:list` | 报价单的制单人部门 + 制单人 |
| `sales` 销售历史 | 销售出库明细 | 同上 | 出入库单的制单人部门 + 制单人（`ScmConstants.TRADE_RULE`） |
| `customerCompare` 客户对比 | 「全部数据」时取价格记忆（`SALES`），否则按销售出库单计算 | 同上 | 见下文 |
| `purchases` 进货历史 | 采购入库明细 | `scm:purchase:list`、`scm:purchaseIn:list` | 出入库单的制单人部门 + 制单人 |
| `purchaseQty` 进货数量 | 采购入库按供应商汇总（次数、数量、金额、均价、最近日期） | 同上 | 同上 |
| `supplierCompare` 供商对比 | 「全部数据」时取价格记忆（`PURCHASE`），否则按采购入库单计算 | 同上 | 见下文 |

- 没有某一方向查看权限时，对应分区返回 `null`（不是空数组），前端据此隐藏标签页；
- 供商 / 客户对比（`ScmPricingService.compare`）：`SecurityUtils.getDataScope().all()` 为真时直接查价格记忆（`ScmPriceMemoryMapper.selectCompare`）；否则在 `DataPermissionContext.execute(ScmConstants.TRADE_RULE, ...)` 中按看得到的销售出库 / 采购入库单现算（`ScmPricingMapper.selectTradeCompare`，口径同价格记忆：最新、最低、最高价及日期，不含退货和单价为 0 的赠品行，价格取优惠前单价 `COALESCE(gross_price, price)`），只列出这些单据的往来单位，价格也只来自这些单据，避免价格记忆这种汇总结果泄露其他人的成交价。前端在这两个标签页下方显示 `pricing.reference.compareScope` 说明；
- 数据权限用 `DataPermissionContext.execute(rule, () -> mapper.selectXxx(q))` 在 Service 内部启用（同一个方法里不同分区的规则不同，不能用方法注解）；
- `kind` 是 `partnerId` 的种类：客户与供应商的 ID 不在同一张表，指定 `kind = SALES` 时 `partnerId` 只用于销售方向的分区，采购方向的分区不按往来单位筛选（`withoutPartner`），反之亦然；
- 查询写在 `ScmPricingMapper.xml`（报价、出入库历史、进货数量）和 `ScmPriceMemoryMapper.xml`（`selectCompare`）中，往来单位的编码 / 名称筛选是公共片段 `partnerFilter`；
- 出入库历史、进货数量一律按**整单优惠前**的口径：单价 `COALESCE(i.gross_price, i.price)`、金额 `i.amount + i.discount_share`，与价格记忆一致（整单优惠只在合计处扣减，见[整单优惠 - 显示口径](./order-discount#显示口径-不改变价格体系)）；供货价格的采购历史（`ScmSupplierPriceMapper`）同样取优惠前单价。新增价格类查询时沿用这个口径。

前端组件 `components/scm/PriceReference.vue`：

```vue
<PriceReference ref="referenceRef" pickable @pick="onReferencePick" />
```

```js
// 打开：kind 为 SALES / PURCHASE，决定默认打开的标签页和 partnerId 的种类；传了 partnerId 时默认只看该往来单位
referenceRef.value.open({ materialId: row.materialId, materialName: row.materialLabel, partnerId: form.partnerId, kind: 'SALES' })

// pickable 时单价可点击，选中后触发 pick(price) 并关闭弹窗；订单、报价、出入库直接开单（TradeDocItems.vue）都传了 pickable
function onReferencePick(price) {
  Object.assign(currentRow, { price, priceAuto: false, priceSource: undefined })
}
```

## 商品速查

「供应链 → 销售 → 商品速查」（`views/scm/quickLookup`，菜单权限 `scm:quickLookup:list`，issue #97）给销售和管理人员报价用，与小程序共用接口（小程序端见 [微信小程序开发 - 商品速查](./miniapp#商品速查)）。用户手册见 [商品速查](/manual/scm/quick-lookup)。

**搜索与列表**

- 按名称、规格、编码、条码、拼音首字母、去掉分隔符的缩写搜索，规则同物料下拉（`WmsMaterialService.options`）；
- 每行显示可用库存（全部仓库，库存 − 冻结）和用户选择的**一种**价格。

**查询价格**（枚举 `QuickPrice`）

| 可选项 | 取值 |
| --- | --- |
| 参考进货价 | 物料参考成本价 |
| 库存均价 | 移动加权成本 |
| 最新进价、最新售价 | 最近一次采购入库 / 销售出库的优惠前单价（`ScmPricingMapper.selectLatestPrices`） |
| 零售价、批发价1–8 | 物料价格列，只列启用的价格列 |
| 不显示价格 | 只显示数量 |

选择保存在个人设置 `quickLookup`（`/profile/settings/quickLookup`，内容 `{ price }`，Web 与小程序共用，没有保存过按最新售价），见[界面设置 - 保存](./ui-settings#保存)。`GET /scm/quick-lookup/price-options` 返回可选项和当前用户能否查看（`allowed`）。

**价格按权限在后端过滤**（`ScmQuickLookupService.allowed`）：不只是前端隐藏，规则与价格参考一致，不另设按钮。

| 价格 | 需要的权限（任一） |
| --- | --- |
| 进货类（参考进货价、最新进价、进价历史） | `scm:purchase:list`、`scm:purchaseIn:list` |
| 库存均价 | 「查看成本金额」`wms:stock:cost` |
| 售价类（最新售价、售价历史） | `scm:sales:list`、`scm:salesOut:list`、`scm:quotation:list` |
| 零售价、批发价 | 同售价类，或「商品价格」`scm:goodsPrice:list` |

- 选择了没有权限或已停用的价格时不返回价格，标记 `priceDenied`，只显示数量；
- 没有权限的人请求进价 / 售价历史、往来明细，接口直接报错；
- 内置角色中销售员、销售经理只能看售价类，采购员只能看进货类，总经理、仓库管理员（能查看采购入库和销售出库单，有「查看成本金额」）全部可看，普通用户（只读）按其查看权限。

**联查接口**（都要求 `scm:quickLookup:list`）

| 接口 | 说明 |
| --- | --- |
| `GET /scm/quick-lookup?keyword=&price=&current=&size=` | 搜索；每行有商品图片时带主图 `imageUrl` |
| `POST /wms/material/images/urls` | 点击商品看全部商品图片（[物料图片](./material#商品图片)，公开文件地址，登录即可读取） |
| `GET /scm/quick-lookup/{id}/stock` | 点击库存看各仓库 / 库位 / 批次，成本按 `wms:stock:cost` |
| `GET /scm/quick-lookup/{id}/summary?kind=SALES\|PURCHASE` | 点击价格看**历史参考**：最近 3 次、系统最新价、最高价、最低价，同价取最近一次；进货类价格默认打开进价，其他打开售价 |
| `GET /scm/quick-lookup/{id}/trades` | **更多交易历史**，分页：日期范围、单位编号 / 名称 / 电话筛选，列 日期、数量、单价、单位名称、单位编号、单号、制单、复核 |

**更多内容**打开与销售单明细相同的[价格参考](#价格参考)（报价、销售、进货、客户对比、供商对比，按权限显示）。

**统计口径**：历史与最新价都只统计优惠前单价大于 0 的行（不含赠品），按出入库单的数据权限（制单人部门 + 制单人）统计，看不到的单据不计入。

前端页面拆为同目录子组件：库存分布 `QuickLookupStock.vue`、商品图片 `QuickLookupImages.vue`、价格历史 `QuickLookupHistory.vue`（内含 `PriceReference`），`lookup.js` 的 `kindOfPrice` 决定点击价格时打开哪种历史。已有库执行升级脚本 `sql/upgrade/20261111_quick_lookup.sql` 登记菜单和授权，见[升级](../deploy/upgrade)。测试 `QuickLookupTests`。

## 客户执行价导入导出

- 导出 `GET /scm/customer-price/export?customerId=&keyword=`（`scm:customer:list`）：`customerId` 为空导出全部客户，`keyword` 按客户编码 / 名称筛选；返回 `ScmCustomerPrice`（带客户、物料的编码名称、规格、单位），SQL 在 `ScmCustomerPriceMapper.xml`。
- 导入 `POST /scm/customer-price/import`（`scm:customer:edit`，`@OperLog` 类型 `IMPORT`），请求体为通用的 `ImportRequest<CustomerPriceImportRow>`（客户编码、物料编码、执行价、税率、备注，校验消息 `scm.valid.customerPrice*`）。`ScmCustomerPriceService.importRows` 用通用的 `ImportExecutor.run` 逐行处理：校验客户 / 物料编码存在（物料按编码批量预加载，客户按编码缓存）、文件内 客户 × 物料 不重复，再按 客户 × 物料 新增或更新（`upsert`，税率、备注为空时清空）；任何一行出错时返回按行号的错误、整批不导入。文件中没有的执行价不变。
- 前端 `components/scm/customerPrices.js`：`CUSTOMER_PRICE_COLUMNS(withCustomer)` 是导入导出共用的列（客户列表的批量导入导出含客户编码列，单个客户的抽屉中不含，导入时由抽屉补上当前客户编码），`exportCustomerPriceRows(params, name)` 在导入列之后追加客户名称、物料名称、规格、单位，用 `writeExcel` 生成文件，导出的文件改完可以直接导入。

## 新增一种价格来源

以「客户最近报价」为例（假设放在销售价目表之后、客户价格等级之前）：

1. **枚举**：在 `PriceSource` 中增加 `QUOTATION`，同时修改类注释中的优先级说明。
2. **数据**：在来源所属模块的 Service 中新增按物料**批量**查询的方法（例如在 `ScmQuotationService` 中新增 `lastPrices(customerId, materialIds)`，返回 物料 ID → 价格），SQL 写在该模块的 mapper XML 中；需要数据权限的按 [数据权限](../architecture/data-scope) 的约定启用。
3. **取价**：在 `ScmPricingService.defaults` 的循环之前加载这份 `Map`，传给 `salesPrice`，并在 `PRICE_LIST` 与 `PRICE_LEVEL` 之间加一个判断，返回 `new DefaultPrice(id, 价格, 税率或 null, PriceSource.QUOTATION)`。采购方向的来源加在 `purchasePrice` 中。
4. **前端常量与文字**：运行 `npm run gen:enums` 更新 `constants/enums.js` 中的 `PriceSource`；在 `locales/zh-CN/pricing.js`、`locales/en-US/pricing.js` 的 `source` 中加 `QUOTATION` 的显示文字（三个开单表单共用，不需要逐个修改）。
5. **说明**：同步修改 `api/scm/pricing.js` 中 `defaultPrices` 注释里的优先级。
6. **验证**：分别准备只有某一级价格的数据，确认带出的价格和来源文字；停用价格列后确认等级价、零售价不再参与。

::: tip 提示
新来源如果来自新表，表上要有 `tenant_id`，唯一约束末尾加 `tenant_id`；按往来单位 × 物料汇总、写入频繁的数据（如价格记忆）用 `INSERT ... ON DUPLICATE KEY UPDATE` 原子更新，并按物料 ID 顺序写入，避免并发确认时死锁。
:::

::: warning 注意
取价在开单页面上频繁调用（选商品、改数量、换客户都会触发），新来源的查询必须按物料批量完成，不要在 `salesPrice` / `purchasePrice` 中逐个物料查库。
:::
