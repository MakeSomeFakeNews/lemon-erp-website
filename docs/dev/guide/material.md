---
order: 18.6
---

# 物料资料与批次管理

仓库模块（`lemon-wms`）中物料资料的三项扩展：复制物料、商品图片、发生库存业务后切换批次 / 序列号管理，以及出库侧显示批次的生产日期（issue #94）。用户视角的说明见用户手册 [物料管理](../../manual/wms/material)。

## 相关概念

| 概念 | 说明 |
| --- | --- |
| 库存位置 | 仓库 + 库位 + 物料 + 批次，对应 `wms_stock` 一行。库位可不指定（`location_id = 0`），未启用批次管理的物料批次号为空串 |
| 批次管理 | 物料启用后，出入库必须填写批次号；首次入库时登记批次及生产日期、有效期（`wms_batch`） |
| 序列号管理 | 物料启用后，数量必须为整数，出入库逐个登记序列号；`wms_serial` 记录每个序列号当前位置和是否在库，`wms_serial_log` 记录完整轨迹 |

因为库存按「库存位置」记账，批次管理不是一个单纯的开关：不启用批次的物料批次号是空串，直接改开关会让已有库存与新规则对不上（启用后出库要求批次，但已有库存没有批次；停用后库存还挂在各批次上，出库却不再按批次扣减）。所以物料发生过库存业务后，`WmsMaterialService.update` 仍拒绝修改批次 / 序列号管理（`wms.error.materialHasStockTransactionsBatchSerial`，提示改用「批次管理」），切换由专门的服务完成并同时调整库存。

## 复制物料

物料列表「更多 → 复制」（需要 `wms:material:add`）：前端用 `asPrefilled(() => drawer.openCreate(...))` 打开新增表单，带出原物料的资料（名称、规格、单位、分类、品牌、价格列、安全库存、再订货点 / 再订货量、默认仓库库位、参考成本、计价方法、批次 / 序列号 / 来料检验、备注）、生产计划属性、替代料和自定义字段；去掉 `id`、`code`、`barcode`、状态、款式标记、主图等字段，编码留空（保存时按编码规则生成）、条码不带（条码不能重复）。

保存时调用 `POST /wms/material?copyFrom=原物料ID`，后端在新增的同一事务中再复制：

- **辅助单位**（`wms_material_unit`），不含包装条码，原因同上；
- **商品图片**：`FileStorageService.copyImage` 复制为新文件，两个物料的图片互不影响，新物料的主图随之同步。

库存、批次、序列号、库存流水等业务数据不复制。多规格款式 / SKU 复制出来都是**普通物料**（只复制资料，不复制 SKU 和规格属性，前端提示 `wms.material.copyVariantTip`）：SKU 的编码、属性值组合由款式生成，连同 SKU 一起复制等于再造一个款式，容易与原款式混淆，需要时在新物料上重新「多规格」生成。

## 商品图片

| 项目 | 说明 |
| --- | --- |
| 表 | `wms_material_image`（`material_id`、`url`、`file_name`、`file_size`、`sort`，索引 `(material_id, sort)`），`sort` 最小的为主图 |
| 主图 | 主图 URL 同步到 `wms_material.image_url`（`WmsMaterialImageService.syncMain`），物料列表、物料下拉（`/wms/material/options`）、库存查询（`StockView` / `StockSummaryView`）返回 `imageUrl` |
| 限制 | png / jpg / gif / webp，单张不超过 5 MB（`MAX_SIZE`），每个物料最多 10 张（`MAX_IMAGES`，`wms.error.imageTooMany`） |
| 前端 | `components/wms/MaterialImages.vue`（上传、左右移动、设为主图、删除、查看大图），物料详情顶部和「更多 → 图片」弹窗（`views/wms/material/MaterialImagesModal.vue`）共用；列表名称前显示缩略图 |
| 小程序 | 库存查询、快速开单的商品搜索显示主图缩略图（`utils/request.js` 的 `fileUrl` 转为完整地址，库存查询点击查看大图） |

### 接口

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /wms/material/{id}/images` | `wms:material:list` | 物料的图片列表，第一张为主图 |
| `POST /wms/material/{id}/images` | `wms:material:edit` | 上传一张（`file`），排在最后；原来没有图片时成为主图 |
| `PUT /wms/material/{id}/images/order` | `wms:material:edit` | 调整顺序，body 为全部图片 ID，第一张为主图；与库中的图片不一致时报 `wms.error.imageListChanged` |
| `PUT /wms/material/{id}/images/{imageId}/main` | `wms:material:edit` | 设为主图（移到第一张） |
| `DELETE /wms/material/{id}/images/{imageId}` | `wms:material:edit` | 删除，主图顺延 |
| `POST /wms/material/images/urls` | 登录即可 | 批量取图：body 为物料 ID 列表（最多 500 个，`wms.error.imageBatchTooMany`），返回 物料 ID → 图片 URL 列表（第一张为主图），供电商小程序等前端取图 |

### 存储与公开访问

图片保存在**公开文件目录**：`FileStorageService.storeImage`，路径 `lemon.upload.path/material/yyyy/MM/随机名`，与头像相同（见 [文件与附件](../architecture/file#公开文件)）。文件通过 `/api/files/**` 不登录即可访问，文件名是随机 UUID，不能枚举。这样选择是因为商品图本来就要对外展示，后续电商小程序可以直接使用 URL；图片列表和维护接口仍按物料权限校验。

没有复用业务附件 `sys_attachment`：附件存在不公开的目录中，只能登录后按记录的数据权限下载，不适合给电商前端直接展示；附件表也没有排序和主图。

文件清理与事务：

- 删除图片、删除物料时，在事务**提交后**删除文件（`afterCommit`），回滚时文件仍在；
- 上传后事务回滚时，删除已保存的文件（`afterCompletion` 中状态不是已提交）。

部署时公开文件目录需要持久化并纳入备份，见 [升级与数据备份](../deploy/upgrade)。

## 批次 / 序列号管理的切换

物料列表「更多 → 批次管理」（`views/wms/material/MaterialTrackingModal.vue`），后端 `WmsMaterialTrackingService`：

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /wms/material/{id}/tracking` | `wms:material:edit` | 切换前检查，返回 `TrackingView`：当前是否启用批次 / 序列号、是否发生过库存业务、库存合计 `stockQty`、无批次库存 `noBatchQty`、有库存的批次数 `batchCount`、阻止切换的单据 `openDocs` |
| `PUT /wms/material/{id}/tracking` | `wms:material:edit` | 切换，body 为 `TrackingRequest`：`batchEnabled`、`serialEnabled`，启用批次时已有库存归入的 `batchNo`（有无批次库存时必填）、`productionDate`、`expiryDate` |

### 切换规则

- **启用批次管理**：无批次的库存按库存位置（仓库 + 库位）整体归入填写的批次（前端默认「期初」）；该位置已有同批次记录时数量相加，否则改写批次号（`merge`）；在库序列号（`SerialStatus.IN_STOCK`、批次为空）同步归入该批次；批次登记到 `wms_batch`（已存在时只更新填写了的生产日期、有效期，有效期不能早于生产日期）。之后出入库必须填写批次号，出库时可选择该批次。
- **停用批次管理**：各批次的库存按库存位置合并为无批次（数量、冻结数量相加，删除合并掉的记录），在库序列号的批次清空。历史流水、序列号轨迹和批次登记保留原批次号，批次追溯照常查询；之后出入库不再要求批次（填写的批次号被清空）。
- 两者都不改变任何库存位置的数量合计，不产生库存流水，不影响成本。
- **并发**：切换时先锁物料的实时成本记录（`WmsMaterialCostMapper.selectForUpdate`），与库存变动（`StockService.apply` 同样先按物料锁成本记录）互斥，锁定后再检查进行中的单据和库存。
- 切换记入物料的变更记录（`ChangeLogger`，`WmsMaterialService.TRACKING_FIELDS`）。
- **序列号管理**只能在库存为 0 时切换（`wms.error.serialSwitchNeedsZeroStock`）：启用需要为每件在库物品登记序列号（相当于一次实物盘点，没法自动补），停用会使在库序列号的状态失真、以后再启用时冲突，都应先出库或盘点调整到 0。
- 多规格款式没有库存，不在这里切换（`wms.error.trackingStyleNotAllowed`），在 SKU 上切换。

### 阻止切换的单据

这些单据按已经确定的批次 / 序列号执行，不会再按物料的管理方式重新规范，存在时不能切换（`wms.error.trackingOpenDocs`，最多列出 5 个单号）：

| 单据 | 来源 |
| --- | --- |
| 在途调拨（收货时按调出的批次入库）、审批中的仓库单据 | `WmsTrackingMapper.selectOpenStockDocs` |
| 草稿或审批中的盘点单（盘点按「库位 + 物料 + 批次」记录账面数） | `WmsTrackingMapper.selectOpenChecks` |
| 仍冻结的待检 / 不合格库存（放行按冻结记录的批次解冻） | `wms_stock_hold` |
| 其他模块登记的单据 | 实现 `MaterialTrackingGuard` 的 Bean |

**不阻止**的单据：出入库草稿、进销存单据草稿、组装拆卸草稿。它们在确认时按物料当前的管理方式重新校验（启用后须补填批次号，停用后自动清空）。库存预留只保证仓库可用量，不锁批次，不受影响。

### MaterialTrackingGuard

`wms` 不能依赖上层模块，其他模块中「已确定批次的进行中单据」由它们实现 `wms` 中的接口登记：

```java
package com.lemon.erp.modules.wms.service;

public interface MaterialTrackingGuard {
    /** 进行中单据的说明（如「发货通知 FH20261111001（未出库）」，已按当前语言），没有返回空列表 */
    List<String> openDocs(Long materialId);
}
```

scm 的实现 `ScmMaterialTrackingGuard`：尚未出库的发货通知（拣货明细已确定库位、批次和序列号），`ScmDeliveryMapper.selectOpenNosByMaterial` 查单号，说明文字用消息键 `scm.text.openDelivery`。新增一种会预先确定批次 / 序列号、确认时不再重新校验的单据时，在所属模块实现一个 `MaterialTrackingGuard` Bean 即可，`WmsMaterialTrackingService` 注入全部实现。

## 批次的生产日期

批次本来就有生产日期、有效期（`wms_batch.production_date` / `expiry_date`），在采购入库、其他入库、完工入库录入新批次时填写，库存查询和批次追溯显示。出库侧补充：

- 出库选择库位 / 批次时显示批次的生产日期：销售出库等用的 `components/scm/StockSlotSelect.vue`（选项中「生产 日期」），出库 / 调拨 / 盘点用的「选择库存」`components/wms/StockPicker.vue`（新增「生产日期」列）；
- 出入库单、进销存单据详情的批次列随批次带出登记的日期：明细的只读字段 `batchProductionDate` / `batchExpiryDate`（`WmsStockDocItem`、`ScmTradeDocItem`，mapper 中只读关联 `wms_batch`），前端用 `components/wms/wms.js` 的 `batchDates` 显示（入库填写的日期优先）；
- 小程序库存查询的批次明细显示生产日期。

没有另加 DOT 字段：DOT 本质上就是生产日期（周 / 年），按批次登记即可。

## 权限

| 功能 | 权限 |
| --- | --- |
| 复制物料 | `wms:material:add` |
| 商品图片查看 / 维护 | `wms:material:list` / `wms:material:edit`；批量取图登录即可 |
| 批次 / 序列号管理切换 | `wms:material:edit` |

## 数据库

`sql/init.sql` 已包含新表 `wms_material_image` 和 `wms_material.image_url`；已有库执行 `sql/upgrade/20261111_wms_material_image.sql`（可重复执行），见 [升级与数据备份](../deploy/upgrade#数据库变更)。复制物料、批次管理的切换不需要改库。
