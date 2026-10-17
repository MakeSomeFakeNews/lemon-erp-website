// 技术架构图：访问终端 → 前端 → 接入层 → 后端（业务模块 / 框架层 / 公共层 / 技术底座）→ 数据存储
// 运行：npm run diagrams（输出 docs/public/images/arch/tech.png）
import { icon, render, FONT } from './lib.mjs'

const WIDTH = 1880

const card = (ic, title, desc = '') => `
  <div class="card">
    <div class="card-icon">${icon(ic, 22, '#1677ff')}</div>
    <div><div class="card-title">${title}</div>${desc ? `<div class="card-desc">${desc}</div>` : ''}</div>
  </div>`

const chip = (t) => `<span class="chip">${t}</span>`

const layer = (ic, name, sub, body, cls = '') => `
  <div class="layer ${cls}">
    <div class="layer-title">
      <div class="layer-icon">${icon(ic, 28, '#fff')}</div>
      <div class="layer-name">${name}</div>
      <div class="layer-sub">${sub}</div>
    </div>
    <div class="layer-body">${body}</div>
  </div>`

const arrow = (text) => `<div class="arrow"><span>${text}</span></div>`

const MODULES = [
  ['SettingOutlined', '系统管理', 'lemon-system'], ['DesktopOutlined', '系统监控', 'lemon-monitor'],
  ['NodeIndexOutlined', '流程中心', 'lemon-workflow'], ['HomeOutlined', '工作台', 'lemon-dashboard'],
  ['InboxOutlined', '仓库管理', 'lemon-wms'], ['ShoppingCartOutlined', '供应链', 'lemon-scm'],
  ['BuildOutlined', '生产与质量', 'lemon-mes'], ['PayCircleOutlined', '财务管理', 'lemon-fin'],
  ['SolutionOutlined', '人力资源', 'lemon-hr'], ['IdcardOutlined', '客户关系', 'lemon-crm'],
  ['ProjectOutlined', '项目管理', 'lemon-pm'], ['PieChartOutlined', '商务智能', 'lemon-bi']
]

const FRAMEWORK = [
  ['SafetyCertificateOutlined', '认证与会话', 'JWT + 服务端会话，可强制下线'],
  ['LockOutlined', '权限控制', '菜单 / 按钮 / 接口三级'],
  ['ApartmentOutlined', '数据权限', '按部门 / 本人过滤数据'],
  ['ClusterOutlined', 'SaaS 多租户', '共享库按租户隔离'],
  ['NodeIndexOutlined', '审批流契约', 'FlowApi、审批完成事件'],
  ['ApiOutlined', '模块间契约', '接口与事件，依赖单向'],
  ['DatabaseOutlined', '缓存', 'Redis / 内存可切换'],
  ['ScheduleOutlined', '定时任务', 'Cron、按租户执行'],
  ['HistoryOutlined', '日志审计', '操作日志、登录日志'],
  ['NumberOutlined', '单据编号', '可配置编码规则'],
  ['PrinterOutlined', '单据打印', 'JasperReports 生成 PDF'],
  ['PaperClipOutlined', '文件与附件', '按单据权限下载'],
  ['EyeOutlined', '演示模式', '只读访问'],
  ['GlobalOutlined', 'IP 归属地', 'ip2region 离线库']
]

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #fff; font-family: ${FONT}; }
  #canvas { width: ${WIDTH}px; padding: 28px; background: #fff; display: flex; flex-direction: column; }
  .layer { display: flex; gap: 20px; align-items: stretch; }
  .layer-title { flex: none; width: 150px; min-height: 96px; border-radius: 14px; padding: 14px 10px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(160deg, #4b9bff, #1668e8); color: #fff; box-shadow: 0 8px 18px rgba(22, 104, 232, .22); }
  .layer-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: rgba(255,255,255,.18); }
  .layer-name { font-size: 18px; font-weight: 600; }
  .layer-sub { font-size: 12px; opacity: .85; text-align: center; }
  .layer-body { flex: 1; border-radius: 14px; background: #f6f8fb; padding: 18px; display: flex; flex-direction: column; justify-content: center; gap: 14px; }
  .row { display: grid; gap: 12px; }
  .card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; background: #fff; border: 1px solid #e6ebf2; }
  .card-icon { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: #eaf2ff; }
  .card-title { font-size: 15px; font-weight: 600; color: #1f2937; }
  .card-desc { margin-top: 2px; font-size: 12px; color: #6b7280; white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .chip { padding: 8px 16px; border-radius: 8px; background: #fff; border: 1px solid #e6ebf2; font-size: 14px; color: #374151; font-weight: 500; }
  .group { border-radius: 12px; border: 1px dashed #b9c7da; padding: 14px; background: rgba(255,255,255,.6); }
  .group-title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
  .group-title b { font-size: 15px; color: #1668e8; }
  .group-title span { font-size: 12px; color: #6b7280; }
  .arrow { position: relative; height: 34px; margin-left: 170px; display: flex; align-items: center; justify-content: center; }
  .arrow::before { content: ''; position: absolute; left: 50%; top: 4px; bottom: 4px; border-left: 2px dashed #9aa5b4; }
  .arrow::after { content: ''; position: absolute; left: calc(50% - 6px); bottom: 0; border: 6px solid transparent; border-top: 8px solid #9aa5b4; border-bottom: 0; }
  .arrow span { position: relative; left: 90px; font-size: 12px; color: #6b7280; background: #fff; padding: 0 6px; }
  .backend .layer-title { background: linear-gradient(160deg, #36b37e, #1f9d6a); box-shadow: 0 8px 18px rgba(31, 157, 106, .22); }
  .backend .group-title b { color: #1f9d6a; }
  .data .layer-title { background: linear-gradient(160deg, #fab005, #f08c00); box-shadow: 0 8px 18px rgba(240, 140, 0, .22); }
</style></head><body>
<div id="canvas">
  ${layer('TeamOutlined', '访问终端', '浏览器即可使用', `<div class="row" style="grid-template-columns: repeat(4, 1fr)">
    ${card('DesktopOutlined', 'PC 浏览器', '内部员工使用全部业务功能')}
    ${card('MobileOutlined', '手机 / PDA', '扫码收货、上架、拣货、盘点')}
    ${card('ShopOutlined', '供应商门户', '订单确认、送货、对账、投标')}
    ${card('IdcardOutlined', '经销商门户', '在线订货、渠道库存上报')}
  </div>`)}
  ${arrow('HTTPS')}
  ${layer('AppstoreOutlined', '前端', 'lemon-web', `<div class="chips">
    ${['Vue 3.5', 'Vite 7', 'Ant Design Vue 4', 'Pinia', 'Vue Router（按菜单动态注册路由）', 'Axios', 'ECharts 5', '按钮权限 v-perm', '多标签页', '深色模式', '移动端布局'].map(chip).join('')}
  </div>`)}
  ${arrow('/api 反向代理')}
  ${layer('CloudServerOutlined', '接入层', 'Nginx', `<div class="chips">
    ${['静态资源托管', '/api 反向代理到后端', 'HTTPS 证书', 'X-Forwarded-For 真实 IP', 'Gzip 压缩'].map(chip).join('')}
  </div>`)}
  ${arrow('REST / JSON')}
  ${layer('DeploymentUnitOutlined', '后端', 'lemon-admin<br/>Spring Boot 可执行 jar', `
    <div class="group">
      <div class="group-title"><b>业务模块</b><span>lemon-modules，按业务域拆分，依赖单向</span></div>
      <div class="row" style="grid-template-columns: repeat(6, 1fr)">
        ${MODULES.map(([ic, t, d]) => card(ic, t, d)).join('')}
      </div>
    </div>
    <div class="group">
      <div class="group-title"><b>框架层</b><span>lemon-framework，安全、数据隔离与各模块共用的基础能力</span></div>
      <div class="row" style="grid-template-columns: repeat(7, 1fr)">
        ${FRAMEWORK.map(([ic, t, d]) => card(ic, t, d)).join('')}
      </div>
    </div>
    <div class="group">
      <div class="group-title"><b>公共层</b><span>lemon-common</span></div>
      <div class="chips">${['统一返回 R', '全局异常处理', '基础实体与树形实体', '校验分组', '分页结果', '工具类'].map(chip).join('')}</div>
    </div>
    <div class="group">
      <div class="group-title"><b>技术底座</b></div>
      <div class="chips">${['Java 17', 'Spring Boot 4.1', 'Spring Security', 'MyBatis-Plus 3.5', 'Flowable 8', 'JasperReports 7', 'Jackson', 'OSHI', 'ip2region', 'Gradle 多模块'].map(chip).join('')}</div>
    </div>`, 'backend')}
  ${arrow('JDBC / Redis 协议 / 文件读写')}
  ${layer('HddOutlined', '数据存储', '', `<div class="row" style="grid-template-columns: repeat(3, 1fr)">
    ${card('DatabaseOutlined', 'MySQL 8', '业务数据、流程引擎表（ACT_*）')}
    ${card('ThunderboltOutlined', 'Redis', '登录会话、权限、字典、参数、验证码与登录失败计数')}
    ${card('FolderOpenOutlined', '文件存储', '头像等公开文件、业务附件')}
  </div>`, 'data')}
</div></body></html>`

await render(html, new URL('../../docs/public/images/arch/tech.png', import.meta.url).pathname)
