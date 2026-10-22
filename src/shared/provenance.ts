// Provenance et confiance : cotation de l'Amirauté, seuils d'affichage de la corroboration.

import type { PropValue } from './types'

/**
 * Propriété qui porte la cotation manuelle d'une entité, à la manière de l'Amirauté (OTAN) :
 * fiabilité de la source (A à F) puis crédibilité de l'information (1 à 6), par exemple `B2`.
 * Elle est dans `data` : archivée, exportée et couverte par l'empreinte du rapport.
 */
export const ADMIRALTY_KEY = 'admiralty'

export const RELIABILITY = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export const CREDIBILITY = [1, 2, 3, 4, 5, 6] as const

export type Reliability = (typeof RELIABILITY)[number]
export type Credibility = (typeof CREDIBILITY)[number]

export interface Admiralty {
  reliability: Reliability | null
  credibility: Credibility | null
}

/** Lit une cotation (`B2`, `B`, `2`) ; `null` si la valeur n'en est pas une. */
export function parseAdmiralty(v: PropValue | undefined): Admiralty | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : typeof v === 'number' ? String(v) : ''
  const m = s.match(/^([A-F])?\s*([1-6])?$/)
  if (!s || !m || (!m[1] && !m[2])) return null
  return { reliability: (m[1] as Reliability | undefined) ?? null, credibility: m[2] ? (Number(m[2]) as Credibility) : null }
}

/** Valeur enregistrée : `B2`, `B` ou `2` ; chaîne vide quand rien n'est coté. */
export function formatAdmiralty(a: Admiralty): string {
  return `${a.reliability ?? ''}${a.credibility ?? ''}`
}

/** Pastille « ×N » sur le canevas à partir de ce nombre de sources distinctes. */
export const CORROBORATION_BADGE_MIN = 3
