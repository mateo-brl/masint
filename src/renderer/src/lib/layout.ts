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

/** Feuilles (un seul voisin) regroupées par parent, pour les ranger en grille. */
function leafGroups(nodes: LayoutNode[], edges: LayoutEdge[], min: number): Map<string, LayoutNode[]> {
  const neighbors = new Map<string, Set<string>>()
  for (const n of nodes) neighbors.set(n.id, new Set())
  for (const e of edges) {
    neighbors.get(e.source)!.add(e.target)
    neighbors.get(e.target)!.add(e.source)
  }
  const groups = new Map<string, LayoutNode[]>()
  for (const n of nodes) {
    const nb = neighbors.get(n.id)!
    if (nb.size !== 1) continue
    const parent = nb.values().next().value as string
    // Deux nœuds isolés reliés entre eux ne forment pas un groupe.
    if (neighbors.get(parent)!.size === 1) continue
    groups.set(parent, [...(groups.get(parent) ?? []), n])
  }
  for (const [p, list] of groups) if (list.length < min) groups.delete(p)
  return groups
}

const LEAF_GROUP_MIN = 7

/**
 * Hiérarchie (dagre). Les nombreuses feuilles d'un même parent sont rangées en grille
 * sous lui (ou à sa droite) au lieu d'une seule rangée interminable.
 */
function tree(nodes: LayoutNode[], edges: LayoutEdge[], dir: 'TB' | 'LR'): Positions {
  const groups = leafGroups(nodes, edges, LEAF_GROUP_MIN)
  const inBlock = new Set<string>()
  for (const list of groups.values()) for (const n of list) inBlock.add(n.id)

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: dir, nodesep: dir === 'TB' ? 24 : 14, ranksep: dir === 'TB' ? 70 : 110, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) if (!inBlock.has(n.id)) g.setNode(n.id, { width: n.width, height: n.height })

  const blocks = new Map<string, { list: LayoutNode[]; cols: number; cellW: number; cellH: number }>()
  for (const [parent, list] of groups) {
    const cellW = Math.max(...list.map((n) => n.width)) + 16
    const cellH = Math.max(...list.map((n) => n.height)) + 14
    // Grille environ 1,6 fois plus large que haute (sous le parent), ou plus haute que large (à sa droite).
    const aspect = dir === 'TB' ? 1.6 : 0.6
    const cols = Math.min(list.length, Math.max(2, Math.round(Math.sqrt((list.length * aspect * cellH) / cellW))))
    const rows = Math.ceil(list.length / cols)
    const id = `__block:${parent}`
    blocks.set(id, { list, cols, cellW, cellH })
    g.setNode(id, { width: cols * cellW, height: rows * cellH })
    g.setEdge(parent, id)
  }
  for (const e of edges) if (!inBlock.has(e.source) && !inBlock.has(e.target)) g.setEdge(e.source, e.target)
  dagre.layout(g)

  const out: Positions = {}
  for (const n of nodes) {
    if (inBlock.has(n.id)) continue
    const p = g.node(n.id)
    out[n.id] = { x: p.x - n.width / 2, y: p.y - n.height / 2 }
  }
  for (const [id, b] of blocks) {
    const p = g.node(id)
    const x0 = p.x - p.width / 2
    const y0 = p.y - p.height / 2
    b.list.forEach((n, i) => {
      out[n.id] = { x: x0 + (i % b.cols) * b.cellW, y: y0 + Math.floor(i / b.cols) * b.cellH }
    })
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

/**
 * Disposition radiale : la racine (nœud le plus connecté) au centre, chaque niveau sur
 * des anneaux. Un niveau trop peuplé occupe plusieurs anneaux concentriques, chacun
 * contenant autant de nœuds qu'il peut en loger sans chevauchement.
 */
function radial(nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    adj.get(e.source)!.push(e.target)
    adj.get(e.target)!.push(e.source)
  }
  const seen = new Set<string>()
  const levels: string[][] = []
  const remaining = [...nodes].sort((a, b) => adj.get(b.id)!.length - adj.get(a.id)!.length)
  for (const root of remaining) {
    if (seen.has(root.id)) continue
    let frontier = [root.id]
    seen.add(root.id)
    let depth = 0
    while (frontier.length) {
      ;(levels[depth] ??= []).push(...frontier)
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
  const maxW = Math.max(...nodes.map((n) => n.width))
  // Pas tangentiel : largeur d'un nœud (le cas le plus défavorable, en haut et en bas du cercle).
  const step = maxW + 24
  // Écart radial : largeur aussi, car sur les côtés les nœuds se suivent horizontalement.
  const gap = maxW + 40
  const out: Positions = {}
  let radius = 0
  levels.forEach((level, depth) => {
    if (depth === 0 && level.length === 1) {
      const n = size.get(level[0])!
      out[level[0]] = { x: -n.width / 2, y: -n.height / 2 }
      return
    }
    let i = 0
    radius = depth === 0 ? gap * 0.8 : radius + gap
    while (i < level.length) {
      const capacity = Math.max(6, Math.floor((2 * Math.PI * radius) / step))
      const ring = level.slice(i, i + capacity)
      // Décalage d'angle d'un anneau à l'autre pour éviter les alignements.
      const offset = (levels.length + i) % 2 ? Math.PI / Math.max(ring.length, 1) : 0
      ring.forEach((id, k) => {
        const a = (2 * Math.PI * k) / ring.length - Math.PI / 2 + offset
        const n = size.get(id)!
        out[id] = { x: Math.cos(a) * radius - n.width / 2, y: Math.sin(a) * radius - n.height / 2 }
      })
      i += ring.length
      if (i < level.length) radius += gap
    }
  })
  return out
}

/**
 * Cercle : un seul anneau tant qu'il reste de taille raisonnable, sinon des anneaux
 * concentriques remplis de l'intérieur vers l'extérieur (au lieu d'un cercle immense
 * qui oblige à dézoomer jusqu'à rendre les nœuds illisibles).
 */
function circle(nodes: LayoutNode[]): Positions {
  const maxW = Math.max(...nodes.map((n) => n.width))
  const step = maxW + 24
  const gap = maxW + 40
  const out: Positions = {}
  const place = (ring: LayoutNode[], r: number, offset: number): void =>
    ring.forEach((n, k) => {
      const a = (2 * Math.PI * k) / ring.length - Math.PI / 2 + offset
      out[n.id] = { x: Math.cos(a) * r - n.width / 2, y: Math.sin(a) * r - n.height / 2 }
    })
  const single = (nodes.length * step) / (2 * Math.PI)
  if (single <= 900) {
    place(nodes, Math.max(180, single), 0)
    return out
  }
  let i = 0
  let r = gap
  let ringIndex = 0
  while (i < nodes.length) {
    const capacity = Math.max(6, Math.floor((2 * Math.PI * r) / step))
    const ring = nodes.slice(i, i + capacity)
    place(ring, r, ringIndex % 2 ? Math.PI / Math.max(ring.length, 1) : 0)
    i += ring.length
    r += gap
    ringIndex++
  }
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
