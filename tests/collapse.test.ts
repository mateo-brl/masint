import { describe, expect, it } from 'vitest'
import { bundleId, collapsedAncestors, computeView, type ViewEdge, type ViewNode } from '../src/renderer/src/lib/collapse'

const node = (id: string, extra: Partial<ViewNode> = {}): ViewNode => ({
  id,
  kind: 'entity',
  type: 'domain',
  label: id,
  platform: null,
  notes: '',
  style: {},
  ...extra
})
const edge = (source: string, target: string, label = ''): ViewEdge => ({ id: `${source}>${target}`, source, target, label })

describe('Réduire un nœud', () => {
  it('masque toute la descendance et compte les nœuds masqués', () => {
    const nodes = [node('root', { style: { collapsed: true } }), node('a'), node('b'), node('a1')]
    const edges = [edge('root', 'a'), edge('root', 'b'), edge('a', 'a1')]
    const v = computeView(nodes, edges, new Set())
    expect([...v.hidden].sort()).toEqual(['a', 'a1', 'b'])
    expect(v.collapsedCount.get('root')).toBe(3)
  })

  it('laisse visible un descendant rattaché à un autre nœud visible', () => {
    const nodes = [node('root', { style: { collapsed: true } }), node('other'), node('shared'), node('only')]
    const edges = [edge('root', 'shared'), edge('root', 'only'), edge('other', 'shared')]
    const v = computeView(nodes, edges, new Set())
    expect([...v.hidden]).toEqual(['only'])
    expect(v.collapsedCount.get('root')).toBe(1)
  })

  it('retrouve les nœuds repliés à déplier pour montrer un nœud', () => {
    const nodes = [node('root', { style: { collapsed: true } }), node('a', { style: { collapsed: true } }), node('a1')]
    const edges = [edge('root', 'a'), edge('a', 'a1')]
    expect(collapsedAncestors('a1', nodes, edges).sort()).toEqual(['a', 'root'])
  })
})

describe('Regroupement automatique', () => {
  const subs = Array.from({ length: 8 }, (_, i) => node(`s${i}.ex.fr`))
  const base = [node('ex.fr'), node('ns1'), node('ns2'), ...subs]
  const edges = [edge('ex.fr', 'ns1', 'NS'), edge('ex.fr', 'ns2', 'NS'), ...subs.map((s) => edge('ex.fr', s.id, 'sous-domaine'))]

  it('regroupe les feuilles semblables d’un même nœud, pas les petits groupes', () => {
    const v = computeView(base, edges, new Set())
    expect(v.bundles).toHaveLength(1)
    expect(v.bundles[0].id).toBe(bundleId('ex.fr', 'domain', 'sous-domaine'))
    expect(v.bundles[0].members).toHaveLength(8)
    expect(v.hidden.has('ns1')).toBe(false)
    expect(v.bundleOf.get('s3.ex.fr')).toBe(v.bundles[0].id)
  })

  it('ne regroupe pas un groupe déplié ni un nœud annoté', () => {
    const id = bundleId('ex.fr', 'domain', 'sous-domaine')
    expect(computeView(base, edges, new Set([id])).bundles).toHaveLength(0)
    const annotated = base.map((n, i) => (i > 3 ? { ...n, notes: 'vu' } : n))
    expect(computeView(annotated, edges, new Set()).bundles).toHaveLength(0)
  })

  it('ne regroupe pas les nœuds qui ont des enfants', () => {
    const more = [...edges, ...subs.slice(0, 4).map((s) => edge(s.id, 'ip'))]
    const v = computeView([...base, node('ip', { type: 'ip' })], more, new Set())
    expect(v.bundles).toHaveLength(0)
  })
})
