// Aller à un nœud depuis n'importe où (palette, tableau, recherche globale, panneau d'analyse) :
// vue Graphe affichée au besoin, nœud rendu visible, sélectionné et centré. Le canevas
// s'enregistre ici à son montage ; un nœud demandé avant (autre vue, autre enquête) est montré
// dès que le canevas est prêt.

import type { ReactFlowInstance } from '@xyflow/react'
import { useApp } from '../store/app'
import { useGraph, type FlowEdge, type FlowNode } from '../store/graph'
import { revealNode } from '../store/view'
import { fitPadding } from './viewport'

let canvas: ReactFlowInstance<FlowNode, FlowEdge> | null = null
/** Nœud à centrer (`id`) ou nœuds à cadrer (`ids`) dès que le canevas est prêt. */
type Pending = { id: string; zoom?: number; ids?: undefined } | { ids: string[]; id?: undefined; zoom?: undefined }
let pending: Pending | null = null

/** Le canevas monté (ou `null`) ; appelé par GraphCanvas. */
export function registerCanvas(rf: ReactFlowInstance<FlowNode, FlowEdge> | null): void {
  canvas = rf
}

export function getCanvas(): ReactFlowInstance<FlowNode, FlowEdge> | null {
  return canvas
}

/** Demande faite avant le montage du canevas : le canevas la traite au lieu du recadrage initial. */
export function takePendingFocus(): Pending | null {
  const p = pending
  pending = null
  return p
}

/** Centre la vue sur un nœud, sans toucher à la sélection. */
export function centerOn(id: string, opts: { zoom?: number; duration?: number } = {}): void {
  const n = useGraph.getState().nodes.find((x) => x.id === id)
  if (!n || !canvas) return
  const w = n.measured?.width ?? 196
  const h = n.measured?.height ?? 52
  void canvas.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: opts.zoom ?? Math.max(canvas.getZoom(), 1), duration: opts.duration ?? 400 })
}

/** Montre un nœud de l'enquête ouverte : vue Graphe, nœud visible, sélectionné et centré. */
export async function focusNode(id: string, opts: { zoom?: number } = {}): Promise<void> {
  if (!useGraph.getState().nodes.some((n) => n.id === id)) return
  await revealNode(id)
  useGraph.getState().select([id])
  if (useApp.getState().view !== 'graph' || !canvas) {
    pending = { id, zoom: opts.zoom }
    useApp.getState().setView('graph')
    return
  }
  centerOn(id, { zoom: opts.zoom ?? 1.2 })
}

/** Cadre plusieurs nœuds sur le canevas (vue Graphe affichée au besoin). */
export function showOnCanvas(ids: string[]): void {
  if (!ids.length) return
  if (useApp.getState().view !== 'graph' || !canvas) {
    pending = { ids }
    useApp.getState().setView('graph')
    return
  }
  fitNodes(ids)
}

/** Cadre des nœuds affichés. */
export function fitNodes(ids: string[], duration = 400): void {
  void canvas?.fitView({ nodes: ids.map((id) => ({ id })), padding: fitPadding(), duration, maxZoom: 1.3 })
}

/** Ouvre une autre enquête et y montre un nœud. */
export async function openInvestigationAt(investigationId: string, nodeId: string): Promise<void> {
  pending = { id: nodeId, zoom: 1.2 }
  if (useApp.getState().currentId === investigationId) {
    pending = null
    return focusNode(nodeId)
  }
  await useApp.getState().openInvestigation(investigationId)
}
