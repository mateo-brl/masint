// Calcul des dispositions hors du fil principal : l'interface reste réactive pendant les
// centaines d'itérations de la disposition « forces » sur un grand graphe.

import { computeLayout, type LayoutEdge, type LayoutKind, type LayoutNode } from './layout'

interface Request {
  id: number
  kind: LayoutKind
  nodes: LayoutNode[]
  edges: LayoutEdge[]
}

self.onmessage = (e: MessageEvent<Request>): void => {
  const { id, kind, nodes, edges } = e.data
  try {
    self.postMessage({ id, positions: computeLayout(kind, nodes, edges) })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
