// Cotation de l'Amirauté : lecture et écriture de la propriété `admiralty`.

import { describe, expect, it } from 'vitest'
import { formatAdmiralty, parseAdmiralty } from '@shared/provenance'

describe('cotation (Amirauté)', () => {
  it('lit une cotation complète ou partielle', () => {
    expect(parseAdmiralty('B2')).toEqual({ reliability: 'B', credibility: 2 })
    expect(parseAdmiralty(' c ')).toEqual({ reliability: 'C', credibility: null })
    expect(parseAdmiralty('6')).toEqual({ reliability: null, credibility: 6 })
    expect(parseAdmiralty(4)).toEqual({ reliability: null, credibility: 4 })
  })

  it('refuse les valeurs hors échelle', () => {
    for (const v of ['G1', 'A7', 'AB', '', null, undefined, ['A1']]) expect(parseAdmiralty(v as never)).toBeNull()
  })

  it('écrit la cotation sous sa forme courte', () => {
    expect(formatAdmiralty({ reliability: 'A', credibility: 1 })).toBe('A1')
    expect(formatAdmiralty({ reliability: null, credibility: 3 })).toBe('3')
    expect(formatAdmiralty({ reliability: null, credibility: null })).toBe('')
  })
})
