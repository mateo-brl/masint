// Fusion de nœuds : rien de ce que portaient les nœuds absorbés ne doit se perdre.

import type { GraphNode, PropValue } from '@shared/types'

/**
 * Propriétés d'une fusion : celles de la cible d'abord. Les valeurs différentes des autres nœuds
 * sont conservées (liste de valeurs), et leurs libellés vont dans « autres valeurs ».
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
