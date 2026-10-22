// Filtre du canevas et calques nommés. Le filtre courant vaut pour la session (il repart vide à
// l'ouverture d'une enquête) ; le mode et les calques sont enregistrés par enquête dans les
// préférences d'affichage de ce poste.

import { useMemo } from 'react'
import { create } from 'zustand'
import { EMPTY_FILTER, isFilterActive, normalizeFilter, type FilterMode, type NodeFilter, type ViewFilter } from '../lib/filters'
import { loadPref, savePref } from '../lib/prefs'
import { useGraph } from './graph'

/** Calque : jeu de filtres nommé, rappelé d'un clic. */
export interface Layer {
  id: string
  name: string
  mode: FilterMode
  filter: NodeFilter
}

interface FiltersState {
  investigationId: string | null
  mode: FilterMode
  filter: NodeFilter
  layers: Layer[]
  /** Calque appliqué tel quel (`null` dès que le filtre est modifié). */
  activeLayer: string | null
  load(investigationId: string): void
  setFilter(patch: Partial<NodeFilter>): void
  setMode(mode: FilterMode): void
  reset(): void
  saveLayer(name: string): void
  applyLayer(id: string): void
  deleteLayer(id: string): void
}

const prefKey = (inv: string): string => `filters:${inv}`

function persist(): void {
  const { investigationId, mode, layers } = useFilters.getState()
  if (investigationId) savePref(prefKey(investigationId), { mode, layers })
}

export const useFilters = create<FiltersState>((set, get) => ({
  investigationId: null,
  mode: 'hide',
  filter: EMPTY_FILTER,
  layers: [],
  activeLayer: null,

  load(investigationId) {
    if (get().investigationId === investigationId) return
    const saved = loadPref<{ mode?: FilterMode; layers?: Layer[] }>(prefKey(investigationId), {})
    const layers = (Array.isArray(saved.layers) ? saved.layers : [])
      .filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string')
      .map((l) => ({ id: l.id, name: l.name, mode: l.mode === 'dim' ? ('dim' as const) : ('hide' as const), filter: normalizeFilter(l.filter) }))
    set({ investigationId, mode: saved.mode === 'dim' ? 'dim' : 'hide', filter: EMPTY_FILTER, layers, activeLayer: null })
  },

  setFilter(patch) {
    set({ filter: { ...get().filter, ...patch }, activeLayer: null })
  },

  setMode(mode) {
    set({ mode, activeLayer: null })
    persist()
  },

  reset() {
    set({ filter: EMPTY_FILTER, activeLayer: null })
  },

  saveLayer(name) {
    const clean = name.trim()
    if (!clean) return
    const layer: Layer = { id: crypto.randomUUID(), name: clean, mode: get().mode, filter: get().filter }
    set({ layers: [...get().layers.filter((l) => l.name !== clean), layer], activeLayer: layer.id })
    persist()
  },

  applyLayer(id) {
    const layer = get().layers.find((l) => l.id === id)
    if (!layer) return
    // Un clic sur le calque actif le retire.
    if (get().activeLayer === id) return set({ filter: EMPTY_FILTER, activeLayer: null })
    set({ filter: layer.filter, mode: layer.mode, activeLayer: id })
  },

  deleteLayer(id) {
    set({ layers: get().layers.filter((l) => l.id !== id), activeLayer: get().activeLayer === id ? null : get().activeLayer })
    persist()
  }
}))

const NO_REVIEW: ReadonlySet<string> = new Set()
let cache: { mode: FilterMode; filter: NodeFilter; suggestions: unknown; value: ViewFilter | null } | null = null

/**
 * Filtre appliqué à la vue, `null` s'il n'écarte rien. Même objet tant que le filtre (et, s'il
 * s'en sert, la liste des résultats à vérifier) ne change pas : la vue reste mémorisée.
 */
export function activeViewFilter(): ViewFilter | null {
  const { mode, filter } = useFilters.getState()
  const suggestions = useGraph.getState().suggestions
  if (cache && cache.mode === mode && cache.filter === filter && (!filter.review || cache.suggestions === suggestions)) return cache.value
  let value: ViewFilter | null = null
  if (isFilterActive(filter)) {
    const review = filter.review ? new Set(suggestions.filter((s) => s.status === 'pending').map((s) => s.nodeId)) : NO_REVIEW
    value = { mode, filter, review }
  }
  cache = { mode, filter, suggestions, value }
  return value
}

/** Filtre appliqué à la vue, pour un composant (re-rendu quand il change). */
export function useViewFilter(): ViewFilter | null {
  const mode = useFilters((s) => s.mode)
  const filter = useFilters((s) => s.filter)
  // Les résultats à vérifier ne comptent que si le filtre s'en sert.
  const suggestions = useGraph((s) => (filter.review ? s.suggestions : null))
  return useMemo(() => activeViewFilter(), [mode, filter, suggestions])
}
