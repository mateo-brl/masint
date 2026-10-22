// Calculs d'analyse hors du fil principal (intermédiarité, communautés) : sur un grand graphe,
// l'algorithme de Brandes parcourt le graphe depuis chaque nœud.

import { betweenness, communities, degrees, type AnalysisGraph } from './analysis'

interface Request {
  id: number
  kind: 'centrality' | 'communities'
  graph: AnalysisGraph
}

self.onmessage = (e: MessageEvent<Request>): void => {
  const { id, kind, graph } = e.data
  try {
    if (kind === 'centrality')
      self.postMessage({ id, result: { degree: Array.from(degrees(graph)), betweenness: Array.from(betweenness(graph, { maxSources: 4000 })) } })
    else {
      const c = communities(graph)
      self.postMessage({ id, result: { of: Array.from(c.of), members: c.members, modularity: c.modularity } })
    }
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
