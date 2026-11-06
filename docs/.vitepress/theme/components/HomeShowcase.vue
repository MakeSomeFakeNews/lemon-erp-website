<script setup lang="ts">
import { ref, computed } from 'vue'
import { withBase } from 'vitepress'

const STATS = [
  { value: '14', label: '大业务模块' },
  { value: '170', label: '功能页面' },
  { value: '20+', label: '可接入审批的业务单据' },
  { value: '100%', label: '开源，无功能限制' }
]

const MODULES = [
  {
    key: 'scm', name: '供应链', image: 'scm-purchase-detail', link: '/manual/scm/',
    title: '采购、销售与往来单位全流程',
    points: ['请购、询价比价、招标采购、采购合同、采购订单到入库退货', '报价、客户专属价与价格控制、促销返利、销售提成、销售订单到发货出库', '订单审核接入审批，入出库自动生成仓库单据并回写进度', '供应商门户与经销商门户，在线确认订单、送货、对账']
  },
  {
    key: 'wms', name: '仓库', image: 'wms-stock', link: '/manual/wms/',
    title: '批次、序列号与库位精细化管理',
    points: ['入库、出库、调拨、盘点、组装拆卸，确认后实时更新库存', '批次与序列号全程追踪，临期与安全库存预警', '多规格物料（SKU 与尺码矩阵）、收发存汇总、库存预留与冻结', '手机 / PDA 扫码收货、上架、拣货、盘点']
  },
  {
    key: 'mes', name: '生产', image: 'mes-mrp', link: '/manual/mes/',
    title: '从主生产计划到完工入库',
    points: ['多版本 BOM 与工艺路线、工程变更、技术文档', 'MRP 多级展开计算净需求，一键下达工单与采购', '齐套分析、领料超领控制、补料、报工、完工入库', '设备台账与维护、设备 OEE、模具工装']
  },
  {
    key: 'qms', name: '质量', image: 'qms-spc', link: '/manual/qms/',
    title: '检验、不良处理与质量分析闭环',
    points: ['检验方案支持 GB/T 2828.1 AQL 抽样', '来料、过程、成品、首件检验，逐项录入自动判定', '不合格品 MRB 评审，联动冻结、报废、返工；8D 纠正预防', '合格率趋势、不良柏拉图、SPC 控制图与 Cp / Cpk']
  },
  {
    key: 'fin', name: '财务', image: 'fin-report', link: '/manual/fin/',
    title: '业财一体化，账实一致',
    points: ['凭证、账簿、三大报表、期末结账，自动凭证科目可配置', '应收应付由出入库自动生成，收付款核销与账龄分析', '成本核算支持月末加权、移动加权、先进先出，标准成本与差异分析', '出纳日记账与资金日报、数电票导入勾稽、往来对账单、库龄分析']
  },
  {
    key: 'crm', name: '客户', image: 'crm-opportunity', link: '/manual/crm/',
    title: '线索到回款的客户经营',
    points: ['客户公海池，领取、分配、自动回收', '线索转化、销售机会阶段看板、赢单生成销售订单', '服务工单处理时限、保修判断与满意度', '销售漏斗、RFM 分层、销售排行分析']
  },
  {
    key: 'pm', name: '项目', image: 'pm-gantt', link: '/manual/pm/',
    title: '计划、工时、成本与收入核算',
    points: ['WBS 任务树、前置任务与甘特图', '成员投入比例与资源负荷分析', '工时填报审批、项目费用与领料', '收款计划、完工百分比确认收入、挣值分析']
  },
  {
    key: 'hr', name: '人力', image: 'hr-payroll', link: '/manual/hr/',
    title: '从招聘入职到月度发薪',
    points: ['员工档案与异动、劳动合同、员工自助', '招聘需求审批、候选人、面试、录用入职', '班次打卡、考勤汇总、请假加班审批与假期余额', '工资表自动计算考勤扣款、社保公积金、个税，生成凭证']
  },
  {
    key: 'bi', name: '商务智能', image: 'bi-cockpit', link: '/manual/bi/',
    title: '数据仓库与经营决策',
    points: ['经营驾驶舱一屏掌握销售、利润、库存、生产', '多维分析透视、筛选、下钻，保存为自定义报表', '自定义仪表盘并共享给团队', '销售预测、ABC 分析、呆滞物料与预警规则']
  },
  {
    key: 'ai', name: 'AI', image: 'ai-settings', link: '/manual/ai/',
    title: '接入国产大模型的智能助手',
    points: ['AI 问数：用自然语言提问，在提问人的权限和数据权限范围内查询业务数据并回答', '智能录入：上传报价单、发票等图片或文件，识别后预填采购订单、销售订单、报销单等', '数据整理：检查物料、客户、供应商资料的重复和不规范，给出修改建议', '智能报告：按周 / 月生成经营分析报告；支持 DeepSeek、通义千问、智谱 GLM、Kimi 等']
  },
  {
    key: 'screen', name: '数据大屏', image: 'screen-factory', link: '/manual/bi/screen',
    title: '车间、仓库、销售、质量四块大屏',
    points: ['生产车间：今日产量、良品率、在制工单进度、设备状态、实时报工', '仓储物流：出入库趋势、待发货、各仓库存、库存预警', '销售经营与质量管理：订单回款、客户产品排行、合格率与不良柏拉图', '多屏轮播、按工作中心显示，投屏链接免登录直接上电视']
  },
  {
    key: 'workflow', name: '审批流', image: 'wf-designer', link: '/manual/workflow/',
    title: '仿钉钉的可视化流程设计器',
    points: ['审批人、抄送、条件分支、并行分支，拖拽式设计', '依次审批、会签、或签，多种审批人类型', '同意、拒绝、转交、撤回，审批记录与进度图', '采购、销售、请假、报销等业务单据一键接入，待办推送到钉钉、企业微信、飞书']
  },
  {
    key: 'mobile', name: '移动端', image: 'miniapp', link: '/manual/miniapp/',
    title: '微信小程序与手机 / PDA 移动作业',
    points: ['微信小程序：审批、消息、员工自助、销售外勤、仓库扫码与生产报工', '审批提醒通过微信订阅消息推送，随时随地处理', '手机浏览器 / PDA：扫码收货、上架、拣货、盘点，适配工业扫码枪', '与电脑端共用权限和数据，实时同步']
  }
]

const COMPARE = [
  ['费用', '按用户数、模块或年费收费，实施费另计', '开源版免费，常用的高级功能需要购买商业版', '完全免费，没有付费版本'],
  ['功能范围', '按购买的模块开通', '开源版多为进销存等基础功能，生产、财务等常在商业版中', '全部 14 大模块开源，含生产、质量、财务、BI、AI'],
  ['源码', '不提供', '只开放部分源码', '全部源码开放，可以审计、修改'],
  ['数据归属', 'SaaS 版数据在厂商服务器', '自己部署', '私有化部署，数据在自己的服务器上'],
  ['用户数、单据量', '按授权限制', '部分有限制', '没有授权码，系统本身不限制'],
  ['二次开发', '依赖厂商或认证伙伴', '可以，但闭源部分改不了', '完全自主，有完整的开发文档和示例']
]

const ADVANTAGES = [
  ['省钱', '软件本身零费用，没有按用户、按模块、按年收费，企业只需要一台服务器；软件服务商用它交付项目，不用再付授权费'],
  ['一套系统管全业务', '采购、销售、仓储、生产、质量、财务、人力、客户、项目、BI 都在一个系统里，不用买多套软件再做接口集成，数据天然一致'],
  ['业财一体，账实相符', '出入库自动更新库存、生成应收应付，业务单据一键生成凭证；生产领料、完工入库自动进入成本核算，月末结账一键完成'],
  ['贴合国内企业', '小企业会计准则三大报表，数电票导入勾稽，个税累计预扣与专项附加扣除、社保公积金，钉钉 / 企业微信 / 飞书、微信小程序，国产大模型'],
  ['数据自主可控', '私有化部署在自己的服务器或内网，源码完全开放可审计，不依赖任何厂商的云服务'],
  ['拿来就能用', 'Docker 一条命令启动；内置示例基础资料、按行业模板开通功能、期初启用向导；中英文界面；用户手册覆盖每个页面的操作'],
  ['容易二次开发', 'Spring Boot 4 + Vue 3 主流技术栈，Gradle 多模块、依赖单向，审批、状态流转、数据权限、明细行都有公共组件'],
  ['多端协同', '电脑浏览器处理全部业务，微信小程序审批和外勤，手机 / PDA 扫码收发货和盘点，数据大屏投屏到车间和仓库'],
  ['安全可靠', '菜单 / 按钮 / 接口三级权限和五种数据权限，操作日志与登录日志，强制下线，登录验证码与密码策略，审批留痕'],
  ['可以做成 SaaS', '内置多租户、租户套餐和行业模板，软件服务商可以直接用它为多家客户提供在线 ERP 服务']
]

const AUDIENCE = [
  ['中小制造企业', '从销售订单、MRP、生产工单、质量检验到成本核算的完整闭环，车间扫码报工、数据大屏'],
  ['商贸、批发零售企业', '采购、销售、库存、多价格体系、客户价格等级、进销存报表、应收应付与资金管理'],
  ['项目型、服务型企业', '项目计划与工时、成本核算、客户关系与服务工单、费用报销与审批'],
  ['软件服务商、实施商', '免授权费的 ERP 底座，可二次开发后交付客户，或用多租户做成 SaaS 服务'],
  ['开发者、学生', '完整的企业级 Java 项目：多模块架构、权限与多租户、工作流、AI 集成、Docker 部署']
]

const active = ref(MODULES[0].key)
const current = computed(() => MODULES.find((m) => m.key === active.value)!)
const img = (name: string) => withBase(`/images/home/${name}.jpg`)

const STACK = ['Java 17', 'Spring Boot 4.1', 'Spring Security', 'MyBatis-Plus 3.5', 'Flowable 8', 'Redis', 'MySQL 8', 'Vue 3.5', 'Vite 7', 'Ant Design Vue 4', 'Pinia', 'ECharts 5']
</script>

<template>
  <div class="home">
    <section class="shot-hero">
      <div class="browser">
        <div class="bar"><i /><i /><i /></div>
        <img :src="img('dashboard')" alt="柠檬ERP 工作台" />
      </div>
    </section>

    <section class="stats">
      <div v-for="s in STATS" :key="s.label" class="stat">
        <div class="value">{{ s.value }}</div>
        <div class="label">{{ s.label }}</div>
      </div>
    </section>

    <section class="block demo">
      <h2>在线体验</h2>
      <p class="sub">无需安装，打开浏览器即可体验全部功能（演示环境只能查看，不能修改数据）</p>
      <div class="demo-card">
        <div class="demo-info">
          <div class="row"><span>演示地址</span><a href="https://erp.dqq.me" target="_blank" rel="noreferrer">https://erp.dqq.me</a></div>
          <div class="row"><span>租户</span><b>柠檬科技</b></div>
          <div class="row"><span>账号</span><b>admin</b> / <b>admin123</b>（超级管理员）</div>
          <div class="row"><span></span><b>test</b> / <b>admin123</b>（普通用户，只读）</div>
        </div>
        <a class="btn primary" href="https://erp.dqq.me" target="_blank" rel="noreferrer">立即体验</a>
      </div>
    </section>

    <section id="why" class="block">
      <h2>为什么选择柠檬ERP</h2>
      <p class="sub">同样是 ERP，柠檬ERP 不收一分钱授权费，也不把核心功能藏在商业版里</p>
      <div class="compare-wrap">
        <table class="compare">
          <thead><tr><th></th><th>商业 ERP 软件</th><th>「开源版 + 商业版」的开源 ERP</th><th class="me">柠檬ERP</th></tr></thead>
          <tbody>
            <tr v-for="r in COMPARE" :key="r[0]"><th>{{ r[0] }}</th><td>{{ r[1] }}</td><td>{{ r[2] }}</td><td class="me">{{ r[3] }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="block">
      <h2>核心优势</h2>
      <p class="sub">省钱、全面、自主可控，同时足够好用、足够好改</p>
      <div class="adv">
        <div v-for="(a, i) in ADVANTAGES" :key="a[0]" class="adv-item">
          <span class="no">{{ String(i + 1).padStart(2, '0') }}</span>
          <h4>{{ a[0] }}</h4>
          <p>{{ a[1] }}</p>
        </div>
      </div>
    </section>

    <section class="block">
      <h2>适合谁使用</h2>
      <p class="sub">从几十人的小工厂到为多家客户服务的软件公司，都能找到合适的用法</p>
      <div class="aud">
        <div v-for="a in AUDIENCE" :key="a[0]" class="aud-item"><h4>{{ a[0] }}</h4><p>{{ a[1] }}</p></div>
      </div>
    </section>

    <section class="block">
      <h2>覆盖企业经营全流程</h2>
      <p class="sub">一套系统打通采购、仓储、生产、质量、销售、财务、人力、客户与项目，业务单据自动联动</p>
      <div class="tabs">
        <button v-for="m in MODULES" :key="m.key" :class="{ on: m.key === active }" @click="active = m.key">{{ m.name }}</button>
      </div>
      <div class="module">
        <div class="desc">
          <h3>{{ current.title }}</h3>
          <ul>
            <li v-for="p in current.points" :key="p">{{ p }}</li>
          </ul>
          <a class="more" :href="withBase(current.link)">查看使用手册 →</a>
        </div>
        <div class="pic">
          <img :src="img(current.image)" :alt="current.title" />
        </div>
      </div>
    </section>

    <section class="block">
      <h2>业务全景</h2>
      <p class="sub">九大业务域、百余个功能节点，单据在模块之间自动流转，一次录入、处处可用</p>
      <a class="arch" :href="withBase('/images/arch/business.png')" target="_blank" rel="noreferrer">
        <img :src="withBase('/images/arch/business.png')" alt="柠檬ERP 业务架构图" />
      </a>
    </section>

    <section class="block">
      <h2>舒适的使用体验</h2>
      <p class="sub">顶部模块导航、多标签页、全局菜单搜索，支持深色模式和中英文界面切换</p>
      <div class="browser dark-shot">
        <div class="bar"><i /><i /><i /></div>
        <img :src="img('dashboard-dark')" alt="深色模式" />
      </div>
    </section>

    <section class="block">
      <h2>主流技术栈</h2>
      <p class="sub">前后端分离，Gradle 多模块、单向依赖，代码结构清晰，便于二次开发</p>
      <div class="stack">
        <span v-for="t in STACK" :key="t">{{ t }}</span>
      </div>
    </section>

    <section id="open-source" class="block">
      <h2>真正 100% 开源</h2>
      <p class="sub">不是「开源版 + 商业版」，你在演示环境和文档中看到的全部功能，都在 GitHub 上完整开源</p>
      <div class="oss">
        <div class="oss-item"><h4>全部功能开源</h4><p>供应链、仓储、生产、质量、财务、人力、客户、项目、商务智能、AI，没有任何模块收费或闭源</p></div>
        <div class="oss-item"><h4>没有功能限制</h4><p>没有授权码和激活，系统本身不限制用户数、租户数和单据量（SaaS 模式下租户的账号上限由你自己设置），也没有隐藏的高级功能</p></div>
        <div class="oss-item"><h4>免费商用</h4><p>基于 Apache-2.0 协议，个人与企业都可以免费使用、修改、二次开发和商业部署，保留版权声明即可</p></div>
        <div class="oss-item"><h4>文档同样开放</h4><p>250 多页用户手册和开发文档、Docker 一键部署脚本全部公开，可以独立完成部署和二次开发</p></div>
      </div>
    </section>

    <section class="block cta">
      <h2>三步运行柠檬ERP</h2>
      <div class="steps">
        <div class="step"><b>1</b><div><h4>初始化数据库</h4><code>mysql lemon_erp &lt; sql/init.sql</code></div></div>
        <div class="step"><b>2</b><div><h4>启动后端</h4><code>./gradlew bootRun</code></div></div>
        <div class="step"><b>3</b><div><h4>启动前端</h4><code>cd lemon-web &amp;&amp; npm run dev</code></div></div>
      </div>
      <div class="docker">
        <span>或者使用 Docker 一键部署</span>
        <code>cd docker &amp;&amp; cp .env.example .env &amp;&amp; docker compose up -d --build</code>
        <a :href="withBase('/dev/deploy/docker')">部署说明 →</a>
      </div>
      <div class="actions">
        <a class="btn primary" href="https://erp.dqq.me" target="_blank" rel="noreferrer">在线演示</a>
        <a class="btn" :href="withBase('/dev/start/')">阅读开发文档</a>
        <a class="btn" href="https://github.com/MakeSomeFakeNews/lemon-erp" target="_blank" rel="noreferrer">GitHub 源码</a>
      </div>
    </section>

    <section id="contact" class="block">
      <h2>联系我们</h2>
      <p class="sub">商务合作、定制开发、部署实施或使用中遇到问题，欢迎联系</p>
      <div class="contact">
        <div class="contact-item"><span>电话</span><b>17701123202</b></div>
        <div class="contact-item"><span>微信</span><b>BG7LIF</b></div>
        <div class="contact-item"><span>邮箱</span><a href="mailto:zmissu@163.com"><b>zmissu@163.com</b></a></div>
        <div class="contact-item"><span>问题反馈</span><a href="https://github.com/MakeSomeFakeNews/lemon-erp/issues" target="_blank" rel="noreferrer"><b>GitHub Issues</b></a></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home { max-width: 1152px; margin: 0 auto; padding: 0 24px 96px; }
.browser { border-radius: 12px; overflow: hidden; border: 1px solid var(--vp-c-divider); box-shadow: 0 24px 64px rgba(15, 23, 42, 0.14); background: var(--vp-c-bg); }
.browser .bar { height: 30px; display: flex; align-items: center; gap: 7px; padding: 0 14px; background: var(--vp-c-bg-soft); border-bottom: 1px solid var(--vp-c-divider); }
.browser .bar i { width: 11px; height: 11px; border-radius: 50%; background: #ff5f57; }
.browser .bar i:nth-child(2) { background: #febc2e; }
.browser .bar i:nth-child(3) { background: #28c840; }
.browser img { display: block; width: 100%; }
.shot-hero { margin-top: 64px; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 56px 0 0; }
.stat { text-align: center; padding: 24px 12px; border-radius: 12px; background: var(--vp-c-bg-soft); }
.stat .value { font-size: 36px; font-weight: 700; line-height: 1.2; background: linear-gradient(120deg, #f59f00, #40c057); -webkit-background-clip: text; background-clip: text; color: transparent; }
.stat .label { margin-top: 6px; color: var(--vp-c-text-2); font-size: 14px; }

.block { margin-top: 96px; }
.block h2 { text-align: center; font-size: 30px; font-weight: 700; letter-spacing: -0.01em; margin: 0; padding: 0; border: 0; line-height: 1.3; }
.block .sub { text-align: center; color: var(--vp-c-text-2); margin: 12px auto 32px; max-width: 760px; }
.home a { text-decoration: none; }
.home h3, .home h4 { margin: 0; padding: 0; border: 0; }
.module ul { margin: 0; }

.tabs { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-bottom: 28px; }
.tabs button { padding: 7px 18px; border-radius: 20px; border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-2); font-size: 14px; transition: all .2s; }
.tabs button:hover { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); }
.tabs button.on { background: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); color: #fff; }

.module { display: grid; grid-template-columns: 340px 1fr; gap: 40px; align-items: center; padding: 32px; border-radius: 16px; background: var(--vp-c-bg-soft); }
.module h3 { font-size: 22px; font-weight: 600; margin-bottom: 16px; }
.module ul { padding-left: 0; list-style: none; }
.module li { position: relative; padding-left: 18px; margin: 10px 0; color: var(--vp-c-text-2); line-height: 1.7; font-size: 15px; }
.module li::before { content: ''; position: absolute; left: 0; top: 10px; width: 7px; height: 7px; border-radius: 50%; background: linear-gradient(135deg, #fab005, #40c057); }
.module .more { display: inline-block; margin-top: 12px; font-weight: 500; color: var(--vp-c-brand-1); }
.module .pic img { display: block; width: 100%; border-radius: 10px; border: 1px solid var(--vp-c-divider); box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12); }

.demo-card { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; max-width: 760px; margin: 0 auto; padding: 28px 32px; border-radius: 16px; background: linear-gradient(135deg, rgba(255, 212, 59, 0.16), rgba(105, 219, 124, 0.14)); border: 1px solid var(--vp-c-divider); }
.demo-info .row { display: flex; gap: 12px; margin: 6px 0; line-height: 1.7; }
.demo-info .row span { flex: none; width: 64px; color: var(--vp-c-text-2); }
.demo-info a { color: var(--vp-c-brand-1); font-weight: 500; }
.arch { display: block; padding: 16px; border-radius: 16px; border: 1px solid var(--vp-c-divider); background: #fff; }
.arch img { display: block; width: 100%; margin: 0; border: 0; border-radius: 0; box-shadow: none; }
.stack { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }
.stack span { padding: 10px 20px; border-radius: 10px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft); font-weight: 500; }

.compare-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid var(--vp-c-divider); }
.home .compare { display: table; width: 100%; margin: 0; border-collapse: collapse; font-size: 14px; }
.compare th, .compare td { padding: 14px 16px; border: 0; border-bottom: 1px solid var(--vp-c-divider); text-align: left; line-height: 1.6; vertical-align: top; }
.compare tr { background: transparent !important; border: 0; }
.compare tbody tr:last-child th, .compare tbody tr:last-child td { border-bottom: 0; }
.compare thead th { background: var(--vp-c-bg-soft); font-weight: 600; white-space: nowrap; }
.compare tbody th { width: 120px; white-space: nowrap; font-weight: 600; color: var(--vp-c-text-1); }
.compare td { color: var(--vp-c-text-2); }
.compare .me { background: linear-gradient(160deg, rgba(255, 212, 59, 0.16), rgba(105, 219, 124, 0.14)); color: var(--vp-c-text-1); font-weight: 600; }
.adv { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
.adv-item { padding: 20px 18px; border-radius: 14px; background: var(--vp-c-bg-soft); }
.adv-item .no { display: block; font-size: 22px; font-weight: 700; line-height: 1; margin-bottom: 12px; background: linear-gradient(120deg, #f59f00, #40c057); -webkit-background-clip: text; background-clip: text; color: transparent; }
.adv-item h4 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.adv-item p, .aud-item p { margin: 0; font-size: 13px; line-height: 1.7; color: var(--vp-c-text-2); }
.aud { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
.aud-item { padding: 20px 18px; border-radius: 14px; border: 1px solid var(--vp-c-divider); border-top: 3px solid var(--vp-c-brand-1); }
.aud-item h4 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.oss { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.oss-item { padding: 22px 20px; border-radius: 14px; background: linear-gradient(160deg, rgba(255, 212, 59, 0.14), rgba(105, 219, 124, 0.12)); border: 1px solid var(--vp-c-divider); }
.oss-item h4 { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
.oss-item p { margin: 0; font-size: 14px; line-height: 1.7; color: var(--vp-c-text-2); }
.contact { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; max-width: 960px; margin: 0 auto; }
.contact-item { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 22px 12px; border-radius: 14px; background: var(--vp-c-bg-soft); }
.contact-item span { font-size: 13px; color: var(--vp-c-text-2); }
.contact-item b { font-size: 17px; color: var(--vp-c-text-1); }
.contact-item a b { color: var(--vp-c-brand-1); }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 32px; }
.step { display: flex; gap: 14px; padding: 20px; border-radius: 12px; background: var(--vp-c-bg-soft); }
.step b { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--vp-c-brand-1); color: #fff; }
.step h4 { font-weight: 600; margin-bottom: 8px; }
.step code { font-size: 13px; padding: 3px 8px; border-radius: 6px; background: var(--vp-c-default-soft); }
.docker { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; margin-top: 20px; color: var(--vp-c-text-2); font-size: 14px; }
.docker code { font-size: 13px; padding: 4px 10px; border-radius: 6px; background: var(--vp-c-default-soft); }
.docker a { color: var(--vp-c-brand-1); font-weight: 500; }
.actions { display: flex; justify-content: center; gap: 12px; margin-top: 36px; }
.btn { padding: 10px 24px; border-radius: 20px; border: 1px solid var(--vp-c-divider); font-weight: 600; }
.btn { color: var(--vp-c-text-1); }
.btn.primary { background: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); color: #fff; }

@media (max-width: 960px) {
  .module { grid-template-columns: 1fr; padding: 20px; }
  .stats, .steps, .oss, .contact, .adv, .aud { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .stats, .steps, .oss, .contact, .adv, .aud { grid-template-columns: 1fr; }
  .block h2 { font-size: 24px; }
}
</style>
