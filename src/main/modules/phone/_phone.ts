// Utilitaires communs aux modules téléphone.

import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js/max'
import { ModuleError, type InputEntity } from '@shared/modules'

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
