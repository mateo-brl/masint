// Recherche globale et corrélation entre enquêtes, soumises au réglage « Cloisonner les
// enquêtes » : quand il est actif, rien ne sort d'une enquête vers une autre.

import type { CrossRef, GlobalSearchHit } from '@shared/types'
import type { Repo } from './db/repo'
import type { SettingsService } from './settings'

/** Nombre maximal de résultats renvoyés par la recherche globale. */
export const GLOBAL_SEARCH_LIMIT = 200

export function globalSearch(repo: Repo, settings: SettingsService, query: string, limit = 100): GlobalSearchHit[] {
  if (settings.get().isolateInvestigations) return []
  return repo.searchNodes(query, { limit: Math.min(limit, GLOBAL_SEARCH_LIMIT) })
}

export function crossReferences(repo: Repo, settings: SettingsService, nodeIds: string[]): Record<string, CrossRef[]> {
  if (settings.get().isolateInvestigations) return {}
  return repo.crossRefs(nodeIds)
}
