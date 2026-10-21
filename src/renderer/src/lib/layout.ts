// Algorithmes de disposition automatique du graphe.

import dagre from '@dagrejs/dagre'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'

export type LayoutKind = 'tree-tb' | 'tree-lr' | 'force' | 'radial' | 'grid' | 'circle'

export interface LayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutEdge {
  source: string
  target: string
}

type Positions = Record<string, { x: number; y: number }>

export function computeLayout(kind: LayoutKind, nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
  if (nodes.length === 0) return {}
  const ids = new Set(nodes.map((n) => n.id))
  const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
  // Le résultat est recentré sur le centre de gravité initial pour ne pas « sauter » ailleurs.
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length
  let pos: Positions
  switch (kind) {
    case 'tree-tb':
    case 'tree-lr':
      pos = tree(nodes, links, kind === 'tree-tb' ? 'TB' : 'LR')
      break
    case 'force':
      pos = force(nodes, links)
      break
    case 'radial':
      pos = radial(nodes, links)
      break
    case 'circle':
      pos = circle(nodes)
      break
    default:
      pos = grid(nodes)
  }
  const values = Object.values(pos)
  const px = values.reduce((s, p) => s + p.x, 0) / values.length
  const py = values.reduce((s, p) => s + p.y, 0) / values.length
  for (const p of values) {
    p.x = Math.round(p.x - px + cx)
    p.y = Math.round(p.y - py + cy)
  }
  return pos
}

function tree(nodes: LayoutNode[], edges: LayoutEdge[], dir: 'TB' | 'LR'): Positions {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: dir, nodesep: dir === 'TB' ? 24 : 14, ranksep: dir === 'TB' ? 70 : 110, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height })
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  const out: Positions = {}
  for (const n of nodes) {
    const p = g.node(n.id)
    out[n.id] = { x: p.x - n.width / 2, y: p.y - n.height / 2 }
  }
  return out
}

function force(nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
  type SimNode = SimulationNodeDatum & { id: string; w: number; h: number }
  const sim: SimNode[] = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }))
  const sim2 = forceSimulation(sim)
    .force(
      'link',
      forceLink<SimNode, { source: string; target: string }>(edges.map((e) => ({ ...e })))
        .id((d) => d.id)
        .distance(150)
        .strength(0.7)
    )
    .force('charge', forceManyBody().strength(-520))
    .force('collide', forceCollide<SimNode>().radius((d) => Math.max(d.w, d.h) / 2 + 14))
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(0.04))
    .stop()
  for (let i = 0; i < 320; i++) sim2.tick()
  const out: Positions = {}
  for (const n of sim) out[n.id] = { x: (n.x ?? 0) - n.w / 2, y: (n.y ?? 0) - n.h / 2 }
  return out
}

/** Disposition radiale : la racine (nœud le plus connecté) au centre, les niveaux en anneaux. */
function radial(nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
  }
  const out: Positions = {}
  const seen = new Set<string>()
  const rings: string[][] = []
  const remaining = [...nodes].sort((a, b) => adj.get(b.id)!.length - adj.get(a.id)!.length)
  // Chaque composante connexe est placée autour de la racine principale.
  for (const root of remaining) {
    if (seen.has(root.id)) continue
    let frontier = [root.id]
    seen.add(root.id)
    let depth = 0
    while (frontier.length) {
      ;(rings[depth] ??= []).push(...frontier)
      const next: string[] = []
      for (const id of frontier)
        for (const nb of adj.get(id)!)
          if (!seen.has(nb)) {
            seen.add(nb)
            next.push(nb)
          }
      frontier = next
      depth++
    }
  }
  const size = new Map(nodes.map((n) => [n.id, n]))
  rings.forEach((ring, depth) => {
    const radius = depth === 0 ? (ring.length > 1 ? 160 : 0) : depth * 260 + Math.max(0, ring.length - 12) * 9
    ring.forEach((id, i) => {
      const a = (2 * Math.PI * i) / ring.length - Math.PI / 2
      const n = size.get(id)!
      out[id] = { x: Math.cos(a) * radius - n.width / 2, y: Math.sin(a) * radius - n.height / 2 }
    })
  })
  return out
}

function circle(nodes: LayoutNode[]): Positions {
  const r = Math.max(180, (nodes.length * 230) / (2 * Math.PI))
  const out: Positions = {}
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2
    out[n.id] = { x: Math.cos(a) * r - n.width / 2, y: Math.sin(a) * r - n.height / 2 }
  })
  return out
}

function grid(nodes: LayoutNode[]): Positions {
  const cols = Math.ceil(Math.sqrt(nodes.length * 1.6))
  const out: Positions = {}
  nodes.forEach((n, i) => {
    out[n.id] = { x: (i % cols) * 230, y: Math.floor(i / cols) * 70 }
  })
  return out
}
