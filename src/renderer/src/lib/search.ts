// Recherche d'un nœud dans le graphe par son libellé ou ses propriétés.

import type { GraphNode } from '@shared/types'

/** Texte de recherche de chaque version d'un nœud : calculé une seule fois, pas à chaque frappe. */
const index = new WeakMap<GraphNode, string>()

/** Libellé et propriétés en minuscules, séparés par un caractère que la saisie ne contient pas. */
export function searchText(node: GraphNode): string {
  let text = index.get(node)
  if (text === undefined) {
    text = `${node.label}\u0000${JSON.stringify(node.data) ?? ''}`.toLowerCase()
    index.set(node, text)
  }
  return text
}

/** Premiers nœuds dont le libellé ou une propriété contient la saisie (casse ignorée). */
export function searchNodes<T extends { data: { node: GraphNode } }>(nodes: readonly T[], query: string, limit = 12): T[] {
  const s = query.trim().toLowerCase()
  if (!s) return []
  const out: T[] = []
  for (const n of nodes) {
    if (searchText(n.data.node).includes(s)) out.push(n)
    if (out.length >= limit) break
  }
  return out
}
