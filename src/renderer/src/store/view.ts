// État d'affichage du canevas propre à ce poste : groupes dépliés, position et sélection des
// nœuds de regroupement. Les données de l'enquête n'en dépendent pas.

import { create } from 'zustand'
import { freeSpot, type Point } from '@shared/placement'
import { collapsedAncestors, computeView, type GraphView } from '../lib/collapse'
import { loadPref, savePref } from '../lib/prefs'
import { activeViewFilter, useFilters, useViewFilter } from './filters'
import { useGraph } from './graph'

interface BundleState {
  position?: Point
  measured?: { width: number; height: number }
  selected?: boolean
}

interface ViewState {
  investigationId: string | null
  /** Groupes que l'enquêteur a dépliés. */
  expanded: Set<string>
  bundles: Record<string, BundleState>
  load(investigationId: string): void
  patchBundle(id: string, patch: BundleState, persist?: boolean): void
  selectBundle(id: string | null): void
  /** Déplie un groupe : ses membres sont rangés en grille, dans un espace libre près du groupe. */
  expandBundle(id: string): Promise<void>
  /** Regroupe de nouveau les membres d'un groupe déplié. */
  regroup(id: string): void
  regroupAll(): void
}

const prefKey = (inv: string): string => `view:${inv}`

export const useView = create<ViewState>((set, get) => ({
  investigationId: null,
  expanded: new Set(),
  bundles: {},

  load(investigationId) {
    if (get().investigationId === investigationId) return
    const saved = loadPref<{ expanded?: string[]; positions?: Record<string, Point> }>(prefKey(investigationId), {})
    const bundles: Record<string, BundleState> = {}
    for (const [id, position] of Object.entries(saved.positions ?? {})) bundles[id] = { position }
    set({ investigationId, expanded: new Set(saved.expanded ?? []), bundles })
  },

  patchBundle(id, patch, persist = false) {
    set({ bundles: { ...get().bundles, [id]: { ...get().bundles[id], ...patch } } })
    if (persist) save()
  },

  selectBundle(id) {
    const bundles: Record<string, BundleState> = {}
    for (const [k, v] of Object.entries(get().bundles)) bundles[k] = { ...v, selected: k === id }
    if (id && !bundles[id]) bundles[id] = { selected: true }
    set({ bundles })
  },

  async expandBundle(id) {
    const { nodes, setPositions } = useGraph.getState()
    const view = currentView()
    const bundle = view.bundles.find((b) => b.id === id)
    set({ expanded: new Set([...get().expanded, id]) })
    save()
    if (!bundle) return
    // Grille environ 1,6 fois plus large que haute, posée sur une place libre près du groupe.
    const cellW = 216
    const cellH = 64
    const cols = Math.max(2, Math.ceil(Math.sqrt(bundle.members.length * 1.6)))
    const rows = Math.ceil(bundle.members.length / cols)
    const members = new Set(bundle.members)
    const occupied = nodes
      .filter((n) => !members.has(n.id) && !view.hidden.has(n.id) && n.data.node.kind !== 'drawing')
      .map((n) => ({ x: n.position.x, y: n.position.y, width: n.measured?.width ?? 196, height: n.measured?.height ?? 52 }))
    const start = get().bundles[id]?.position ?? nodes.find((n) => n.id === bundle.members[0])?.position ?? { x: 0, y: 0 }
    const at = freeSpot(occupied, start, { width: cols * cellW, height: rows * cellH })
    const pos: Record<string, Point> = {}
    bundle.members.forEach((m, i) => (pos[m] = { x: at.x + (i % cols) * cellW, y: at.y + Math.floor(i / cols) * cellH }))
    await setPositions(pos)
  },

  regroup(id) {
    const expanded = new Set(get().expanded)
    expanded.delete(id)
    set({ expanded })
    save()
  },

  regroupAll() {
    set({ expanded: new Set() })
    save()
  }
}))

function save(): void {
  const { investigationId, expanded, bundles } = useView.getState()
  if (!investigationId) return
  const positions: Record<string, Point> = {}
  for (const [id, b] of Object.entries(bundles)) if (b.position) positions[id] = b.position
  savePref(prefKey(investigationId), { expanded: Array.from(expanded), positions })
}

/** Vue courante (filtre, nœuds masqués, groupes) calculée à partir des stores. */
export function currentView(): GraphView {
  const { nodes, edges } = useGraph.getState()
  return computeView(
    nodes.map((n) => n.data.node),
    edges.map((e) => e.data!.edge),
    useView.getState().expanded,
    { filter: activeViewFilter() }
  )
}

/**
 * Vue courante pour un composant : mêmes paramètres que le canevas, donc le même calcul
 * mémorisé. Le composant n'est re-rendu que si la vue change (pas pendant un glisser).
 */
export function useGraphView(): GraphView {
  // Groupes dépliés et filtre : re-rendu quand ils changent, la vue est alors relue.
  useView((s) => s.expanded)
  useViewFilter()
  return useGraph(() => currentView())
}

/**
 * Rend un nœud visible : retire le filtre s'il l'écarte, déplie ses ancêtres repliés et le
 * groupe qui le contient.
 */
export async function revealNode(id: string): Promise<void> {
  if (currentView().filtered.has(id)) useFilters.getState().reset()
  const { nodes, edges, updateNodes } = useGraph.getState()
  const ancestors = collapsedAncestors(
    id,
    nodes.map((n) => n.data.node),
    edges.map((e) => e.data!.edge)
  )
  if (ancestors.length) {
    const byId = new Map(nodes.map((n) => [n.id, n.data.node]))
    await updateNodes(ancestors.map((a) => ({ id: a, style: { ...byId.get(a)!.style, collapsed: false } })))
  }
  const bundle = currentView().bundleOf.get(id)
  if (bundle) await useView.getState().expandBundle(bundle)
}

/** Nœuds réellement affichés (visibles et groupes), pour cadrer une capture. */
export function displayedNodes(): Array<{ id: string; position: Point; data: Record<string, unknown>; measured?: { width?: number; height?: number } }> {
  const view = currentView()
  const { nodes } = useGraph.getState()
  const bundles = useView.getState().bundles
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return [
    ...nodes.filter((n) => !view.hidden.has(n.id)),
    ...view.bundles.map((b) => ({
      id: b.id,
      data: {},
      position: bundles[b.id]?.position ?? byId.get(b.members[0])!.position,
      measured: bundles[b.id]?.measured ?? { width: 212, height: 48 }
    }))
  ]
}
