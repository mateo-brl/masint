import { describe, expect, it } from 'vitest'
import { fold, fuzzyFilter, fuzzyMatch } from '../src/renderer/src/lib/fuzzy'

const titles = ['Exporter en PNG', 'Exporter en CSV (nœuds)', 'Disposition en arbre', 'Paramètres', 'Plus court chemin', 'Thème clair', 'Enrichir la sélection']
const best = (q: string): string | undefined => fuzzyFilter(titles, q, (s) => s)[0]?.item

describe('Recherche floue de la palette', () => {
  it('ignore la casse et les accents en gardant les positions', () => {
    expect(fold('Paramètres Élodie')).toBe('parametres elodie')
    expect(fold('Œuvre').length).toBe(5)
    expect(best('parametres')).toBe('Paramètres')
    expect(best('THEME')).toBe('Thème clair')
  })

  it('trouve les lettres dans l’ordre, de préférence en début de mot', () => {
    expect(best('pcc')).toBe('Plus court chemin')
    expect(best('ex png')).toBe('Exporter en PNG')
    expect(best('expng')).toBe('Exporter en PNG')
    expect(fuzzyMatch('xyz', 'Exporter en PNG')).toBeNull()
  })

  it('cherche chaque mot indépendamment', () => {
    expect(best('png exporter')).toBe('Exporter en PNG')
    expect(fuzzyMatch('csv chemin', 'Exporter en CSV (nœuds)')).toBeNull()
  })

  it('classe une sous-chaîne exacte devant une suite de lettres dispersées', () => {
    const list = fuzzyFilter(['Disposition en arbre', 'Disposer'], 'dispos', (s) => s)
    expect(list.map((x) => x.item)).toEqual(['Disposer', 'Disposition en arbre'])
    const ranked = fuzzyFilter(['Rapport', 'Réglages : apparence', 'Arbre'], 'arb', (s) => s).map((x) => x.item)
    expect(ranked[0]).toBe('Arbre')
  })

  it('renvoie les positions à mettre en évidence', () => {
    expect(fuzzyMatch('png', 'Exporter en PNG')?.positions).toEqual([12, 13, 14])
    expect(fuzzyMatch('pcc', 'Plus court chemin')?.positions).toEqual([0, 5, 11])
  })

  it('garde tout, dans l’ordre d’origine, pour une saisie vide', () => {
    expect(fuzzyFilter(titles, '  ', (s) => s).map((x) => x.item)).toEqual(titles)
    expect(fuzzyFilter(titles, '', (s) => s, 2)).toHaveLength(2)
  })
})
