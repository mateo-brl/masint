import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, Investigation, ModuleInfo, ModuleRun } from '@shared/types'
import {
  buildReportHtml,
  DEFAULT_SECTIONS,
  entityOrder,
  fingerprintPayload,
  type ReportInput
} from '../src/renderer/src/components/export/report'
import { buildViewerData, buildViewerHtml } from '../src/renderer/src/components/export/viewer'

const T0 = new Date(2026, 9, 20, 9, 30).getTime()
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const investigation: Investigation = {
  id: 'inv-1',
  name: 'Affaire <Alpha>',
  description: 'Recherche sur un numéro',
  color: '#e5484d',
  createdAt: T0,
  updatedAt: T0,
  notes: '# Hypothèses\n\n- le numéro appartient à **Jean**\n- voir https://example.com/profil',
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

const nodes: GraphNode[] = [
  node({ id: 'p1', type: 'phone', label: '+33612345678', data: { country: 'France', carrier: 'Orange' }, notes: 'Numéro <principal>' }),
  node({ id: 'a1', type: 'account', platform: 'facebook', label: 'jean.dupont', source: 'fb_lookup', imageId: 'img1', data: { url: 'https://facebook.com/jean.dupont', followers: 120 } }),
  node({ id: 'h1', type: 'person', label: 'Jean Dupont', data: { birth_date: '1980-01-01' } }),
  node({ id: 't1', kind: 'text', type: 'text', label: 'Piste à vérifier' })
]

const edges: GraphEdge[] = [
  { id: 'e1', investigationId: 'inv-1', source: 'p1', target: 'a1', label: 'compte lié', data: {}, style: {}, sourceModule: 'fb_lookup', createdAt: T0, updatedAt: T0 },
  { id: 'e2', investigationId: 'inv-1', source: 'h1', target: 'p1', label: 'utilise', data: {}, style: { dashed: true }, sourceModule: 'manual', createdAt: T0, updatedAt: T0 }
]

const modules: ModuleInfo[] = [
  {
    id: 'fb_lookup',
    name: { fr: 'Recherche Facebook', en: 'Facebook lookup' },
    description: { fr: '', en: '' },
    category: 'social',
    inputTypes: ['phone'],
    keys: [],
    ondemand: false,
    noisy: false,
    experimental: false,
    enabled: true,
    configured: true,
    homepage: 'https://www.facebook.com/'
  }
]

const runs: ModuleRun[] = [
  { id: 'r1', investigationId: 'inv-1', nodeId: 'p1', moduleId: 'fb_lookup', jobId: 'j', status: 'done', found: true, resultCount: 1, error: null, startedAt: T0 + 1000, finishedAt: T0 + 3000 },
  { id: 'r2', investigationId: 'inv-1', nodeId: 'p1', moduleId: 'other', jobId: 'j', status: 'error', found: null, resultCount: 0, error: 'HTTP 429 <rate limit>', startedAt: T0 + 2000, finishedAt: T0 + 2500 }
]

const markup = (): string => '<circle cx="12" cy="12" r="9"/>'

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  options: { title: '', investigator: 'Lt. Martin', reference: '2026-OSINT-042', classification: 'Diffusion restreinte', lang: 'fr', sections: { ...DEFAULT_SECTIONS } },
  investigation,
  nodes,
  edges,
  runs,
  modules,
  iconMarkup: markup,
  generatedAt: new Date(2026, 9, 21, 14, 3),
  graphImage: PNG,
  images: { img1: PNG },
  appVersion: '0.1.0',
  platform: 'linux',
  fingerprint: 'ab'.repeat(32),
  ...over
})

describe('buildReportHtml', () => {
  const html = buildReportHtml(input())

  it('produit un document HTML complet avec page de garde', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="fr">')
    expect(html).toContain('class="cover"')
    expect(html).toContain('Affaire &lt;Alpha&gt;')
    expect(html).toContain('2026-OSINT-042')
    expect(html).toContain('Lt. Martin')
    expect(html).toContain('Diffusion restreinte')
    expect(html).toContain('MASINT 0.1.0')
  })

  it("n'a aucune ressource externe ni script", () => {
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/(src|href)="(?!data:|#|https?:\/\/)/)
    expect(html).not.toMatch(/src="https?:/)
    expect(html).not.toMatch(/masint-file:/)
  })

  it('échappe les données saisies', () => {
    expect(html).not.toContain('<Alpha>')
    expect(html).not.toContain('<principal>')
    expect(html).toContain('Numéro &lt;principal&gt;')
    expect(html).toContain('HTTP 429 &lt;rate limit&gt;')
  })

  it('contient le sommaire et les sections demandées, numérotées', () => {
    expect(html).toContain('Sommaire')
    for (const id of ['summary', 'graph', 'notes', 'entities', 'links', 'sources']) expect(html).toContain(`id="s-${id}"`)
    expect(html).not.toContain('id="s-raw"')
    expect(html).toContain('id="s-trace"')
    expect(html).toMatch(/<h2 class="chapter-title" id="s-summary"><span class="num">1<\/span>Synthèse<\/h2>/)
  })

  it('rend les notes en Markdown', () => {
    expect(html).toContain('<h3>Hypothèses</h3>')
    expect(html).toContain('<strong>Jean</strong>')
    expect(html).toContain('<a href="https://example.com/profil">')
  })

  it('groupe les fiches par catégorie avec références', () => {
    expect(html).toContain('id="cat-identity"')
    expect(html).toContain('id="cat-annotations"')
    expect(html).toContain('Piste à vérifier')
    const order = entityOrder(nodes, 'fr').flatMap((g) => g.nodes.map((n) => n.id))
    // Ordre du catalogue : la personne avant le téléphone et les comptes.
    expect(order).toEqual(['h1', 'p1', 'a1'])
    expect(html).toContain('<span class="ref big">E001</span>')
    expect(html).toContain('<span class="ref big">E003</span>')
    expect(html).toContain('Recherche Facebook')
    expect(html).toContain(`<img class="card-img" src="${PNG}"`)
  })

  it('liste les liens et le journal des modules', () => {
    expect(html).toContain('compte lié')
    expect(html).toContain('utilise')
    expect(html).toContain('Terminé')
    expect(html).toContain('Erreur')
    expect(html).toContain('facebook.com')
  })

  it('ajoute les mentions de traçabilité', () => {
    expect(html).toContain('Rapport généré le')
    expect(html).toContain('ab'.repeat(32))
    expect(html).toContain('inv-1')
  })

  it("respecte les sections décochées et l'annexe", () => {
    const h = buildReportHtml(
      input({
        options: { ...input().options, sections: { summary: false, graph: false, notes: false, entities: false, links: true, sources: false, raw: true } },
        rawRuns: [{ run: runs[0], raw: { result: '<b>ok</b>' } }]
      })
    )
    expect(h).not.toContain('id="s-summary"')
    expect(h).not.toContain('id="s-entities"')
    expect(h).toContain('id="s-raw"')
    expect(h).toMatch(/id="s-links"><span class="num">1</)
    expect(h).toContain('&lt;b&gt;ok&lt;/b&gt;')
  })

  it('se traduit en anglais', () => {
    const h = buildReportHtml(input({ options: { ...input().options, lang: 'en' } }))
    expect(h).toContain('<html lang="en">')
    expect(h).toContain('Contents')
    expect(h).toContain('Entity sheets')
    expect(h).toContain('Phone number')
  })

  it('ignore une capture qui ne serait pas une data URL', () => {
    const h = buildReportHtml(input({ graphImage: 'masint-file://att/x', images: { img1: 'javascript:alert(1)' } }))
    expect(h).not.toContain('masint-file')
    expect(h).not.toContain('javascript:')
    expect(h).toContain('La capture du graphe n’a pas pu être réalisée.')
  })
})

describe('fingerprintPayload', () => {
  it("ne dépend pas de l'ordre des nœuds ni des clés", () => {
    const a = fingerprintPayload(investigation, nodes, edges)
    const shuffled = [...nodes].reverse().map((n) => ({ ...n, data: Object.fromEntries(Object.entries(n.data).reverse()) }))
    expect(fingerprintPayload(investigation, shuffled, [...edges].reverse())).toBe(a)
    expect(fingerprintPayload(investigation, nodes.slice(1), edges)).not.toBe(a)
  })
})

describe('buildViewerHtml', () => {
  const opts = {
    investigation,
    nodes,
    edges,
    lang: 'fr' as const,
    exportedAt: new Date(2026, 9, 21, 14, 3),
    iconMarkup: markup,
    images: { img1: PNG },
    modules
  }

  it('prépare les données du visualiseur', () => {
    const data = buildViewerData(opts)
    expect(data.nodes).toHaveLength(4)
    expect(data.edges).toHaveLength(2)
    const acc = data.nodes.find((n) => n.id === 'a1')!
    expect(acc.kicker).toBe('FACEBOOK')
    expect(acc.image).toBe('img1')
    expect(acc.source).toBe('Recherche Facebook')
    expect(acc.props).toContainEqual(['URL du profil', 'https://facebook.com/jean.dupont'])
    expect(data.images.img1).toBe(PNG)
    expect(data.legend.map((l) => l.key).sort()).toEqual(['account', 'person', 'phone'])
    expect(data.meta).toContain('3 entités')
  })

  it('produit un fichier autonome et sûr', () => {
    const html = buildViewerHtml({ ...opts, nodes: [...nodes, node({ id: 'x', label: '</script><script>alert(1)</script>' })] })
    expect(html).toContain("Content-Security-Policy")
    expect(html).toContain("default-src 'none'")
    expect(html.match(/<script/g)).toHaveLength(2)
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link /)
    expect(html).toContain('<title>Affaire &lt;Alpha&gt; · MASINT</title>')
    // Le visualiseur est sérialisé sans dépendance extérieure.
    expect(html).toMatch(/<script>\(function viewerRuntime\(\)|<script>\(function\s*\w*\(\)/)
    expect(html).not.toContain('__vite_ssr_import')
  })

  it('ignore les liens vers des nœuds absents', () => {
    const data = buildViewerData({ ...opts, edges: [...edges, { ...edges[0], id: 'bad', target: 'missing' }] })
    expect(data.edges.map((e) => e.id)).toEqual(['e1', 'e2'])
  })
})
