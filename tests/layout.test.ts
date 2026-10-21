import { describe, expect, it } from 'vitest'
import { computeLayout, type LayoutEdge, type LayoutKind, type LayoutNode } from '../src/renderer/src/lib/layout'

const W = 196
const H = 40

function star(children: number, grandChildren = 0): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes: LayoutNode[] = [{ id: 'root', x: 0, y: 0, width: W, height: H }]
  const edges: LayoutEdge[] = []
  for (let i = 0; i < children; i++) {
    nodes.push({ id: `c${i}`, x: 0, y: 0, width: W, height: H })
    edges.push({ source: 'root', target: `c${i}` })
  }
  for (let j = 0; j < grandChildren; j++) {
    nodes.push({ id: `g${j}`, x: 0, y: 0, width: W, height: H })
    edges.push({ source: `c${j % 3}`, target: `g${j}` })
  }
  return { nodes, edges }
}

function overlaps(nodes: LayoutNode[], pos: Record<string, { x: number; y: number }>): number {
  let count = 0
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = pos[nodes[i].id]
      const b = pos[nodes[j].id]
      if (Math.abs(a.x - b.x) < W && Math.abs(a.y - b.y) < H) count++
    }
  return count
}

function extent(pos: Record<string, { x: number; y: number }>): { w: number; h: number } {
  const xs = Object.values(pos).map((p) => p.x)
  const ys = Object.values(pos).map((p) => p.y)
  return { w: Math.max(...xs) - Math.min(...xs) + W, h: Math.max(...ys) - Math.min(...ys) + H }
}

describe('dispositions sur un graphe en étoile (1 parent, 120 enfants)', () => {
  const g = star(120, 9)
  it.each<LayoutKind>(['tree-tb', 'tree-lr', 'radial', 'grid', 'circle'])('%s : aucun chevauchement', (kind) => {
    expect(overlaps(g.nodes, computeLayout(kind, g.nodes, g.edges))).toBe(0)
  })

  it('hiérarchique vertical : les feuilles forment une grille, pas une rangée interminable', () => {
    const { w, h } = extent(computeLayout('tree-tb', g.nodes, g.edges))
    expect(w / h).toBeLessThan(4)
  })

  it('cercle : anneaux concentriques plutôt qu’un cercle immense', () => {
    const { w } = extent(computeLayout('circle', g.nodes, g.edges))
    expect(w).toBeLessThan(4500)
  })

  it('radial : reste compact', () => {
    const { w } = extent(computeLayout('radial', g.nodes, g.edges))
    expect(w).toBeLessThan(4500)
  })
})
