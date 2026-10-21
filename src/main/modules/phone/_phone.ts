// Utilitaires communs aux modules téléphone.

import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max'
import { ModuleError, type InputEntity } from '@shared/modules'
import { findPlatformByName } from '@shared/platforms'

export function parsePhone(input: InputEntity | string): PhoneNumber {
  const candidates = typeof input === 'string' ? [input] : [input.label, String(input.data.e164 ?? '')]
  for (const raw of candidates) {
    const parsed = raw.trim() ? parsePhoneNumberFromString(raw.trim(), 'FR') : undefined
    if (parsed) return parsed
  }
  throw new ModuleError('Numéro non reconnu', 'invalid_input')
}

/** Numéro au format E.164 (`+33612345678`). */
export function toE164(input: InputEntity | string): string {
  return parsePhone(input).number
}

/** Plateforme opérateur à partir d'un nom libre (« O2 (UK) », « EE Limited (T-Mobile) »...). */
export function carrierPlatform(name: string): string | undefined {
  const stripped = name.replace(/\([^)]*\)/g, '').trim()
  const candidates = [name, stripped, stripped.split(/\s+/)[0]]
  for (const c of candidates) {
    const p = c ? findPlatformByName(c, 'carrier') : undefined
    if (p) return p.id
  }
  return undefined
}
