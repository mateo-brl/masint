import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange
} from '@xyflow/react'
import { create } from 'zustand'
import type { EdgeInput, GraphChange, GraphEdge, GraphNode, Investigation, NodeInput } from '@shared/types'
import { api } from '../lib/api'

export type FlowNode = Node<{ node: GraphNode }>
export type FlowEdge = Edge<{ edge: GraphEdge }>

const RESIZABLE = new Set(['text', 'image', 'map', 'drawing'])

export function toFlowNode(n: GraphNode, prev?: FlowNode): FlowNode {
  const sized = RESIZABLE.has(n.kind) && n.width && n.height
  return {
    id: n.id,
    type: n.kind,
    position: prev?.dragging ? prev.position : { x: n.x, y: n.y },
    data: { node: n },
    selected: prev?.selected ?? false,
    ...(sized ? { width: n.width!, height: n.height! } : {}),
    zIndex: n.kind === 'drawing' ? 0 : n.kind === 'entity' ? 2 : 1
  }
}

export function toFlowEdge(e: GraphEdge, prev?: FlowEdge): FlowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'masint',
    data: { edge: e },
    selected: prev?.selected ?? false
  }
}

interface GraphState {
  investigation: Investigation | null
  nodes: FlowNode[]
  edges: FlowEdge[]
  loading: boolean
  /** Outil actif sur le canevas. */
  tool: 'select' | 'draw'
  drawColor: string
  drawWidth: number

  load(id: string): Promise<void>
  close(): void
  setTool(tool: 'select' | 'draw'): void
  setDrawStyle(color: string, width: number): void
  onNodesChange(changes: NodeChange<FlowNode>[]): void
  onEdgesChange(changes: EdgeChange<FlowEdge>[]): void
  onConnect(c: Connection): void
  addNodes(inputs: NodeInput[], select?: boolean): Promise<GraphNode[]>
  updateNode(id: string, patch: NodeInput): Promise<void>
  updateNodes(patches: NodeInput[]): Promise<void>
  deleteNodes(ids: string[]): Promise<void>
  addEdges(inputs: EdgeInput[]): Promise<GraphEdge[]>
  updateEdge(id: string, patch: Partial<EdgeInput>): Promise<void>
  deleteEdges(ids: string[]): Promise<void>
  setPositions(pos: Record<string, { x: number; y: number }>): Promise<void>
  applyChange(change: GraphChange): void
  updateInvestigation(patch: Partial<Pick<Investigation, 'name' | 'description' | 'color' | 'notes' | 'viewport'>>): Promise<void>
  select(ids: string[]): void
  selectedNodes(): GraphNode[]
}

export const useGraph = create<GraphState>((set, get) => ({
  investigation: null,
  nodes: [],
  edges: [],
  loading: false,
  tool: 'select',
  drawColor: '#e5484d',
  drawWidth: 4,

  async load(id) {
    set({ loading: true })
    const bundle = await api('investigations:open', id)
    set({
      investigation: bundle.investigation,
      nodes: bundle.nodes.map((n) => toFlowNode(n)),
      edges: bundle.edges.map((e) => toFlowEdge(e)),
      loading: false,
      tool: 'select'
    })
  },

  close() {
    set({ investigation: null, nodes: [], edges: [] })
  },

  setTool(tool) {
    set({ tool })
  },

  setDrawStyle(drawColor, drawWidth) {
    set({ drawColor, drawWidth })
  },

  onNodesChange(changes) {
    const inv = get().investigation
    if (!inv) return
    const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
    const moved: NodeInput[] = []
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false && c.position) moved.push({ id: c.id, x: c.position.x, y: c.position.y })
      if (c.type === 'dimensions' && c.resizing === false && c.dimensions) {
        moved.push({ id: c.id, width: c.dimensions.width, height: c.dimensions.height })
      }
    }
    set({ nodes: applyNodeChanges(changes.filter((c) => c.type !== 'remove'), get().nodes) })
    if (removed.length) void get().deleteNodes(removed)
    if (moved.length) {
      // La fin d'un redimensionnement envoie aussi une position : on fusionne par id.
      const byId = new Map<string, NodeInput>()
      for (const m of moved) byId.set(m.id!, { ...byId.get(m.id!), ...m })
      const current = new Map(get().nodes.map((n) => [n.id, n]))
      const patches = Array.from(byId.values()).map((p) => {
        const n = current.get(p.id!)
        return n && p.x === undefined ? { ...p, x: n.position.x, y: n.position.y } : p
      })
      void api('graph:upsertNodes', inv.id, patches).then((saved) => {
        const map = new Map(saved.map((s) => [s.id, s]))
        set({ nodes: get().nodes.map((n) => (map.has(n.id) ? { ...n, data: { node: map.get(n.id)! } } : n)) })
      })
    }
  },

  onEdgesChange(changes) {
    const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
    set({ edges: applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), get().edges) })
    if (removed.length) void get().deleteEdges(removed)
  },

  onConnect(c) {
    if (!c.source || !c.target || c.source === c.target) return
    void get().addEdges([{ source: c.source, target: c.target, label: '' }])
  },

  async addNodes(inputs, select = true) {
    const inv = get().investigation
    if (!inv) return []
    const saved = await api('graph:upsertNodes', inv.id, inputs)
    const ids = new Set(saved.map((s) => s.id))
    const existing = get().nodes.filter((n) => !ids.has(n.id)).map((n) => (select ? { ...n, selected: false } : n))
    set({ nodes: [...existing, ...saved.map((s) => ({ ...toFlowNode(s), selected: select }))] })
    return saved
  },

  async updateNode(id, patch) {
    await get().updateNodes([{ ...patch, id }])
  },

  async updateNodes(patches) {
    const inv = get().investigation
    if (!inv) return
    const byId = new Map(patches.map((p) => [p.id!, p]))
    // Mise à jour optimiste pour que la saisie reste fluide.
    set({
      nodes: get().nodes.map((n) => {
        const p = byId.get(n.id)
        if (!p) return n
        const merged = { ...n.data.node, ...p } as GraphNode
        return toFlowNode(merged, { ...n, position: p.x !== undefined ? { x: p.x, y: p.y ?? n.position.y } : n.position })
      })
    })
    const saved = await api('graph:upsertNodes', inv.id, patches)
    const map = new Map(saved.map((s) => [s.id, s]))
    set({ nodes: get().nodes.map((n) => (map.has(n.id) ? toFlowNode(map.get(n.id)!, n) : n)) })
  },

  async deleteNodes(ids) {
    const inv = get().investigation
    if (!inv || !ids.length) return
    const set2 = new Set(ids)
    set({
      nodes: get().nodes.filter((n) => !set2.has(n.id)),
      edges: get().edges.filter((e) => !set2.has(e.source) && !set2.has(e.target))
    })
    await api('graph:deleteNodes', inv.id, ids)
  },

  async addEdges(inputs) {
    const inv = get().investigation
    if (!inv) return []
    const saved = await api('graph:upsertEdges', inv.id, inputs)
    const ids = new Set(saved.map((s) => s.id))
    set({ edges: [...get().edges.filter((e) => !ids.has(e.id)), ...saved.map((s) => toFlowEdge(s))] })
    return saved
  },

  async updateEdge(id, patch) {
    const inv = get().investigation
    const current = get().edges.find((e) => e.id === id)?.data?.edge
    if (!inv || !current) return
    const next = { ...current, ...patch, id }
    set({ edges: get().edges.map((e) => (e.id === id ? toFlowEdge(next as GraphEdge, e) : e)) })
    const [saved] = await api('graph:upsertEdges', inv.id, [next])
    set({ edges: get().edges.map((e) => (e.id === id ? toFlowEdge(saved, e) : e)) })
  },

  async deleteEdges(ids) {
    const inv = get().investigation
    if (!inv || !ids.length) return
    const s = new Set(ids)
    set({ edges: get().edges.filter((e) => !s.has(e.id)) })
    await api('graph:deleteEdges', inv.id, ids)
  },

  async setPositions(pos) {
    const patches = Object.entries(pos).map(([id, p]) => ({ id, x: p.x, y: p.y }))
    await get().updateNodes(patches)
  },

  applyChange(change) {
    const inv = get().investigation
    if (!inv || inv.id !== change.investigationId) return
    const delNodes = new Set(change.deletedNodeIds ?? [])
    const delEdges = new Set(change.deletedEdgeIds ?? [])
    const nodes = new Map(get().nodes.filter((n) => !delNodes.has(n.id)).map((n) => [n.id, n]))
    for (const n of change.nodes) nodes.set(n.id, toFlowNode(n, nodes.get(n.id)))
    const edges = new Map(get().edges.filter((e) => !delEdges.has(e.id)).map((e) => [e.id, e]))
    for (const e of change.edges) edges.set(e.id, toFlowEdge(e, edges.get(e.id)))
    set({
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()).filter((e) => nodes.has(e.source) && nodes.has(e.target))
    })
  },

  async updateInvestigation(patch) {
    const inv = get().investigation
    if (!inv) return
    set({ investigation: { ...inv, ...patch } })
    const saved = await api('investigations:update', inv.id, patch)
    set({ investigation: saved })
  },

  select(ids) {
    const s = new Set(ids)
    set({ nodes: get().nodes.map((n) => ({ ...n, selected: s.has(n.id) })), edges: get().edges.map((e) => ({ ...e, selected: false })) })
  },

  selectedNodes() {
    return get()
      .nodes.filter((n) => n.selected)
      .map((n) => n.data.node)
  }
}))
