// Exports GraphML, GEXF 1.3 et CSV Maltego : documents bien formés, attributs déclarés,
// dates, correspondance des types. Valeurs fictives uniquement.

import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, Investigation } from '@shared/types'
import { buildGexf, buildGraphMl, buildMaltegoCsv, maltegoType, xmlText } from '../src/renderer/src/components/export/graphFormats'
import { findAll, parseXml } from './helpers/xml'

const T0 = Date.UTC(2026, 9, 20, 9, 30)

const investigation: Investigation = {
  id: 'inv-1',
  name: 'Affaire <Alpha> & co',
  description: '',
  color: '#e5484d',
  createdAt: T0,
  updatedAt: T0,
  notes: '',
  viewport: null
}

const node = (over: Partial<GraphNode>): GraphNode => ({
  id: 'n',
  investigationId: 'inv-1',
  kind: 'entity',
  type: 'phone',
  label: '',
  platform: null,
  data: {},
  notes: '',
  imageId: null,
  x: 0,
  y: 0,
  width: null,
  height: null,
  style: {},
  source: 'manual',
  createdAt: T0,
  updatedAt: T0,
  ...over
})

const edge = (over: Partial<GraphEdge>): GraphEdge => ({
  id: 'e',
  investigationId: 'inv-1',
  source: '',
  target: '',
  label: '',
  data: {},
  style: {},
  sourceModule: 'manual',
  createdAt: T0,
  updatedAt: T0,
  ...over
})

const nodes: GraphNode[] = [
  node({ id: 'h1', type: 'person', label: 'Alice <script>"Exemple"</script>', data: { birth_date: '1980-01-02', aliases: ['A. E.', 'Alice E'] }, x: 10, y: 20 }),
  node({ id: 'p1', type: 'phone', label: '+33639981234', data: { carrier: 'Opérateur & fils', country: 'France\u0001' }, notes: "ligne 1\nl'autre" }),
  node({ id: 'm1', type: 'email', label: 'alice@example.com', platform: 'gmail', data: { breach_count: 2 } }),
  node({ id: 'i6', type: 'ip', label: '2001:db8::1' }),
  node({ id: 'c1', type: 'company', label: 'Exemple, SARL' }),
  node({ id: 'k1', type: 'keyword', label: '=HYPERLINK("x")' }),
  node({ id: 't1', kind: 'text', type: 'text', label: 'Note du canevas' })
]

const edges: GraphEdge[] = [
  edge({ id: 'e1', source: 'h1', target: 'p1', label: 'utilise' }),
  edge({ id: 'e2', source: 'p1', target: 'm1', label: 'compte lié', sourceModule: 'phone.links' }),
  edge({ id: 'e3', source: 'h1', target: 'c1', label: 'dirige' }),
  edge({ id: 'e4', source: 'h1', target: 't1', label: 'voir note' })
]

const input = { investigation, nodes, edges }

describe('vérificateur XML des tests', () => {
  it('refuse les documents mal formés', () => {
    for (const bad of ['<a><b></a>', '<a>&</a>', '<a x="1" x="2"/>', '<a x=1/>', '<a/><b/>', '<a>\u0001</a>', '<a>', 'texte'])
      expect(() => parseXml(bad), bad).toThrow()
    expect(parseXml('<?xml version="1.0"?><a x="&lt;"><b>t&amp;u</b></a>').children[0].text).toBe('t&u')
  })
})

describe('xmlText', () => {
  it('échappe et retire les caractères interdits', () => {
    expect(xmlText('a<b>&"\'\u0001\u0007c')).toBe('a&lt;b&gt;&amp;&quot;&apos;c')
    expect(xmlText('\uD800x')).toBe('x')
    expect(xmlText('😀')).toBe('😀')
  })
})

describe('GraphML', () => {
  const xml = buildGraphMl(input, 'fr')
  const root = parseXml(xml)

  it('est un document bien formé', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(root.name).toBe('graphml')
    expect(root.attrs.xmlns).toBe('http://graphml.graphdrawing.org/xmlns')
  })

  it('déclare chaque attribut utilisé', () => {
    const keys = new Map(findAll(root, 'key').map((k) => [k.attrs.id, k]))
    for (const d of findAll(root, 'data')) {
      const key = keys.get(d.attrs.key)
      expect(key, d.attrs.key).toBeDefined()
      expect(key!.attrs.for).toBe(d.parent!.name)
    }
    const names = Array.from(keys.values()).map((k) => k.attrs['attr.name'])
    expect(names).toEqual(expect.arrayContaining(['label', 'type', 'platform', 'birth_date', 'aliases', 'carrier', 'breach_count']))
    for (const k of keys.values()) expect(['string', 'double']).toContain(k.attrs['attr.type'])
  })

  it('exporte les entités et les liens entre elles, sans les annotations', () => {
    const graph = findAll(root, 'graph')[0]
    expect(graph.attrs.edgedefault).toBe('directed')
    const ids = findAll(root, 'node').map((n) => n.attrs.id)
    expect(ids).toEqual(['h1', 'p1', 'm1', 'i6', 'c1', 'k1'])
    const es = findAll(root, 'edge')
    expect(es.map((e) => e.attrs.id)).toEqual(['e1', 'e2', 'e3'])
    for (const e of es) expect(ids).toContain(e.attrs.target)
  })

  it('garde libellés, types, plateformes, propriétés et étiquettes Neo4j', () => {
    const keys = new Map(findAll(root, 'key').map((k) => [k.attrs.id, k.attrs['attr.name']]))
    const valuesOf = (id: string): Record<string, string> => {
      const n = findAll(root, 'node').find((x) => x.attrs.id === id)!
      return Object.fromEntries(n.children.map((d) => [keys.get(d.attrs.key)!, d.text]))
    }
    const h1 = valuesOf('h1')
    expect(h1.label).toBe('Alice <script>"Exemple"</script>')
    expect(h1.type).toBe('person')
    expect(h1.aliases).toBe('["A. E.","Alice E"]')
    expect(h1.labels).toBe(':Entity:Person')
    const p1 = valuesOf('p1')
    expect(p1.carrier).toBe('Opérateur & fils')
    expect(p1.country).toBe('France')
    expect(p1.notes).toBe("ligne 1\nl'autre")
    expect(valuesOf('m1').platform).toBe('gmail')
    expect(findAll(root, 'node').find((x) => x.attrs.id === 'm1')!.attrs.labels).toBe(':Entity:Email')
  })
})

describe('GEXF 1.3', () => {
  const xml = buildGexf(input, 'fr', new Date(T0))
  const root = parseXml(xml)

  it('est un document GEXF 1.3 bien formé', () => {
    expect(root.name).toBe('gexf')
    expect(root.attrs.version).toBe('1.3')
    expect(root.attrs.xmlns).toBe('http://gexf.net/1.3')
    expect(findAll(root, 'description')[0].text).toBe('Affaire <Alpha> & co')
  })

  it('date les nœuds qui ont une date (start), en mode dynamique', () => {
    const graph = findAll(root, 'graph')[0]
    expect(graph.attrs.mode).toBe('dynamic')
    expect(graph.attrs.timeformat).toBe('date')
    const byId = new Map(findAll(root, 'node').map((n) => [n.attrs.id, n]))
    expect(byId.get('h1')!.attrs.start).toBe('1980-01-02')
    expect(byId.get('p1')!.attrs.start).toBeUndefined()
    expect(byId.has('t1')).toBe(false)
  })

  it('déclare les attributs et les référence', () => {
    const declared = new Map<string, string>()
    for (const group of findAll(root, 'attributes')) for (const a of group.children) declared.set(`${group.attrs.class}:${a.attrs.id}`, a.attrs.title)
    for (const v of findAll(root, 'attvalue')) {
      const owner = v.parent!.parent!.name
      expect(declared.has(`${owner}:${v.attrs.for}`), `${owner}:${v.attrs.for}`).toBe(true)
    }
    expect(Array.from(declared.values())).toEqual(expect.arrayContaining(['type', 'platform', 'birth_date', 'carrier']))
  })

  it('reprend couleur et position', () => {
    const h1 = findAll(root, 'node').find((n) => n.attrs.id === 'h1')!
    const pos = h1.children.find((c) => c.name === 'viz:position')!
    expect(pos.attrs).toMatchObject({ x: '10', y: '-20' })
    expect(h1.children.some((c) => c.name === 'viz:color')).toBe(true)
    expect(findAll(root, 'edge').map((e) => e.attrs.label)).toEqual(['utilise', 'compte lié', 'dirige'])
  })

  it('reste statique sans date', () => {
    const plain = parseXml(buildGexf({ investigation, nodes: nodes.slice(1), edges: [] }, 'en'))
    const graph = findAll(plain, 'graph')[0]
    expect(graph.attrs.mode).toBe('static')
    expect(graph.attrs.timeformat).toBeUndefined()
  })
})

/** Découpe un CSV à virgules en respectant les guillemets. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\r') continue
    else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  return rows
}

describe('CSV Maltego', () => {
  const csv = buildMaltegoCsv(input, 'fr')
  const rows = parseCsv(csv)

  it('a un en-tête et une ligne par lien, types Maltego dans leurs colonnes', () => {
    expect(rows[0]).toEqual(['Source', 'Type source', 'Cible', 'Type cible', 'Libellé du lien'])
    expect(rows[1]).toEqual(['Alice <script>"Exemple"</script>', 'maltego.Person', '+33639981234', 'maltego.PhoneNumber', 'utilise'])
    expect(rows[2]).toEqual(['+33639981234', 'maltego.PhoneNumber', 'alice@example.com', 'maltego.EmailAddress', 'compte lié'])
    expect(rows[3]).toEqual(['Alice <script>"Exemple"</script>', 'maltego.Person', 'Exemple, SARL', 'maltego.Company', 'dirige'])
  })

  it('ajoute les entités sans lien et ignore les annotations', () => {
    expect(rows.slice(4)).toEqual([
      ['2001:db8::1', 'maltego.IPv6Address', '', '', ''],
      ["'=HYPERLINK(\"x\")", 'maltego.Phrase', '', '', '']
    ])
    expect(csv).not.toContain('Note du canevas')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('associe les types MASINT aux types Maltego', () => {
    const t = (type: string, label = 'x'): string => maltegoType({ type, label })
    expect(t('email')).toBe('maltego.EmailAddress')
    expect(t('phone')).toBe('maltego.PhoneNumber')
    expect(t('domain')).toBe('maltego.Domain')
    expect(t('ip', '192.0.2.1')).toBe('maltego.IPv4Address')
    expect(t('person')).toBe('maltego.Person')
    expect(t('username')).toBe('maltego.Alias')
    expect(t('url')).toBe('maltego.URL')
    expect(t('company')).toBe('maltego.Company')
    expect(t('address')).toBe('maltego.Location')
    expect(t('inconnu')).toBe('maltego.Phrase')
  })
})
