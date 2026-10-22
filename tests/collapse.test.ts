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

describe('Mémorisation de la vue', () => {
  const subs = Array.from({ length: 8 }, (_, i) => node(`s${i}.ex.fr`))
  const base = [node('ex.fr'), node('root', { style: { collapsed: true } }), node('a'), ...subs]
  const edges = [edge('root', 'a'), ...subs.map((s) => edge('ex.fr', s.id, 'sous-domaine'))]
  // Les nœuds du canevas portent aussi leur position, que la vue ignore.
  const moved = (list: ViewNode[], dx: number): ViewNode[] => list.map((n, i) => ({ ...n, x: i * 10 + dx, y: dx }) as ViewNode)

  it('renvoie le même objet quand seules les positions changent', () => {
    const v1 = computeView(moved(base, 0), edges, new Set())
    const v2 = computeView(moved(base, 50), edges.map((e) => ({ ...e })), new Set())
    expect(v2).toBe(v1)
    expect(v2.collapsedCount).toBe(v1.collapsedCount)
    // Mêmes objets, nouveaux tableaux (cas d'un glisser) : toujours le même résultat.
    const same = moved(base, 0)
    const v3 = computeView(same, edges, new Set())
    expect(computeView([...same], [...edges], new Set())).toBe(v3)
  })

  it('ignore les changements sans effet sur la vue (libellé, données)', () => {
    const v1 = computeView(base, edges, new Set())
    const relabeled = base.map((n) => ({ ...n, label: `${n.label} (renommé)` }))
    expect(computeView(relabeled, edges, new Set())).toBe(v1)
  })

  it('recalcule quand le repli change', () => {
    const v1 = computeView(base, edges, new Set())
    expect(v1.collapsedCount.get('root')).toBe(1)
    const unfolded = base.map((n) => (n.id === 'root' ? { ...n, style: {} } : n))
    const v2 = computeView(unfolded, edges, new Set())
    expect(v2).not.toBe(v1)
    expect(v2.collapsedCount.size).toBe(0)
    expect(v2.hidden.has('a')).toBe(false)
  })

  it('recalcule quand un lien, son libellé, un type ou les groupes dépliés changent', () => {
    const v1 = computeView(base, edges, new Set())
    expect(v1.bundles).toHaveLength(1)
    const relinked = edges.map((e, i) => (i === 1 ? { ...e, label: 'autre' } : e))
    const v2 = computeView(base, relinked, new Set())
    expect(v2).not.toBe(v1)
    expect(v2.bundles[0].members).toHaveLength(7)
    const retyped = base.map((n) => (n.id === 's0.ex.fr' ? { ...n, type: 'ip' } : n))
    expect(computeView(retyped, edges, new Set()).bundles[0].members).toHaveLength(7)
    const fewer = edges.slice(0, -1)
    expect(computeView(base, fewer, new Set()).bundles[0].members).toHaveLength(7)
    const v3 = computeView(base, edges, new Set([bundleId('ex.fr', 'domain', 'sous-domaine')]))
    expect(v3.bundles).toHaveLength(0)
    // Même contenu dans un nouvel ensemble : même vue.
    expect(computeView(base, edges, new Set([bundleId('ex.fr', 'domain', 'sous-domaine')]))).toBe(v3)
  })

  it('recalcule quand une note ou une couleur empêche le regroupement', () => {
    const v1 = computeView(base, edges, new Set())
    const noted = base.map((n) => (n.id === 's0.ex.fr' ? { ...n, notes: 'vu' } : n))
    const v2 = computeView(noted, edges, new Set())
    expect(v2).not.toBe(v1)
    expect(v2.bundles[0].members).toHaveLength(7)
    const colored = base.map((n) => (n.id === 's1.ex.fr' ? { ...n, style: { color: '#e5484d' } } : n))
    expect(computeView(colored, edges, new Set()).bundles[0].members).toHaveLength(7)
  })
})
