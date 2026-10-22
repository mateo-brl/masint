// Recherches assistées en cours ou terminées, partagées entre la fiche et la liste « À vérifier ».
// Le dernier résultat de chaque recherche est gardé en base par le processus principal ; il est
// rechargé à l'ouverture de l'enquête (`hydrate`).

import { create } from 'zustand'
import type { AssistResult, Suggestion } from '@shared/types'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'

interface Entry {
  running: boolean
  result?: AssistResult
  /** Résultats déjà ajoutés au graphe, masqués de la liste. */
  added: string[]
  /** Date de la recherche (résultat repris de la base). */
  at?: number
}

interface AssistState {
  entries: Record<string, Entry>
  run(id: string): Promise<void>
  /** Une recherche après l'autre : une seule fenêtre à la fois si une vérification est demandée. */
  runAll(ids: string[]): Promise<void>
  markAdded(id: string, url: string): void
  /** Résultats enregistrés des recherches de l'enquête ouverte (les recherches en cours sont gardées). */
  hydrate(suggestions: Suggestion[]): void
  reset(): void
}

export const useAssist = create<AssistState>((set, get) => ({
  entries: {},

  async run(id) {
    if (get().entries[id]?.running) return
    set({ entries: { ...get().entries, [id]: { running: true, added: [] } } })
    let result: AssistResult
    try {
      result = await api('assist:run', id)
    } catch (e) {
      result = { status: 'error', url: '', title: '', matches: [], error: errorMessage(e) }
    }
    set({ entries: { ...get().entries, [id]: { running: false, result, added: [], at: Date.now() } } })
  },

  async runAll(ids) {
    for (const id of ids) await get().run(id)
  },

  markAdded(id, url) {
    const e = get().entries[id]
    if (e) set({ entries: { ...get().entries, [id]: { ...e, added: [...e.added, url] } } })
    void api('assist:markAdded', id, url).catch(() => undefined)
  },

  hydrate(suggestions) {
    const entries = { ...get().entries }
    for (const s of suggestions) {
      if (!s.assist || entries[s.id]?.running) continue
      entries[s.id] = { running: false, result: s.assist.result, added: s.assist.added, at: s.assist.at }
    }
    set({ entries })
  },

  reset() {
    const running = Object.entries(get().entries).filter(([, e]) => e.running)
    set({ entries: Object.fromEntries(running) })
  }
}))
