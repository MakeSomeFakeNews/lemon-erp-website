---
order: 20.5
---

# 其他收支、调拨与返利开发

本页说明现金银行（其他收入单 / 费用支出单、收支类别、账户调拨手续费承担方、出纳日记账来源单据）和返利协议（销售返利 / 采购返利、两种计算方式）的实现。收付款核销、冲账单见[应收应付核销开发](./settlement)。

## 其他收支

「财务 → 资金与费用 → 其他收支」，后端 `FinIoService`、`FinIoCategoryService`、`FinIoController`（`/fin/io`），前端 `views/fin/income-expense`（`index.vue` 收支单列表，`IoForm.vue` / `IoDetail.vue` / `IoSummary.vue` / `IoCategory.vue`，`useIoActions.js` 列表和详情共用的确认 / 取消确认）。

其他收入单（废料销售、佣金、房租收入等）和费用支出单（房租、水电、差旅、招待、快递、工资等直接支付的费用）是同一张单据，用方向区分。不接入审批：收支单由出纳按实际收付登记，员工垫付需要审批的走费用报销。

### 表结构

| 表 | 说明 |
| --- | --- |
| `fin_io_doc` | 收支单：`doc_no`、`direction`（`FundDirection` `IN` / `OUT`，字典 `fin_fund_direction`）、`doc_date`、`ticket_no`、`partner_type`（`IoPartnerType` `CUSTOMER` / `SUPPLIER` / `OTHER`，字典 `fin_io_partner_type`）、`partner_id`（客户 / 供应商）、`partner_name`（其他单位名称）、`settle_method`（业务字典 `fin_settle_method`）、`account_id`（现金 / 银行末级科目）、`dept_id`（费用部门，只有支出）、`amount`（明细合计）、`status`（`IoStatus` `DRAFT` / `CONFIRMED`，字典 `fin_io_status`）、`voucher_id`、`confirm_by`、`confirm_time`、`create_by` |
| `fin_io_doc_item` | 明细：`doc_id`、`category_id`、`amount`、`remark` |
| `fin_io_category` | 收支类别：`name`、`direction`、`account_id`（末级科目）、`sort`、`status`（`EnableStatus`）、`remark`；唯一约束 `(direction, name, tenant_id)` |

单号规则：其他收入单 `SR`、费用支出单 `ZC`（在 `FinDocNos` 中声明）。凭证来源 `VoucherSource.INCOME_EXPENSE`（字典 `fin_voucher_source`「其他收支」）。

### 接口

| 操作 | 接口 | 权限 |
| --- | --- | --- |
| 列表 / 详情 | `GET /fin/io`、`/{id}` | `fin:io:list` |
| 新增 / 修改 / 删除 | `POST`、`PUT /{id}`、`DELETE /{ids}` | `fin:io:add` / `edit` / `remove` |
| 确认 / 取消确认 | `POST /{id}/confirm`、`/{id}/cancel-confirm` | `fin:io:confirm` |
| 收支汇总 / 明细 | `GET /summary`、`/lines` | `fin:io:list` |
| 收支类别列表 | `GET /category` | `fin:io:list` |
| 收支类别维护 | `POST` / `PUT` / `DELETE /category` | `fin:io:category` |

内置角色：会计、出纳全部权限；总经理、普通用户只读。

### 规则

- **保存校验**（`validate`）：结算账户经 `FinAccountService.requireCashAccount` 校验；业务期间未结账（`FinBizPeriodGuard.checkOpen`）；结算方式用 `DictLookup.check` 校验，且不能是 `SettleMethods.NOTE`（票据由票据管理生成，前端用 `SETTLE_METHOD_NOTE` 过滤）；关联单位为客户 / 供应商时 `partnerId` 必填并校验存在；明细的类别须存在、启用、方向与单据一致；明细 1～200 行。
- **修改、删除**：只能处理待确认的单据（条件更新 `status = DRAFT`），方向不能修改；明细用 `DetailLines.replace` 整体替换。
- **确认**（`@Transactional`）：`FinVoucherService.createGenerated` 生成未审核凭证，`StatusTransitions.change` 改为已确认并记录凭证、确认人。分录：

| 方向 | 分录 |
| --- | --- |
| 收入 | 借 结算账户（合计）/ 贷 各明细类别科目 |
| 支出 | 借 各明细类别科目（带 `dept_id`，计入部门预算执行）/ 贷 结算账户（合计） |

  摘要按默认语言取 `fin.text.ioIncomeSummary` / `ioExpenseSummary`（「其他收入 单号」「费用支出 单号」）+ 关联单位 + 类别名称 + 备注；关联单位为客户 / 供应商时类别分录 `withCustomer` / `withSupplier`。类别没有科目时报 `fin.error.ioCategoryNoAccount`。
- **取消确认**：凭证已记账时报 `fin.error.ioDocVoucherPosted`；否则 `FinVoucherService.deleteOwned` 删除凭证（只能删未审核的），回到待确认。`INCOME_EXPENSE` 已加入凭证管理不能直接删除的来源列表。
- **汇总 / 明细**：只统计已确认的单据，日期范围必填且不超过一年（`FinIoDocMapper.selectSummary` 按类别 `GROUP BY`，`selectLines` 分页）。

### 收支类别

收支类别没有用业务字典，而是单独的基础资料表：每个类别要标明收 / 支并关联一个末级会计科目，字典数据没有这两个字段。

- 每个租户一份，一级；新租户由 `FinTenantInitializer` 从平台租户复制，科目按 ID 映射到新租户的科目。
- 同一方向下名称唯一（`fin.error.ioCategoryNameExists`）；科目经 `FinAccountService.requireLeaves` 校验为末级。
- 已被收支单使用的类别不能删除（`fin.error.ioCategoryUsed`）、不能改方向（`ioCategoryUsedDirection`），可以停用；列表返回 `used` 供前端隐藏删除按钮、锁定方向。
- 被类别或收支单引用的科目视为已使用（`FinAccountService`），不能删除、不能再加下级；客户、供应商、部门被收支单引用时不能删除（`FinRefMapper.xml`）。

内置类别（init.sql 同时在管理费用 6602 下补充了 660206 业务招待费、660207 水电费、660208 租赁费、660209 快递费）：

| 方向 | 类别 | 科目 |
| --- | --- | --- |
| 收入 | 废料销售、佣金收入、房租收入 | 6051 |
| | 其他收入 | 6301 |
| 支出 | 差旅费、业务招待费、办公费、房租、水电费、快递费、工资 | 660204、660206、660202、660208、660207、660209、660201 |
| | 银行手续费 | 6603 |
| | 其他支出 | 6711 |

## 账户调拨手续费承担方

`fin_fund_transfer.fee_bearer`（`FeeBearer` `FROM` / `TO`，字典 `fin_fee_bearer`，默认 `FROM`），请求 `FundTransferRequest.feeBearer`，`FinFundService` 生成凭证：

| 承担方 | 分录 |
| --- | --- |
| `FROM` 转出账户 | 借 转入账户（金额）、财务费用（手续费）/ 贷 转出账户（金额 + 手续费） |
| `TO` 转入账户 | 借 转入账户（金额 − 手续费）、财务费用（手续费）/ 贷 转出账户（金额）；手续费须小于金额（`fin.error.transferFeeExceedsAmount`） |

前端 `views/fin/transfer/index.vue` 在手续费不为 0 时显示承担方单选，并实时提示两个账户实际付出 / 收到的金额。

## 出纳日记账的来源单据

`FinCashierMapper.xml` 的日记账查询带出凭证的 `source_type`、`source_no`，`CashierViews` 的日记账行增加 `sourceType`、`sourceNo`；前端日记账增加「来源单据」列（字典 `fin_voucher_source` 标签 + 来源单号），手工凭证为空。

## 返利协议

返利协议分两种（`scm_rebate.kind`，`scm/model/RebateKind`，字典 `scm_rebate_kind`）：

| 种类 | 菜单 / 接口 | 对象 | 单号规则 | 权限 |
| --- | --- | --- | --- | --- |
| `SALES` 销售返利 | 「销售 → 销售返利」，`/scm/rebate`（`ScmRebateController`） | 客户 `customer_id` | `FL` | `scm:rebate:list/add/settle` |
| `PURCHASE` 采购返利 | 「采购 → 采购返利」，`/scm/purchase-rebate`（`ScmPurchaseRebateController`） | 供应商 `supplier_id` | `CFL` | `scm:purchaseRebate:list/add/settle` |

两者共用 `ScmRebateService`，方法都带 `kind` 参数；按种类读取，另一种类的协议视为不存在（`detail` 中 `r.getKind() != kind` 时报不存在），所以两套权限互不越权。前端共用 `components/scm/RebatePage.vue` / `RebateDetail.vue`，`components/scm/rebate.js` 的 `rebateApi(kind)` 选择接口、`useRebateText(kind)` 选择措辞（客户 / 供应商、销售额 / 采购额、红字应收 / 红字应付）。

### 计算方式

`scm_rebate.calc_mode`（`RebateCalcMode`，字典 `scm_rebate_calc`）：

| 方式 | 说明 |
| --- | --- |
| `TIER` 阶梯比例 | 明细 `scm_rebate_tier`（`min_amount`、`rate`，1～20 档，金额不能重复）。期间金额（`ScmRebateMapper.selectTradeAmount`：销售返利为销售出库 − 销售退货，采购返利为采购入库 − 采购退货，取 `scm_trade_doc.total_amount`，含税）达到的最高一档返利率 × 全部金额 |
| `ITEM` 按项目填写金额 | 明细 `scm_rebate_item`（`item_name`、可选的 `brand` / `category`（业务字典 `wms_material_brand` / `wms_material_category`，`DictLookup.check` 校验）、`amount`，1～100 项）。结算时取合计，不做公式计算；期间金额只作参考，`rate` 为空 |

`Calc` 返回期间金额、返利率（`ITEM` 为 `null`）、返利金额；前端按 `rate == null` 判断显示「按项目合计」。保存时按 `calcMode` 只保存对应的明细（另一种明细传空）。

### 结算与财务处理

期间结束后结算（返利金额须大于 0），状态 `ACTIVE` → `SETTLED`，记录金额、返利率、结算人。兑付方式 `settle_mode`：

- **销售返利**：`CREDIT_NOTE` 红字应收，或 `NEXT_ORDER` 计入客户返利余额（`selectEarned` − 销售订单已抵扣 `selectUsed`），新建 / 修改销售订单时填写返利抵扣（不超过余额，按行金额分摊到单价）。
- **采购返利**：只能 `CREDIT_NOTE`（`scm.error.purchaseRebateCreditNoteOnly`），不在采购订单中抵扣。

红字单据方式发布 `RebateSettledEvent(rebateId, rebateNo, kind, partnerId, amount, settleDate)`，fin 的 `FinBillService.onRebateSettled` 同一事务生成来源 `BillSource.REBATE` 的红字单据（税额按 13% 价内计算），再调用 `ScmRebateService.bindBill` 回写。`FinBillService.lines` 中的分录：

| 种类 | 单据 | 分录 |
| --- | --- | --- |
| 销售返利 | 红字应收单 | 与销售应收相同的结构、金额为负：借 应收账款 / 贷 主营业务收入（`REVENUE`）、销项税额 |
| 采购返利 | 红字应付单 | 借 应付账款（供应商）/ 贷 `AccountRole.PURCHASE_REBATE`（默认 6401 主营业务成本，冲减成本，不含税金额）、进项税额（税额），金额取正数 |

`PURCHASE_REBATE` 属于「收入与费用」组，名称 `fin.label.purchaseRebateAccount`「采购返利的对方科目（冲减成本）」，可在凭证科目设置中修改。付款时与其他红字单据一样勾选即可冲抵欠款（与冲账单相同的机制）。

撤销结算发布 `RebateUnsettledEvent`，fin 删除红字单据：须未核销、未生成凭证；下次订单抵扣的须余额足够收回（未被订单使用）。

## 关键类与文件

| 位置 | 内容 |
| --- | --- |
| fin `service/FinIoService`、`FinIoCategoryService`、`controller/FinIoController`、`dto/IoRequests` | 其他收支、收支类别 |
| fin `entity/FinIoDoc`、`FinIoDocItem`、`FinIoCategory`，`mapper/fin/FinIoDocMapper.xml`、`FinIoCategoryMapper.xml`、`FinIoDocItemMapper.xml` | 表映射、列表 / 汇总 / 明细查询 |
| fin `model/FundDirection`、`IoStatus`、`IoPartnerType`、`FeeBearer`、`VoucherSource.INCOME_EXPENSE`、`AccountRole.PURCHASE_REBATE` | 枚举 |
| fin `service/FinFundService`、`FinCashierService`、`mapper/fin/FinCashierMapper.xml` | 调拨手续费承担方、日记账来源单据 |
| fin `service/FinBillService`（`onRebateSettled`、`onRebateUnsettled`、`lines`） | 返利红字单据及凭证 |
| fin `service/FinTenantInitializer` | 新租户复制收支类别 |
| scm `service/ScmRebateService`、`controller/ScmRebateController`、`ScmPurchaseRebateController`、`mapper/scm/ScmRebateMapper.xml` | 返利协议 |
| scm `model/RebateKind`、`RebateCalcMode`，`entity/ScmRebateItem`，`event/RebateSettledEvent` | 种类、计算方式、返利项目、结算事件 |
| 前端 `views/fin/income-expense/*`、`views/fin/transfer/index.vue`、`views/fin/cashier/index.vue` | 其他收支、调拨、日记账 |
| 前端 `components/scm/RebatePage.vue`、`RebateDetail.vue`、`rebate.js`，`views/scm/rebate`、`views/scm/purchase-rebate` | 返利协议页面 |
