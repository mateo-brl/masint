// Sous-titre affiché sous le libellé d'une entité (canevas, exports, rapport).

import type { GraphNode } from './types'

/** Localisation, pseudo ou valeur clé selon le type d'entité. */
export function nodeSubtitle(n: Pick<GraphNode, 'type' | 'data'>): string {
  const d = n.data ?? {}
  const pick = (...keys: string[]): string =>
    keys
      .map((k) => d[k])
      .filter((v) => v !== undefined && v !== null && v !== '' && !Array.isArray(v) && typeof v !== 'object')
      .map(String)
      .slice(0, 2)
      .join(' · ')
  switch (n.type) {
    case 'account':
      return pick('location', 'username')
    case 'phone':
      return pick('carrier', 'country')
    case 'ip':
      return pick('city', 'country', 'isp')
    case 'email':
      return pick('provider')
    case 'carrier':
      return pick('country', 'network')
    case 'company':
      return pick('siren', 'activity')
    case 'domain':
      return pick('registrar')
    case 'crypto_wallet':
      return pick('balance')
    case 'person':
      return pick('birth_date', 'occupation')
    case 'breach':
    case 'infostealer':
      return pick('breach_date', 'date_compromised', 'computer_name')
    default:
      return pick('location', 'country', 'city', 'date', 'description')
  }
}
