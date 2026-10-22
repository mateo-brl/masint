// Corrélation entre enquêtes : pour chaque nœud de l'enquête ouverte, les autres enquêtes où la
// même entité apparaît. Chargée une fois à l'ouverture, puis complétée pour les nœuds créés ou
// dont la valeur change (requêtes groupées, jamais pendant un glisser). Vide quand les
// enquêtes sont cloisonnées.

import { useEffect } from 'react'
import { create } from 'zustand'
import type { CrossRef, GraphNode } from '@shared/types'
import { api } from '../lib/api'
import { useApp } from './app'
import { useCanvas } from './canvas'
import { useGraph } from './graph'

interface CorrelationState {
  investigationId: string | null
  refs: ReadonlyMap<string, CrossRef[]>
}

export const useCorrelation = create<CorrelationState>(() => ({ investigationId: null, refs: new Map() }))

/** Publie les décomptes pour les nœuds du canevas (pastille « vu dans N enquêtes »). */
function publish(refs: ReadonlyMap<string, CrossRef[]>): void {
  useCorrelation.setState({ refs })
  useCanvas.setState({ crossRefs: new Map(Array.from(refs, ([id, list]) => [id, list.length])) })
}

/** Délai de regroupement des nouveaux nœuds avant la requête. */
const BATCH_DELAY = 400

/** Valeur qui détermine la clé canonique d'un nœud. */
const identity = (n: GraphNode): string => `${n.type}\u0000${n.platform ?? ''}\u0000${n.label}`

/**
 * Tient la corrélation à jour pour l'enquête ouverte. À monter une fois dans l'espace de travail.
 */
export function useCorrelationSync(): void {
  const investigationId = useGraph((s) => s.investigation?.id ?? null)
  const isolated = useApp((s) => s.settings?.isolateInvestigations ?? false)

  useEffect(() => {
    useCorrelation.setState({ investigationId })
    publish(new Map())
    if (!investigationId || isolated) return
    let live = true
    /** Valeur interrogée pour chaque nœud ; nœuds (versions) déjà examinés. */
    const asked = new Map<string, string>()
    const seen = new WeakSet<GraphNode>()
    let timer: ReturnType<typeof setTimeout> | null = null

    const check = async (): Promise<void> => {
      timer = null
      const batch: string[] = []
      for (const f of useGraph.getState().nodes) {
        const n = f.data.node
        // Même version du nœud qu'au dernier examen (cas d'un déplacement) : rien à faire.
        if (seen.has(n)) continue
        seen.add(n)
        if (n.kind !== 'entity') continue
        const id = identity(n)
        if (asked.get(n.id) === id) continue
        asked.set(n.id, id)
        batch.push(n.id)
      }
      if (!batch.length) return
      const found = await api('nodes:crossRefs', batch).catch(() => ({}) as Record<string, CrossRef[]>)
      if (!live) return
      const refs = new Map(useCorrelation.getState().refs)
      for (const id of batch) {
        const list = found[id]
        if (list?.length) refs.set(id, list)
        else refs.delete(id)
      }
      publish(refs)
    }
    const schedule = (): void => {
      if (!timer) timer = setTimeout(() => void check(), BATCH_DELAY)
    }

    void check()
    const unsubscribe = useGraph.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes) schedule()
    })
    return () => {
      live = false
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [investigationId, isolated])
}
