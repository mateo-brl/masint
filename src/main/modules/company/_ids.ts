// Identifiants d'une entreprise ou d'une association lus dans la fiche : SIREN et numéro RNA.

import type { InputEntity } from '@shared/modules'

/** SIREN de la fiche : propriété, SIRET ou libellé numérique (9 ou 14 chiffres). */
export function sirenOf(input: Pick<InputEntity, 'label' | 'data'>): string | null {
  for (const v of [input.data.siren, input.data.siret, input.label]) {
    const d = typeof v === 'string' ? v.replace(/[\s.]/g, '') : ''
    if (/^\d{9}$/.test(d) || /^\d{14}$/.test(d)) return d.slice(0, 9)
  }
  return null
}

/** Numéro RNA (`W` suivi de 9 chiffres) de la fiche ou de la saisie. */
export function rnaOf(input: Pick<InputEntity, 'label' | 'data'>): string | null {
  for (const v of [input.data.rna, input.label]) {
    const s = typeof v === 'string' ? v.trim().toUpperCase().replace(/\s/g, '') : ''
    if (/^W\d{9}$/.test(s)) return s
  }
  return null
}
