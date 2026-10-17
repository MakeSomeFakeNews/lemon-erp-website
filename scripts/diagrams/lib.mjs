// 架构图公共方法：Ant Design 图标转 SVG、用本机 Chrome 把 HTML 渲染为 PNG
import icons from '@ant-design/icons-svg'
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

/** Ant Design 图标（与系统界面一致）转为内联 SVG */
export function icon(name, size = 24, color = '#fff') {
  const def = icons[name]
  if (!def) throw new Error(`图标不存在：${name}`)
  const render = (node) => {
    const attrs = Object.entries(node.attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ')
    return `<${node.tag} ${attrs}>${(node.children || []).map(render).join('')}</${node.tag}>`
  }
  const { attrs, children } = def.icon
  return `<svg viewBox="${attrs.viewBox}" width="${size}" height="${size}" fill="${color}">${children.map(render).join('')}</svg>`
}

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find((p) => fs.existsSync(p))

/** 渲染 HTML 为 PNG（2 倍分辨率），宽度取页面中 #canvas 的尺寸 */
export async function render(html, out) {
  if (!CHROME) throw new Error('找不到 Chrome，请设置环境变量 CHROME_PATH')
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 2400, height: 1200, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load' })
    const el = await page.$('#canvas')
    await el.screenshot({ path: out, omitBackground: false })
    console.log('已生成', out)
  } finally {
    await browser.close()
  }
}

export const FONT = `-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif`
