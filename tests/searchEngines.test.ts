import { describe, expect, it } from 'vitest'
import { engineOrder, googleQuery, searchUrlFor, startpageUrl } from '../src/shared/searchEngines'

describe('moteur des recherches assistées', () => {
  const google = 'https://www.google.com/search?q=%22Xavier%20Niel%22%20filetype%3Apdf'

  it('lit la requête d’une recherche Google seulement', () => {
    expect(googleQuery(google)).toBe('"Xavier Niel" filetype:pdf')
    expect(googleQuery('https://www.google.fr/search?q=abc')).toBe('abc')
    expect(googleQuery('https://www.truecaller.com/search/fr/0144442222')).toBeNull()
    expect(googleQuery('https://maps.google.com/?q=Paris')).toBeNull()
    expect(googleQuery('pas une url')).toBeNull()
  })

  it('passe par Startpage quand il est choisi, sans toucher aux autres sites', () => {
    expect(startpageUrl('"a b"', 'fr')).toBe('https://www.startpage.com/do/search?query=%22a%20b%22&language=francais')
    expect(searchUrlFor(google, 'startpage', 'en')).toBe('https://www.startpage.com/do/search?query=%22Xavier%20Niel%22%20filetype%3Apdf&language=english')
    expect(searchUrlFor(google, 'auto', 'fr')).toMatch(/^https:\/\/www\.startpage\.com\//)
    expect(searchUrlFor(google, 'google', 'fr')).toBe(google)
    expect(searchUrlFor('https://www.truecaller.com/search/fr/1', 'startpage', 'fr')).toBe('https://www.truecaller.com/search/fr/1')
  })

  it('ordre des moteurs : Startpage puis Google en automatique', () => {
    expect(engineOrder('auto')).toEqual(['startpage', 'google'])
    expect(engineOrder('google')).toEqual(['google'])
    expect(engineOrder('startpage')).toEqual(['startpage'])
  })
})
