<script setup lang="ts">
import { ref, computed } from 'vue'
import { withBase } from 'vitepress'

const STATS = [
  { value: '13', label: '大业务模块' },
  { value: '150+', label: '功能页面' },
  { value: '20+', label: '可接入审批的业务单据' },
  { value: '100%', label: '开源，可免费商用' }
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
    key: 'workflow', name: '审批流', image: 'wf-designer', link: '/manual/workflow/',
    title: '仿钉钉的可视化流程设计器',
    points: ['审批人、抄送、条件分支、并行分支，拖拽式设计', '依次审批、会签、或签，多种审批人类型', '同意、拒绝、转交、撤回，审批记录与进度图', '采购、销售、请假、报销等业务单据一键接入']
  },
  {
    key: 'mobile', name: '移动端', image: 'mobile', link: '/manual/mobile/',
    title: '手机与 PDA 移动作业',
    points: ['扫码收货、上架、拣货、盘点', '适配手机与工业 PDA 扫码枪', '与后台单据实时同步', '无需安装 App，浏览器即可使用']
  }
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
      <p class="sub">顶部模块导航、多标签页、全局菜单搜索，支持深色模式</p>
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

    <section class="block cta">
      <h2>三步运行柠檬ERP</h2>
      <div class="steps">
        <div class="step"><b>1</b><div><h4>初始化数据库</h4><code>mysql lemon_erp &lt; sql/init.sql</code></div></div>
        <div class="step"><b>2</b><div><h4>启动后端</h4><code>./gradlew bootRun</code></div></div>
        <div class="step"><b>3</b><div><h4>启动前端</h4><code>cd lemon-web &amp;&amp; npm run dev</code></div></div>
      </div>
      <div class="actions">
        <a class="btn primary" href="https://erp.dqq.me" target="_blank" rel="noreferrer">在线演示</a>
        <a class="btn" :href="withBase('/dev/start/')">阅读开发文档</a>
        <a class="btn" href="https://github.com/MakeSomeFakeNews/lemon-erp" target="_blank" rel="noreferrer">GitHub 源码</a>
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

.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 32px; }
.step { display: flex; gap: 14px; padding: 20px; border-radius: 12px; background: var(--vp-c-bg-soft); }
.step b { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; background: var(--vp-c-brand-1); color: #fff; }
.step h4 { font-weight: 600; margin-bottom: 8px; }
.step code { font-size: 13px; padding: 3px 8px; border-radius: 6px; background: var(--vp-c-default-soft); }
.actions { display: flex; justify-content: center; gap: 12px; margin-top: 36px; }
.btn { padding: 10px 24px; border-radius: 20px; border: 1px solid var(--vp-c-divider); font-weight: 600; }
.btn { color: var(--vp-c-text-1); }
.btn.primary { background: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); color: #fff; }

@media (max-width: 960px) {
  .module { grid-template-columns: 1fr; padding: 20px; }
  .stats, .steps { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .stats, .steps { grid-template-columns: 1fr; }
  .block h2 { font-size: 24px; }
}
</style>
