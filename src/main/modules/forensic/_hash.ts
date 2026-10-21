// Algorithme d'une empreinte : propriété `algorithm` du nœud, sinon déduit de la longueur.

import { hashAlgorithm } from '@shared/detect'
import type { InputEntity } from '@shared/modules'

export function hashValue(input: InputEntity): string {
  return input.label.trim().toLowerCase()
}

export function algorithmOf(input: InputEntity): string | null {
  const declared = typeof input.data.algorithm === 'string' ? input.data.algorithm.toUpperCase().replace('SHA256', 'SHA-256').replace('SHA1', 'SHA-1') : null
  const detected = hashAlgorithm(hashValue(input))
  return detected ?? declared
}
