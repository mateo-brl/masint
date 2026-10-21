// Structure des IBAN par pays : longueur officielle et position du code banque / guichet
// (registre IBAN SWIFT). Table des banques françaises, monégasques et espagnoles extraite
// de la liste des institutions financières monétaires de la BCE (code RIAD = code banque).

import { isValidIban } from '@shared/detect'
import banks from './_banks.json'

interface Layout {
  length: number
  /** [début, fin) du code banque dans le BBAN. */
  bank?: [number, number]
  branch?: [number, number]
}

export const IBAN_LAYOUT: Record<string, Layout> = {
  AD: { length: 24, bank: [0, 4], branch: [4, 8] },
  AE: { length: 23, bank: [0, 3] },
  AT: { length: 20, bank: [0, 5] },
  BE: { length: 16, bank: [0, 3] },
  BG: { length: 22, bank: [0, 4], branch: [4, 8] },
  CH: { length: 21, bank: [0, 5] },
  CY: { length: 28, bank: [0, 3], branch: [3, 8] },
  CZ: { length: 24, bank: [0, 4] },
  DE: { length: 22, bank: [0, 8] },
  DK: { length: 18, bank: [0, 4] },
  EE: { length: 20, bank: [0, 2] },
  ES: { length: 24, bank: [0, 4], branch: [4, 8] },
  FI: { length: 18, bank: [0, 3] },
  FR: { length: 27, bank: [0, 5], branch: [5, 10] },
  GB: { length: 22, bank: [0, 4], branch: [4, 10] },
  GI: { length: 23, bank: [0, 4] },
  GR: { length: 27, bank: [0, 3], branch: [3, 7] },
  HR: { length: 21, bank: [0, 7] },
  HU: { length: 28, bank: [0, 3], branch: [3, 7] },
  IE: { length: 22, bank: [0, 4], branch: [4, 10] },
  IS: { length: 26, bank: [0, 2], branch: [2, 4] },
  IT: { length: 27, bank: [1, 6], branch: [6, 11] },
  LI: { length: 21, bank: [0, 5] },
  LT: { length: 20, bank: [0, 5] },
  LU: { length: 20, bank: [0, 3] },
  LV: { length: 21, bank: [0, 4] },
  MC: { length: 27, bank: [0, 5], branch: [5, 10] },
  MT: { length: 31, bank: [0, 4], branch: [4, 9] },
  NL: { length: 18, bank: [0, 4] },
  NO: { length: 15, bank: [0, 4] },
  PL: { length: 28, bank: [0, 3], branch: [3, 7] },
  PT: { length: 25, bank: [0, 4], branch: [4, 8] },
  RO: { length: 24, bank: [0, 4] },
  SE: { length: 24, bank: [0, 3] },
  SI: { length: 19, bank: [0, 2], branch: [2, 5] },
  SK: { length: 24, bank: [0, 4] },
  SM: { length: 27, bank: [1, 6], branch: [6, 11] },
  VA: { length: 22, bank: [0, 3] }
}

/** Pays de la zone SEPA (virements et prélèvements en euros). */
export const SEPA = new Set([
  'AD', 'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE', 'IS',
  'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'SM', 'VA', 'AL', 'MD', 'ME', 'MK', 'RS'
])

const BANK_TABLE = banks as unknown as Record<string, Record<string, [string, string, string]>>
// Établissements absorbés dont les IBAN restent en circulation.
const HISTORIC: Record<string, Record<string, [string, string, string]>> = {
  FR: { '30076': ['Crédit du Nord (groupe Société Générale)', 'NORDFRPPXXX', 'PARIS'] }
}

export interface IbanInfo {
  iban: string
  formatted: string
  country: string
  valid: boolean
  lengthOk: boolean | null
  bankCode: string | null
  branchCode: string | null
  sepa: boolean
}

export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase()
}

export function analyzeIban(raw: string): IbanInfo {
  const iban = normalizeIban(raw)
  const country = iban.slice(0, 2)
  const layout = IBAN_LAYOUT[country]
  const bban = iban.slice(4)
  const lengthOk = layout ? iban.length === layout.length : null
  return {
    iban,
    formatted: iban.replace(/(.{4})/g, '$1 ').trim(),
    country,
    valid: isValidIban(iban) && lengthOk !== false,
    lengthOk,
    bankCode: layout?.bank ? bban.slice(...layout.bank) : null,
    branchCode: layout?.branch ? bban.slice(...layout.branch) : null,
    sepa: SEPA.has(country)
  }
}

/** Banque connue localement (France, Monaco, Espagne). */
export function localBank(country: string, bankCode: string | null): { name: string; bic: string | null; city: string } | null {
  if (!bankCode) return null
  // Les banques monégasques utilisent la même numérotation que la France.
  const table = country === 'MC' ? 'FR' : country
  const row = BANK_TABLE[table]?.[bankCode] ?? HISTORIC[table]?.[bankCode]
  return row ? { name: row[0], bic: row[1] || null, city: row[2] } : null
}
