// 业务架构图：各业务域为泳道，节点是功能页面，箭头表示单据流转与自动联动
// 运行：npm run diagrams（输出 docs/public/images/arch/business.png）
import { icon, render, FONT } from './lib.mjs'

const LEFT = 160 // 泳道标题列宽
const COL = 160 // 每列宽度
const COLS = 11
const ROW = 140 // 一行节点的高度
const GAP = 26 // 泳道间距（跨泳道连线从这里走）
const PAD = 24
const WIDTH = LEFT + COL * COLS + PAD

/** 泳道：rows 为行数，nodes 为 [列, 行, 名称, 图标] */
const LANES = [
  { key: 'base', name: '基础配置', icon: 'SettingOutlined', rows: 1, nodes: [
    [0, 0, '部门管理', 'ApartmentOutlined'], [1, 0, '角色管理', 'TeamOutlined'], [2, 0, '用户管理', 'UserOutlined'],
    [3, 0, '往来单位', 'ContactsOutlined'], [4, 0, '物料管理', 'AppstoreOutlined'], [5, 0, '物料清单', 'PartitionOutlined'],
    [6, 0, '工作中心', 'ClusterOutlined'], [7, 0, '仓库库位', 'HomeOutlined'], [8, 0, '会计科目', 'AccountBookOutlined'],
    [9, 0, '编码规则', 'NumberOutlined'], [10, 0, '打印模板', 'PrinterOutlined']
  ] },
  { key: 'sales', name: '销售与客户', icon: 'RiseOutlined', rows: 1, nodes: [
    [0, 0, '线索', 'BulbOutlined'], [1, 0, '客户', 'IdcardOutlined'], [2, 0, '销售机会', 'FunnelPlotOutlined'],
    [3, 0, '销售报价', 'FileTextOutlined'], [4, 0, '销售订单', 'ProfileOutlined'], [5, 0, '发货通知', 'SendOutlined'],
    [6, 0, '波次拣货', 'CarryOutOutlined'], [7, 0, '销售出库', 'ExportOutlined'], [8, 0, '物流发运', 'CarOutlined'],
    [9, 0, '销售退货', 'RollbackOutlined'], [10, 0, '服务工单', 'CustomerServiceOutlined']
  ] },
  { key: 'mes', name: '生产制造', icon: 'BuildOutlined', rows: 1, nodes: [
    [0, 0, '设备台账', 'DesktopOutlined'], [1, 0, '设备维护', 'ControlOutlined'], [2, 0, '设备 OEE', 'DashboardOutlined'],
    [3, 0, '产能排程', 'FieldTimeOutlined'], [4, 0, '生产计划', 'ScheduleOutlined'], [5, 0, 'MRP 运算', 'CalculatorOutlined'],
    [6, 0, '生产工单', 'FileDoneOutlined'], [7, 0, '生产领料', 'ContainerOutlined'], [8, 0, '生产报工', 'CheckSquareOutlined'],
    [9, 0, '完工入库', 'ImportOutlined'], [10, 0, '齐套分析', 'AimOutlined']
  ] },
  { key: 'scm', name: '采购', icon: 'ShoppingCartOutlined', rows: 1, nodes: [
    [0, 0, '供应商', 'ShopOutlined'], [1, 0, '供应商评估', 'AuditOutlined'], [2, 0, '招标采购', 'TrophyOutlined'],
    [3, 0, '采购合同', 'FileProtectOutlined'], [4, 0, '补货建议', 'AlertOutlined'], [5, 0, '请购单', 'FormOutlined'],
    [6, 0, '询价比价', 'InteractionOutlined'], [7, 0, '采购订单', 'ShoppingCartOutlined'], [8, 0, '送货通知', 'CarOutlined'],
    [9, 0, '采购入库', 'ImportOutlined'], [10, 0, '采购退货', 'RollbackOutlined']
  ] },
  { key: 'qms', name: '质量', icon: 'SafetyCertificateOutlined', rows: 1, nodes: [
    [0, 0, '检验方案', 'FileSearchOutlined'], [1, 0, '质量分析', 'LineChartOutlined'], [2, 0, 'SPC 控制图', 'DotChartOutlined'],
    [4, 0, '纠正预防', 'SafetyOutlined'], [5, 0, '供应商索赔', 'MoneyCollectOutlined'], [6, 0, '不合格品处理', 'ExceptionOutlined'],
    [7, 0, '首件检验', 'FlagOutlined'], [8, 0, '过程检验', 'ExperimentOutlined'], [9, 0, '来料检验', 'SafetyCertificateOutlined'],
    [10, 0, '成品检验', 'CheckCircleOutlined']
  ] },
  { key: 'wms', name: '仓储', icon: 'InboxOutlined', rows: 1, nodes: [
    [0, 0, '库存查询', 'DatabaseOutlined'], [1, 0, '调拨单', 'SwapOutlined'], [2, 0, '盘点单', 'OrderedListOutlined'],
    [3, 0, '库存预留', 'LockOutlined'], [4, 0, '库存冻结', 'StopOutlined'], [5, 0, '批次序列号', 'BarcodeOutlined'],
    [7, 0, '出库单', 'ExportOutlined'], [8, 0, '库存流水', 'HistoryOutlined'], [9, 0, '入库单', 'ImportOutlined']
  ] },
  { key: 'fin', name: '财务', icon: 'PayCircleOutlined', rows: 2, nodes: [
    [0, 0, '费用报销', 'TransactionOutlined'], [1, 0, '员工借款', 'CreditCardOutlined'], [2, 0, '固定资产', 'GoldOutlined'],
    [3, 0, '预算管理', 'FundProjectionScreenOutlined'], [5, 0, '收款单', 'WalletOutlined'], [6, 0, '应收管理', 'MoneyCollectOutlined'],
    [8, 0, '成本核算', 'CalculatorOutlined'], [9, 0, '应付管理', 'ReconciliationOutlined'], [10, 0, '付款单', 'DollarOutlined'],
    [0, 1, '银行对账', 'BankOutlined'], [1, 1, '票据管理', 'ContainerOutlined'], [2, 1, '资金计划', 'FundOutlined'],
    [5, 1, '凭证管理', 'BookOutlined'], [6, 1, '账簿查询', 'ReadOutlined'], [7, 1, '财务报表', 'PieChartOutlined'],
    [8, 1, '期末结账', 'LockOutlined']
  ] },
  { key: 'hr', name: '人力与项目', icon: 'SolutionOutlined', rows: 1, nodes: [
    [0, 0, '招聘管理', 'UsergroupAddOutlined'], [1, 0, '员工档案', 'IdcardOutlined'], [2, 0, '考勤管理', 'ClockCircleOutlined'],
    [3, 0, '薪酬核算', 'CalculatorOutlined'], [5, 0, '项目列表', 'ProjectOutlined'], [6, 0, '计划进度', 'ScheduleOutlined'],
    [7, 0, '工时管理', 'FieldTimeOutlined'], [8, 0, '项目核算', 'AccountBookOutlined']
  ] },
  { key: 'bi', name: '商务智能', icon: 'PieChartOutlined', rows: 1, nodes: [
    [0, 0, '数据仓库', 'CloudSyncOutlined'], [1, 0, '多维分析', 'TableOutlined'], [2, 0, '自定义报表', 'FileTextOutlined'],
    [3, 0, '自定义仪表盘', 'DashboardOutlined'], [4, 0, '经营驾驶舱', 'FundOutlined'], [5, 0, '决策支持', 'BulbOutlined'],
    [6, 0, '预警规则', 'AlertOutlined']
  ] }
]

// ---------------------------------------------------------------- 布局
let y = PAD
for (const lane of LANES) {
  lane.top = y
  lane.height = lane.rows * ROW
  y += lane.height + GAP
}
const HEIGHT = y - GAP + PAD + 28

const nodes = {}
for (const lane of LANES) {
  for (const [c, r, name, ic] of lane.nodes) {
    const cx = LEFT + c * COL + COL / 2
    const tileTop = lane.top + r * ROW + 26
    nodes[`${lane.key}.${name}`] = { cx, cy: tileTop + 26, top: tileTop - 2, bottom: tileTop + 92, left: cx - 34, right: cx + 34, name, icon: ic, tileTop }
  }
}
const N = (id) => {
  const n = nodes[id]
  if (!n) throw new Error(`节点不存在：${id}`)
  return n
}
const lane = (key) => LANES.find((l) => l.key === key)
/** 泳道下方 / 上方的间隙（连线通道），k 为偏移 */
const below = (key, k = 0) => lane(key).top + lane(key).height + GAP / 2 + k * 5
const above = (key, k = 0) => lane(key).top - GAP / 2 + k * 5
/** 第 c 列左侧的列间隙 */
const gapX = (c, k = 0) => LEFT + c * COL + k * 7

// ---------------------------------------------------------------- 连线
/** 泳道内相邻节点：[泳道, 起点, 终点]，自动判断方向 */
const FLOWS = [
  ['base', '部门管理', '角色管理'], ['base', '角色管理', '用户管理'], ['base', '物料管理', '物料清单'], ['base', '物料清单', '工作中心'],
  ['sales', '线索', '客户'], ['sales', '客户', '销售机会'], ['sales', '销售机会', '销售报价'], ['sales', '销售报价', '销售订单'],
  ['sales', '销售订单', '发货通知'], ['sales', '发货通知', '波次拣货'], ['sales', '波次拣货', '销售出库'], ['sales', '销售出库', '物流发运'],
  ['mes', '设备台账', '设备维护'], ['mes', '设备维护', '设备 OEE'], ['mes', '生产计划', 'MRP 运算'], ['mes', 'MRP 运算', '生产工单'],
  ['mes', '生产工单', '生产领料'], ['mes', '生产领料', '生产报工'], ['mes', '生产报工', '完工入库'],
  ['scm', '供应商', '供应商评估'], ['scm', '补货建议', '请购单'], ['scm', '请购单', '询价比价'], ['scm', '询价比价', '采购订单'],
  ['scm', '采购订单', '送货通知'], ['scm', '送货通知', '采购入库'],
  ['qms', '首件检验', '不合格品处理'], ['qms', '不合格品处理', '供应商索赔'], ['qms', '供应商索赔', '纠正预防'],
  ['wms', '出库单', '库存流水'], ['wms', '入库单', '库存流水'],
  ['fin', '应收管理', '收款单'], ['fin', '应付管理', '付款单'], ['fin', '凭证管理', '账簿查询'], ['fin', '账簿查询', '财务报表'], ['fin', '财务报表', '期末结账'],
  ['hr', '招聘管理', '员工档案'], ['hr', '员工档案', '考勤管理'], ['hr', '考勤管理', '薪酬核算'],
  ['hr', '项目列表', '计划进度'], ['hr', '计划进度', '工时管理'], ['hr', '工时管理', '项目核算'],
  ['bi', '数据仓库', '多维分析'], ['bi', '多维分析', '自定义报表'], ['bi', '自定义报表', '自定义仪表盘'], ['bi', '自定义仪表盘', '经营驾驶舱'], ['bi', '经营驾驶舱', '决策支持'], ['bi', '决策支持', '预警规则']
]

/** 跨泳道联动：折线路径点（起点在源节点下方 / 上方，终点在目标节点上方 / 下方） */
const LINKS = []
const link = (...pts) => LINKS.push(pts)
const down = (from, to, dx = 0) => [[N(from).cx + dx, N(from).bottom], [N(to).cx + dx, N(to).top]]

// 销售订单 → 生产计划（由销售订单生成主生产计划）
link(...down('sales.销售订单', 'mes.生产计划'))
// MRP 运算 → 请购单 / 采购订单
link(...down('mes.MRP 运算', 'scm.请购单'))
// 采购入库 → 来料检验 → 入库单
link(...down('scm.采购入库', 'qms.来料检验'))
link(...down('qms.来料检验', 'wms.入库单', -8))
// 完工入库 → 成品检验 → 入库单
{
  const a = N('mes.完工入库'), b = N('qms.成品检验'), c = N('wms.入库单')
  link([a.cx + 8, a.bottom], [a.cx + 8, below('mes')], [gapX(10, 1), below('mes')], [gapX(10, 1), above('qms')], [b.cx, above('qms')], [b.cx, b.top])
  link([b.cx, b.bottom], [b.cx, below('qms')], [c.cx + 8, below('qms')], [c.cx + 8, c.top])
}
// 生产工单 → 首件检验 / 过程检验（报工前首件检验）
{
  const a = N('mes.生产报工'), b = N('qms.过程检验')
  link([a.cx - 8, a.bottom], [a.cx - 8, below('mes', 1)], [gapX(8, -1), below('mes', 1)], [gapX(8, -1), above('qms', -1)], [b.cx, above('qms', -1)], [b.cx, b.top])
}
// 生产领料 → 出库单；销售出库 → 出库单
{
  const a = N('mes.生产领料'), s = N('sales.销售出库'), o = N('wms.出库单')
  link([a.cx, a.bottom], [a.cx, below('mes', -1)], [gapX(7, -1), below('mes', -1)], [gapX(7, -1), above('wms', -1)], [o.cx - 8, above('wms', -1)], [o.cx - 8, o.top])
  link([s.cx, s.bottom], [s.cx, below('sales')], [gapX(7, 1), below('sales')], [gapX(7, 1), above('wms', 1)], [o.cx + 8, above('wms', 1)], [o.cx + 8, o.top])
  // 销售出库 → 应收管理
  const r = N('fin.应收管理')
  link([gapX(7, 1), above('wms', 1)], [gapX(7, 1), above('fin')], [r.cx, above('fin')], [r.cx, r.top])
}
// 采购入库 → 应付管理
{
  const p = N('scm.采购入库'), f = N('fin.应付管理')
  link([p.cx + 8, p.bottom], [p.cx + 8, below('scm', 1)], [gapX(10, -1), below('scm', 1)], [gapX(10, -1), above('fin', 1)], [f.cx, above('fin', 1)], [f.cx, f.top])
}
// 不合格品处理 → 库存冻结；供应商索赔 → 应付（冲减）
{
  const n = N('qms.不合格品处理'), h = N('wms.库存冻结')
  link([n.cx, n.bottom], [n.cx, below('qms')], [h.cx, below('qms')], [h.cx, h.top])
}
// 库存流水 → 成本核算
link(...down('wms.库存流水', 'fin.成本核算'))
// 收款单 → 凭证管理；成本核算 → 期末结账
link(...down('fin.收款单', 'fin.凭证管理'))
link(...down('fin.成本核算', 'fin.期末结账'))
// 付款单 → 凭证（经两行之间的通道）
{
  const p = N('fin.付款单'), v = N('fin.凭证管理'), mid = lane('fin').top + ROW + 2
  link([p.cx, p.bottom], [p.cx, mid], [gapX(6, -2), mid], [gapX(6, -2), v.cy + 12], [v.right, v.cy + 12])
}
// 薪酬核算 → 凭证管理（计提、发放凭证）；项目核算 → 应收管理（开票）
{
  const s = N('hr.薪酬核算'), v = N('fin.凭证管理')
  link([s.cx, s.top], [s.cx, above('hr')], [gapX(5, -1), above('hr')], [gapX(5, -1), v.cy], [v.left, v.cy])
  const p = N('hr.项目核算'), r = N('fin.应收管理'), mid = lane('fin').top + ROW + 14
  link([p.cx, p.top], [p.cx, above('hr', 1)], [gapX(8, -1), above('hr', 1)], [gapX(8, -1), mid], [r.cx, mid], [r.cx, r.bottom])
}

// ---------------------------------------------------------------- 输出
const path = (pts) => 'M' + pts.map(([x, yy]) => `${x} ${yy}`).join(' L')
const arrows = FLOWS.map(([k, a, b]) => {
  const s = N(`${k}.${a}`), t = N(`${k}.${b}`)
  if (s.tileTop !== t.tileTop) throw new Error(`不在同一行：${a} → ${b}`)
  const dir = t.cx > s.cx ? 1 : -1
  return `<path d="${path([[dir > 0 ? s.right : s.left, s.cy], [dir > 0 ? t.left - 4 : t.right + 4, t.cy]])}" class="flow" marker-end="url(#blue)"/>`
}).join('')
const links = LINKS.map((pts) => `<path d="${path(pts.slice(0, -1).concat([[pts.at(-1)[0] + (pts.at(-1)[0] - pts.at(-2)[0] > 0 ? -4 : pts.at(-1)[0] - pts.at(-2)[0] < 0 ? 4 : 0), pts.at(-1)[1] + (pts.at(-1)[1] - pts.at(-2)[1] > 0 ? -4 : pts.at(-1)[1] - pts.at(-2)[1] < 0 ? 4 : 0)]]))}" class="link" marker-end="url(#gray)"/>`).join('')

const laneHtml = LANES.map((l) => `
  <div class="lane" style="top:${l.top}px;height:${l.height}px"></div>
  <div class="lane-title" style="top:${l.top + l.height / 2 - 48}px">
    <div class="lane-icon">${icon(l.icon, 30, '#1677ff')}</div>
    <div class="lane-name">${l.name}</div>
  </div>`).join('')

const nodeHtml = Object.values(nodes).map((n) => `
  <div class="node" style="left:${n.cx - 60}px;top:${n.tileTop}px">
    <div class="tile">${icon(n.icon, 26)}</div>
    <div class="base"></div>
    <div class="label">${n.name}</div>
  </div>`).join('')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #fff; font-family: ${FONT}; }
  #canvas { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; background: #fff; }
  .lane { position: absolute; left: ${LEFT - 12}px; right: ${PAD}px; background: #f6f8fb; border-radius: 12px; }
  .lane-title { position: absolute; left: 0; width: ${LEFT - 24}px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .lane-icon { width: 60px; height: 60px; border-radius: 16px; display: grid; place-items: center; background: linear-gradient(145deg, #e8f1ff, #d4e5ff); box-shadow: 0 6px 14px rgba(22, 119, 255, .16); }
  .lane-name { font-size: 16px; font-weight: 600; color: #1f2937; }
  .node { position: absolute; width: 120px; display: flex; flex-direction: column; align-items: center; }
  .tile { position: relative; z-index: 2; width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; background: linear-gradient(145deg, #4b9bff, #1668e8); box-shadow: 0 8px 16px rgba(22, 104, 232, .28); }
  .base { width: 68px; height: 16px; margin-top: -8px; border-radius: 50%; background: radial-gradient(ellipse at center, #e3e8ef 0%, #eef1f5 60%, rgba(238,241,245,0) 72%); }
  .label { margin-top: 6px; font-size: 14px; color: #374151; white-space: nowrap; }
  svg.lines { position: absolute; inset: 0; z-index: 1; }
  .flow { fill: none; stroke: #5b9dff; stroke-width: 1.6; stroke-dasharray: 5 4; }
  .link { fill: none; stroke: #9aa5b4; stroke-width: 1.4; stroke-dasharray: 5 4; }
  .legend { position: absolute; right: ${PAD}px; bottom: 10px; font-size: 13px; color: #6b7280; display: flex; gap: 28px; }
  .legend span { display: flex; align-items: center; gap: 8px; }
  .legend i { display: inline-block; width: 36px; border-top: 2px dashed; }
  .legend .l-flow { border-color: #5b9dff; }
  .legend .l-link { border-color: #9aa5b4; }
</style></head><body>
<div id="canvas">
  ${laneHtml}
  <svg class="lines" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <marker id="blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#5b9dff"/></marker>
      <marker id="gray" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#9aa5b4"/></marker>
    </defs>
    ${links}${arrows}
  </svg>
  ${nodeHtml}
  <div class="legend"><span><i class="l-flow"></i>模块内业务流程</span><span><i class="l-link"></i>跨模块自动联动（生成单据、更新库存、生成应收应付与凭证）</span></div>
</div></body></html>`

await render(html, new URL('../../docs/public/images/arch/business.png', import.meta.url).pathname)
