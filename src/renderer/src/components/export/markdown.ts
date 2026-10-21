// Rendu Markdown minimal et sûr pour les notes de l'enquête dans le rapport :
// tout le texte est échappé, seuls les liens http(s) sont conservés.

import { escapeHtml, safeHttpUrl } from './format'

const TRAILING = /[.,;:!?)\]]+$/

function inline(src: string): string {
  const slots: string[] = []
  const slot = (html: string): string => `\u0001${slots.push(html) - 1}\u0001`
  let s = src.replace(/[\u0000\u0001]/g, '')
  s = s.replace(/`([^`]+)`/g, (_, code: string) => slot(`<code>${escapeHtml(code)}</code>`))
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const href = safeHttpUrl(url)
    return href ? slot(`<a href="${escapeHtml(href)}">${emphasis(escapeHtml(text))}</a>`) : m
  })
  s = s.replace(/https?:\/\/[^\s<>"'\u0001]+/g, (m) => {
    const trail = TRAILING.exec(m)?.[0] ?? ''
    const url = trail ? m.slice(0, -trail.length) : m
    const href = safeHttpUrl(url)
    return (href ? slot(`<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`) : url) + trail
  })
  s = emphasis(escapeHtml(s))
  return s.replace(/\u0001(\d+)\u0001/g, (_, i: string) => slots[Number(i)] ?? '')
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
}

function listItem(text: string): string {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(text)
  if (task) return `<li class="task">${task[1] === ' ' ? '☐' : '☑'} ${inline(task[2])}</li>`
  return `<li>${inline(text)}</li>`
}

/** Convertit du Markdown en HTML. `headingBase` fixe le niveau du titre `#` (3 → `<h3>`). */
export function renderMarkdown(md: string, headingBase = 3): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null

  const flushPara = (): void => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`)
    para = []
  }
  const flushList = (): void => {
    if (list) out.push(`<${list.tag}>${list.items.map(listItem).join('')}</${list.tag}>`)
    list = null
  }
  const flush = (): void => {
    flushPara()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++])
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flush()
      const level = Math.min(6, headingBase + heading[1].length - 1)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push('<hr>')
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flush()
      const body: string[] = [quote[1]]
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) body.push(lines[++i].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${body.map(inline).join('<br>')}</blockquote>`)
      continue
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const tag = ul ? 'ul' : 'ol'
      if (!list || list.tag !== tag) {
        flushList()
        list = { tag, items: [] }
      }
      list.items.push((ul ?? ol)![1])
      continue
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flush()
  return out.join('\n')
}
