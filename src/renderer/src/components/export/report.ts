// Rapport d'enquête : document HTML autonome, mis en page pour l'impression A4
// (le processus principal l'imprime en PDF). Fonction pure, sans accès au DOM.

import { canonicalKey } from '@shared/canonical'
import { CATEGORIES, ENTITY_TYPES, getEntityType, type CategoryId } from '@shared/entityTypes'
import { propertyLabel } from '@shared/propertyLabels'
import { ADMIRALTY_KEY, parseAdmiralty } from '@shared/provenance'
import type { Attachment, GraphEdge, GraphNode, Investigation, Lang, ModuleInfo, ModuleRun, ModuleRunStats } from '@shared/types'
import { collectEvents, formatEventDate } from '../../lib/timeline'
import { entityBadgeHtml, iconSvg, logoHtml, type IconMarkup } from './badges'
import {
  escapeHtml,
  exportStrings,
  fmt,
  formatDate,
  formatDateTime,
  formatNumber,
  formatShortDateTime,
  isImageDataUrl,
  orderedProps,
  platformName,
  safeHttpUrl,
  typeLabel
} from './format'
import { renderMarkdown } from './markdown'

export type ReportSectionId = 'summary' | 'graph' | 'notes' | 'entities' | 'links' | 'timeline' | 'sources' | 'attachments' | 'raw'
export const REPORT_SECTIONS: ReportSectionId[] = ['summary', 'graph', 'notes', 'entities', 'links', 'timeline', 'sources', 'attachments', 'raw']

export interface ReportOptions {
  title: string
  investigator: string
  reference: string
  classification: string
  lang: Lang
  sections: Record<ReportSectionId, boolean>
}

export interface ReportInput {
  options: ReportOptions
  investigation: Investigation
  nodes: GraphNode[]
  edges: GraphEdge[]
  runs: ModuleRun[]
  modules: ModuleInfo[]
  iconMarkup: IconMarkup
  generatedAt: Date
  /** Capture du graphe en data URL PNG. */
  graphImage?: string | null
  /** Images jointes en data URL, par identifiant de pièce jointe. */
  images?: Record<string, string>
  appVersion?: string | null
  platform?: string | null
  /** Empreinte SHA-256 de `fingerprintPayload(...)`. */
  fingerprint?: string | null
  /** Réponses brutes des modules pour l'annexe. */
  rawRuns?: Array<{ run: ModuleRun; raw: unknown }>
  /**
   * Statistiques par module calculées en base (toutes les exécutions) ; sans elles, les
   * chiffres sont tirés de `runs`, qui peut être tronqué.
   */
  runStats?: ModuleRunStats[]
  /** Pièces jointes utilisées par les nœuds (nom, SHA-256, URL d'origine). */
  attachments?: Attachment[]
}

export const DEFAULT_SECTIONS: Record<ReportSectionId, boolean> = {
  summary: true,
  graph: true,
  notes: true,
  entities: true,
  links: true,
  timeline: true,
  sources: true,
  attachments: true,
  raw: false
}

const MAX_RUN_ROWS = 1500
const MAX_EVENT_ROWS = 1500
const MAX_RAW_CHARS = 4000

/** Objet aux clés triées, à toute profondeur (sérialisation stable). */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])
    )
  }
  return v
}

/**
 * Données couvertes par l'empreinte de traçabilité, sous une forme canonique triée qui ne
 * dépend ni des identifiants internes (régénérés à chaque import), ni des positions, ni des
 * dates d'enregistrement, ni du nom de l'enquête (suffixé à l'import) :
 * - entités : clé canonique (type et valeur), libellé, plateforme, propriétés, notes, module
 *   source et SHA-256 de l'image ;
 * - annotations du canevas (textes, images, cartes ; dessins exclus) : contenu et image ;
 * - liens : extrémités désignées par leur clé canonique, libellé ;
 * - notes de l'enquête.
 * Une enquête et sa copie (archive, duplication) ont donc la même empreinte.
 */
export function fingerprintPayload(
  investigation: Investigation,
  nodes: GraphNode[],
  edges: GraphEdge[],
  imageHashes: Record<string, string> = {}
): string {
  const items = nodes.filter((n) => n.kind !== 'drawing')
  const keyOf = (n: GraphNode): string => (n.kind === 'entity' ? canonicalKey(n.type, n.label, n.platform) : `${n.kind}|${n.type}|${n.label.trim()}`)
  const byId = new Map(items.map((n) => [n.id, n]))
  const sorted = (list: unknown[]): string[] => list.map((x) => JSON.stringify(sortKeys(x))).sort()
  return JSON.stringify({
    format: 'masint-fingerprint',
    version: 2,
    notes: investigation.notes ?? '',
    nodes: sorted(
      items.map((n) => ({
        key: keyOf(n),
        kind: n.kind,
        type: n.type,
        label: n.label,
        platform: n.platform,
        data: n.data,
        notes: n.notes,
        source: n.source,
        image: n.imageId ? (imageHashes[n.imageId] ?? 'image') : null
      }))
    ),
    links: sorted(
      edges
        .filter((e) => byId.has(e.source) && byId.has(e.target))
        .map((e) => ({ from: keyOf(byId.get(e.source)!), to: keyOf(byId.get(e.target)!), label: e.label, module: e.sourceModule }))
    )
  })
}

const TYPE_RANK = new Map(ENTITY_TYPES.map((t, i) => [t.id, i]))

/** Fiches groupées par catégorie, types dans l'ordre du catalogue (la personne avant ses comptes). */
export function entityOrder(nodes: GraphNode[], lang: Lang): Array<{ category: CategoryId; nodes: GraphNode[] }> {
  const entities = nodes.filter((n) => n.kind === 'entity')
  const rank = (type: string): number => TYPE_RANK.get(type) ?? ENTITY_TYPES.length
  const groups: Array<{ category: CategoryId; nodes: GraphNode[] }> = []
  for (const cat of CATEGORIES) {
    const list = entities
      .filter((n) => getEntityType(n.type).category === cat.id)
      .sort((a, b) => rank(a.type) - rank(b.type) || a.label.localeCompare(b.label, lang))
    if (list.length) groups.push({ category: cat.id, nodes: list })
  }
  return groups
}

const isoDate = (ts: number): string | number => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toISOString()
}

export function buildReportHtml(input: ReportInput): string {
  const { options, investigation, iconMarkup } = input
  const lang = options.lang
  const S = exportStrings(lang).report.doc
  const sections = options.sections
  const title = options.title.trim() || investigation.name || S.untitled
  const images = input.images ?? {}
  const moduleById = new Map(input.modules.map((m) => [m.id, m]))
  const moduleName = (id: string): string => (id === 'manual' || !id ? S.manual : (moduleById.get(id)?.name[lang] ?? id))
  const e = escapeHtml

  const groups = entityOrder(input.nodes, lang)
  const ordered = groups.flatMap((g) => g.nodes)
  const pad = Math.max(3, String(ordered.length).length)
  const refs = new Map(ordered.map((n, i) => [n.id, `E${String(i + 1).padStart(pad, '0')}`]))
  const byId = new Map(input.nodes.map((n) => [n.id, n]))
  const entities = ordered
  const annotations = input.nodes.filter((n) => n.kind === 'text' || n.kind === 'image' || n.kind === 'map')
  const edges = input.edges.filter((x) => byId.has(x.source) && byId.has(x.target))

  const degree = new Map<string, number>()
  for (const x of edges) {
    degree.set(x.source, (degree.get(x.source) ?? 0) + 1)
    degree.set(x.target, (degree.get(x.target) ?? 0) + 1)
  }

  const nodeName = (id: string): string => {
    const n = byId.get(id)
    if (!n) return ''
    return n.label || (n.kind === 'entity' ? typeLabel(n.type, lang) : '')
  }
  const refTag = (id: string): string => (refs.has(id) ? `<span class="ref">${refs.get(id)}</span>` : '')
  const nodeCell = (id: string): string => `${refTag(id)} ${e(nodeName(id))}`

  // Sections numérotées dans l'ordre d'apparition.
  const enabled = REPORT_SECTIONS.filter((id) => sections[id])
  const titles: Record<ReportSectionId, string> = {
    summary: S.summary,
    graph: S.graph,
    notes: S.notes,
    entities: S.entities,
    links: S.links,
    timeline: S.timeline,
    sources: S.sources,
    attachments: S.attachmentsTitle,
    raw: S.raw
  }
  // Exécutions : totaux de la requête d'agrégat quand ils sont fournis (la liste est limitée).
  const runTotal = input.runStats ? input.runStats.reduce((a, s) => a + s.runs, 0) : input.runs.length
  const resultTotal = input.runStats
    ? input.runStats.reduce((a, s) => a + s.results, 0)
    : input.runs.reduce((a, r) => a + (r.resultCount || 0), 0)
  const num = (id: ReportSectionId): number => enabled.indexOf(id) + 1
  const chapterHead = (id: ReportSectionId): string =>
    `<h2 class="chapter-title" id="s-${id}"><span class="num">${num(id)}</span>${e(titles[id])}</h2>`

  const parts: string[] = []

  // Sommaire -------------------------------------------------------------------
  const tocItems = enabled.map((id) => {
    let sub = ''
    if (id === 'entities' && groups.length) {
      sub = `<ol class="toc-sub">${groups
        .map((g) => `<li><a href="#cat-${g.category}">${e(CATEGORIES.find((c) => c.id === g.category)!.label[lang])}</a><span class="toc-count">${g.nodes.length}</span></li>`)
        .join('')}${annotations.length ? `<li><a href="#cat-annotations">${e(S.annotations)}</a><span class="toc-count">${annotations.length}</span></li>` : ''}</ol>`
    }
    return `<li><a href="#s-${id}"><span class="toc-num">${num(id)}</span>${e(titles[id])}</a>${sub}</li>`
  })
  tocItems.push(`<li><a href="#s-trace"><span class="toc-num">${enabled.length + 1}</span>${e(S.traceability)}</a></li>`)
  parts.push(`<section class="chapter toc"><h2 class="chapter-title">${e(S.toc)}</h2><ol class="toc-list">${tocItems.join('')}</ol></section>`)

  // Synthèse -------------------------------------------------------------------
  if (sections.summary) {
    const types = new Set(entities.map((n) => n.type))
    const imageCount = input.nodes.filter((n) => n.imageId).length
    const manual = entities.filter((n) => !n.source || n.source === 'manual').length
    const times = input.nodes.map((n) => n.createdAt).filter((t) => t > 0)
    const period =
      times.length > 0
        ? `${formatDate(Math.min(...times), lang)} → ${formatDate(Math.max(...input.nodes.map((n) => n.updatedAt || n.createdAt)), lang)}`
        : ''
    const tile = (value: number, label: string): string =>
      `<div class="tile"><div class="tile-value">${formatNumber(value, lang)}</div><div class="tile-label">${e(label)}</div></div>`
    const total = Math.max(1, entities.length)
    const catRows = groups
      .map((g) => {
        const cat = CATEGORIES.find((c) => c.id === g.category)!
        const pct = (g.nodes.length / total) * 100
        return `<tr><td><span class="cat-ico">${iconSvg(iconMarkup(cat.icon), 12, '#63636b')}</span>${e(cat.label[lang])}</td><td class="num">${g.nodes.length}</td><td class="bar-cell"><span class="bar" style="width:${pct.toFixed(1)}%"></span><span class="pct">${pct.toFixed(0)} %</span></td></tr>`
      })
      .join('')
    const typeCounts = new Map<string, number>()
    for (const n of entities) typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1)
    const typeRows = Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => `<tr><td>${e(typeLabel(type, lang))}</td><td class="num">${count}</td></tr>`)
      .join('')
    const top = entities
      .filter((n) => (degree.get(n.id) ?? 0) > 0)
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, 10)
      .map(
        (n) =>
          `<tr><td>${refTag(n.id)}</td><td class="wrap">${e(n.label)}</td><td>${e(typeLabel(n.type, lang))}</td><td class="num">${degree.get(n.id)}</td></tr>`
      )
      .join('')
    parts.push(`<section class="chapter summary">${chapterHead('summary')}
<div class="tiles">${tile(entities.length, S.stats.entities)}${tile(edges.length, S.stats.links)}${tile(types.size, S.stats.types)}${tile(runTotal, S.stats.runs)}${tile(resultTotal, S.stats.results)}${tile(imageCount, S.stats.images)}</div>
<table class="kv"><tbody>
${period ? `<tr><th>${e(S.stats.period)}</th><td>${e(period)}</td></tr>` : ''}
<tr><th>${e(S.stats.manual)}</th><td>${manual}</td></tr>
<tr><th>${e(S.stats.automatic)}</th><td>${entities.length - manual}</td></tr>
</tbody></table>
${catRows ? `<h3>${e(S.byCategory)}</h3><table class="grid"><thead><tr><th>${e(S.category)}</th><th class="num">${e(S.count)}</th><th>${e(S.share)}</th></tr></thead><tbody>${catRows}</tbody></table>` : ''}
<div class="cols">
${typeRows ? `<div><h3>${e(S.byType)}</h3><table class="grid"><thead><tr><th>${e(S.type)}</th><th class="num">${e(S.count)}</th></tr></thead><tbody>${typeRows}</tbody></table></div>` : ''}
${top ? `<div><h3>${e(S.topConnected)}</h3><table class="grid"><thead><tr><th>${e(S.ref)}</th><th>${e(S.entity)}</th><th>${e(S.type)}</th><th class="num">${e(S.degree)}</th></tr></thead><tbody>${top}</tbody></table></div>` : ''}
</div>
</section>`)
  }

  // Graphe ---------------------------------------------------------------------
  if (sections.graph) {
    const img = input.graphImage && isImageDataUrl(input.graphImage) ? input.graphImage : null
    parts.push(`<section class="chapter">${chapterHead('graph')}
${
  img
    ? `<figure class="graph"><img src="${img}" alt=""><figcaption>${e(fmt(S.graphCaption, { nodes: input.nodes.length, edges: edges.length }))}</figcaption></figure>`
    : `<p class="muted">${e(S.graphMissing)}</p>`
}
</section>`)
  }

  // Notes ----------------------------------------------------------------------
  if (sections.notes) {
    const notes = (investigation.notes ?? '').trim()
    parts.push(`<section class="chapter">${chapterHead('notes')}
${notes ? `<div class="prose">${renderMarkdown(notes, 3)}</div>` : `<p class="muted">${e(S.notesEmpty)}</p>`}
</section>`)
  }

  // Fiches ---------------------------------------------------------------------
  if (sections.entities) {
    const links = (n: GraphNode): string => {
      const items = edges
        .filter((x) => x.source === n.id || x.target === n.id)
        .map((x) => {
          const out = x.source === n.id
          const other = out ? x.target : x.source
          return `<li><span class="dir">${out ? '→' : '←'}</span>${x.label ? `<span class="rel">${e(x.label)}</span>` : ''}${nodeCell(other)}</li>`
        })
      return items.length ? `<div class="card-links"><div class="card-sub">${e(S.connections)} (${items.length})</div><ul>${items.join('')}</ul></div>` : ''
    }
    // Cotation de l'enquêteur (Amirauté) : code et sens, en tête de fiche.
    const rating = (n: GraphNode): string => {
      const a = parseAdmiralty(n.data?.[ADMIRALTY_KEY])
      if (!a) return ''
      const parts = [
        a.reliability ? `${e(S.ratingSource)} : ${e(S.reliability[a.reliability] ?? a.reliability)}` : '',
        a.credibility ? `${e(S.ratingInfo)} : ${e(S.credibility[String(a.credibility)] ?? String(a.credibility))}` : ''
      ].filter(Boolean)
      return `<div class="card-rating"><span class="rating-code">${e(`${a.reliability ?? ''}${a.credibility ?? ''}`)}</span>${e(S.rating)} · ${parts.join(' · ')}</div>`
    }
    const card = (n: GraphNode): string => {
      const props = orderedProps(n, lang).filter((p) => p.key !== ADMIRALTY_KEY)
      const img = n.imageId ? images[n.imageId] : undefined
      const plat = platformName(n.platform)
      const kicker = [typeLabel(n.type, lang), plat].filter(Boolean).join(' · ')
      const rows = props
        .map((p) => {
          const href = safeHttpUrl(p.value)
          const value = href ? `<a href="${e(href)}">${e(p.value)}</a>` : e(p.value)
          return `<tr><th>${e(p.label)}</th><td>${value}</td></tr>`
        })
        .join('')
      const meta = [
        `${e(S.source)} : ${e(moduleName(n.source))}`,
        `${e(S.created)} ${e(formatShortDateTime(n.createdAt, lang))}`,
        n.updatedAt && n.updatedAt !== n.createdAt ? `${e(S.updated)} ${e(formatShortDateTime(n.updatedAt, lang))}` : ''
      ]
        .filter(Boolean)
        .join(' · ')
      return `<article class="card" id="e-${e(n.id)}">
<header class="card-head">${entityBadgeHtml(n, 28, iconMarkup)}<div class="card-titles"><div class="kicker">${e(kicker)}</div><div class="card-label">${e(n.label || typeLabel(n.type, lang))}</div></div><span class="ref big">${refs.get(n.id)}</span></header>
<div class="card-body${img && isImageDataUrl(img) ? ' has-img' : ''}">
${img && isImageDataUrl(img) ? `<img class="card-img" src="${img}" alt="">` : ''}
<div class="card-main">
${rating(n)}
${rows ? `<table class="props"><tbody>${rows}</tbody></table>` : `<p class="muted small">${e(S.noProperties)}</p>`}
${n.notes?.trim() ? `<div class="card-notes"><div class="card-sub">${e(S.entityNotes)}</div><div class="notes-text">${e(n.notes.trim())}</div></div>` : ''}
${links(n)}
</div>
</div>
<footer class="card-meta">${meta}</footer>
</article>`
    }
    const blocks = groups.map((g) => {
      const cat = CATEGORIES.find((c) => c.id === g.category)!
      return `<h3 class="cat" id="cat-${g.category}">${iconSvg(iconMarkup(cat.icon), 14, '#dc2626')}<span>${e(cat.label[lang])}</span><span class="cat-count">${g.nodes.length}</span></h3>${g.nodes.map(card).join('\n')}`
    })
    if (annotations.length) {
      const kindName = (n: GraphNode): string => (n.kind === 'text' ? S.annotationText : n.kind === 'image' ? S.annotationImage : S.annotationMap)
      const notes = annotations.map((n) => {
        const img = n.imageId ? images[n.imageId] : undefined
        const coords = n.kind === 'map' && n.data ? [n.data.lat, n.data.lon].filter((v) => v !== undefined && v !== null).join(', ') : ''
        return `<article class="card annotation"><header class="card-head"><div class="card-titles"><div class="kicker">${e(kindName(n))}</div>${
          n.kind !== 'text' && n.label ? `<div class="card-label">${e(n.label)}</div>` : ''
        }</div></header><div class="card-body">${n.kind === 'text' ? `<div class="notes-text">${e(n.label)}</div>` : ''}${
          img && isImageDataUrl(img) ? `<img class="annot-img" src="${img}" alt="">` : ''
        }${coords ? `<div class="small">${e(coords)}</div>` : ''}</div><footer class="card-meta">${e(S.created)} ${e(formatShortDateTime(n.createdAt, lang))}</footer></article>`
      })
      blocks.push(`<h3 class="cat" id="cat-annotations">${iconSvg(iconMarkup('StickyNote'), 14, '#dc2626')}<span>${e(S.annotations)}</span><span class="cat-count">${annotations.length}</span></h3>${notes.join('\n')}`)
    }
    parts.push(`<section class="chapter">${chapterHead('entities')}${blocks.join('\n') || `<p class="muted">${e(S.noProperties)}</p>`}</section>`)
  }

  // Liens ----------------------------------------------------------------------
  if (sections.links) {
    const rows = edges
      .map(
        (x) =>
          `<tr><td class="wrap">${nodeCell(x.source)}</td><td class="wrap rel-cell">${e(x.label)}</td><td class="wrap">${nodeCell(x.target)}</td><td class="wrap">${e(moduleName(x.sourceModule))}</td><td class="nowrap">${e(formatShortDateTime(x.createdAt, lang))}</td></tr>`
      )
      .join('')
    parts.push(`<section class="chapter">${chapterHead('links')}
${
  rows
    ? `<table class="grid links"><thead><tr><th>${e(S.from)}</th><th>${e(S.relation)}</th><th>${e(S.to)}</th><th>${e(S.module)}</th><th>${e(S.when)}</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">${e(S.noLinks)}</p>`
}
</section>`)
  }

  // Chronologie ----------------------------------------------------------------
  if (sections.timeline) {
    // Mêmes dates que la frise : champs de date des fiches (naissance, création, fuite...).
    const events = collectEvents(entities)
    const rows = events
      .slice(0, MAX_EVENT_ROWS)
      .map((ev) => {
        const field = ev.field ? ev.field[lang] : propertyLabel(ev.key, lang)
        return `<tr><td class="nowrap">${e(formatEventDate(ev.t, ev.precision, lang))}</td><td class="wrap">${nodeCell(ev.nodeId)}</td><td class="wrap">${e(typeLabel(ev.node.type, lang))}</td><td class="wrap">${e(field)}</td></tr>`
      })
      .join('')
    parts.push(`<section class="chapter">${chapterHead('timeline')}
${
  rows
    ? `<p class="muted small">${e(fmt(S.timelineIntro, { count: events.length }))}</p>${events.length > MAX_EVENT_ROWS ? `<p class="muted small">${e(fmt(S.timelineTruncated, { count: MAX_EVENT_ROWS }))}</p>` : ''}<table class="grid timeline"><thead><tr><th>${e(S.when)}</th><th>${e(S.entity)}</th><th>${e(S.type)}</th><th>${e(S.event)}</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">${e(S.timelineEmpty)}</p>`
}
</section>`)
  }

  // Sources et modules ---------------------------------------------------------
  if (sections.sources) {
    const runs = [...input.runs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    const stats = new Map<string, { runs: number; results: number; errors: number; created: number }>()
    if (input.runStats)
      for (const s of input.runStats) stats.set(s.moduleId, { runs: s.runs, results: s.results, errors: s.errors, created: 0 })
    else
      for (const r of runs) {
        const s = stats.get(r.moduleId) ?? { runs: 0, results: 0, errors: 0, created: 0 }
        s.runs++
        s.results += r.resultCount || 0
        if (r.status === 'error') s.errors++
        stats.set(r.moduleId, s)
      }
    for (const n of entities) {
      if (!n.source || n.source === 'manual') continue
      const s = stats.get(n.source) ?? { runs: 0, results: 0, errors: 0, created: 0 }
      s.created++
      stats.set(n.source, s)
    }
    const moduleRows = Array.from(stats.entries())
      .sort((a, b) => moduleName(a[0]).localeCompare(moduleName(b[0]), lang))
      .map(([id, s]) => {
        const m = moduleById.get(id)
        const href = m?.homepage ? safeHttpUrl(m.homepage) : null
        return `<tr><td class="wrap">${e(moduleName(id))}</td><td class="wrap">${href ? `<a href="${e(href)}">${e(href.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : '<span class="muted">·</span>'}</td><td class="num">${s.runs}</td><td class="num">${s.results}</td><td class="num">${s.errors}</td><td class="num">${s.created}</td></tr>`
      })
      .join('')
    const statusName = (r: ModuleRun): string => S.statuses[r.status] ?? r.status
    const shown = runs.slice(0, MAX_RUN_ROWS)
    const runRows = shown
      .map((r) => {
        const detail = r.error ? r.error : r.found === true ? S.foundYes : r.found === false ? S.foundNo : ''
        return `<tr class="st-${r.status}"><td class="nowrap">${e(formatShortDateTime(r.startedAt ?? r.finishedAt, lang))}</td><td class="wrap">${e(moduleName(r.moduleId))}</td><td class="wrap">${nodeCell(r.nodeId)}</td><td class="nowrap"><span class="status">${e(statusName(r))}</span></td><td class="num">${r.resultCount}</td><td class="wrap small">${e(detail.length > 160 ? `${detail.slice(0, 160)}…` : detail)}</td></tr>`
      })
      .join('')
    parts.push(`<section class="chapter">${chapterHead('sources')}
${
  runs.length || moduleRows
    ? `<h3>${e(S.modulesUsed)}</h3><table class="grid"><thead><tr><th>${e(S.module)}</th><th>${e(S.service)}</th><th class="num">${e(S.runsCount)}</th><th class="num">${e(S.results)}</th><th class="num">${e(S.errors)}</th><th class="num">${e(S.stats.entities)}</th></tr></thead><tbody>${moduleRows}</tbody></table>`
    : ''
}
${
  runs.length
    ? `<h3>${e(S.runsLog)}</h3>${runTotal > shown.length ? `<p class="muted small">${e(fmt(S.runsTruncated, { count: shown.length, total: runTotal }))}</p>` : ''}<table class="grid runs"><thead><tr><th>${e(S.when)}</th><th>${e(S.module)}</th><th>${e(S.entity)}</th><th>${e(S.status)}</th><th class="num">${e(S.results)}</th><th>${e(S.detail)}</th></tr></thead><tbody>${runRows}</tbody></table>`
    : `<p class="muted">${e(S.noRuns)}</p>`
}
</section>`)
  }

  // Pièces jointes et empreintes -----------------------------------------------
  if (sections.attachments) {
    const users = new Map<string, GraphNode[]>()
    for (const n of input.nodes) if (n.imageId) users.set(n.imageId, [...(users.get(n.imageId) ?? []), n])
    const atts = (input.attachments ?? []).filter((a) => users.has(a.id)).sort((a, b) => a.name.localeCompare(b.name, lang))
    const rows = atts
      .map((a) => {
        const origin = a.origin ? safeHttpUrl(a.origin) : null
        const usedBy = users
          .get(a.id)!
          .map((n) => (refs.has(n.id) ? nodeCell(n.id) : e(n.label || S.annotationImage)))
          .join(', ')
        return `<tr><td class="wrap">${e(a.name)}<div class="small muted">${e(a.mime)} · ${e(formatNumber(a.size, lang))} ${e(S.bytes)}</div></td><td class="wrap"><code class="hash">${e(a.sha256)}</code></td><td class="wrap small">${
          origin ? `<a href="${e(origin)}">${e(origin)}</a>` : `<span class="muted">${e(S.originUnknown)}</span>`
        }</td><td class="wrap">${usedBy}</td></tr>`
      })
      .join('')
    parts.push(`<section class="chapter">${chapterHead('attachments')}
${
  rows
    ? `<p class="muted small">${e(S.attachmentsIntro)}</p><table class="grid attachments"><thead><tr><th>${e(S.fileName)}</th><th>SHA-256</th><th>${e(S.origin)}</th><th>${e(S.usedBy)}</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">${e(S.attachmentsEmpty)}</p>`
}
</section>`)
  }

  // Annexe ---------------------------------------------------------------------
  if (sections.raw) {
    const json = (v: unknown): string => {
      let s = ''
      try {
        s = JSON.stringify(v, null, 2) ?? ''
      } catch {
        s = String(v)
      }
      return s.length > MAX_RAW_CHARS ? `${s.slice(0, MAX_RAW_CHARS)}\n${S.rawTruncated}` : s
    }
    const ents = entities
      .map(
        (n) =>
          `<div class="raw"><div class="raw-head">${refTag(n.id)} ${e(n.label)}</div><pre>${e(
            json({
              id: n.id,
              type: n.type,
              platform: n.platform,
              label: n.label,
              data: n.data,
              notes: n.notes || undefined,
              source: n.source,
              imageId: n.imageId ?? undefined,
              createdAt: isoDate(n.createdAt),
              updatedAt: isoDate(n.updatedAt)
            })
          )}</pre></div>`
      )
      .join('')
    const raws = (input.rawRuns ?? [])
      .filter((r) => r.raw !== null && r.raw !== undefined)
      .map(
        ({ run, raw }) =>
          `<div class="raw"><div class="raw-head">${e(moduleName(run.moduleId))} · ${nodeCell(run.nodeId)} · ${e(formatShortDateTime(run.startedAt, lang))}</div><pre>${e(json(raw))}</pre></div>`
      )
      .join('')
    parts.push(`<section class="chapter">${chapterHead('raw')}
<h3>${e(S.rawEntities)}</h3>${ents}
${raws ? `<h3>${e(S.rawModules)}</h3>${raws}` : ''}
</section>`)
  }

  // Traçabilité ----------------------------------------------------------------
  const trace = [
    fmt(S.generatedOn, { date: formatDateTime(input.generatedAt, lang, true) }),
    input.appVersion ? fmt(S.generatedBy, { version: input.appVersion }) : '',
    input.platform ? fmt(S.platformOs, { platform: input.platform }) : '',
    fmt(S.investigationId, { id: investigation.id })
  ].filter(Boolean)
  parts.push(`<section class="chapter trace" id="s-trace"><h2 class="chapter-title"><span class="num">${enabled.length + 1}</span>${e(S.traceability)}</h2>
<ul class="trace-list">${trace.map((t) => `<li>${e(t)}</li>`).join('')}</ul>
${input.fingerprint ? `<div class="fingerprint"><div class="card-sub">${e(S.fingerprint)}</div><code>${e(input.fingerprint)}</code><p class="small muted">${e(S.fingerprintScope)}</p></div>` : ''}
<p class="disclaimer">${e(S.disclaimer)}</p>
</section>`)

  // Page de garde --------------------------------------------------------------
  const classification = options.classification.trim()
  const metaRows: Array<[string, string]> = [
    [S.reference, options.reference.trim()],
    [S.investigator, options.investigator.trim()],
    [S.date, formatDateTime(input.generatedAt, lang, true)],
    [S.investigation, investigation.name],
    [S.openedOn, formatDate(investigation.createdAt, lang)]
  ]
  const cover = `<section class="cover">
<div class="cover-top">${logoHtml(34)}<div class="wordmark">MASINT</div>${classification ? `<div class="classif">${e(classification)}</div>` : ''}</div>
<div class="cover-rule"></div>
<div class="cover-main">
<div class="cover-kicker">${e(S.kicker)}</div>
<h1>${e(title)}</h1>
${investigation.description?.trim() ? `<p class="cover-desc">${e(investigation.description.trim())}</p>` : ''}
</div>
<table class="cover-meta"><tbody>${metaRows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`)
    .join('')}</tbody></table>
<div class="cover-foot">${e(input.appVersion ? `MASINT ${input.appVersion}` : 'MASINT')}</div>
</section>`

  const runHead = `<div class="runhead"><span class="rh-left">${logoHtml(11)}<span>${e(title)}</span></span><span class="rh-right">${
    options.reference.trim() ? `<span>${e(options.reference.trim())}</span>` : ''
  }${classification ? `<span class="rh-classif">${e(classification)}</span>` : ''}</span></div>`

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="generator" content="MASINT${input.appVersion ? ` ${e(input.appVersion)}` : ''}">
<title>${e(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
${cover}
<table class="frame"><thead><tr><td>${runHead}</td></tr></thead><tbody><tr><td>
${parts.join('\n')}
</td></tr></tbody></table>
</body>
</html>
`
}

const REPORT_CSS = `
@page{size:A4}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:#18181b;font:9.5pt/1.45 system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif;-webkit-font-smoothing:antialiased}
a{color:#b91c1c;text-decoration:none}
h1,h2,h3{font-weight:600;color:#18181b}
.muted{color:#63636b}
.small{font-size:8pt}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.nowrap{white-space:nowrap}
.wrap{overflow-wrap:anywhere}
code,pre{font-family:'JetBrains Mono','Cascadia Mono',Consolas,'DejaVu Sans Mono',ui-monospace,monospace}

/* Page de garde */
.cover{height:262mm;display:flex;flex-direction:column;padding:6mm 4mm 0;break-after:page;page-break-after:always;position:relative}
.cover-top{display:flex;align-items:center;gap:10px}
.wordmark{font-size:15pt;font-weight:800;letter-spacing:.06em}
.classif{margin-left:auto;border:1.5px solid #dc2626;color:#dc2626;border-radius:4px;padding:4px 10px;font-size:8.5pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.cover-rule{margin-top:9mm;width:42mm;height:2px;background:#dc2626}
.cover-main{margin-top:52mm}
.cover-kicker{font-size:8.5pt;letter-spacing:.2em;text-transform:uppercase;color:#dc2626;font-weight:600}
.cover h1{font-size:27pt;line-height:1.15;margin:4mm 0 0;letter-spacing:-.01em;overflow-wrap:anywhere}
.cover-desc{font-size:11pt;color:#52525b;margin:5mm 0 0;max-width:150mm;white-space:pre-wrap}
.cover-meta{margin-top:auto;border-collapse:collapse;width:100%;font-size:9.5pt}
.cover-meta th{text-align:left;font-weight:500;color:#71717a;width:48mm;padding:2.2mm 0;border-top:1px solid #e4e4e7;font-size:8pt;letter-spacing:.08em;text-transform:uppercase}
.cover-meta td{padding:2.2mm 0;border-top:1px solid #e4e4e7;font-weight:500}
.cover-foot{margin-top:6mm;font-size:7.5pt;color:#a1a1aa}

/* Cadre : l'en-tête du tableau se répète sur chaque page imprimée */
table.frame{width:100%;border-collapse:collapse}
table.frame>thead>tr>td,table.frame>tbody>tr>td{padding:0}
.runhead{display:flex;align-items:center;justify-content:space-between;gap:8mm;font-size:7pt;color:#71717a;padding:0 0 2mm;margin-bottom:5mm;border-bottom:1px solid #e4e4e7}
.rh-left{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rh-right{display:flex;gap:10px;white-space:nowrap}
.rh-classif{color:#dc2626;font-weight:700;letter-spacing:.1em;text-transform:uppercase}

/* Chapitres */
.chapter{break-before:page;page-break-before:always}
.chapter:first-child{break-before:auto;page-break-before:auto}
.chapter-title{display:flex;align-items:center;gap:10px;font-size:16pt;margin:0 0 5mm;padding-bottom:2.5mm;border-bottom:1.5px solid #18181b;break-after:avoid}
.chapter-title .num{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 5px;border-radius:5px;background:#dc2626;color:#fff;font-size:10pt;font-weight:700}
h3{font-size:10.5pt;margin:6mm 0 2.5mm;break-after:avoid}

/* Sommaire */
.toc-list{list-style:none;margin:0;padding:0;font-size:11pt}
.toc-list>li{padding:2.6mm 0;border-bottom:1px solid #e4e4e7}
.toc-list a{color:#18181b;display:flex;align-items:center;gap:10px}
.toc-num{display:inline-block;min-width:8mm;color:#dc2626;font-weight:700}
.toc-sub{list-style:none;margin:1.5mm 0 0 18mm;padding:0;font-size:9pt;columns:2;column-gap:10mm}
.toc-sub li{display:flex;justify-content:space-between;gap:6px;padding:.6mm 0;break-inside:avoid}
.toc-sub a{color:#52525b}
.toc-count{color:#a1a1aa;font-variant-numeric:tabular-nums}

/* Synthèse */
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:2.5mm;margin-bottom:4mm}
.tile{border:1px solid #e4e4e7;border-radius:6px;padding:2.8mm 4mm;break-inside:avoid}
.tile-value{font-size:17pt;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums}
.tile-label{font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;color:#71717a;margin-top:1mm}
.tile:first-child{border-top:2px solid #dc2626}
table.kv{border-collapse:collapse;font-size:9pt;margin-bottom:2mm}
table.kv th{text-align:left;font-weight:500;color:#63636b;padding:1.2mm 8mm 1.2mm 0}
table.kv td{padding:1.2mm 0;font-variant-numeric:tabular-nums}
.cols{display:grid;grid-template-columns:1fr 1.4fr;gap:6mm}
.summary table.grid td{padding:1.1mm 2mm}
.summary h3{margin:5mm 0 2mm}
.cols>div{min-width:0}
.cat-ico{display:inline-flex;vertical-align:-2px;margin-right:6px}
.bar-cell{width:45%;position:relative}
.bar{display:inline-block;height:7px;border-radius:2px;background:#dc2626;opacity:.75;vertical-align:middle;max-width:80%}
.pct{margin-left:6px;color:#71717a;font-size:8pt;font-variant-numeric:tabular-nums}

/* Tableaux */
table.grid{width:100%;border-collapse:collapse;font-size:8.5pt}
table.grid thead{display:table-header-group}
table.grid th{text-align:left;font-weight:600;color:#3f3f46;background:#f4f4f5;padding:1.6mm 2mm;border-bottom:1px solid #d4d4d8;font-size:7.5pt;letter-spacing:.05em;text-transform:uppercase}
table.grid td{padding:1.5mm 2mm;border-bottom:1px solid #ececef;vertical-align:top}
table.grid tr{break-inside:avoid;page-break-inside:avoid}
table.links td:first-child,table.links td:nth-child(3){width:27%}
table.links td:nth-child(2){width:15%}
table.links td:nth-child(4){width:16%}
.rel-cell{color:#52525b;font-style:italic}
.ref{display:inline-block;font-family:'JetBrains Mono',Consolas,ui-monospace,monospace;font-size:7pt;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:3px;padding:0 3px;line-height:1.5;vertical-align:1px}
.ref.big{font-size:8pt;padding:1px 5px;margin-left:auto;align-self:flex-start}
table.runs td:first-child{width:24mm}
table.timeline td:first-child{width:30mm}
code.hash{font-size:7pt;overflow-wrap:anywhere;word-break:break-all}
.status{display:inline-block;font-size:7pt;border-radius:3px;padding:0 4px;background:#f4f4f5;color:#3f3f46}
tr.st-done .status{background:#ecfdf3;color:#15803d}
tr.st-error .status{background:#fef2f2;color:#b91c1c}
tr.st-skipped .status,tr.st-cancelled .status{color:#a1a1aa}

/* Graphe */
figure.graph{margin:0;break-inside:avoid}
figure.graph img{display:block;max-width:100%;max-height:220mm;margin:0 auto;border:1px solid #e4e4e7;border-radius:6px}
figure.graph figcaption{margin-top:2.5mm;font-size:8pt;color:#71717a;text-align:center}

/* Notes */
.prose{font-size:10pt;line-height:1.55}
.prose h3,.prose h4,.prose h5,.prose h6{margin:5mm 0 2mm}
.prose h4{font-size:10pt}
.prose p{margin:0 0 3mm}
.prose ul,.prose ol{margin:0 0 3mm;padding-left:6mm}
.prose li.task{list-style:none;margin-left:-5mm}
.prose blockquote{margin:0 0 3mm;padding:1mm 0 1mm 4mm;border-left:2px solid #dc2626;color:#52525b}
.prose pre{background:#f4f4f5;border-radius:4px;padding:3mm;font-size:8pt;white-space:pre-wrap;overflow-wrap:anywhere}
.prose code{font-size:8.5pt;background:#f4f4f5;border-radius:3px;padding:0 3px}
.prose pre code{background:none;padding:0}
.prose hr{border:0;border-top:1px solid #e4e4e7;margin:4mm 0}

/* Fiches */
h3.cat{display:flex;align-items:center;gap:7px;font-size:11.5pt;margin:7mm 0 3mm;padding-bottom:1.5mm;border-bottom:1px solid #e4e4e7}
h3.cat:first-of-type{margin-top:0}
.cat-count{margin-left:auto;font-size:8.5pt;color:#a1a1aa;font-weight:500}
.card{border:1px solid #e4e4e7;border-radius:6px;margin:0 0 3.5mm;break-inside:avoid;page-break-inside:avoid;overflow:hidden}
.card-head{display:flex;align-items:center;gap:9px;padding:2.5mm 3mm;background:#fafafa;border-bottom:1px solid #ececef}
.card-head img.mx-badge{border-radius:5px}
.card-titles{min-width:0}
.kicker{font-size:6.8pt;letter-spacing:.1em;text-transform:uppercase;color:#71717a;font-weight:600}
.card-label{font-size:10.5pt;font-weight:600;overflow-wrap:anywhere}
.card-body{padding:2.5mm 3mm;display:flex;gap:4mm}
.card-main{flex:1;min-width:0}
.card-img{width:34mm;height:34mm;object-fit:cover;border-radius:5px;border:1px solid #e4e4e7;flex-shrink:0;order:2}
.annot-img{max-width:100%;max-height:90mm;border-radius:5px;border:1px solid #e4e4e7}
table.props{width:100%;border-collapse:collapse;font-size:8.5pt}
table.props th{text-align:left;font-weight:500;color:#63636b;width:36%;padding:1mm 3mm 1mm 0;vertical-align:top;border-bottom:1px solid #f1f1f3}
table.props td{padding:1mm 0;overflow-wrap:anywhere;vertical-align:top;border-bottom:1px solid #f1f1f3}
.card-sub{font-size:6.8pt;letter-spacing:.1em;text-transform:uppercase;color:#71717a;font-weight:600;margin:2.5mm 0 1mm}
.notes-text{white-space:pre-wrap;font-size:8.5pt;background:#fafafa;border-left:2px solid #dc2626;padding:1.5mm 2.5mm;overflow-wrap:anywhere}
.card-links ul{list-style:none;margin:0;padding:0;font-size:8.5pt}
.card-links li{padding:.4mm 0;overflow-wrap:anywhere}
.card-links .dir{color:#a1a1aa;margin-right:4px}
.card-links .rel{color:#52525b;font-style:italic;margin-right:5px}
.card-meta{font-size:7pt;color:#a1a1aa;padding:1.5mm 3mm;border-top:1px solid #f1f1f3}
.card-rating{font-size:7.5pt;color:#52525b;margin:0 0 1.5mm}
.rating-code{display:inline-block;font-family:'JetBrains Mono',Consolas,ui-monospace,monospace;font-weight:700;font-size:8pt;color:#18181b;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:3px;padding:0 4px;margin-right:4px}
.card.annotation .card-body{display:block}

/* Annexe */
.raw{margin:0 0 3mm}
.raw-head{font-size:8pt;font-weight:600;margin-bottom:1mm;break-after:avoid}
.raw pre{margin:0;font-size:6.8pt;line-height:1.35;background:#fafafa;border:1px solid #ececef;border-radius:4px;padding:2mm 2.5mm;white-space:pre-wrap;overflow-wrap:anywhere}

/* Traçabilité */
.trace-list{margin:0 0 4mm;padding-left:5mm;font-size:9.5pt}
.trace-list li{padding:.6mm 0}
.fingerprint{border:1px solid #e4e4e7;border-radius:6px;padding:2.5mm 3.5mm;margin-bottom:5mm;break-inside:avoid}
.fingerprint code{font-size:8pt;overflow-wrap:anywhere}
.disclaimer{font-size:8pt;color:#71717a;border-top:1px solid #e4e4e7;padding-top:3mm}
@media screen{
body{background:#e9e9ec;padding:8mm 4mm}
.cover,table.frame{background:#fff;max-width:210mm;margin:0 auto;box-shadow:0 2px 12px rgb(0 0 0/.12)}
.cover{height:auto;min-height:270mm;padding:14mm 16mm;margin-bottom:8mm}
table.frame>thead>tr>td{padding:10mm 16mm 0}
table.frame>tbody>tr>td{padding:0 16mm 14mm}
.chapter+.chapter{margin-top:12mm;padding-top:10mm;border-top:1px dashed #d4d4d8}
}
`
