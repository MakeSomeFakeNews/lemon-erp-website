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
| 客户执行价（客户 × 物料） | `scm_customer_price` | 客户列表「执行价」（`CustomerPriceDrawer.vue`） | `ScmCustomerPriceService.ofMaterials(customerId, materialIds)` |
| 销售价目表（客户专属 / 客户等级、有效期、起订量） | `scm_price_list` | 「销售 → 价目表」 | `ScmPriceListService.quote(materialId, customerId, qty, date)` |
| 采购合同价 | `scm_purchase_contract_item` | 「采购寻源 → 采购合同」 | `ScmPurchaseContractService.active(supplierId, date)` |
| 供货价格（阶梯价） | `scm_supplier_price` | 供应商「供货价格」 | `ScmQueryService.supplierPrice(supplierId, materialId)` + `effectivePrice(price, qty)` |
| 价格记忆（往来单位 × 物料的最新 / 最低 / 最高价） | `scm_price_memory` | 销售出库、采购入库确认时自动登记 | `ScmPriceMemoryService`，见 [业务联动 - 价格记忆](../architecture/integration#价格记忆) |
| 参考成本价 | `wms_material.ref_cost` | 物料表单 | |

所有价格都是**含税、基本单位、本位币**。价格列设置中停用的列在物料表单、列表、导入导出、客户价格等级的选择中隐藏，已填写的值保留，但不参与取价。

## 开单默认价

接口 `GET /scm/pricing/default?kind=SALES|PURCHASE&partnerId=&materialIds=&qtys=&date=`（`ScmPricingController.defaults`），返回每个物料一行 `PricingViews.DefaultPrice(materialId, price, taxRate, source)`：

- `qtys` 与 `materialIds` 一一对应，用于价目表起订量和供货阶梯价，缺少或不大于 0 时按 1；`date` 为空取今天；
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
    // 2. 逐个物料按顺序取价
    for (Long id : ids) {
        result.add(salesPrice(id, materials.get(id), customerPrices.get(id), partnerId, qtyOf.get(id), day, level,
                enabledLevels, memory.get(id)));
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
- 开单默认价只给出建议价格，**不做校验**：最低售价 / 最高采购价的控制仍在订单保存或直接开单生成隐式订单时由 `ScmOrderPricingService.checkPriceLimit` 执行。

### 前端调用

`api/scm/pricing.js` 的 `defaultPrices({ kind, partnerId, materialIds, qtys, date })`。销售订单（`OrderForm.vue`）、销售报价（`QuotationForm.vue`）、出入库直接开单（`TradeDocItems.vue`）的约定相同：

- 选择商品后带出该行的单价、税率，并在行上记 `priceAuto = true`、`priceSource = source`；多行一次请求；
- 默认价是基本单位、本位币，销售订单按行上的单位和订单币种换算后填入（`OrderForm.vue` 的 `fetchSalesPrices`）；采购订单目前不调用这个接口，仍按合同价、供货价取价；
- 往来单位或单据日期变化时，对 `priceAuto` 仍为 `true` 的行重新取价（只覆盖没有手工改过的单价）；
- 用户手工修改单价、或在价格参考中选用价格后，`priceAuto = false`，不再自动覆盖；
- 单价下方显示来源：`$t(`pricing.source.${record.priceSource}`)`（语言包 `locales/<语言>/pricing.js` 的 `source`）。

## 价格参考

接口 `GET /scm/pricing/reference?materialId=&partnerId=&kind=&keyword=&start=&end=`（`ScmPricingService.reference`），返回 `PricingViews.Reference`，每个分区最多 `REFERENCE_LIMIT`（200）行：

| 分区 | 数据 | 需要的权限（任一） | 数据权限 |
| --- | --- | --- | --- |
| `quotations` 报价历史 | `scm_quotation_item` | `scm:sales:list`、`scm:salesOut:list`、`scm:quotation:list` | 报价单的制单人部门 + 制单人 |
| `sales` 销售历史 | 销售出库明细 | 同上 | 出入库单的制单人部门 + 制单人（`ScmConstants.TRADE_RULE`） |
| `customerCompare` 客户对比 | 价格记忆（`SALES`） | 同上 | 汇总结果，按功能权限整体裁剪 |
| `purchases` 进货历史 | 采购入库明细 | `scm:purchase:list`、`scm:purchaseIn:list` | 出入库单的制单人部门 + 制单人 |
| `purchaseQty` 进货数量 | 采购入库按供应商汇总（次数、数量、金额、均价、最近日期） | 同上 | 同上 |
| `supplierCompare` 供商对比 | 价格记忆（`PURCHASE`） | 同上 | 汇总结果，按功能权限整体裁剪 |

- 没有某一方向查看权限时，对应分区返回 `null`（不是空数组），前端据此隐藏标签页；
- 数据权限用 `DataPermissionContext.execute(rule, () -> mapper.selectXxx(q))` 在 Service 内部启用（同一个方法里不同分区的规则不同，不能用方法注解）；
- `kind` 是 `partnerId` 的种类：客户与供应商的 ID 不在同一张表，指定 `kind = SALES` 时 `partnerId` 只用于销售方向的分区，采购方向的分区不按往来单位筛选（`withoutPartner`），反之亦然；
- 查询写在 `ScmPricingMapper.xml`（报价、出入库历史、进货数量）和 `ScmPriceMemoryMapper.xml`（`selectCompare`）中，往来单位的编码 / 名称筛选是公共片段 `partnerFilter`。

前端组件 `components/scm/PriceReference.vue`：

```vue
<PriceReference ref="referenceRef" pickable @pick="onReferencePick" />
```

```js
// 打开：kind 为 SALES / PURCHASE，决定默认打开的标签页和 partnerId 的种类；传了 partnerId 时默认只看该往来单位
referenceRef.value.open({ materialId: row.materialId, materialName: row.materialLabel, partnerId: form.partnerId, kind: 'SALES' })

// pickable 时单价可点击，选中后触发 pick(price) 并关闭弹窗
function onReferencePick(price) {
  Object.assign(currentRow, { price, priceAuto: false, priceSource: undefined })
}
```

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
