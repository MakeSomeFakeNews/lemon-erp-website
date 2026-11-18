---
order: 20.5
---

# 其他收支、调拨与返利开发

本页说明现金银行（资金账户与指定科目、出纳核对总账、银行对账的期初未达账、其他收入单 / 费用支出单、业务单据生成的费用支出单、收支类别、账户调拨（手续费支付账户、经办人、票据号码）、出纳日记账来源单据）和返利协议（销售返利 / 采购返利、两种计算方式）的实现。收付款核销、冲账单见[应收应付核销开发](./settlement)。

## 资金账户

issue #136。「财务 → 资金与费用 → 资金账户」（`FinCashAccountService` / `FinCashAccountController`，前端 `views/fin/cash-account`：`index.vue` 列表、`CashAccountForm.vue` 表单、`OpeningDrawer.vue` 期初），用户手册见 [资金账户](/manual/fin/cash-account)。

### 指定科目

科目范围用途 库存现金 `CASH`（1001）、银行存款 `BANK`（1002）、其他货币资金 `OTHER_FUNDS`（1012，本次新增，`init.sql` 预置 1012 及下级 101201 微信、101202 支付宝）即「指定科目」，在「凭证科目设置」或「会计科目」页面的「指定科目」（`views/fin/account/DesignateModal.vue`，保存到同一份 `fin_account_rule`）中设置。三者须是资产类科目且不能互相包含（`FinAccountRuleService.checkFundScope`，`fin.error.fundScopeMustAsset` / `fundScopeOverlap`），会计科目列表按 `GET /fin/account/scopes` 给对应科目加标签。`FinAccountService.cashCodes()` 返回三者，现金流量表（`FinAnalysisService`）、资金计划（`FinFundService`）因此也包含其他货币资金。

### 表与字段

| 表 | 说明 |
| --- | --- |
| `fin_cash_account` | 名称（单据下拉显示）、类型 `type`（`CashAccountType`：`CASH` / `BANK` / `WECHAT` / `ALIPAY` / `OTHER`，系统字典 `fin_cash_account_type`）、入账科目 `account_id`（唯一键 `uk_cash_account_subject`，一个科目一个账户）、开户行、账号、启用日期 `enable_date`、日记账期初 `journal_opening`、对账单期初 `statement_opening`、排序、状态（`EnableStatus`） |
| `fin_bank_opening_item` | 银行类账户的期初未达账：`cash_account_id`、`side`（`BankOpeningSide`：`BOOK` 企业已记银行未记 / `BANK` 银行已记企业未记，系统字典 `fin_bank_opening_side`）、`txn_date`（早于启用日期）、`amount`（收入正、支出负）、摘要、流水号，勾对后记录 `entry_id`（与凭证分录）或 `statement_id`（与银行流水） |

银行流水本身不加列：与期初未达账的勾对记在 `fin_bank_opening_item.statement_id` / `entry_id` 上，`FinBankStatement` 只增加非持久化字段 `openingItemId`、`opening` 供页面显示。

### 账户规则

- **入账科目**（`validateSubject`）：指定科目下的启用末级科目（现金账户在 `CASH` 下，其他类型在 `BANK` 或 `OTHER_FUNDS` 下）、不能启用辅助核算、不能已被其他账户绑定。被绑定的科目视为已使用（不能删除、不能增加下级），不能再启用辅助核算（`fin.error.accountBoundCashAccountAux`），账户启用时科目不能停用（`accountBoundCashAccountDisable`）。
- **修改**：启用中的账户只能改名称、开户行、账号、排序、备注（`cashAccountEnabledLocked`）；入账科目被凭证、单据、对账单、期初未达账使用后（`FinCashAccountMapper.subjectUsed`，涵盖 `fin_voucher_entry`、`fin_settlement`、`fin_advance`、`fin_io_doc`、`fin_fund_transfer`、`fin_expense_claim`、`fin_loan`、`fin_loan_repay`、`fin_note_log`、`fin_bank_statement`、`scm_trade_doc`、`wms_stock_doc` 等）不能更换、账户不能删除（可停用）。
- **启用**（`enable`）：再次校验入账科目；有启用日期时期初未达账日期须早于启用日期，且期初平衡（`GET /fin/cash-account/{id}/opening-check`，`CashAccountRequests.OpeningCheck`：日记账期初 + 银行已收企业未收 − 银行已付企业未付 = 对账单期初 + 企业已收银行未收 − 企业已付银行未付，同时返回入账科目在启用日期之前的账面余额 `ledgerBalance` 供参考）。新增时 `enable = true` 直接启用。
- **期初未达账**：只有未启用、有启用日期的非现金账户可以增删（`/fin/cash-account/{id}/opening-items`）。
- **新租户**：`FinTenantInitializer` 复制平台的账户（预置库存现金、工商银行、招商银行、微信、支付宝），不复制期初。

### 单据中的结算账户

**单据中保存的仍是入账科目 ID**（`fin_settlement.account_id`、`fin_io_doc.account_id`、调拨、报销 / 借款付款、票据、工资发放、运费现付 `freight_account_id`、调拨费用 `fee_account_id` 等字段不变），账户与科目一一对应，因此原有单据、凭证不需要迁移：

- 后端 `FinAccountService.requireCashAccount(科目, 业务日期)`：科目在指定科目下（`settlementAccountMustCashBankDeposit`）、建立了资金账户（`cashAccountNotSetUp`）、账户已启用（`cashAccountDisabled`）、业务日期不早于启用日期（`cashAccountBeforeEnableDate`）。收付款、预收预付、其他收支、报销 / 借款付款与还款、账户调拨、票据、固定资产购置与处置、工资发放（hr `HrPayrollService`）、运费现付和调拨费用生成费用支出单时都经过它；
- 前端结算账户一律用 `components/fin/CashAccountSelect.vue`（`GET /fin/cash-account/options`，登录即可访问，带 `cached`）：`usable` 为 true 的可选，停用的只用于显示已有单据的值（「名称（已停用）」）；`all` 属性可选停用的（出纳管理、银行对账的查询条件），`bank` 只列非现金账户；小程序 `api/wms.js` 的 `cashAccounts` 同样取此接口；
- 进销存报表资产状况的「现金」按类型为 `CASH` 的资金账户汇总（`BiJxcAnalysisService`，不再写死 1001）。

### 出纳管理与核对总账

`FinCashierService` 按资金账户取数（查询范围 `CashierViews.Scope`：入账科目 + 启用日期）：账户有启用日期时日记账、资金日报只取启用日期当天及以后的凭证，期初为日记账期初；没有启用日期时取科目期初 + 全部凭证（升级时回填的账户都是这种）。

**核对总账**（`GET /fin/cashier/check`，`CashierViews.CheckRow`）：每个资金账户一行，日记账（启用日期起，日记账期初 + 全部凭证，含未记账）与总账（入账科目的科目期初 + 已记账凭证，不受启用日期限制）比对期初、借贷发生额、期末；`difference` = 日记账期末 − 总账期末，其中 `unposted`（日记账期末 − 只算已记账凭证的日记账期末）和 `openingDifference`（日记账期初 − 总账在启用日期之前的已记账余额），两者之和即差额；另列截至结束日期未生成凭证的收付款（`unvoucheredCount` / `unvoucheredAmount`，两边都不包含）；`matched` 为差额是否为 0。

### 银行对账的期初未达账

`FinBankService`：选择银行类资金账户（非现金）。账户有启用日期时余额调节表的账面余额 = 日记账期初 + 启用日期起的凭证，银行余额 = 对账单期初 + 启用日期起的流水（未填写银行余额时）。期初未达账标「期初」列入两边：银行已记企业未记的与启用日期及以后的凭证分录勾对（`entry_id`），企业已记银行未记的与之后的流水勾对（`statement_id`），两条期初未达账之间不能勾对；自动勾对同样处理（`GET /fin/bank/opening-items`、`POST /fin/bank/opening-item/{id}/match/{targetId}`），未勾对的计入余额调节表。前端勾对页 `views/fin/bank/index.vue`、余额调节表拆为 `ReconcileModal.vue`。

## 其他收支

「财务 → 资金与费用 → 其他收支」，后端 `FinIoService`、`FinIoCategoryService`、`FinIoController`（`/fin/io`），前端 `views/fin/income-expense`（`index.vue` 收支单列表，`IoForm.vue` / `IoDetail.vue` / `IoSummary.vue` / `IoCategory.vue`，`useIoActions.js` 列表和详情共用的确认 / 取消确认）。

其他收入单（废料销售、佣金、房租收入等）和费用支出单（房租、水电、差旅、招待、快递、工资等直接支付的费用）是同一张单据，用方向区分。不接入审批：收支单由出纳按实际收付登记，员工垫付需要审批的走费用报销。

### 表结构

| 表 | 说明 |
| --- | --- |
| `fin_io_doc` | 收支单：`doc_no`、`direction`（`FundDirection` `IN` / `OUT`，字典 `fin_fund_direction`）、`doc_date`、`ticket_no`、`partner_type`（`IoPartnerType` `CUSTOMER` / `SUPPLIER` / `OTHER`，字典 `fin_io_partner_type`）、`partner_id`（客户 / 供应商）、`partner_name`（其他单位名称）、`settle_method`（业务字典 `fin_settle_method`）、`account_id`（现金 / 银行末级科目）、`dept_id`（费用部门，只有支出）、`amount`（明细合计）、`status`（`IoStatus` `DRAFT` / `CONFIRMED`，字典 `fin_io_status`）、`voucher_id`、`confirm_by`、`confirm_time`、`create_by`；`source_type` / `source_id` / `source_no`（业务单据生成时的来源，`BillSource`，索引 `idx_io_doc_source`） |
| `fin_io_doc_item` | 明细：`doc_id`、`category_id`、`amount`、`remark` |
| `fin_io_category` | 收支类别：`name`、`direction`、`account_id`（末级科目）、`sort`、`status`（`EnableStatus`）、`remark`、`code`（内置类别标识 `IoCategoryCode`，程序使用，唯一键 `uk_io_category_code`）；唯一约束 `(direction, name, tenant_id)` |

单号规则：其他收入单 `SR`、费用支出单 `ZC`（在 `FinDocNos` 中声明）。凭证来源 `VoucherSource.INCOME_EXPENSE`（字典 `fin_voucher_source`「其他收支」）。

### 接口

| 操作 | 接口 | 权限 |
| --- | --- | --- |
| 列表 / 详情 | `GET /fin/io`、`/{id}`（关键字也匹配来源单号） | `fin:io:list` |
| 新增 / 修改 / 删除 | `POST`、`PUT /{id}`、`DELETE /{ids}` | `fin:io:add` / `edit` / `remove` |
| 确认 / 取消确认 | `POST /{id}/confirm`、`/{id}/cancel-confirm` | `fin:io:confirm` |
| 收支汇总 / 明细 | `GET /summary`、`/lines`（`transferFee=true` 只看调拨手续费） | `fin:io:list` |
| 收支类别列表 | `GET /category` | `fin:io:list` |
| 收支类别维护 | `POST` / `PUT` / `DELETE /category` | `fin:io:category` |

内置角色：会计、出纳全部权限；总经理、普通用户只读。

### 规则

- **保存校验**（`validate`）：结算账户经 `FinAccountService.requireCashAccount(科目, 单据日期)` 校验（建立了启用的资金账户、日期不早于启用日期，见[资金账户](#单据中的结算账户)）；业务期间未结账（`FinBizPeriodGuard.checkOpen`）；结算方式用 `DictLookup.check` 校验，且不能是 `SettleMethods.NOTE`（票据由票据管理生成，前端用 `SETTLE_METHOD_NOTE` 过滤）；关联单位为客户 / 供应商时 `partnerId` 必填并校验存在；明细的类别须存在、启用、方向与单据一致；明细 1～200 行。
- **修改、删除**：只能处理待确认的单据（条件更新 `status = DRAFT`），方向不能修改；明细用 `DetailLines.replace` 整体替换。有来源单据的（业务单据生成）不能修改、删除（`fin.error.ioDocGenerated`）。
- **确认**（`@Transactional`）：`FinVoucherService.createGenerated` 生成未审核凭证，`StatusTransitions.change` 改为已确认并记录凭证、确认人。分录：

| 方向 | 分录 |
| --- | --- |
| 收入 | 借 结算账户（合计）/ 贷 各明细类别科目 |
| 支出 | 借 各明细类别科目（带 `dept_id`，计入部门预算执行）/ 贷 结算账户（合计） |

  摘要按默认语言取 `fin.text.ioIncomeSummary` / `ioExpenseSummary`（「其他收入 单号」「费用支出 单号」）+ 关联单位 + 类别名称 + 备注；关联单位为客户 / 供应商时类别分录 `withCustomer` / `withSupplier`。类别没有科目时报 `fin.error.ioCategoryNoAccount`。
- **取消确认**：凭证已记账时报 `fin.error.ioDocVoucherPosted`；否则 `FinVoucherService.deleteOwned` 删除凭证（只能删未审核的），回到待确认。`INCOME_EXPENSE` 已加入凭证管理不能直接删除的来源列表。
- **汇总 / 明细**：只统计已确认的单据，日期范围必填且不超过一年（`FinIoDocMapper.selectSummary` 按类别 `GROUP BY`，`selectLines` 分页）。收支汇总不按凭证统计，所以账户调拨的手续费由 `FinFundService.feeSummary`（`FinFundTransferMapper.selectFeeSummary`）汇总后在支出最后单列一行（`IoRequests.SummaryRow.transferFee = true`，方向 `OUT`，科目为 `AccountRole.FINANCE_EXPENSE`），方向选收入时不含。明细 `selectLines` 为收支单明细与调拨手续费的 `UNION ALL`（调拨行 `transferId` 有值，账户为支付手续费的账户，`fee > 0`）：传 `categoryId` 时只查收支单，`transferFee=true` 时只查调拨手续费，都不传且方向不是收入时两者合并分页。前端 `IoSummary.vue` 中调拨手续费的单号跳转到 `/fin/transfer?id=`（`useRouteOpen` 打开详情），没有 `fin:transfer:list` 权限时只显示单号。

### 收支类别

收支类别没有用业务字典，而是单独的基础资料表：每个类别要标明收 / 支并关联一个末级会计科目，字典数据没有这两个字段。

- 每个租户一份，一级；新租户由 `FinTenantInitializer` 从平台租户复制，科目按 ID 映射到新租户的科目。
- 同一方向下名称唯一（`fin.error.ioCategoryNameExists`）；科目经 `FinAccountService.requireLeaves` 校验为末级。
- 已被收支单使用的类别不能删除（`fin.error.ioCategoryUsed`）、不能改方向（`ioCategoryUsedDirection`），可以停用；列表返回 `used` 供前端隐藏删除按钮、锁定方向。
- 被类别或收支单引用的科目视为已使用（`FinAccountService`），不能删除、不能再加下级；客户、供应商、部门被收支单引用时不能删除（`FinRefMapper.xml`）。
- 内置类别（`code` 不为空）不能删除（`fin.error.ioCategoryBuiltinDelete`）、不能改方向（`ioCategoryBuiltinDirection`），可以修改名称和科目、停用；列表返回 `code`，前端 `IoCategory.vue` 显示「内置」标签、隐藏删除、锁定方向。

内置类别（init.sql 同时在管理费用 6602 下补充了 660206 业务招待费、660207 水电费、660208 租赁费、660209 快递费）：

| 方向 | 类别 | 科目 |
| --- | --- | --- |
| 收入 | 废料销售、佣金收入、房租收入 | 6051 |
| | 其他收入 | 6301 |
| 支出 | 差旅费、业务招待费、办公费、房租、水电费、快递费、工资 | 660204、660206、660202、660208、660207、660209、660201 |
| | 银行手续费 | 6603 |
| | 其他支出 | 6711 |
| | 销售运费（内置，`SALES_FREIGHT`） | 6601 |
| | 代垫运费（内置，`FREIGHT_ADVANCE`） | 1221 |
| | 调拨费用（内置，`TRANSFER_FEE`） | 6601 |

内置类别的默认科目与凭证科目设置的销售运费 / 代垫运费 / 调拨费用默认值一致；升级脚本给平台和已有租户各增加一份，科目取该租户凭证科目设置中的销售运费 / 代垫运费 / 调拨费用（没有设置按编码 6601 / 1221 / 6601；调拨费用由 `20261112_transfer_price.sql` 增加），已有同名支出类别时直接标记为内置。

### 业务单据生成的费用支出单

`FinIoService.createGenerated(code, date, accountId, supplierId, deptId, amount, sourceType, sourceId, sourceNo, remark)`：销售出库、采购退货现付的运费（`FinFreightService` 处理 `TradeFreightEvent`，见 [业务联动 - 运费](../architecture/integration#运费)）生成待确认的费用支出单，与出入库同一事务：

- 结算账户经 `requireCashAccount` 校验，业务期间未结账（`FinBizPeriodGuard.checkOpen`，已结账时抛 `fin.error.hasClosedBusinessDatePeriodNo`，出入库单整体回滚）；类别取 `FinIoCategoryService.getBuiltin(code)`，缺少时抛 `fin.error.ioCategoryBuiltinMissing`；
- 关联单位为承运商（供应商，可空），费用部门为出入库单的部门，明细一行；`source_type` 为 `SALES_OUT` / `PURCHASE_RETURN`，`source_id` / `source_no` 为出入库单；调拨单现付的调拨费用同样生成（`FinTransferFeeService` 处理 wms 的 `TransferFeeEvent`，类别 `IoCategoryCode.TRANSFER_FEE`，`source_type` 为 `TRANSFER_FEE`，来源为调拨单，冲销时金额为负数的红字单据，见 [实时库存成本 - 调拨费用](./stock-cost#调拨费用)）；
- 金额与来源一致，不能修改、删除，可确认、取消确认（规则同手工单据）；
- 前端列表增加「来源单据」列、详情增加「来源单据」行（`SourceDocLink`，按 `sourceDocs.js` 打开出入库单；`TRANSFER_FEE` 跳转 `/wms/transfer?id=`，需要 `wms:transfer:list`，调拨单页面用 `useRouteOpen` 打开详情），有来源时隐藏编辑、删除；`index.vue` 用 `useRouteOpen` 处理出入库单详情跳转过来的 `?id=`。

## 账户调拨

「财务 → 资金与费用 → 账户调拨」，后端 `FinFundService`、`FinFundController`（`/fin/fund-transfer`：列表 `GET`、详情 `GET /{id}`，权限 `fin:transfer:list`；新增 `POST`、删除 `DELETE /{ids}`，权限 `fin:transfer:edit`），前端 `views/fin/transfer/index.vue`。调拨不能修改；删除时删除凭证（须未审核）。

`fin_fund_transfer` 字段：日期、转出 / 转入账户、金额、手续费（可为 0）、手续费支付账户 `fee_bearer`（`FeeBearer` `FROM` / `TO`，字典 `fin_fee_bearer`：转出账户支付 / 转入账户支付，默认 `FROM`，手续费为 0 时不起作用）、经办人 `handler_id`（用户，可空，前端 `IdentityUserSelect`，不默认当前用户）、票据号码 `ticket_no`（转账回单号、支票号等，可空，最多 64 个字符，列表关键字可按其查询）、备注。凭证号显示系统生成的凭证（列表、详情可点开，详情同时显示凭证状态），不另设手工凭证号——外部单据的号码填在票据号码中。

`FinFundService.createTransfer` 生成凭证（来源 `VoucherSource.TRANSFER`）：

| 分录 | 说明 |
| --- | --- |
| 借 转入账户 / 贷 转出账户（调拨金额） | 调拨本身 |
| 借 财务费用 / 贷 手续费支付账户（手续费） | 有手续费时另记一组，摘要带「手续费」；`FROM` 贷转出账户，`TO` 贷转入账户 |

合计效果：转出账户支付时转出 金额 + 手续费、转入 金额；转入账户支付时转出 金额、转入 金额 − 手续费，此时手续费须小于金额（`fin.error.transferFeeExceedsAmount`）。手续费单独一组分录，所以出纳日记账、资金日报（支出金额和支出笔数）和银行对账中手续费是支付账户单独的一笔支出（日记账的对方科目为财务费用）。日记账的对方科目按分录配对（`CounterAccounts`）：凭证分录按行号累计借贷，每回到平衡结束一组，取同组中方向相反的分录科目，所以本金行显示对方账户、手续费行显示财务费用；一借多贷、多借一贷显示全部对方科目，同组两边都有多行时金额唯一相等的一一对应。手续费计入财务费用，利润表、科目余额表 / 明细账、预算执行、现金流量表、BI 利润分析等按凭证统计的报表自然包含；其他收支的「收支汇总」不按凭证统计，单列调拨手续费（见上文「汇总 / 明细」）。已有调拨的凭证保持原来的合并分录，各账户净额不变。

前端表单中手续费支付账户始终显示（下拉框，默认转出账户支付），手续费为 0 时禁用并提示「手续费为 0 时不起作用」，有手续费时实时提示两个账户实际付出 / 收到的金额；列表有手续费、手续费支付账户、票据号码、经办人列（没有手续费时显示 -），点击单号打开详情（`?id=` 也会打开详情，供收支汇总跳转）。

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
| `ITEM` 按项目填写金额 | 明细 `scm_rebate_item`（`item_name`、可选的 `brand` / `category`（业务字典 `wms_material_brand` / 物料分类 `wms_material_category`（由 `DictSource` 提供），`DictLookup.check` 校验）、`amount`，1～100 项）。结算时取合计，不做公式计算；期间金额只作参考，`rate` 为空 |

`Calc` 返回期间金额、返利率（`ITEM` 为 `null`）、返利金额；前端按 `rate == null` 判断显示「按项目合计」。保存时按 `calcMode` 只保存对应的明细（另一种明细传空）。

### 结算与财务处理

期间结束后结算（返利金额须大于 0），状态 `ACTIVE` → `SETTLED`，记录金额、返利率、结算人。兑付方式 `settle_mode`：

- **销售返利**：`CREDIT_NOTE` 红字应收，或 `NEXT_ORDER` 计入客户返利余额（`selectEarned` − 销售订单已抵扣 `selectUsed`），新建 / 修改销售订单时填写返利抵扣（不超过余额，按行金额分摊到单价）。
- **采购返利**：只能 `CREDIT_NOTE`（`scm.error.purchaseRebateCreditNoteOnly`），不在采购订单中抵扣。

红字单据方式发布 `RebateSettledEvent(rebateId, rebateNo, kind, partnerId, amount, settleDate)`，fin 的 `FinBillService.onRebateSettled` 同一事务生成来源 `BillSource.REBATE` 的红字单据（税额按业务参数「默认税率」`scm.defaultTaxRate`（默认 13%）价内计算，经 `ScmTaxRates.defaultRate()` 读取），再调用 `ScmRebateService.bindBill` 回写。`FinBillService.lines` 中的分录：

| 种类 | 单据 | 分录 |
| --- | --- | --- |
| 销售返利 | 红字应收单 | 与销售应收相同的结构、金额为负：借 应收账款 / 贷 主营业务收入（`REVENUE`）、销项税额 |
| 采购返利 | 红字应付单 | 借 应付账款（供应商）/ 贷 `AccountRole.PURCHASE_REBATE`（默认 6401 主营业务成本，冲减成本，不含税金额）、进项税额（税额），金额取正数 |

`PURCHASE_REBATE` 属于「收入与费用」组，名称 `fin.label.purchaseRebateAccount`「采购返利的对方科目（冲减成本）」，可在凭证科目设置中修改。付款时与其他红字单据一样勾选即可冲抵欠款（与冲账单相同的机制）。

撤销结算发布 `RebateUnsettledEvent`，fin 删除红字单据：须未核销、未生成凭证；下次订单抵扣的须余额足够收回（未被订单使用）。

## 关键类与文件

| 位置 | 内容 |
| --- | --- |
| fin `service/FinCashAccountService`、`FinAccountService.requireCashAccount`、`FinAccountRuleService.checkFundScope`、`mapper/fin/FinCashAccountMapper.xml`、`FinBankOpeningItemMapper.xml`；前端 `views/fin/cash-account/*`、`views/fin/account/DesignateModal.vue`、`components/fin/CashAccountSelect.vue` | 资金账户、指定科目、单据结算账户校验与下拉 |
| fin `service/FinCashierService`、`FinBankService`；前端 `views/fin/cashier/index.vue`、`views/fin/bank/index.vue`、`ReconcileModal.vue` | 日记账 / 资金日报按资金账户、核对总账、银行对账的期初未达账 |
| fin `service/FinIoService`、`FinIoCategoryService`、`controller/FinIoController`、`dto/IoRequests` | 其他收支、收支类别 |
| fin `entity/FinIoDoc`、`FinIoDocItem`、`FinIoCategory`，`mapper/fin/FinIoDocMapper.xml`、`FinIoCategoryMapper.xml`、`FinIoDocItemMapper.xml` | 表映射、列表 / 汇总 / 明细查询 |
| fin `model/FundDirection`、`IoStatus`、`IoPartnerType`、`FeeBearer`、`VoucherSource.INCOME_EXPENSE`、`AccountRole.PURCHASE_REBATE` | 枚举 |
| fin `service/FinFundService`、`FinCashierService`、`mapper/fin/FinCashierMapper.xml` | 账户调拨（凭证分录、详情、手续费汇总）、日记账来源单据 |
| fin `service/FinBillService`（`onRebateSettled`、`onRebateUnsettled`、`lines`） | 返利红字单据及凭证 |
| fin `service/FinTenantInitializer` | 新租户复制收支类别 |
| scm `service/ScmRebateService`、`controller/ScmRebateController`、`ScmPurchaseRebateController`、`mapper/scm/ScmRebateMapper.xml` | 返利协议 |
| scm `model/RebateKind`、`RebateCalcMode`，`entity/ScmRebateItem`，`event/RebateSettledEvent` | 种类、计算方式、返利项目、结算事件 |
| 前端 `views/fin/income-expense/*`、`views/fin/transfer/index.vue`、`views/fin/cashier/index.vue` | 其他收支、调拨、日记账 |
| 前端 `components/scm/RebatePage.vue`、`RebateDetail.vue`、`rebate.js`，`views/scm/rebate`、`views/scm/purchase-rebate` | 返利协议页面 |
