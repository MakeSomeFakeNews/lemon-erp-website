import type MarkdownIt from 'markdown-it'

/**
 * 目录树代码块渲染为两列：左列是树形线 + 文件名（等宽，不换行），右列是说明（可换行）。
 * 文档里的目录树写成普通代码块即可（```、```text 或 ```tree，内容含 ├── / └──）：
 *
 *   lemon-erp
 *   ├── settings.gradle      模块清单
 *   │   │                    上一行说明的续行（没有 ├ / └ 的行并入上一行说明）
 *   └── docker               # 说明前的 # 可写可不写
 *
 * 文件名与说明之间至少两个空格。纯文本的代码块中说明一长就要横向滚动，中英文混排时竖线也对不齐。
 */

const TREE = /[├└]──/
const PREFIX = /^[│├└─\s]*/
const GAP = /\s{2,}|\s+#\s/

interface Row {
  prefix: string
  name: string
  desc: string
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function parse(content: string): (Row | null)[] {
  const rows: (Row | null)[] = []
  for (const raw of content.replace(/\s+$/, '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      rows.push(null)
      continue
    }
    const prefix = line.match(PREFIX)![0]
    const rest = line.slice(prefix.length)
    const last = rows[rows.length - 1]
    // 续行：有缩进但没有分支符号，并入上一行的说明
    if (prefix && !/[├└]/.test(prefix) && last) {
      last.desc = last.desc ? `${last.desc} ${rest}` : rest
      continue
    }
    const gap = rest.match(GAP)
    const name = gap ? rest.slice(0, gap.index) : rest
    const desc = gap ? rest.slice(gap.index! + gap[0].length).replace(/^#\s*/, '') : ''
    rows.push({ prefix, name, desc })
  }
  return rows
}

function render(content: string): string {
  const cells = parse(content).map((r) => {
    if (!r) return '<div class="ft-gap"></div>'
    // Markdown 会编译成 Vue 模板，模板编译会把连续空格压成一个（<pre> 除外），前缀中的空格改为不换行空格
    const prefix = r.prefix ? `<span class="ft-prefix">${escape(r.prefix).replace(/ /g, '&nbsp;')}</span>` : ''
    return `<div class="ft-name">${prefix}<span class="ft-file">${escape(r.name)}</span></div>`
      + `<div class="ft-desc">${escape(r.desc)}</div>`
  })
  return `<div class="file-tree">${cells.join('')}</div>\n`
}

export function fileTree(md: MarkdownIt) {
  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const lang = token.info.trim()
    if (['', 'text', 'tree'].includes(lang) && TREE.test(token.content)) return render(token.content)
    return fence(tokens, idx, options, env, self)
  }
}
