// Disposition automatique calculée dans un Web Worker (voir layout.worker.ts). Sans Worker
// (tests sous Node) ou si celui-ci échoue, le calcul se fait directement, comme avant.

import { computeLayout, type LayoutEdge, type LayoutKind, type LayoutNode } from './layout'

type Positions = Record<string, { x: number; y: number }>
type Reply = { id: number; positions?: Positions; error?: string }

let worker: Worker | null = null
/** Le Worker n'a pas pu démarrer : on n'essaie plus. */
let unavailable = false
let nextId = 1
const pending = new Map<number, { resolve: (p: Positions) => void; reject: (e: Error) => void; fallback: () => void }>()

function getWorker(): Worker | null {
  if (worker || unavailable) return worker
  if (typeof Worker === 'undefined') {
    unavailable = true
    return null
  }
  try {
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    unavailable = true
    return null
  }
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const job = pending.get(e.data.id)
    if (!job) return
    pending.delete(e.data.id)
    if (e.data.positions) job.resolve(e.data.positions)
    else job.reject(new Error(e.data.error ?? 'layout'))
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

/** Calcule une disposition sans bloquer l'interface (repli synchrone si aucun Worker). */
export function computeLayoutAsync(kind: LayoutKind, nodes: LayoutNode[], edges: LayoutEdge[]): Promise<Positions> {
  const w = getWorker()
  if (!w) return Promise.resolve().then(() => computeLayout(kind, nodes, edges))
  return new Promise<Positions>((resolve, reject) => {
    const id = nextId++
    const fallback = (): void => {
      try {
        resolve(computeLayout(kind, nodes, edges))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    pending.set(id, { resolve, reject, fallback })
    // Copie simple des données (clonage structuré) : pas de références vers les nœuds du canevas.
    w.postMessage({
      id,
      kind,
      nodes: nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height })),
      edges: edges.map((e) => ({ source: e.source, target: e.target }))
    })
  })
}
