---
order: 19.5
---

# 工单完工与生产统计

本页说明 mes 模块中与 issue #49 相关的三块实现：工单的报工报废数量与完工判断（`scrap_qty`）、完工入库的领料齐套校验（`WoKitQty`、业务参数 `mes.finish.kitCheck`），以及「生产制造 → 生产统计」的 5 张实时报表（`MesStatService`）。代码在 `lemon-modules/lemon-mes`（包 `com.lemon.erp.modules.mes`），前端在 `lemon-web/src/components/mes`、`views/mes`。用户手册见[生产工单 - 完工条件](/manual/mes/wo#完工条件)和[生产统计](/manual/mes/stat)。

## 报工报废与工单完工

### 数据

`mes_work_order.scrap_qty`（`MesWorkOrder.scrapQty`）是工单的**报工报废数量**：各工序报工报废的合计（一件产品只会在一道工序报废）。报工时 `WoReportService.report` 在同一事务中调用 `MesWorkOrderService.addScrap` 累加（`MesWorkOrderMapper.addScrap`，`scrap_qty = scrap_qty + #{qty}`）。新建、返工工单初始化为 0。

### 完工判断

`MesWorkOrderMapper.markCompleted` 的条件由「完工满数量」改为：

```sql
WHERE id = #{id} AND status IN ('RELEASED', 'STARTED')
  AND finished_qty > 0 AND finished_qty + scrap_qty >= qty
```

即**已有完工入库**且 **完工 + 报工报废 ≥ 工单数量**（完工满数量是它的特例）。只有报废、没有完工入库的工单不自动完工，需要关闭（在制品损失）。三个入口都会检查：

| 入口 | 调用 | 成本处理 |
| --- | --- | --- |
| 完工入库（`MesWoDocService.save`，`FINISH`） | `markCompleted` | 本次完工入库就是最后一次完工，按 `MesStockCosts.finishCost` 取全部剩余成本（见下文） |
| 报工有报废（`WoReportService.report`） | `completeIfDone` | 不经完工入库而完工：`MesStockCosts.applyClose` 把未转入产品的成本按关闭规则追加到已完工产品，写 `close_cost` / `close_stock_cost` |
| 改量（`WoChangeService.changeQty`） | `completeIfDone` | 同上 |

`markCompleted` 改为已完工时，在同一事务中同步发布 `WorkOrderCompletedEvent(woId)`（`mes/model`），三个入口都会走到这里。`MesSupplementService.onWorkOrderCompleted` 监听该事件，与工单关闭（`WorkOrderClosedEvent`）共用 `cancelActive`：审批中、待发料的补料申请改为已撤销，审批中且流程仍在运行的同时 `flowApi.cancel` 撤销审批流程（撤销意见「工单已完工」，存库保持中文）；已发料的不受影响。

`markCompleted` 返回是否由本次改为已完工，之后照旧检查生产计划：计划下全部工单的**完工数量**达到计划数量时计划关闭——报废不算完成计划。前端 `WoDetail.vue` 对已完工工单的 `close_cost` 显示为「完工补转成本」（已关闭的仍为「关闭转出成本」）。

### 已完工工单的报废入库

报废入库原来要求工单可执行（`getExecutable`），现在走 `MesWorkOrderService.getScrapReceivable`：已下达、生产中，或**已完工**的工单都可以报废入库（累计仍不超过报工报废数）。前端 `WoDetail.vue` 在已完工且「报工报废 > 已报废入库」时显示「报废入库」按钮。

### 在制数量扣除报废

报废的产品不会再生产出来，各处的在制产出改为 `qty − finished_qty − scrap_qty`（`MesWorkOrderMapper.xml`）：MRP 的在途、齐套分析的在途、可承诺量的生产在制。

工序级的剩余数量由 `WoOpQty` 计算（纯函数）：`fillUpstreamScrap` 按工单分组、工序号排序后填写每道工序的前序报废合计（`MesWoOp.upstreamScrap`，非表字段），`left(woQty, op)` = 工单数量 − 前序报废 − 本工序合格 − 本工序报废。`MesBoardService`（生产看板）、`MesScheduleService`（产能负荷与排程）使用；排程按工作中心筛选时，要先对工单的**全部工序**计算前序报废再筛选。

报工时本工序累计（合格 + 报废）不能超过上道工序的累计合格数（第一道为工单数量）。工单详情的工序返回还可报工的数量 `reportableQty`（`WoOpQty.fillReportable`，与报工校验一致，前序有报废时小于看板的剩余数量），Web 报工弹窗（`WoReportModal.vue`）和小程序报工页（`pkg-wms/report`）的默认合格数取它。需要首件检验的工序：`MesWoOpMapper.selectByWo` 返回 `firstArticlePending`（非表字段：`first_article = 1` 且没有已确认、结论不是不合格的首件检验单，与 `WoReportService` 的首件校验一致），为 true 时 `reportableQty` 累计不超过 1 件（默认 1，已报过 1 件为 0），两端在报工页面提示「首件检验合格前，该工序累计只能报工 1 件」；单元测试 `WoOpQtyTest` 覆盖首件上限。

完工入库表单（`components/mes/WoDocForm.vue`）的默认数量也改为 `qty − finishedQty − scrapQty`；后端的上限仍是累计不超过工单数量。

### 成本口径

报废品的料工费由合格品承担，判断「最后一次完工」的数量从工单数量改为**应完工数量** = 工单数量 − 报工报废：

- 实时成本：`MesStockCosts.targetQty(wo)` 传给 `WoFinishCost.amount`、`WoConversionCost.amount`，累计完工达到它时取全部剩余的净领料成本和工费；`afterReturn` 同样使用；
- 月末成本核算：`FinCostSourceMapper.selectWorkOrders` 返回的 `qty` 为 `o.qty - o.scrap_qty`（`CostRows` 中注明为应完工数量），完工达到它时转出全部成本。

实时库存成本的完整说明见 [实时库存成本 - 生产成本口径](./stock-cost#生产成本口径)。

### 升级数据

`20261110_mes_issue49.sql` 按已有报工回填 `scrap_qty`，把已有完工入库且完工 + 报废已达到数量的在制工单改为已完工（完工时间取最后一次完工入库或报工的时间），并增加 `plan_end` 索引（工单完成情况按计划完工日期查询）。

## 完工入库领料校验

### 齐套数量 `WoKitQty`

`WoKitQty.compute(lines, substitutes)` 是纯函数，按工单用料的**净领料**（`mes_wo_material.issued_qty`，即领料 + 补料 − 退料）计算可完工的齐套数量：

- 每个用料可支持的数量 = 净领料 ÷ 单位用量（`unit_qty`，含损耗），取各用料的最小值，`RoundingMode.DOWN` 保留 4 位；
- 同一物料多行先合并；做过替代料切换的主料与替代料合并计算：(主料已领 + Σ 替代料已领 ÷ 比例) ÷ (主料单位用量 + Σ 替代料单位用量 ÷ 比例)，比例为「替代 1 个主料需要的数量」，取自 `MesMaterialService.substitutes`，只计入工单用料中实际存在的替代料；
- 单位用量为 0 的不参与；没有参与计算的用料时返回 `Result.UNLIMITED`（`qty` 为 `null`，不限）；
- `limitMaterial` 为限制齐套数量的物料（替代料组记主料），用于提示。

### 业务参数与接口

| 项 | 说明 |
| --- | --- |
| 业务参数 | `MesBizRules.FINISH_KIT_CHECK` = `mes.finish.kitCheck`，模块「生产制造」（`mes.label.manufacturing`），下拉 `FinishKitCheck`：`NONE` 不校验 / `WARN` 提示（默认）/ `BLOCK` 禁止；在 `publicKeys` 中声明为前端可读 |
| 查询 | `GET /mes/wo/{id}/finish-check`（`mes:wo:finish`）→ `MesWoDocService.finishCheck`，返回 `WoFinishCheckView`：校验方式、工单数量、已完工、报工报废、齐套数量、受限物料编码和名称 |
| 拦截 | `MesWoDocService.checkKit`：只有 `BLOCK` 时在后端拦截，累计完工（已完工 + 本次）超过齐套数量时抛 `mes.error.finishExceedsKitQty`；`WARN` 由前端确认，后端不拦截 |
| 前端 | `WoDocForm.vue` 打开完工入库时调用 `getWoFinishCheck`（`api/mes/wo.js`），顶部 `a-alert` 显示可完工数量（超出时为 warning）；`BLOCK` 时把默认数量压到剩余齐套数量以内，提交前 `confirmKit`：`BLOCK` 提示后不提交，`WARN` 弹 `Modal.confirm` |

默认 `WARN` 是为了不影响已有客户先入库、后补领料的流程。系统没有倒冲领料；委外加工走采购订单的委外用料，不在此校验。

## 生产统计

### 代码位置

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 接口 | `mes/controller/MesStatController`（`/mes/stat/*`） | 见下表 |
| 查询条件 | `mes/dto/MesStatQuery` | `begin` / `end`（必填）、`operatorId`、`workCenterId`、`noWorkCenter`、`opName`、`productId`、`category`、`deptId`、`day`、`materialId`、`status`、`keyword`；穿透参数由前端按汇总行生成 |
| 返回结构 | `mes/dto/MesStatViews` | `Summary<T>(rows, total, truncated)`、`ReportRow`、`ReportDetail`、`WoRow`、`OutputRow`、`UsageRow` |
| 汇总维度 | `mes/model/MesStatDimension` | `OPERATOR`、`OPERATOR_OP`、`OPERATOR_DAY`、`WORK_CENTER`、`OPERATION`、`PRODUCT`、`CATEGORY`、`DEPT`、`DAY`、`MONTH`、`WORK_ORDER`、`MATERIAL`、`WO_MATERIAL`；每张报表允许的维度在 `MesStatService` 的 `*_DIMS` 中，不允许时抛 `mes.error.statInvalidDimension` |
| 交期状态 | `mes/model/WoDueState` | `ON_TIME`、`LATE`、`OVERDUE`、`OPEN`、`CLOSED` |
| Service | `MesStatService` | 校验日期、维度，补齐比率等派生指标 |
| SQL | `resources/mapper/mes/MesStatMapper.xml` | 只读 JOIN wms、sys 的表 |
| 前端页面 | `views/mes/stat/{piece,output,wo,product,usage}/index.vue` | 每个页面只是 `<MesStatReport report="..." />` |
| 前端组件 | `components/mes/stat/MesStatReport.vue`（汇总页）、`MesStatReportDetail.vue`（报工明细子页）、`stat.js`（每张报表的维度、筛选、列、指标卡、穿透参数 `REPORTS`） | |
| 接口封装 | `api/mes/stat.js` | `mesStat(report, params)`、`mesStatReports(params)` |
| 语言包 | `locales/<语言>/mesStat.js` | 维度 `mesStat.dim.*`、列 `mesStat.field.*`、各报表的口径说明 `mesStat.<报表>.tip` |

### 接口与权限

| 接口 | 权限 | 报表 |
| --- | --- | --- |
| `GET /mes/stat/piece?groupBy=` | `mes:stat:piece` | 人员计件统计 |
| `GET /mes/stat/output?groupBy=` | `mes:stat:output` | 工序产量统计 |
| `GET /mes/stat/reports`（分页） | `hasAnyPerm('mes:stat:piece', 'mes:stat:output')` | 报工明细（汇总行穿透） |
| `GET /mes/stat/wo?groupBy=` | `mes:stat:wo` | 工单完成情况 |
| `GET /mes/stat/product?groupBy=` | `mes:stat:product` | 产品产量汇总，完工入库成本另需 `wms:stock:cost`（没有时 `finishCost`、`unitCost` 置空） |
| `GET /mes/stat/usage?groupBy=` | `mes:stat:usage` | 用料差异分析 |

菜单：分组「生产统计」（ID 970，生产制造下，排序 4）及 5 个页面 410–414，组件路径 `mes/stat/piece/index` 等。SaaS 功能模块 `PRODUCTION` 的菜单列表加入了 970（`SysFeatureCatalog`）。内置授权：普通用户、总经理、生产计划员、车间主管全部；仓库管理员 `product`；会计 `piece`、`product`、`usage`；人事专员 `piece`；质量工程师 `output`、`wo`（见 `init.sql` 末尾）。

### 公共约束

- 每个查询方法加 `@DataPermission(table = "mes_work_order", deptColumn = "dept_id", userColumn = "create_by")`，按**工单**的部门 + 制单人过滤（工单部门见 [数据权限](../architecture/data-scope)）；
- `prepare` 校验日期必填、结束不早于开始、跨度小于 `MAX_DAYS`（366）天，`keyword` 去空白；
- 汇总取 `LIMIT + 1` 行判断截断，最多返回 `LIMIT`（2000）行，`truncated` 告诉前端；合计另查一次（`selectReportTotal`，或以 `dim = null` 调用汇总 SQL 取一行），因此合计总是全部数据；
- 良品率、效率、完成率、按期完工率等比率在 `fill*` 中用 `Decimals.percent(分子, 分母, 1)` 计算，合计行同样按合计数计算，SQL 只做求和和计数；
- 每行的 `groupKey` 由各维度取值用 `|` 连接，前端作为 `row-key`。

### 各报表的口径

| 报表 | 数据来源与筛选日期 | 指标 |
| --- | --- | --- |
| 人员计件 / 工序产量（`reportFrom`） | `mes_report` JOIN 工单、工序 `mes_wo_op`、产品，LEFT JOIN 工作中心、操作员 `sys_user` 及其部门；按 `report_date` | 合格、报废、良品率 = 合格 ÷ (合格 + 报废)、实际工时、标准工时 = Σ (合格 + 报废) × `op.std_hours`、效率 = 标准 ÷ 实际（标准工时为 0 时为空）、计件工资 = Σ `r.piece_wage`、报工次数、工单数、人数（`COUNT(DISTINCT operator_id)`）。按工序汇总的分组键是 工作中心 + 工序名称 |
| 工单完成情况（`woFrom`） | `mes_work_order`，`status <> 'DRAFT'`，按 `plan_end` | 计划、完工、报废（`scrap_qty`）、完成率 = 完工 ÷ 计划、良品率 = 完工 ÷ (完工 + 报废)；汇总时 SQL 用 `CAST(finish_time AS DATE)` 与 `plan_end` 比较计数按期 / 延期，`plan_end < today` 的在制工单为逾期；按工单列出时由 `MesStatService.due` 计算交期状态和延期天数，口径与汇总一致 |
| 产品产量（`selectOutputSummary`） | `mes_wo_doc` 的 `FINISH`、`SCRAP`，按 `biz_date` | 完工入库数量、报废入库数量、完工入库次数、工单数、完工入库成本 = Σ (`material_cost` + `labor_cost` + `overhead_cost`)（完工入库时记录的料工费）、单位成本 = 成本 ÷ 完工数量 |
| 用料差异（`selectUsage`） | `mes_wo_material` JOIN 工单，`COMPLETED` 按 `finish_time`、`CLOSED` 按 `close_time` 落在期间内（Service 把日期换成 `[begin 00:00, end + 1 天 00:00)`） | 标准用量 = `finished_qty × unit_qty`，实际 = `issued_qty`，差异 = 实际 − 标准，差异率 = 差异 ÷ 标准；不同物料单位不同，`total` 为 `null` |

**计件工资与工资表同源**：报工时写入的 `mes_report.piece_wage`（合格数 × 工序计件单价）是唯一来源，工资表的 `HrPayrollItemMapper.selectPieceWages` 也按 `report_date` 求和该字段，因此同一月份、全部数据权限下两边一致。工资表通过 `hr_employee.user_id` 关联操作员，操作员没有员工档案时计件工资不进入工资表，但统计中仍显示。

### 前端

`MesStatReport.vue` 按 `REPORTS[report]` 渲染筛选条件、汇总方式（`a-radio-group`）、指标卡、口径说明和表格：

- 列配置 `{ key, title, type, width, value }`，`type` 为 `qty` / `money` / `price` / `rate` / `int` / `text`，`cellText` 负责显示，`exportCell` 负责导出（数值列导出数字，状态导出字典名称）；
- `drill: true` 的报表（人员计件、工序产量）点击行时用 `drillParams(dim, row)` 生成穿透条件，打开 `MesStatReportDetail`（`ref.open({ params, label })`）；工作中心为空的行传 `noWorkCenter: true`，按月汇总的行换成当月首尾日期；
- 导出汇总用 `utils/excel` 的 `writeExcel`，导出当前结果并附合计行；明细导出按 500 条一页循环取数，最多 5000 行；
- 日期快捷选项复用进销存报表的 `rangePresets` / `thisMonth`（`components/bi/jxc/jxc.js`）；`costVisible` 按 `wms:stock:cost` 决定是否显示成本列和指标卡。

### 新增一张生产统计报表

1. 在 `MesStatDimension` 中补充需要的维度，`MesStatService` 中新增方法（加 `@DataPermission`，调用 `prepare`、`checkDim`），`MesStatViews` 中新增行类型；
2. 在 `MesStatMapper.xml` 中写汇总 SQL（汇总、合计共用一个片段，`dim` 为空时只返回合计），在 `MesStatController` 中加接口和权限；
3. 前端在 `stat.js` 的 `REPORTS` 中登记维度、筛选、列、指标卡，新建 `views/mes/stat/<报表>/index.vue`，在 `mesStat.js` 两个语言包中补充文字；
4. 在 `init.sql`（和升级脚本）中登记菜单（分组 970 下）、按钮权限与内置角色授权，见 [新增菜单与授权](./menu)。
