// Fusion de nœuds : rien de ce que portaient les nœuds absorbés ne doit se perdre.

import { ADMIRALTY_KEY } from '@shared/provenance'
import type { GraphChange, GraphEdge, GraphNode, PropValue } from '@shared/types'
import type { Repo } from './db/repo'

/**
 * Propriétés d'une fusion : celles de la cible d'abord. Les valeurs différentes des autres nœuds
 * sont conservées (liste de valeurs), et leurs libellés vont dans « autres valeurs ». La
 * cotation de la cible l'emporte (une seule cotation par nœud).
 */
export function mergeData(target: GraphNode, others: GraphNode[]): Record<string, PropValue> {
  const data: Record<string, PropValue> = { ...target.data }
  // Valeur simple ou liste de valeurs simples, sinon null (objet, coordonnées...).
  const values = (v: unknown): string[] | null =>
    typeof v === 'string' || typeof v === 'number'
      ? [String(v)]
      : Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')
        ? v.map(String)
        : null
  for (const o of others)
    for (const [k, v] of Object.entries(o.data)) {
      const cur = data[k]
      if (cur === undefined || cur === null || cur === '') {
        data[k] = v
        continue
      }
      if (k === ADMIRALTY_KEY) continue
      const a = values(cur)
      const b = values(v)
      if (!a || !b) continue
      const all = Array.from(new Set([...a, ...b]))
      if (all.length > a.length) data[k] = all
    }
  const aliases = new Set(values(data.aliases) ?? [])
  for (const o of others) if (o.label && o.label !== target.label) aliases.add(o.label)
  if (aliases.size) data.aliases = Array.from(aliases)
  return data
}

/**
 * Fusionne `otherIds` dans `targetId` : propriétés, notes et image reprises, liens recâblés vers
 * la cible (libellés cumulés quand le lien existe déjà), exécutions, résultats à vérifier et
 * observations reportés, puis nœuds absorbés supprimés.
 */
export function mergeNodes(repo: Repo, investigationId: string, targetId: string, otherIds: string[]): GraphChange {
  const target = repo.getNode(targetId)
  if (!target) throw new Error('Nœud cible introuvable')
  const others = repo.getNodes(otherIds.filter((id) => id !== targetId))
  const data = mergeData(target, others)
  const notes = [target.notes, ...others.map((o) => o.notes)].filter(Boolean).join('\n\n')
  const [merged] = repo.upsertNodes(investigationId, [
    { id: targetId, data, notes, imageId: target.imageId ?? others.find((o) => o.imageId)?.imageId ?? null }
  ])
  const edges: GraphEdge[] = []
  const otherSet = new Set(others.map((o) => o.id))
  // Lien absorbé vers le lien qui le remplace (`null` : lien entre nœuds fusionnés, disparu).
  const edgeMap = new Map<string, string | null>()
  for (const e of repo.listEdges(investigationId)) {
    if (!otherSet.has(e.source) && !otherSet.has(e.target)) continue
    const source = otherSet.has(e.source) ? targetId : e.source
    const target2 = otherSet.has(e.target) ? targetId : e.target
    if (source === target2) {
      edgeMap.set(e.id, null)
      continue
    }
    const existing = repo.findEdge(investigationId, source, target2)
    if (existing) {
      edgeMap.set(e.id, existing.id)
      // Lien déjà présent : on garde les deux libellés (« empreinte SHA-256 · empreinte MD5 »).
      const labels = [existing.label, e.label].filter(Boolean)
      const label = Array.from(new Set(labels.flatMap((l) => l.split(' · ')))).join(' · ')
      if (label !== existing.label) edges.push(...repo.upsertEdges(investigationId, [{ ...existing, label }]))
      continue
    }
    const [created] = repo.upsertEdges(investigationId, [{ ...e, id: undefined, source, target: target2 }])
    edgeMap.set(e.id, created?.id ?? null)
    if (created) edges.push(created)
  }
  repo.reassignNodeHistory(investigationId, Array.from(otherSet), targetId)
  repo.reassignObservations(investigationId, Array.from(otherSet), targetId, edgeMap)
  const deletedEdgeIds = repo.deleteNodes(investigationId, Array.from(otherSet))
  const touched = Array.from(edgeMap.values()).filter((id): id is string => !!id)
  const corroboration = repo.corroboration(investigationId, { nodeIds: [targetId], edgeIds: touched })
  return { investigationId, nodes: [merged], edges, deletedNodeIds: Array.from(otherSet), deletedEdgeIds, corroboration }
}
