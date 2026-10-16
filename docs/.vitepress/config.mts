import { defineConfig, type DefaultTheme } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

const DOCS = path.resolve(__dirname, '..')
const BASE = '/lemon-erp-website/'
const REPO = 'https://github.com/MakeSomeFakeNews/lemon-erp'

/** 用户手册各章节：目录 → 标题，顺序即侧边栏顺序 */
const MANUAL: [string, string][] = [
  ['guide', '入门'],
  ['scm', '供应链管理'],
  ['wms', '仓库管理'],
  ['mes', '生产制造'],
  ['qms', '质量管理'],
  ['fin', '财务管理'],
  ['crm', '客户关系'],
  ['pm', '项目管理'],
  ['hr', '人力资源'],
  ['bi', '商务智能'],
  ['workflow', '流程中心'],
  ['portal', '供应商与经销商门户'],
  ['mobile', '移动作业'],
  ['system', '系统管理'],
  ['monitor', '系统监控'],
  ['faq', '常见问题']
]

/** 开发文档各章节 */
const DEV: [string, string][] = [
  ['start', '开始'],
  ['architecture', '架构设计'],
  ['guide', '开发指南'],
  ['deploy', '部署运维']
]

/** 读取页面 frontmatter 的 order / title（没有 title 时取一级标题） */
function pageMeta(file: string) {
  const src = fs.readFileSync(file, 'utf-8')
  const fm = src.match(/^---\n([\s\S]*?)\n---/)
  const get = (k: string) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '')
  const h1 = src.match(/^#\s+(.+)$/m)?.[1].trim()
  return { order: Number(get('order') ?? 999), title: get('title') ?? h1 ?? path.basename(file, '.md') }
}

/** 按目录生成一个侧边栏分组：index.md 排第一，其余按 frontmatter order 排序 */
function group(root: string, dir: string, text: string, collapsed: boolean): DefaultTheme.SidebarItem | null {
  const abs = path.join(DOCS, root, dir)
  if (!fs.existsSync(abs)) return null
  const items = fs.readdirSync(abs)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, ...pageMeta(path.join(abs, f)) }))
    .sort((a, b) => (a.f === 'index.md' ? -1 : b.f === 'index.md' ? 1 : a.order - b.order))
    .map(({ f, title }) => ({ text: f === 'index.md' && title === text ? '概述' : title, link: `/${root}/${dir}/${f === 'index.md' ? '' : f.replace(/\.md$/, '')}` }))
  return { text, items, collapsed }
}

const sidebarOf = (root: string, sections: [string, string][]) =>
  sections.map(([dir, text], i) => group(root, dir, text, i > 0)).filter((g): g is DefaultTheme.SidebarItem => !!g)

export default defineConfig({
  lang: 'zh-CN',
  title: '柠檬ERP',
  description: '柠檬ERP：Spring Boot 4 + Vue 3 全功能开源 ERP，覆盖供应链、仓储、生产、质量、财务、人力、客户、项目与商务智能',
  base: BASE,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: `${BASE}logo.svg` }],
    ['meta', { name: 'keywords', content: '开源ERP,ERP,MES,WMS,CRM,进销存,Spring Boot,Vue3,柠檬ERP' }]
  ],
  markdown: { image: { lazyLoading: true } },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '用户手册', link: '/manual/guide/', activeMatch: '^/manual/' },
      { text: '开发文档', link: '/dev/start/', activeMatch: '^/dev/' },
      { text: '源码', link: REPO }
    ],
    sidebar: {
      '/manual/': sidebarOf('manual', MANUAL),
      '/dev/': sidebarOf('dev', DEV)
    },
    socialLinks: [{ icon: 'github', link: REPO }],
    outline: { level: [2, 3], label: '本页目录' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '没有找到相关结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
          }
        }
      }
    },
    editLink: { pattern: 'https://github.com/MakeSomeFakeNews/lemon-erp-website/edit/main/docs/:path', text: '在 GitHub 上编辑此页' },
    lastUpdated: { text: '最后更新' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    notFound: { title: '页面不存在', quote: '你访问的页面不存在或已被移动。', linkText: '返回首页' },
    footer: { message: '基于 Apache-2.0 协议开源', copyright: 'Copyright © 2026 柠檬ERP' }
  }
})
