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
import type { EdgeInput, GraphChange, GraphEdge, GraphNode, Investigation, NodeInput, Suggestion } from '@shared/types'
import { api } from '../lib/api'
import type { Bundle } from '../lib/collapse'

/** `bundle` : nœud d'affichage qui regroupe des feuilles semblables (voir lib/collapse). */
export type FlowNode = Node<{ node: GraphNode; bundle?: Bundle }>
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
    zIndex: n.kind === 'drawing' ? 3 : n.kind === 'entity' ? 2 : 1
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

// Historique d'annulation. Les opérations enregistrées dans la même tâche
// (ex. suppression d'un nœud et de ses liens) forment une seule étape.
interface HistoryEntry {
  undo: () => Promise<void>
  redo: () => Promise<void>
}

const past: HistoryEntry[] = []
const future: HistoryEntry[] = []
let pending: HistoryEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let replaying = false
const HISTORY_LIMIT = 100

function flushHistory(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  if (!pending.length) return
  const group = pending
  pending = []
  past.push(
    group.length === 1
      ? group[0]
      : {
          undo: async () => {
            for (const g of [...group].reverse()) await g.undo()
          },
          redo: async () => {
            for (const g of group) await g.redo()
          }
        }
  )
  if (past.length > HISTORY_LIMIT) past.shift()
  future.length = 0
  useGraph.setState({ canUndo: true, canRedo: false })
}

function record(entry: HistoryEntry): void {
  if (replaying) return
  pending.push(entry)
  if (!flushTimer) flushTimer = setTimeout(flushHistory, 0)
}

function resetHistory(): void {
  past.length = 0
  future.length = 0
  pending = []
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
}

/** Valeurs actuelles des champs qu'un patch va modifier, pour pouvoir l'annuler. */
function previousOf<T extends object>(current: T, patch: object): Partial<T> {
  const prev: Partial<T> = {}
  for (const k of Object.keys(patch)) (prev as Record<string, unknown>)[k] = (current as Record<string, unknown>)[k]
  return prev
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
  canUndo: boolean
  canRedo: boolean
  /** Résultats à vérifier de l'enquête ouverte (tous états). */
  suggestions: Suggestion[]

  refreshSuggestions(): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
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
  suggestions: [],

  async refreshSuggestions() {
    const inv = get().investigation
    if (!inv) return set({ suggestions: [] })
    const list = await api('suggestions:list', inv.id)
    if (get().investigation?.id === inv.id) set({ suggestions: list })
  },
  tool: 'select',
  drawColor: '#e5484d',
  drawWidth: 4,
  canUndo: false,
  canRedo: false,

  async undo() {
    flushHistory()
    const entry = past.pop()
    if (!entry) return
    replaying = true
    try {
      await entry.undo()
    } finally {
      replaying = false
    }
    future.push(entry)
    set({ canUndo: past.length > 0, canRedo: true })
  },

  async redo() {
    const entry = future.pop()
    if (!entry) return
    replaying = true
    try {
      await entry.redo()
    } finally {
      replaying = false
    }
    past.push(entry)
    set({ canUndo: true, canRedo: future.length > 0 })
  },

  async load(id) {
    resetHistory()
    set({ loading: true, canUndo: false, canRedo: false })
    const bundle = await api('investigations:open', id)
    set({
      investigation: bundle.investigation,
      nodes: bundle.nodes.map((n) => toFlowNode(n)),
      edges: bundle.edges.map((e) => toFlowEdge(e)),
      loading: false,
      tool: 'select',
      suggestions: []
    })
    void get().refreshSuggestions()
  },

  close() {
    resetHistory()
    set({ investigation: null, nodes: [], edges: [], canUndo: false, canRedo: false, suggestions: [] })
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
      void get().updateNodes(patches)
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
    const withIds = inputs.map((i) => ({ ...i, id: i.id ?? crypto.randomUUID() }))
    const ids0 = withIds.map((i) => i.id)
    record({ undo: () => get().deleteNodes(ids0), redo: async () => void (await get().addNodes(withIds, false)) })
    const saved = await api('graph:upsertNodes', inv.id, withIds)
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
    const currentById = new Map(get().nodes.map((n) => [n.id, n.data.node]))
    const prev = patches
      .filter((p) => currentById.has(p.id!))
      .map((p) => ({ ...previousOf(currentById.get(p.id!)!, p), id: p.id }) as NodeInput)
    record({ undo: () => get().updateNodes(prev), redo: () => get().updateNodes(patches) })
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
    const nodeSnap = get().nodes.filter((n) => set2.has(n.id)).map((n) => n.data.node)
    const edgeSnap = get()
      .edges.filter((e) => set2.has(e.source) || set2.has(e.target))
      .map((e) => e.data!.edge)
    record({
      undo: async () => {
        await get().addNodes(nodeSnap, false)
        if (edgeSnap.length) await get().addEdges(edgeSnap)
      },
      redo: () => get().deleteNodes(ids)
    })
    set({
      nodes: get().nodes.filter((n) => !set2.has(n.id)),
      edges: get().edges.filter((e) => !set2.has(e.source) && !set2.has(e.target))
    })
    await api('graph:deleteNodes', inv.id, ids)
  },

  async addEdges(inputs) {
    const inv = get().investigation
    if (!inv) return []
    const withIds = inputs.map((i) => ({ ...i, id: i.id ?? crypto.randomUUID() }))
    record({ undo: () => get().deleteEdges(withIds.map((e) => e.id)), redo: async () => void (await get().addEdges(withIds)) })
    const saved = await api('graph:upsertEdges', inv.id, withIds)
    const ids = new Set(saved.map((s) => s.id))
    set({ edges: [...get().edges.filter((e) => !ids.has(e.id)), ...saved.map((s) => toFlowEdge(s))] })
    return saved
  },

  async updateEdge(id, patch) {
    const inv = get().investigation
    const current = get().edges.find((e) => e.id === id)?.data?.edge
    if (!inv || !current) return
    const next = { ...current, ...patch, id }
    const prev = previousOf(current, patch)
    record({ undo: () => get().updateEdge(id, prev), redo: () => get().updateEdge(id, patch) })
    set({ edges: get().edges.map((e) => (e.id === id ? toFlowEdge(next as GraphEdge, e) : e)) })
    const [saved] = await api('graph:upsertEdges', inv.id, [next])
    set({ edges: get().edges.map((e) => (e.id === id ? toFlowEdge(saved, e) : e)) })
  },

  async deleteEdges(ids) {
    const inv = get().investigation
    if (!inv || !ids.length) return
    const s = new Set(ids)
    const snap = get()
      .edges.filter((e) => s.has(e.id))
      .map((e) => e.data!.edge)
    if (!snap.length) return
    record({ undo: async () => void (await get().addEdges(snap)), redo: () => get().deleteEdges(ids) })
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
    // Seuls les éléments dont l'état change sont recréés : les autres ne sont pas re-rendus.
    const edges = get().edges
    set({
      nodes: get().nodes.map((n) => (!!n.selected === s.has(n.id) ? n : { ...n, selected: s.has(n.id) })),
      edges: edges.some((e) => e.selected) ? edges.map((e) => (e.selected ? { ...e, selected: false } : e)) : edges
    })
  },

  selectedNodes() {
    return get()
      .nodes.filter((n) => n.selected)
      .map((n) => n.data.node)
  }
}))
