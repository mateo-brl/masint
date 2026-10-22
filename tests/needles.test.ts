import { describe, expect, it } from 'vitest'
import { needlesFor } from '../src/shared/needles'

describe('variantes de recherche', () => {
  it('numéro : formats international et national en chiffres', () => {
    expect(needlesFor('phone', '+33 6 12 34 56 78').digits.sort()).toEqual(['0612345678', '33612345678'])
    expect(needlesFor('phone', '06 12 34 56 78').digits.sort()).toEqual(['0612345678', '33612345678'])
  })
  it('nom : sans accents, dans les deux ordres', () => {
    expect(needlesFor('person', 'Hélène Dupont').text).toEqual(['helene dupont', 'dupont helene'])
  })
  it('email : tel quel, en minuscules', () => {
    expect(needlesFor('email', 'Jean.Dupont@Exemple.fr')).toEqual({ text: ['jean.dupont@exemple.fr'], digits: [] })
  })
})
