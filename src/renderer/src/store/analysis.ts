// Analyse du graphe dans l'interface : plus court chemin mis en évidence, coloration par
// communauté. Les calculs eux-mêmes sont dans lib/analysis (Worker au-delà de 500 nœuds).

import { create } from 'zustand'
import { shortestPath, type AnalysisGraph, type GraphPath } from '../lib/analysis'
import type { GraphView } from '../lib/collapse'
import { getCanvas } from '../lib/focus'
import { fitPadding } from '../lib/viewport'
import i18n from '../lib/i18n'
import { useApp } from './app'
import { useCanvas } from './canvas'
import { useGraph } from './graph'
import { currentView, revealNode } from './view'

interface AnalysisState {
  /** Chemin mis en évidence sur le canevas. */
  path: (GraphPath & { from: string; to: string }) | null
  /** Option « Colorer par communauté ». */
  colorByCommunity: boolean
  setColorByCommunity(on: boolean): void
}

export const useAnalysis = create<AnalysisState>((set) => ({
  path: null,
  colorByCommunity: false,
  setColorByCommunity(on) {
    set({ colorByCommunity: on })
    if (!on) useCanvas.setState({ community: null })
  }
}))

/**
 * Graphe analysé : les entités de l'enquête (annotations exclues) et leurs liens, sans ce que le
 * filtre masque. Les nœuds repliés ou regroupés en font partie : ce sont des données.
 */
export function analysisGraph(view: GraphView): AnalysisGraph {
  const { nodes, edges } = useGraph.getState()
  const ids = new Set<string>()
  for (const n of nodes) if (n.data.node.kind === 'entity' && !view.filtered.has(n.id)) ids.add(n.id)
  return {
    nodes: Array.from(ids),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, source: e.source, target: e.target }))
  }
}

/** Efface la mise en évidence du chemin. */
export function clearPath(): void {
  if (!useAnalysis.getState().path && !useCanvas.getState().focus) return
  useAnalysis.setState({ path: null })
  useCanvas.setState({ focus: null })
}

/**
 * Plus court chemin entre deux nœuds : nœuds repliés ou regroupés du chemin rendus visibles,
 * chemin mis en évidence (le reste estompé jusqu'à Échap) et cadré.
 */
export async function showShortestPath(from: string, to: string): Promise<GraphPath | null> {
  const { toast } = useApp.getState()
  const path = shortestPath(analysisGraph(currentView()), from, to)
  if (!path) {
    clearPath()
    toast('info', i18n.t('analysis.noPath'))
    return null
  }
  for (const id of path.nodes) if (currentView().hidden.has(id)) await revealNode(id)
  useAnalysis.setState({ path: { ...path, from, to } })
  useCanvas.setState({ focus: { nodes: new Set(path.nodes), edges: new Set(path.edges) } })
  toast('success', i18n.t('analysis.pathFound', { count: path.edges.length }))
  const rf = getCanvas()
  if (rf) setTimeout(() => void rf.fitView({ nodes: path.nodes.map((id) => ({ id })), padding: fitPadding(), duration: 400, maxZoom: 1.3 }), 60)
  return path
}
