// Exports vers les outils d'analyse de graphes : GraphML (yEd, Gephi, Neo4j), GEXF 1.3
// (Gephi, avec dates) et CSV « Import graph from table » de Maltego.
// Seules les entités sont exportées (les annotations du canevas n'ont pas de sens dans ces
// outils), avec type, libellé, plateforme, propriétés et liens. Fonctions pures.

import { getEntityType } from '@shared/entityTypes'
import type { GraphEdge, GraphNode, Investigation, Lang, PropValue } from '@shared/types'
import { collectEvents } from '../../lib/timeline'
import { exportStrings, typeLabel } from './format'

export interface GraphExportInput {
  investigation: Investigation
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Entités exportées et liens entre elles. */
function entityGraph(input: GraphExportInput): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = input.nodes.filter((n) => n.kind === 'entity')
  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, edges: input.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }
}

/**
 * Texte inséré dans un document XML : caractères spéciaux échappés, caractères interdits en
 * XML 1.0 (contrôles, demi-paires UTF-16 isolées) retirés. Les données viennent de sources
 * non fiables : un caractère de contrôle rendrait le fichier illisible.
 */
export function xmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Valeur de propriété en texte : listes et objets en JSON, pour rester exploitables. */
export function propText(v: PropValue | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** Clés de propriétés renseignées, les plus fréquentes d'abord. */
function propertyKeys(nodes: GraphNode[]): string[] {
  const count = new Map<string, number>()
  for (const n of nodes)
    for (const [k, v] of Object.entries(n.data ?? {})) if (propText(v) !== '') count.set(k, (count.get(k) ?? 0) + 1)
  return Array.from(count.keys()).sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b))
}

const iso = (ts: number): string => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** Libellé Neo4j d'un type (`crypto_wallet` → `CryptoWallet`). */
const neoLabel = (type: string): string =>
  type
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('') || 'Entity'

// ---------------------------------------------------------------------------
// GraphML

/**
 * Document GraphML : chaque attribut est déclaré par une balise `key` (nœuds puis liens).
 * L'attribut `labels` des nœuds (`:Entity:Phone`) est celui que lit `apoc.import.graphml`.
 */
export function buildGraphMl(input: GraphExportInput, lang: Lang): string {
  const { nodes, edges } = entityGraph(input)
  const props = propertyKeys(nodes)
  const nodeKeys: Array<[string, string, string]> = [
    ['labels', 'labels', 'string'],
    ['label', 'label', 'string'],
    ['type', 'type', 'string'],
    ['type_label', 'type_label', 'string'],
    ['platform', 'platform', 'string'],
    ['source', 'source', 'string'],
    ['notes', 'notes', 'string'],
    ['created_at', 'created_at', 'string'],
    ['updated_at', 'updated_at', 'string'],
    ['x', 'x', 'double'],
    ['y', 'y', 'double']
  ]
  const propId = new Map(props.map((k, i) => [k, `p${i}`]))
  const keyLines = [
    ...nodeKeys.map(([id, name, type]) => `  <key id="n_${id}" for="node" attr.name="${name}" attr.type="${type}"/>`),
    ...props.map((k) => `  <key id="${propId.get(k)}" for="node" attr.name="${xmlText(k)}" attr.type="string"/>`),
    '  <key id="e_label" for="edge" attr.name="label" attr.type="string"/>',
    '  <key id="e_source_module" for="edge" attr.name="source_module" attr.type="string"/>',
    '  <key id="e_created_at" for="edge" attr.name="created_at" attr.type="string"/>'
  ]
  const data = (key: string, value: unknown): string => {
    const s = typeof value === 'number' ? String(value) : xmlText(value)
    return s === '' ? '' : `<data key="${key}">${s}</data>`
  }
  const nodeLines = nodes.map((n) => {
    const labels = `:Entity:${neoLabel(n.type)}`
    const cells = [
      data('n_labels', labels),
      data('n_label', n.label),
      data('n_type', n.type),
      data('n_type_label', typeLabel(n.type, lang)),
      data('n_platform', n.platform ?? ''),
      data('n_source', n.source),
      data('n_notes', n.notes),
      data('n_created_at', iso(n.createdAt)),
      data('n_updated_at', iso(n.updatedAt)),
      data('n_x', Math.round(n.x * 100) / 100),
      data('n_y', Math.round(n.y * 100) / 100),
      ...props.map((k) => data(propId.get(k)!, propText(n.data?.[k])))
    ].filter(Boolean)
    return `    <node id="${xmlText(n.id)}" labels="${xmlText(labels)}">${cells.join('')}</node>`
  })
  const edgeLines = edges.map(
    (e) =>
      `    <edge id="${xmlText(e.id)}" source="${xmlText(e.source)}" target="${xmlText(e.target)}" label="${xmlText(e.label)}">${[
        data('e_label', e.label),
        data('e_source_module', e.sourceModule),
        data('e_created_at', iso(e.createdAt))
      ].join('')}</edge>`
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">',
    ...keyLines,
    `  <graph id="${xmlText(input.investigation.id)}" edgedefault="directed">`,
    `    <desc>${xmlText(input.investigation.name)}</desc>`,
    ...nodeLines,
    ...edgeLines,
    '  </graph>',
    '</graphml>',
    ''
  ].join('\n')
}

// ---------------------------------------------------------------------------
// GEXF 1.3

const hexRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null
}

/**
 * Document GEXF 1.3. Les nœuds datés (naissance, création d'un domaine, fuite...) reçoivent
 * `start`, leur date la plus ancienne (mêmes champs que la frise) : Gephi peut alors animer
 * le graphe dans le temps. Couleur du type et position du canevas en `viz`.
 */
export function buildGexf(input: GraphExportInput, lang: Lang, exportedAt: Date = new Date()): string {
  const { nodes, edges } = entityGraph(input)
  const props = propertyKeys(nodes)
  const fixed: Array<[string, string]> = [
    ['type', 'type'],
    ['type_label', 'type_label'],
    ['platform', 'platform'],
    ['source', 'source'],
    ['notes', 'notes'],
    ['created_at', 'created_at']
  ]
  const propId = new Map(props.map((k, i) => [k, `p${i}`]))
  // Date la plus ancienne de chaque nœud (événements triés par date).
  const start = new Map<string, string>()
  for (const ev of collectEvents(nodes)) if (!start.has(ev.nodeId)) start.set(ev.nodeId, new Date(ev.t).toISOString().slice(0, 10))
  const dynamic = start.size > 0
  const attr = (id: string, value: string): string => (value === '' ? '' : `<attvalue for="${id}" value="${xmlText(value)}"/>`)
  const nodeLines = nodes.map((n) => {
    const values = [
      attr('type', n.type),
      attr('type_label', typeLabel(n.type, lang)),
      attr('platform', n.platform ?? ''),
      attr('source', n.source),
      attr('notes', n.notes),
      attr('created_at', iso(n.createdAt)),
      ...props.map((k) => attr(propId.get(k)!, propText(n.data?.[k])))
    ].join('')
    const color = hexRgb(n.style?.color ?? getEntityType(n.type).color)
    const viz = [
      color ? `<viz:color r="${color.r}" g="${color.g}" b="${color.b}"/>` : '',
      // Axe vertical inversé : Gephi compte vers le haut, le canevas vers le bas.
      `<viz:position x="${Math.round(n.x * 100) / 100}" y="${Math.round(-n.y * 100) / 100}" z="0"/>`
    ].join('')
    const s = start.get(n.id)
    return `      <node id="${xmlText(n.id)}" label="${xmlText(n.label)}"${s ? ` start="${s}"` : ''}><attvalues>${values}</attvalues>${viz}</node>`
  })
  const edgeLines = edges.map(
    (e) =>
      `      <edge id="${xmlText(e.id)}" source="${xmlText(e.source)}" target="${xmlText(e.target)}" label="${xmlText(e.label)}"><attvalues>${attr(
        'source_module',
        e.sourceModule
      )}${attr('created_at', iso(e.createdAt))}</attvalues></edge>`
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gexf xmlns="http://gexf.net/1.3" xmlns:viz="http://gexf.net/1.3/viz" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://gexf.net/1.3 http://gexf.net/1.3/gexf.xsd" version="1.3">',
    `  <meta lastmodifieddate="${exportedAt.toISOString().slice(0, 10)}"><creator>MASINT</creator><description>${xmlText(input.investigation.name)}</description></meta>`,
    `  <graph defaultedgetype="directed" mode="${dynamic ? 'dynamic' : 'static'}"${dynamic ? ' timeformat="date"' : ''}>`,
    '    <attributes class="node">',
    ...fixed.map(([id, title]) => `      <attribute id="${id}" title="${title}" type="string"/>`),
    ...props.map((k) => `      <attribute id="${propId.get(k)}" title="${xmlText(k)}" type="string"/>`),
    '    </attributes>',
    '    <attributes class="edge">',
    '      <attribute id="source_module" title="source_module" type="string"/>',
    '      <attribute id="created_at" title="created_at" type="string"/>',
    '    </attributes>',
    '    <nodes>',
    ...nodeLines,
    '    </nodes>',
    '    <edges>',
    ...edgeLines,
    '    </edges>',
    '  </graph>',
    '</gexf>',
    ''
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Maltego

/** Type d'entité Maltego correspondant à un type MASINT (`maltego.Phrase` par défaut). */
const MALTEGO_TYPES: Record<string, string> = {
  person: 'maltego.Person',
  username: 'maltego.Alias',
  account: 'maltego.Alias',
  phone: 'maltego.PhoneNumber',
  email: 'maltego.EmailAddress',
  domain: 'maltego.Domain',
  website: 'maltego.Website',
  url: 'maltego.URL',
  search_link: 'maltego.URL',
  ip: 'maltego.IPv4Address',
  asn: 'maltego.AS',
  cidr: 'maltego.Netblock',
  company: 'maltego.Company',
  hosting: 'maltego.Company',
  carrier: 'maltego.Company',
  bank: 'maltego.Company',
  organization: 'maltego.Organization',
  group: 'maltego.Organization',
  school: 'maltego.Organization',
  administration: 'maltego.Organization',
  address: 'maltego.Location',
  city: 'maltego.Location',
  country: 'maltego.Location',
  place: 'maltego.Location',
  coordinates: 'maltego.Location',
  hash: 'maltego.Hash',
  iban: 'maltego.BankAccount',
  crypto_wallet: 'maltego.CryptocurrencyAddress',
  crypto_tx: 'maltego.CryptocurrencyTransaction',
  photo: 'maltego.Image',
  document: 'maltego.Document',
  file: 'maltego.Document',
  device: 'maltego.Device'
}

export function maltegoType(n: Pick<GraphNode, 'type' | 'label'>): string {
  if (n.type === 'ip' && n.label.includes(':')) return 'maltego.IPv6Address'
  return MALTEGO_TYPES[n.type] ?? 'maltego.Phrase'
}

/** Cellule CSV (séparateur virgule), formules neutralisées comme dans les autres exports CSV. */
function maltegoCell(value: string): string {
  let s = value
  const numeric = /^[+-]?[\d\s().]*$/.test(s)
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !numeric)) s = `'${s}`
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV pour « Import graph from table » de Maltego : une ligne par lien (source, type Maltego
 * de la source, cible, type Maltego de la cible, libellé du lien), puis une ligne par entité
 * sans lien (colonnes de cible vides) pour ne rien perdre.
 */
export function buildMaltegoCsv(input: GraphExportInput, lang: Lang): string {
  const { nodes, edges } = entityGraph(input)
  const h = exportStrings(lang).exportx.maltego
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const value = (n: GraphNode): string => n.label || typeLabel(n.type, lang)
  const rows: string[][] = [[h.source, h.sourceType, h.target, h.targetType, h.linkLabel]]
  const linked = new Set<string>()
  for (const e of edges) {
    const a = byId.get(e.source)!
    const b = byId.get(e.target)!
    linked.add(a.id).add(b.id)
    rows.push([value(a), maltegoType(a), value(b), maltegoType(b), e.label])
  }
  for (const n of nodes) if (!linked.has(n.id)) rows.push([value(n), maltegoType(n), '', '', ''])
  return rows.map((r) => r.map(maltegoCell).join(',')).join('\r\n') + '\r\n'
}
