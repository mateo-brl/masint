// Recherches assistées en cours ou terminées, partagées entre la fiche et la liste « À vérifier ».

import { create } from 'zustand'
import type { AssistResult } from '@shared/types'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'

interface Entry {
  running: boolean
  result?: AssistResult
  /** Résultats déjà ajoutés au graphe, masqués de la liste. */
  added: string[]
}

interface AssistState {
  entries: Record<string, Entry>
  run(id: string): Promise<void>
  /** Une recherche après l'autre : une seule fenêtre à la fois si une vérification est demandée. */
  runAll(ids: string[]): Promise<void>
  markAdded(id: string, url: string): void
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
    set({ entries: { ...get().entries, [id]: { running: false, result, added: [] } } })
  },

  async runAll(ids) {
    for (const id of ids) await get().run(id)
  },

  markAdded(id, url) {
    const e = get().entries[id]
    if (e) set({ entries: { ...get().entries, [id]: { ...e, added: [...e.added, url] } } })
  }
}))
