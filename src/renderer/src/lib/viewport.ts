// Zone utile du canevas : les barres et panneaux flottants en masquent une partie,
// le recadrage et le placement des nouveaux nœuds doivent en tenir compte.

import type { FitViewOptions, ReactFlowInstance } from '@xyflow/react'
import { freeSpots, nodeBox, type Box, type Point } from '@shared/placement'
import type { FlowEdge, FlowNode } from '../store/graph'
import { useGraph } from '../store/graph'

type Flow = ReactFlowInstance<FlowNode, FlowEdge>

/** Marges en pixels occupées par la barre du haut, celle du bas et les panneaux ouverts. */
export function canvasInsets(): { top: number; right: number; bottom: number; left: number } {
  const flow = document.querySelector('.react-flow')?.getBoundingClientRect()
  const base = { top: 84, right: 32, bottom: 84, left: 32 }
  if (!flow) return base
  const catalog = document.querySelector('[data-panel="catalog"]')?.getBoundingClientRect()
  const props = document.querySelector('[data-panel="properties"]')?.getBoundingClientRect()
  return {
    ...base,
    left: catalog?.width ? Math.max(base.left, catalog.right - flow.left + 32) : base.left,
    right: props?.width ? Math.max(base.right, flow.right - props.left + 32) : base.right
  }
}

export function fitPadding(): NonNullable<FitViewOptions['padding']> {
  const i = canvasInsets()
  return { top: `${i.top}px`, right: `${i.right}px`, bottom: `${i.bottom}px`, left: `${i.left}px` }
}

/** « Tout afficher » dans la partie visible du canevas, panneaux exclus. */
export function fitGraph(rf: Flow, duration = 300, maxZoom = 1.4): void {
  void rf.fitView({ padding: fitPadding(), duration, maxZoom })
}

/** Centre, en coordonnées du graphe, de la partie visible du canevas. */
export function visibleCenter(rf: Flow): Point {
  const flow = document.querySelector('.react-flow')?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight
  }
  const i = canvasInsets()
  return rf.screenToFlowPosition({
    x: flow.left + i.left + (flow.width - i.left - i.right) / 2,
    y: flow.top + i.top + (flow.height - i.top - i.bottom) / 2
  })
}

/** Emprises des nœuds affichés (taille mesurée quand elle est connue), dessins exclus. */
export function occupiedBoxes(): Box[] {
  return useGraph
    .getState()
    .nodes.filter((n) => n.data.node.kind !== 'drawing')
    .map((n) => {
      const est = nodeBox(n.data.node)
      return { x: n.position.x, y: n.position.y, width: n.measured?.width ?? est.width, height: n.measured?.height ?? est.height }
    })
}

/**
 * Coins haut gauche libres pour poser des nœuds de tailles `sizes` autour de `center`
 * (coordonnées du graphe), sans chevaucher le graphe ni se chevaucher entre eux.
 */
export function placeAround(center: Point, sizes: Array<{ width: number; height: number }>): Point[] {
  if (!sizes.length) return []
  const start = { x: center.x - sizes[0].width / 2, y: center.y - sizes[0].height / 2 }
  return freeSpots(occupiedBoxes(), start, sizes)
}
