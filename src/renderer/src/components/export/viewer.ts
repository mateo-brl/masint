// Export HTML interactif : un fichier autonome (aucune ressource externe) qui affiche
// le graphe aux positions du canevas, avec déplacement, zoom, recherche et fiches.

import type { GraphEdge, GraphNode, Investigation, Lang, ModuleInfo, NodeKind } from '@shared/types'
import { badgeKey, entityBadgeHtml, iconSvg, logoHtml, typeBadgeHtml, type IconMarkup } from './badges'
import {
  escapeHtml,
  exportStrings,
  fmt,
  formatDateTime,
  formatValue,
  isImageDataUrl,
  jsonForScript,
  nodeSubtitle,
  orderedProps,
  platformName,
  safeColor,
  typeLabel
} from './format'

export const ENTITY_WIDTHS = { sm: 168, md: 196, lg: 240 }

export interface ViewerNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  w: number | null
  h: number | null
  label: string
  kicker: string
  typeLabel: string
  platform: string
  subtitle: string
  badge: string
  image: string | null
  accent: string | null
  bg: string | null
  fontSize: number | null
  color: string | null
  props: Array<[string, string]>
  notes: string
  source: string
  created: string
  updated: string
  svg: string | null
  legend: string | null
  search: string
}

export interface ViewerEdge {
  id: string
  source: string
  target: string
  label: string
  color: string | null
  dashed: boolean
  width: number
}

export interface ViewerData {
  lang: Lang
  title: string
  meta: string
  nodes: ViewerNode[]
  edges: ViewerEdge[]
  badges: Record<string, string>
  images: Record<string, string>
  legend: Array<{ key: string; label: string; badge: string; count: number }>
  icons: Record<string, string>
  t: ExportViewerStrings
  omitted: string
}

type ExportViewerStrings = ReturnType<typeof exportStrings>['exportx']['viewer']

export interface ViewerInput {
  investigation: Pick<Investigation, 'id' | 'name' | 'description'>
  nodes: GraphNode[]
  edges: GraphEdge[]
  lang: Lang
  exportedAt: Date
  iconMarkup: IconMarkup
  /** Images en data URL, par identifiant de pièce jointe. */
  images?: Record<string, string>
  /** Nombre d'images écartées pour rester sous la taille maximale. */
  omittedImages?: number
  /** Dimensions mesurées sur le canevas. */
  sizes?: Record<string, { width: number; height: number }>
  /** Rendu SVG des dessins, capturé depuis le canevas. */
  drawings?: Record<string, string>
  modules?: ModuleInfo[]
}

const UI_ICONS: Record<string, string> = {
  search: 'Search',
  fit: 'Scan',
  plus: 'Plus',
  minus: 'Minus',
  close: 'X',
  pin: 'MapPin',
  out: 'ArrowRight',
  in: 'ArrowLeft',
  legend: 'Layers'
}

/** Prépare les données du visualiseur (fonction pure, testable). */
export function buildViewerData(input: ViewerInput): ViewerData {
  const { lang, iconMarkup } = input
  const s = exportStrings(lang).exportx.viewer
  const moduleNames = new Map((input.modules ?? []).map((m) => [m.id, m.name[lang]]))
  const badges: Record<string, string> = {}
  const images: Record<string, string> = {}
  const legendCount = new Map<string, number>()
  const nodes: ViewerNode[] = []

  for (const n of input.nodes) {
    const isEntity = n.kind === 'entity'
    const bKey = badgeKey(n)
    if (isEntity && !badges[bKey]) badges[bKey] = entityBadgeHtml(n, 26, iconMarkup)
    const img = n.imageId ? input.images?.[n.imageId] : undefined
    if (n.imageId && isImageDataUrl(img)) images[n.imageId] = img
    const measured = input.sizes?.[n.id]
    const tLabel = isEntity ? typeLabel(n.type, lang) : kindLabel(n.kind, s)
    const plat = platformName(n.platform)
    const props = isEntity ? orderedProps(n, lang).map((p) => [p.label, p.value] as [string, string]) : []
    if (n.kind === 'map' && n.data) {
      for (const k of ['lat', 'lon', 'zoom']) if (n.data[k] !== undefined && n.data[k] !== null) props.push([k, formatValue(n.data[k], lang)])
    }
    if (isEntity) legendCount.set(n.type, (legendCount.get(n.type) ?? 0) + 1)
    const source = n.source === 'manual' || !n.source ? s.manual : (moduleNames.get(n.source) ?? n.source)
    nodes.push({
      id: n.id,
      kind: n.kind,
      x: Math.round(n.x * 10) / 10,
      y: Math.round(n.y * 10) / 10,
      w: n.width ?? measured?.width ?? null,
      h: n.height ?? measured?.height ?? null,
      label: n.label,
      kicker: (plat || tLabel).toUpperCase(),
      typeLabel: tLabel,
      platform: plat,
      subtitle: isEntity && !n.style?.hideSubtitle ? nodeSubtitle(n) : '',
      badge: isEntity ? bKey : '',
      image: n.imageId && images[n.imageId] ? n.imageId : null,
      accent: n.style?.color ? safeColor(n.style.color, '') || null : null,
      bg: n.style?.bg ? safeColor(n.style.bg, '') || null : null,
      fontSize: typeof n.style?.fontSize === 'number' ? n.style.fontSize : null,
      color: n.style?.color ? safeColor(n.style.color, '') || null : null,
      props,
      notes: n.notes ?? '',
      source,
      created: formatDateTime(n.createdAt, lang),
      updated: formatDateTime(n.updatedAt, lang),
      svg: n.kind === 'drawing' ? (input.drawings?.[n.id] ?? null) : null,
      legend: isEntity ? n.type : null,
      search: [n.label, tLabel, plat, n.notes, ...props.map((p) => p[1])].join(' ').toLowerCase()
    })
  }

  const legend = Array.from(legendCount.entries())
    .sort((a, b) => b[1] - a[1] || typeLabel(a[0], lang).localeCompare(typeLabel(b[0], lang)))
    .map(([type, count]) => ({ key: type, label: typeLabel(type, lang), badge: typeBadgeHtml(type, 18, iconMarkup), count }))

  const ids = new Set(nodes.map((n) => n.id))
  const edges: ViewerEdge[] = input.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label ?? '',
      color: e.style?.color ? safeColor(e.style.color, '') || null : null,
      dashed: !!e.style?.dashed,
      width: typeof e.style?.width === 'number' ? e.style.width : 1.1
    }))

  const icons: Record<string, string> = {}
  for (const [k, name] of Object.entries(UI_ICONS)) icons[k] = iconSvg(iconMarkup(name), 15, 'currentColor')

  const entityCount = nodes.filter((n) => n.kind === 'entity').length
  const meta = [
    fmt(s.exportedOn, { date: formatDateTime(input.exportedAt, lang, true) }),
    fmt(s.entities, { count: entityCount }),
    fmt(s.links, { count: edges.length })
  ].join(' · ')

  return {
    lang,
    title: input.investigation.name,
    meta,
    nodes,
    edges,
    badges,
    images,
    legend,
    icons,
    t: s,
    omitted: input.omittedImages ? fmt(s.imagesOmitted, { count: input.omittedImages }) : ''
  }
}

function kindLabel(kind: NodeKind, s: ExportViewerStrings): string {
  if (kind === 'text') return s.text
  if (kind === 'image') return s.image
  if (kind === 'map') return s.map
  if (kind === 'drawing') return s.drawing
  return ''
}

export function buildViewerHtml(input: ViewerInput): string {
  const data = buildViewerData(input)
  const s = data.t
  return `<!doctype html>
<html lang="${input.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="generator" content="MASINT">
<title>${escapeHtml(data.title)} · MASINT</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<header class="top">
  <div class="brand">${logoHtml(26)}<span>MASINT</span></div>
  <div class="sep"></div>
  <div class="title"><div class="name">${escapeHtml(data.title)}</div><div class="meta">${escapeHtml(data.meta)}</div></div>
  <div class="spacer"></div>
  <div class="search">${data.icons.search}<input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(s.search)}"><div id="results" class="results glass" hidden></div></div>
  <div class="tools">
    <button id="zoom-out" title="${escapeHtml(s.zoomOut)}">${data.icons.minus}</button>
    <button id="zoom-in" title="${escapeHtml(s.zoomIn)}">${data.icons.plus}</button>
    <button id="fit" title="${escapeHtml(s.fit)}">${data.icons.fit}</button>
  </div>
</header>
<main id="stage"><div id="world"><svg id="edges" xmlns="http://www.w3.org/2000/svg"><defs id="markers"></defs></svg><div id="nodes"></div><div id="labels"></div></div></main>
<aside id="panel" class="glass" hidden></aside>
<div id="legend" class="glass"></div>
<div class="hint">${escapeHtml(s.hint)}${data.omitted ? ` · ${escapeHtml(data.omitted)}` : ''} · ${escapeHtml(s.generatedBy)}</div>
<script type="application/json" id="mx-data">${jsonForScript(data)}</script>
<script>(${viewerRuntime.toString()})()</script>
</body>
</html>
`
}

const VIEWER_CSS = `
:root{--app:#050505;--canvas:#0a0a0b;--dot:#1e1e21;--panel:#0e0e10;--panel-2:#141417;--panel-3:#1b1b1f;--border:#232327;--border-strong:#303036;--text:#ededef;--muted:#8d8d93;--faint:#5c5c63;--accent:#e5484d;--accent-soft:#e5484d22;--edge:#6b6b72;--node:#121215;--node-border:#2a2a2f;color-scheme:dark}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--app);color:var(--text);font:13px/1.4 'Inter','Inter Variable','Segoe UI',system-ui,-apple-system,Roboto,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;display:flex;flex-direction:column}
button{font:inherit;color:inherit}
.glass{background:color-mix(in srgb,var(--panel) 94%,transparent);border:1px solid var(--border);backdrop-filter:blur(10px);box-shadow:0 10px 40px rgb(0 0 0/.35)}
.top{height:54px;flex:none;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid var(--border);background:var(--panel);position:relative;z-index:7}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.02em}
.sep{width:1px;height:24px;background:var(--border)}
.title{min-width:0}
.title .name{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
.title .meta{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
.spacer{flex:1}
.search{position:relative;display:flex;align-items:center;gap:6px;width:340px;max-width:34vw;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:0 9px;color:var(--muted)}
.search:focus-within{border-color:var(--border-strong);box-shadow:0 0 0 3px var(--accent-soft)}
.search input{flex:1;min-width:0;height:32px;background:transparent;border:0;outline:0;color:var(--text);font:inherit}
.search input::placeholder{color:var(--faint)}
.results{position:absolute;top:38px;left:0;right:0;max-height:360px;overflow:auto;border-radius:10px;padding:4px}
.results button{display:flex;width:100%;align-items:center;gap:8px;padding:6px 8px;border:0;background:transparent;border-radius:7px;text-align:left;cursor:pointer}
.results button:hover,.results button.on{background:var(--panel-3)}
.results .r-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
.results .r-type{font-size:11px;color:var(--faint);white-space:nowrap}
.results .empty{padding:8px;color:var(--muted);font-size:12px}
.tools{display:flex;gap:2px}
.tools button{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}
.tools button:hover{background:var(--panel-3);color:var(--text)}
#stage{flex:1;position:relative;overflow:hidden;background-color:var(--canvas);background-image:radial-gradient(var(--dot) 1.2px,transparent 1.2px);cursor:grab;touch-action:none}
#stage.panning{cursor:grabbing}
#world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
#edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
#edges path{fill:none;stroke:var(--edge);stroke-width:1.1;transition:opacity .15s}
#edges path.hl{stroke:var(--accent)!important;stroke-width:1.8}
#edges path.dim,.elabel.dim{opacity:.15}
#labels{position:absolute;left:0;top:0}
.elabel{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;border:1px solid var(--border);background:var(--panel);color:var(--muted);border-radius:6px;padding:1px 6px;font-size:9px;pointer-events:none;transition:opacity .15s}
.elabel.hl{color:var(--text);border-color:var(--accent)}
.node{position:absolute;transition:opacity .15s}
.node.dim{opacity:.18}
.entity{display:flex;align-items:center;gap:8px;min-height:38px;padding:6px;border-radius:7px;border:1px solid var(--node-border);background:var(--node);box-shadow:0 2px 10px rgb(0 0 0/.25);cursor:pointer}
.entity:hover{border-color:var(--border-strong)}
.node.sel .entity,.entity.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 6px 24px rgb(0 0 0/.35)}
.node.match .entity{border-color:var(--accent)}
.entity .avatar{width:26px;height:26px;border-radius:5px;object-fit:cover;flex-shrink:0}
.entity .txt{min-width:0;flex:1;line-height:1.25}
.entity .kicker{font-size:7.5px;font-weight:600;letter-spacing:.08em;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.entity .label{font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.entity .label.untitled{font-style:italic;color:var(--faint);font-weight:500}
.entity .sub{font-size:8.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.entity .bar{position:absolute;left:0;top:4px;bottom:4px;width:2px;border-radius:2px}
.entity .deg{position:absolute;top:-6px;right:-6px;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--accent);color:#fff;font-size:8.5px;font-weight:700;display:flex;align-items:center;justify-content:center}
.textnode{white-space:pre-wrap;overflow-wrap:break-word;padding:4px 6px;border-radius:6px;color:var(--text);line-height:1.35;cursor:pointer;overflow:hidden}
.textnode.postit{padding:12px 14px;border-radius:3px;color:#1c1917;box-shadow:0 1px 2px rgb(0 0 0/.18),0 8px 22px rgb(0 0 0/.22)}
.imagenode{display:flex;flex-direction:column;padding:4px;border:1px solid var(--node-border);border-radius:10px;overflow:hidden;background:var(--node);box-shadow:0 4px 16px rgb(0 0 0/.22);cursor:pointer}
.node.sel .imagenode,.node.sel .textnode{box-shadow:0 0 0 1px var(--accent),0 8px 26px rgb(0 0 0/.35)}
.imagenode .frame{position:relative;flex:1;min-height:0;overflow:hidden;border-radius:7px;background:var(--panel-2)}
.imagenode img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.imagenode .caption{flex:none;height:22px;line-height:22px;padding:0 4px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mapnode{border:1px solid var(--border);border-radius:8px;background:var(--panel);padding:10px;display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:11px;cursor:pointer}
.mapnode .m-title{display:flex;gap:6px;align-items:center;color:var(--text);font-weight:600;font-size:12px}
.drawnode{pointer-events:none}
.drawnode svg{overflow:visible}
#panel{position:absolute;top:66px;right:12px;bottom:12px;width:360px;max-width:calc(100vw - 24px);border-radius:16px;overflow:auto;z-index:6;padding:16px}
#panel .p-head{display:flex;gap:10px;align-items:flex-start}
#panel .p-head .p-badge img{width:40px;height:40px;border-radius:7px;object-fit:cover}
#panel .p-kicker{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
#panel .p-label{font-size:16px;font-weight:600;word-break:break-word}
#panel .p-close{margin-left:auto;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
#panel .p-close:hover{background:var(--panel-3);color:var(--text)}
#panel .p-image{margin-top:12px;width:100%;max-height:280px;object-fit:contain;border-radius:10px;border:1px solid var(--border);background:var(--panel-2)}
#panel h3{margin:18px 0 6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
#panel table{width:100%;border-collapse:collapse;font-size:12px}
#panel td{padding:5px 0;border-bottom:1px solid var(--border);vertical-align:top}
#panel td:first-child{color:var(--muted);width:40%;padding-right:10px}
#panel td:last-child{word-break:break-word;user-select:text}
#panel a{color:var(--accent);text-decoration:none}
#panel a:hover{text-decoration:underline}
#panel .p-notes{white-space:pre-wrap;font-size:12.5px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;user-select:text}
#panel .p-empty{color:var(--faint);font-size:12px}
#panel .conn{display:flex;align-items:center;gap:8px;width:100%;padding:5px 6px;border:0;background:transparent;border-radius:7px;text-align:left;cursor:pointer}
#panel .conn:hover{background:var(--panel-3)}
#panel .conn .c-dir{color:var(--faint);display:inline-flex}
#panel .conn .c-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}
#panel .conn .c-rel{color:var(--muted);font-size:11px;white-space:nowrap;max-width:40%;overflow:hidden;text-overflow:ellipsis}
#panel .mono{font-family:'JetBrains Mono',ui-monospace,Consolas,monospace;font-size:11px}
#legend{position:absolute;left:12px;bottom:12px;max-width:260px;max-height:46vh;overflow:auto;border-radius:12px;padding:8px;z-index:4}
#legend .l-head{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:2px 4px 6px;cursor:pointer;user-select:none}
#legend.collapsed .l-items{display:none}
#legend .l-item{display:flex;align-items:center;gap:8px;width:100%;padding:4px;border:0;background:transparent;border-radius:6px;cursor:pointer;text-align:left;font-size:12px}
#legend .l-item:hover{background:var(--panel-3)}
#legend .l-item.on{background:var(--accent-soft)}
#legend .l-item .l-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#legend .l-item .l-count{color:var(--faint);font-size:11px}
.hint{position:absolute;right:12px;bottom:10px;font-size:11px;color:var(--faint);z-index:3;pointer-events:none;text-align:right;max-width:50vw}
@media (max-width:760px){.search{width:auto;flex:1;max-width:none}.title{display:none}.sep{display:none}#legend{display:none}}
`

/**
 * Visualiseur exécuté dans le fichier exporté. La fonction est sérialisée avec
 * `toString()` : elle ne doit utiliser aucune variable extérieure.
 */
function viewerRuntime(): void {
  const D = JSON.parse(document.getElementById('mx-data')!.textContent || '{}') as ViewerData
  const stage = document.getElementById('stage')!
  const world = document.getElementById('world')!
  const svg = document.getElementById('edges') as unknown as SVGSVGElement
  const markers = document.getElementById('markers')!
  const nodesLayer = document.getElementById('nodes')!
  const labelsLayer = document.getElementById('labels')!
  const panel = document.getElementById('panel')!
  const legendEl = document.getElementById('legend')!
  const q = document.getElementById('q') as HTMLInputElement
  const results = document.getElementById('results')!
  const SVGNS = 'http://www.w3.org/2000/svg'
  const WIDTHS: Record<string, number> = { sm: 168, md: 196, lg: 240 }

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }
  const html = (markup: string): DocumentFragment => {
    const t = document.createElement('template')
    t.innerHTML = markup
    return t.content
  }
  const isUrl = (v: string): boolean => /^https?:\/\/[^\s<>"']+$/i.test(v.trim())

  // Nœuds -------------------------------------------------------------------
  const byId = new Map<string, ViewerNode>()
  const elById = new Map<string, HTMLElement>()
  const box = new Map<string, { x: number; y: number; w: number; h: number }>()
  const outDeg = new Map<string, number>()
  for (const e of D.edges) outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1)

  const avatar = (n: ViewerNode, size: number): Node => {
    if (n.image && D.images[n.image]) {
      const img = el('img', 'avatar')
      img.src = D.images[n.image]
      img.alt = ''
      img.style.width = img.style.height = `${size}px`
      return img
    }
    const frag = html(D.badges[n.badge] ?? '')
    const b = frag.firstElementChild as HTMLElement | null
    if (b && size !== 26) {
      const ratio = size / 26
      b.style.width = b.style.height = `${size}px`
      b.querySelectorAll('svg').forEach((s) => {
        s.setAttribute('width', String(Number(s.getAttribute('width')) * ratio))
        s.setAttribute('height', String(Number(s.getAttribute('height')) * ratio))
      })
      b.querySelectorAll('span').forEach((s) => (s.style.fontSize = `${parseFloat(s.style.fontSize) * ratio}px`))
    }
    return frag
  }

  for (const n of D.nodes) {
    byId.set(n.id, n)
    const wrap = el('div', 'node')
    wrap.style.left = `${n.x}px`
    wrap.style.top = `${n.y}px`
    wrap.dataset.id = n.id
    if (n.kind === 'entity') {
      const card = el('div', 'entity')
      card.style.width = `${WIDTHS.md}px`
      if (n.w && n.w > 0) card.style.width = `${n.w}px`
      if (n.bg) card.style.background = n.bg
      card.appendChild(avatar(n, 26))
      const txt = el('div', 'txt')
      txt.appendChild(el('div', 'kicker', n.kicker))
      txt.appendChild(el('div', n.label ? 'label' : 'label untitled', n.label || D.t.untitled))
      if (n.subtitle) txt.appendChild(el('div', 'sub', n.subtitle))
      card.appendChild(txt)
      if (n.accent) {
        const bar = el('div', 'bar')
        bar.style.background = n.accent
        card.appendChild(bar)
      }
      const deg = outDeg.get(n.id) ?? 0
      if (deg > 0) card.appendChild(el('span', 'deg', String(deg)))
      card.style.position = 'relative'
      wrap.appendChild(card)
    } else if (n.kind === 'text') {
      // Texte libre ou post-it (fond coloré), comme sur le canevas.
      const t = el('div', n.bg ? 'textnode postit' : 'textnode', n.label)
      t.style.fontSize = `${n.fontSize ?? 14}px`
      if (n.bg) t.style.background = n.bg
      if (n.color) t.style.color = n.color
      if (n.w) t.style.width = `${n.w}px`
      if (n.h) t.style.height = `${n.h}px`
      wrap.appendChild(t)
    } else if (n.kind === 'image') {
      const f = el('div', 'imagenode')
      f.style.width = `${n.w ?? 260}px`
      f.style.height = `${n.h ?? 200}px`
      const frame = el('div', 'frame')
      if (n.image && D.images[n.image]) {
        const img = el('img')
        img.src = D.images[n.image]
        img.alt = n.label
        frame.appendChild(img)
      }
      f.appendChild(frame)
      if (n.label.trim()) f.appendChild(el('div', 'caption', n.label.trim()))
      wrap.appendChild(f)
    } else if (n.kind === 'map') {
      const m = el('div', 'mapnode')
      m.style.width = `${n.w ?? 260}px`
      m.style.minHeight = `${n.h ?? 120}px`
      const head = el('div', 'm-title')
      head.appendChild(html(D.icons.pin))
      head.appendChild(el('span', '', n.label || D.t.map))
      m.appendChild(head)
      for (const [k, v] of n.props) m.appendChild(el('div', '', `${k} : ${v}`))
      wrap.appendChild(m)
    } else if (n.kind === 'drawing') {
      if (!n.svg) continue
      const d = el('div', 'drawnode')
      d.style.width = `${n.w ?? 1}px`
      d.style.height = `${n.h ?? 1}px`
      d.appendChild(html(n.svg))
      d.querySelectorAll('script,foreignObject').forEach((x) => x.remove())
      wrap.appendChild(d)
    }
    nodesLayer.appendChild(wrap)
    elById.set(n.id, wrap)
  }

  // Dimensions réelles une fois les nœuds dans la page.
  for (const [id, w] of elById) {
    const n = byId.get(id)!
    box.set(id, { x: n.x, y: n.y, w: w.offsetWidth || n.w || 196, h: w.offsetHeight || n.h || 40 })
  }

  // Liens -------------------------------------------------------------------
  const markerIds = new Map<string, string>()
  const marker = (color: string): string => {
    let id = markerIds.get(color)
    if (id) return id
    id = `m${markerIds.size}`
    markerIds.set(color, id)
    const m = document.createElementNS(SVGNS, 'marker')
    m.setAttribute('id', id)
    m.setAttribute('viewBox', '-10 -10 20 20')
    m.setAttribute('markerWidth', '14')
    m.setAttribute('markerHeight', '14')
    m.setAttribute('markerUnits', 'userSpaceOnUse')
    m.setAttribute('orient', 'auto-start-reverse')
    m.setAttribute('refX', '0')
    m.setAttribute('refY', '0')
    const p = document.createElementNS(SVGNS, 'polyline')
    p.setAttribute('points', '-5,-4 0,0 -5,4 -5,-4')
    p.setAttribute('style', `stroke:${color};fill:${color};stroke-width:1;stroke-linecap:round;stroke-linejoin:round`)
    m.appendChild(p)
    markers.appendChild(m)
    return id
  }
  const offset = (d: number): number => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d))

  const edgeEls = new Map<string, { path: SVGPathElement; label: HTMLElement | null; color: string }>()
  const neighbors = new Map<string, Set<string>>()
  for (const e of D.edges) {
    const a = box.get(e.source)
    const b = box.get(e.target)
    if (!a || !b) continue
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set())
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set())
    neighbors.get(e.source)!.add(e.target)
    neighbors.get(e.target)!.add(e.source)
    // Même courbe que React Flow : sortie en bas de la source, entrée en haut de la cible.
    const sx = a.x + a.w / 2
    const sy = a.y + a.h
    const tx = b.x + b.w / 2
    const ty = b.y
    const c1y = sy + offset(ty - sy)
    const c2y = ty - offset(ty - sy)
    const path = document.createElementNS(SVGNS, 'path')
    path.setAttribute('d', `M${sx},${sy} C${sx},${c1y} ${tx},${c2y} ${tx},${ty}`)
    const color = e.color ?? 'var(--edge)'
    path.style.stroke = color
    path.style.strokeWidth = String(e.width)
    if (e.dashed) path.style.strokeDasharray = '5 4'
    path.setAttribute('marker-end', `url(#${marker(color)})`)
    svg.appendChild(path)
    let label: HTMLElement | null = null
    if (e.label) {
      label = el('div', 'elabel', e.label)
      label.style.left = `${sx * 0.125 + sx * 0.375 + tx * 0.375 + tx * 0.125}px`
      label.style.top = `${sy * 0.125 + c1y * 0.375 + c2y * 0.375 + ty * 0.125}px`
      labelsLayer.appendChild(label)
    }
    edgeEls.set(e.id, { path, label, color })
  }

  // Vue ---------------------------------------------------------------------
  const view = { x: 0, y: 0, z: 1 }
  const apply = (): void => {
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`
    const g = 22 * view.z
    stage.style.backgroundSize = `${g}px ${g}px`
    stage.style.backgroundPosition = `${view.x}px ${view.y}px`
  }
  const clamp = (z: number): number => Math.min(4, Math.max(0.05, z))
  let anim = 0
  const animateTo = (x: number, y: number, z: number, ms = 280): void => {
    cancelAnimationFrame(anim)
    const from = { ...view }
    const t0 = performance.now()
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      view.x = from.x + (x - from.x) * e
      view.y = from.y + (y - from.y) * e
      view.z = from.z + (z - from.z) * e
      apply()
      if (k < 1) anim = requestAnimationFrame(step)
    }
    anim = requestAnimationFrame(step)
  }
  const fit = (animated = true): void => {
    const all = Array.from(box.values())
    const r = stage.getBoundingClientRect()
    if (!all.length) {
      view.x = r.width / 2
      view.y = r.height / 2
      apply()
      return
    }
    const minX = Math.min(...all.map((b) => b.x))
    const minY = Math.min(...all.map((b) => b.y))
    const maxX = Math.max(...all.map((b) => b.x + b.w))
    const maxY = Math.max(...all.map((b) => b.y + b.h))
    const pad = 60
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(1, maxX - minX), (r.height - pad * 2) / Math.max(1, maxY - minY), 1.4))
    const x = (r.width - (maxX - minX) * z) / 2 - minX * z
    const y = (r.height - (maxY - minY) * z) / 2 - minY * z
    if (animated) animateTo(x, y, z)
    else {
      view.x = x
      view.y = y
      view.z = z
      apply()
    }
  }
  const zoomAt = (factor: number, cx: number, cy: number): void => {
    const z = clamp(view.z * factor)
    const k = z / view.z
    view.x = cx - (cx - view.x) * k
    view.y = cy - (cy - view.y) * k
    view.z = z
    apply()
  }
  const zoomCenter = (factor: number): void => {
    const r = stage.getBoundingClientRect()
    zoomAt(factor, r.width / 2, r.height / 2)
  }
  const focus = (id: string): void => {
    const b = box.get(id)
    if (!b) return
    const r = stage.getBoundingClientRect()
    const z = Math.max(view.z, 1.1)
    // La fiche occupe la droite de l'écran : on centre dans la zone restante.
    const visible = r.width > 900 ? r.width - 372 : r.width
    animateTo(visible / 2 - (b.x + b.w / 2) * z, r.height / 2 - (b.y + b.h / 2) * z, z)
    select(id)
  }

  // Mise en évidence --------------------------------------------------------
  let selected: string | null = null
  let legendType: string | null = null
  let matches: Set<string> | null = null
  const refresh = (): void => {
    let focusSet: Set<string> | null = null
    if (selected) focusSet = new Set([selected, ...(neighbors.get(selected) ?? [])])
    else if (matches) focusSet = matches
    else if (legendType) focusSet = new Set(D.nodes.filter((n) => n.legend === legendType).map((n) => n.id))
    for (const [id, w] of elById) {
      w.classList.toggle('sel', id === selected)
      w.classList.toggle('match', !selected && !!matches && matches.has(id))
      w.classList.toggle('dim', !!focusSet && !focusSet.has(id))
    }
    for (const e of D.edges) {
      const x = edgeEls.get(e.id)
      if (!x) continue
      const hl = !!selected && (e.source === selected || e.target === selected)
      const dim = !!focusSet && !hl && !(focusSet.has(e.source) && focusSet.has(e.target) && !selected)
      x.path.classList.toggle('hl', hl)
      x.path.classList.toggle('dim', dim)
      x.path.setAttribute('marker-end', `url(#${marker(hl ? 'var(--accent)' : x.color)})`)
      x.label?.classList.toggle('hl', hl)
      x.label?.classList.toggle('dim', dim)
    }
  }

  // Fiche -------------------------------------------------------------------
  const section = (title: string): HTMLElement => panel.appendChild(el('h3', '', title))
  const select = (id: string | null): void => {
    selected = id
    refresh()
    panel.textContent = ''
    const n = id ? byId.get(id) : undefined
    if (!n) {
      panel.hidden = true
      return
    }
    panel.hidden = false
    const head = el('div', 'p-head')
    const badge = el('div', 'p-badge')
    if (n.kind === 'entity') badge.appendChild(avatar(n, 40))
    head.appendChild(badge)
    const titles = el('div')
    titles.style.minWidth = '0'
    titles.appendChild(el('div', 'p-kicker', n.kicker))
    titles.appendChild(el('div', 'p-label', n.label || D.t.untitled))
    head.appendChild(titles)
    const close = el('button', 'p-close')
    close.title = D.t.close
    close.appendChild(html(D.icons.close))
    close.onclick = () => select(null)
    head.appendChild(close)
    panel.appendChild(head)
    if (n.image && D.images[n.image]) {
      const img = el('img', 'p-image')
      img.src = D.images[n.image]
      img.alt = ''
      panel.appendChild(img)
    }
    if (n.kind === 'entity' || n.props.length) {
      section(D.t.properties)
      if (n.props.length) {
        const table = el('table')
        for (const [k, v] of n.props) {
          const tr = el('tr')
          tr.appendChild(el('td', '', k))
          const td = el('td')
          if (isUrl(v)) {
            const a = el('a', '', v)
            a.href = v.trim()
            a.target = '_blank'
            a.rel = 'noopener noreferrer'
            td.appendChild(a)
          } else td.textContent = v
          tr.appendChild(td)
          table.appendChild(tr)
        }
        panel.appendChild(table)
      } else panel.appendChild(el('div', 'p-empty', D.t.noProperties))
    }
    if (n.notes.trim()) {
      section(D.t.notes)
      panel.appendChild(el('div', 'p-notes', n.notes))
    }
    const links = D.edges.filter((e) => e.source === n.id || e.target === n.id)
    if (links.length) {
      section(`${D.t.connections} (${links.length})`)
      for (const e of links) {
        const outgoing = e.source === n.id
        const other = byId.get(outgoing ? e.target : e.source)
        if (!other) continue
        const b = el('button', 'conn')
        const dir = el('span', 'c-dir')
        dir.appendChild(html(outgoing ? D.icons.out : D.icons.in))
        b.appendChild(dir)
        if (other.kind === 'entity') b.appendChild(avatar(other, 18))
        b.appendChild(el('span', 'c-label', other.label || other.typeLabel || D.t.untitled))
        if (e.label) b.appendChild(el('span', 'c-rel', e.label))
        b.onclick = () => focus(other.id)
        panel.appendChild(b)
      }
    }
    section(D.t.metadata)
    const meta = el('table')
    const rows: Array<[string, string, boolean?]> = [
      [D.t.type, n.typeLabel],
      [D.t.platform, n.platform],
      [D.t.source, n.source],
      [D.t.created, n.created],
      [D.t.updated, n.updated],
      [D.t.id, n.id, true]
    ]
    for (const [k, v, mono] of rows) {
      if (!v) continue
      const tr = el('tr')
      tr.appendChild(el('td', '', k))
      tr.appendChild(el('td', mono ? 'mono' : '', v))
      meta.appendChild(tr)
    }
    panel.appendChild(meta)
  }

  // Recherche ---------------------------------------------------------------
  let active = 0
  let found: ViewerNode[] = []
  const renderResults = (): void => {
    results.textContent = ''
    if (!q.value.trim()) {
      results.hidden = true
      return
    }
    results.hidden = false
    if (!found.length) {
      results.appendChild(el('div', 'empty', D.t.noResults))
      return
    }
    found.slice(0, 15).forEach((n, i) => {
      const b = el('button', i === active ? 'on' : '')
      if (n.kind === 'entity') b.appendChild(avatar(n, 18))
      b.appendChild(el('span', 'r-label', n.label || D.t.untitled))
      b.appendChild(el('span', 'r-type', n.typeLabel))
      b.onmousedown = (ev) => ev.preventDefault()
      b.onclick = () => {
        focus(n.id)
        results.hidden = true
      }
      results.appendChild(b)
    })
  }
  q.addEventListener('input', () => {
    // La recherche remplace la sélection courante pour que les résultats restent visibles.
    if (selected) select(null)
    const s = q.value.trim().toLowerCase()
    found = s ? D.nodes.filter((n) => n.kind !== 'drawing' && n.search.includes(s)) : []
    matches = s ? new Set(found.map((n) => n.id)) : null
    active = 0
    refresh()
    renderResults()
  })
  q.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      const max = Math.min(found.length, 15)
      if (max) active = (active + (ev.key === 'ArrowDown' ? 1 : max - 1)) % max
      renderResults()
    } else if (ev.key === 'Enter' && found[active]) {
      focus(found[active].id)
      results.hidden = true
    } else if (ev.key === 'Escape') {
      if (!q.value) select(null)
      q.value = ''
      q.dispatchEvent(new Event('input'))
      q.blur()
    }
  })
  q.addEventListener('focus', () => renderResults())
  q.addEventListener('blur', () => (results.hidden = true))

  // Légende -----------------------------------------------------------------
  if (D.legend.length) {
    const head = el('div', 'l-head')
    head.appendChild(html(D.icons.legend))
    head.appendChild(el('span', '', D.t.legend))
    head.onclick = () => legendEl.classList.toggle('collapsed')
    legendEl.appendChild(head)
    const items = el('div', 'l-items')
    for (const l of D.legend) {
      const b = el('button', 'l-item')
      b.appendChild(html(l.badge))
      b.appendChild(el('span', 'l-label', l.label))
      b.appendChild(el('span', 'l-count', String(l.count)))
      b.onclick = () => {
        if (selected) select(null)
        legendType = legendType === l.key ? null : l.key
        items.querySelectorAll('.l-item').forEach((x) => x.classList.remove('on'))
        if (legendType) b.classList.add('on')
        refresh()
      }
      items.appendChild(b)
    }
    legendEl.appendChild(items)
  } else legendEl.hidden = true

  // Souris ------------------------------------------------------------------
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean; node: string | null } | null = null
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    const target = (ev.target as HTMLElement).closest('.node') as HTMLElement | null
    drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false, node: target?.dataset.id ?? null }
    stage.setPointerCapture(ev.pointerId)
  })
  stage.addEventListener('pointermove', (ev) => {
    if (!drag) return
    const dx = ev.clientX - drag.x
    const dy = ev.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    stage.classList.add('panning')
    cancelAnimationFrame(anim)
    view.x = drag.vx + dx
    view.y = drag.vy + dy
    apply()
  })
  const end = (): void => {
    if (drag && !drag.moved) select(drag.node && byId.get(drag.node)?.kind !== 'drawing' ? drag.node : null)
    drag = null
    stage.classList.remove('panning')
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', () => {
    drag = null
    stage.classList.remove('panning')
  })
  stage.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault()
      cancelAnimationFrame(anim)
      const r = stage.getBoundingClientRect()
      const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY
      zoomAt(Math.exp(-delta * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top)
    },
    { passive: false }
  )
  document.getElementById('zoom-in')!.onclick = () => zoomCenter(1.25)
  document.getElementById('zoom-out')!.onclick = () => zoomCenter(0.8)
  document.getElementById('fit')!.onclick = () => fit()
  window.addEventListener('keydown', (ev) => {
    if (ev.target === q) return
    if (ev.key === 'Escape') select(null)
    else if (ev.key === 'f' || ev.key === 'F') fit()
    else if (ev.key === '+' || ev.key === '=') zoomCenter(1.25)
    else if (ev.key === '-') zoomCenter(0.8)
    else if (ev.key === '/' || ((ev.ctrlKey || ev.metaKey) && ev.key === 'f')) {
      ev.preventDefault()
      q.focus()
    }
  })
  let resizeTimer = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => fit(false), 120)
  })
  fit(false)
}
