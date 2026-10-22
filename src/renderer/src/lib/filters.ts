// Filtres du canevas : type d'entité, plateforme, module source, date de création, statut
// « À vérifier ». En mode « masquer », le filtre s'applique dans `computeView` (disposition,
// exports et frise le respectent) ; en mode « estomper », les nœuds écartés restent en place,
// en retrait. Les annotations (textes, images, cartes, dessins) ne sont jamais filtrées.

export interface NodeFilter {
  /** Types d'entités gardés ; vide : tous. */
  types: string[]
  /** Plateformes gardées (`''` : sans plateforme) ; vide : toutes. */
  platforms: string[]
  /** Origines gardées (`manual` ou identifiant de module) ; vide : toutes. */
  sources: string[]
  /** Créés à partir de cette date (ms). */
  from: number | null
  /** Créés au plus tard à cette date (ms) : curseur temporel. */
  to: number | null
  /** Seulement les nœuds qui ont des résultats « À vérifier » en attente. */
  review: boolean
}

export type FilterMode = 'hide' | 'dim'

/** Filtre appliqué à la vue, avec les nœuds « À vérifier » de l'enquête. */
export interface ViewFilter {
  mode: FilterMode
  filter: NodeFilter
  /** Nœuds qui ont des résultats à vérifier en attente. */
  review: ReadonlySet<string>
}

/** Ce que le filtre lit d'un nœud. */
export interface FilterableNode {
  id: string
  kind: string
  type: string
  platform: string | null
  source?: string
  createdAt?: number
}

export const EMPTY_FILTER: NodeFilter = { types: [], platforms: [], sources: [], from: null, to: null, review: false }

/** Le filtre écarte-t-il quelque chose ? */
export function isFilterActive(f: NodeFilter | null | undefined): boolean {
  return !!f && (f.types.length > 0 || f.platforms.length > 0 || f.sources.length > 0 || f.from !== null || f.to !== null || f.review)
}

/** Le nœud passe-t-il le filtre ? Les annotations passent toujours. */
export function matchesFilter(n: FilterableNode, f: NodeFilter, review: ReadonlySet<string>): boolean {
  if (n.kind !== 'entity') return true
  if (f.types.length && !f.types.includes(n.type)) return false
  if (f.platforms.length && !f.platforms.includes(n.platform ?? '')) return false
  if (f.sources.length && !f.sources.includes(n.source ?? 'manual')) return false
  if (f.from !== null && (n.createdAt ?? 0) < f.from) return false
  if (f.to !== null && (n.createdAt ?? 0) > f.to) return false
  if (f.review && !review.has(n.id)) return false
  return true
}

/** Clé du filtre : tout ce qu'il lit, nœuds « À vérifier » compris quand il s'en sert. */
export function viewFilterKey(v: ViewFilter | null | undefined): string {
  if (!v || !isFilterActive(v.filter)) return ''
  const f = v.filter
  return JSON.stringify([
    v.mode,
    [...f.types].sort(),
    [...f.platforms].sort(),
    [...f.sources].sort(),
    f.from,
    f.to,
    f.review ? Array.from(v.review).sort() : 0
  ])
}

/** Copie d'un filtre enregistré (préférences), complétée et nettoyée. */
export function normalizeFilter(raw: Partial<NodeFilter> | null | undefined): NodeFilter {
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const date = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    types: list(raw?.types),
    platforms: list(raw?.platforms),
    sources: list(raw?.sources),
    from: date(raw?.from),
    to: date(raw?.to),
    review: raw?.review === true
  }
}

/** Ajoute ou retire une valeur d'une liste du filtre. */
export function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
