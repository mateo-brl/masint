// Analyse du graphe sans bloquer l'interface : au-delà de WORKER_MIN nœuds, le calcul part
// dans un Web Worker (voir analysis.worker.ts). En dessous, ou sans Worker (tests sous Node),
// il se fait directement.

import { betweenness, communities, degrees, type AnalysisGraph, type Communities } from './analysis'

/** Au-delà de ce nombre de nœuds, calcul dans le Worker. */
export const WORKER_MIN = 500

export interface Centrality {
  degree: Map<string, number>
  betweenness: Map<string, number>
}

type Raw = { degree: Array<[string, number]>; betweenness: Array<[string, number]> } | { of: Array<[string, number]>; members: string[][]; modularity: number }
type Reply = { id: number; result?: Raw; error?: string }

let worker: Worker | null = null
let unavailable = false
let nextId = 1
const pending = new Map<number, { resolve: (r: Raw) => void; reject: (e: Error) => void; fallback: () => void }>()

function getWorker(): Worker | null {
  if (worker || unavailable) return worker
  if (typeof Worker === 'undefined') {
    unavailable = true
    return null
  }
  try {
    worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    unavailable = true
    return null
  }
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const job = pending.get(e.data.id)
    if (!job) return
    pending.delete(e.data.id)
    if (e.data.result) job.resolve(e.data.result)
    else job.reject(new Error(e.data.error ?? 'analysis'))
  }
  // Script introuvable ou refusé : les calculs en attente se font sur le fil principal.
  worker.onerror = (e) => {
    e.preventDefault()
    worker?.terminate()
    worker = null
    unavailable = true
    const jobs = Array.from(pending.values())
    pending.clear()
    for (const job of jobs) job.fallback()
  }
  return worker
}

function run(kind: 'centrality' | 'communities', graph: AnalysisGraph, direct: () => Raw): Promise<Raw> {
  const w = graph.nodes.length > WORKER_MIN ? getWorker() : null
  if (!w) return Promise.resolve().then(direct)
  return new Promise<Raw>((resolve, reject) => {
    const id = nextId++
    const fallback = (): void => {
      try {
        resolve(direct())
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    pending.set(id, { resolve, reject, fallback })
    // Copie simple (clonage structuré) : pas de références vers les objets du canevas.
    w.postMessage({ id, kind, graph: { nodes: [...graph.nodes], edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) } })
  })
}

/** Degré et intermédiarité de chaque nœud. */
export async function centralityAsync(graph: AnalysisGraph): Promise<Centrality> {
  const raw = (await run('centrality', graph, () => ({
    degree: Array.from(degrees(graph)),
    betweenness: Array.from(betweenness(graph, { maxSources: 4000 }))
  }))) as { degree: Array<[string, number]>; betweenness: Array<[string, number]> }
  return { degree: new Map(raw.degree), betweenness: new Map(raw.betweenness) }
}

/** Communautés (méthode de Louvain). */
export async function communitiesAsync(graph: AnalysisGraph): Promise<Communities> {
  const raw = (await run('communities', graph, () => {
    const c = communities(graph)
    return { of: Array.from(c.of), members: c.members, modularity: c.modularity }
  })) as { of: Array<[string, number]>; members: string[][]; modularity: number }
  return { of: new Map(raw.of), members: raw.members, modularity: raw.modularity }
}
