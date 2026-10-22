import { describe, expect, it } from 'vitest'
import { betweenness, communities, degrees, shortestPath, topScores, type AnalysisGraph } from '../src/renderer/src/lib/analysis'
import { centralityAsync, communitiesAsync } from '../src/renderer/src/lib/analysisAsync'

/** Graphe à partir de paires « a-b ». */
function graph(pairs: string[], extra: string[] = []): AnalysisGraph {
  const edges = pairs.map((p, i) => {
    const [source, target] = p.split('-')
    return { id: `e${i}:${p}`, source, target }
  })
  const nodes = Array.from(new Set([...edges.flatMap((e) => [e.source, e.target]), ...extra]))
  return { nodes, edges }
}

const round = (m: Map<string, number>): Record<string, number> => Object.fromEntries(Array.from(m, ([k, v]) => [k, Math.round(v * 1000) / 1000]))

describe('Plus court chemin', () => {
  it('suit les liens sans tenir compte de leur sens', () => {
    // a → b → c et d → c : de a à d, il faut remonter le lien d → c.
    const g = graph(['a-b', 'b-c', 'd-c', 'a-e', 'e-f'])
    expect(shortestPath(g, 'a', 'd')).toEqual({ nodes: ['a', 'b', 'c', 'd'], edges: ['e0:a-b', 'e1:b-c', 'e2:d-c'] })
    expect(shortestPath(g, 'd', 'a')?.nodes).toEqual(['d', 'c', 'b', 'a'])
  })

  it('prend le chemin le plus court, pas le premier exploré', () => {
    const g = graph(['a-b', 'b-c', 'c-d', 'd-z', 'a-z'])
    expect(shortestPath(g, 'a', 'z')).toEqual({ nodes: ['a', 'z'], edges: ['e4:a-z'] })
  })

  it('renvoie null sans chemin, et le nœud seul de lui-même à lui-même', () => {
    const g = graph(['a-b', 'c-d'], ['seul'])
    expect(shortestPath(g, 'a', 'd')).toBeNull()
    expect(shortestPath(g, 'a', 'absent')).toBeNull()
    expect(shortestPath(g, 'seul', 'seul')).toEqual({ nodes: ['seul'], edges: [] })
  })

  it('ignore les boucles et les liens vers des nœuds absents', () => {
    const g: AnalysisGraph = {
      nodes: ['a', 'b'],
      edges: [
        { id: 'loop', source: 'a', target: 'a' },
        { id: 'ghost', source: 'a', target: 'x' },
        { id: 'ab', source: 'b', target: 'a' }
      ]
    }
    expect(shortestPath(g, 'a', 'b')).toEqual({ nodes: ['a', 'b'], edges: ['ab'] })
  })
})

describe('Nœuds pivots', () => {
  it('compte les voisins distincts (liens doublés comptés une fois)', () => {
    const g = graph(['a-b', 'b-a', 'a-c'], ['d'])
    expect(Object.fromEntries(degrees(g))).toEqual({ a: 2, b: 1, c: 1, d: 0 })
  })

  it('calcule l’intermédiarité normalisée d’une chaîne et d’une étoile', () => {
    // Chaîne a-b-c-d-e : valeurs connues 0, 1/2, 2/3, 1/2, 0.
    expect(round(betweenness(graph(['a-b', 'b-c', 'c-d', 'd-e'])))).toEqual({ a: 0, b: 0.5, c: 0.667, d: 0.5, e: 0 })
    // Étoile : le centre est sur tous les chemins.
    expect(round(betweenness(graph(['h-a', 'h-b', 'h-c', 'h-d'])))).toEqual({ h: 1, a: 0, b: 0, c: 0, d: 0 })
  })

  it('partage les chemins de même longueur', () => {
    // Carré a-b-c-d : deux chemins de a à c (par b ou par d).
    expect(round(betweenness(graph(['a-b', 'b-c', 'c-d', 'd-a'])))).toEqual({ a: 0.167, b: 0.167, c: 0.167, d: 0.167 })
  })

  it('repère le pont entre deux groupes', () => {
    const g = graph(['a1-a2', 'a2-a3', 'a3-a1', 'a1-pont', 'pont-b1', 'b1-b2', 'b2-b3', 'b3-b1'])
    expect(topScores(betweenness(g), 1)[0].id).toBe('pont')
    expect(topScores(degrees(g), 1)[0]).toEqual({ id: 'a1', score: 3 })
  })

  it('estime l’intermédiarité à partir d’un échantillon de sources sur un grand graphe', () => {
    // Deux cliques de dix nœuds reliées par un chemin de trois nœuds.
    const clique = (p: string): string[] => {
      const out: string[] = []
      for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) out.push(`${p}${i}-${p}${j}`)
      return out
    }
    const g = graph([...clique('a'), ...clique('b'), 'a0-p1', 'p1-p2', 'p2-p3', 'p3-b0'])
    const exact = betweenness(g)
    const sampled = betweenness(g, { maxSources: 12 })
    expect(topScores(exact, 1)[0].id).toBe('p2')
    for (const id of ['p1', 'p2', 'p3']) expect(Math.abs(sampled.get(id)! - exact.get(id)!) / exact.get(id)!).toBeLessThan(0.25)
    expect(sampled.get('a5')).toBe(0)
  })
})

describe('Communautés', () => {
  it('sépare deux groupes reliés par un seul lien', () => {
    const g = graph(['a1-a2', 'a1-a3', 'a1-a4', 'a2-a3', 'a2-a4', 'a3-a4', 'b1-b2', 'b1-b3', 'b1-b4', 'b2-b3', 'b2-b4', 'b3-b4', 'a4-b1'], ['seul'])
    const c = communities(g)
    const a = c.of.get('a1')
    const b = c.of.get('b1')
    expect(a).not.toBe(b)
    for (const id of ['a2', 'a3', 'a4']) expect(c.of.get(id)).toBe(a)
    for (const id of ['b2', 'b3', 'b4']) expect(c.of.get(id)).toBe(b)
    // Nœud isolé : sa propre communauté, la plus petite (numérotée en dernier).
    expect(c.of.get('seul')).toBe(2)
    expect(c.members.map((m) => m.length)).toEqual([4, 4, 1])
    expect(c.modularity).toBeGreaterThan(0.35)
  })

  it('regroupe trois cliques en anneau et donne toujours le même résultat', () => {
    const cliques = ['x', 'y', 'z'].flatMap((p) => [`${p}1-${p}2`, `${p}1-${p}3`, `${p}2-${p}3`, `${p}1-${p}4`, `${p}2-${p}4`, `${p}3-${p}4`])
    const g = graph([...cliques, 'x4-y1', 'y4-z1', 'z4-x1'])
    const c1 = communities(g)
    expect(c1.members).toHaveLength(3)
    expect(new Set(['x1', 'x2', 'x3', 'x4'].map((id) => c1.of.get(id))).size).toBe(1)
    expect(communities(g).members).toEqual(c1.members)
  })

  it('laisse chaque nœud seul dans un graphe sans lien', () => {
    const c = communities({ nodes: ['a', 'b'], edges: [] })
    expect(c.members).toEqual([['a'], ['b']])
    expect(c.modularity).toBe(0)
  })
})

describe('Calcul asynchrone', () => {
  it('donne le même résultat sans Worker (repli direct)', async () => {
    const nodes = Array.from({ length: 600 }, (_, i) => `n${i}`)
    const edges = nodes.slice(1).map((id, i) => ({ id: `e${i}`, source: nodes[Math.floor(i / 3)], target: id }))
    const g = { nodes, edges }
    const c = await centralityAsync(g)
    expect(c.degree).toEqual(degrees(g))
    expect(c.betweenness).toEqual(betweenness(g))
    const com = await communitiesAsync(g)
    expect(com.members).toEqual(communities(g).members)
    expect(com.of.size).toBe(600)
  })
})
