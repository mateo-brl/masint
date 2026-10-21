import { describe, expect, it } from 'vitest'
import frDirigeants, { companiesFor, matchesPerson, type ReResponse } from '../../src/main/modules/person/frDirigeants'
import { splitName } from '../../src/main/modules/person/_name'
import searchLinks, { personSearchLinks } from '../../src/main/modules/person/searchLinks'
import usernames, { candidateUsernames } from '../../src/main/modules/person/usernames'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixtureJson, type Route } from './social_helpers'

const person = (label: string, data = {}) => entity('person', label, { data })

describe('découpage du nom', () => {
  it.each([
    ['Jean Dupont', ['Jean'], 'Dupont'],
    ['DUPONT Jean', ['Jean'], 'DUPONT'],
    ['Jean-Pierre Martin', ['Jean-Pierre'], 'Martin'],
    ['Marie Claire Durand', ['Marie', 'Claire'], 'Durand'],
    ['Jean de La Fontaine', ['Jean'], 'de La Fontaine'],
    ['Ludwig van Beethoven', ['Ludwig'], 'van Beethoven']
  ])('%s', (label, firstNames, lastName) => {
    expect(splitName({ label, data: {} })).toEqual({ firstNames, lastName })
  })
  it('champs prénom / nom prioritaires, nom seul refusé', () => {
    expect(splitName({ label: 'X', data: { first_name: 'Anne', last_name: 'Le Gall' } })).toEqual({ firstNames: ['Anne'], lastName: 'Le Gall' })
    expect(splitName({ label: 'Dupont', data: {} })).toBeNull()
  })
})

describe('pseudos probables', () => {
  it('dix variantes sans accents ni doublons', () => {
    const list = candidateUsernames({ firstNames: ['Jérôme'], lastName: 'Dupont' }).map((c) => c.username)
    expect(list).toHaveLength(10)
    expect(list.slice(0, 5)).toEqual(['jeromedupont', 'jerome.dupont', 'jdupont', 'jerome_dupont', 'dupontjerome'])
    expect(new Set(list).size).toBe(list.length)
    expect(candidateUsernames({ firstNames: ['Jean-Pierre'], lastName: 'Le Gall' }).map((c) => c.username)).toContain('jplegall')
  })
  it('module', async () => {
    const out = await runModule(usernames, person('Jean Dupont'))
    expect(out.entities).toHaveLength(10)
    expect(out.entities![0]).toMatchObject({ type: 'username', label: 'jeandupont', linkLabel: 'pseudo possible' })
  })
})

describe('liens de recherche', () => {
  it('liens encodés, sans tiret long', async () => {
    const links = personSearchLinks('Jean Dupont', 'Dupont', 'Jean')
    expect(links.find((l) => l.engine === 'Google')!.url).toBe('https://www.google.com/search?q=%22Jean%20Dupont%22')
    expect(links.find((l) => l.engine === 'Pages Blanches')!.url).toContain('quoiqui=Jean%20Dupont')
    expect(links.some((l) => l.engine === 'Copains d’avant')).toBe(true)
    const out = await runModule(searchLinks, person('DUPONT jean'))
    expect(out.entities!.every((e) => e.type === 'search_link' && typeof e.data?.url === 'string')).toBe(true)
    expect(out.entities![0].label).toBe('Google : Jean Dupont')
    expect(JSON.stringify(out)).not.toMatch(/[–—]/)
  })
})

describe('dirigeants (recherche-entreprises)', () => {
  const res = fixtureJson<ReResponse>('person/recherche_entreprises.json')
  const name = { firstNames: ['Xavier'], lastName: 'Niel' }

  it('ne garde que les mandats de la personne cherchée', () => {
    expect(matchesPerson({ nom: 'NIEL', prenoms: 'XAVIER', type_dirigeant: 'personne physique' }, name)).toBe(true)
    expect(matchesPerson({ nom: 'NIEL', prenoms: 'JULES', type_dirigeant: 'personne physique' }, name)).toBe(false)
    expect(matchesPerson({ nom: 'NIEL (NIEL)', prenoms: 'ALEXANDRE NICOLAS XAVIER', type_dirigeant: 'personne physique' }, name)).toBe(true)
    const companies = companiesFor(res.results, name)
    const freebox = companies.find((c) => c.label === 'FREEBOX')!
    expect(freebox).toMatchObject({ type: 'company', linkLabel: 'Président de SAS · né(e) 08/1967', data: { siren: '433910619', legal_form: 'SAS', status: 'active' } })
    expect(typeof freebox.data?.lat).toBe('number')
    expect(companies.find((c) => c.label === 'SNDM')!.data).toMatchObject({ status: 'cessée' })
  })

  it('module : pagination, nouvelle tentative après coupure', async () => {
    let calls = 0
    const routes: Route[] = [
      [
        /recherche-entreprises\.api\.gouv\.fr\/search/,
        (url) => {
          calls++
          if (calls === 1) return { status: 502, body: 'bad gateway' }
          return { body: /[?&]page=1(&|$)/.test(url) ? res : { ...res, results: [] } }
        }
      ]
    ]
    const ctx = fakeContext(routes)
    const out = await frDirigeants.run(person('Xavier Niel'), ctx)
    expect(out.entities!.length).toBeGreaterThanOrEqual(3)
    expect(ctx.calls[0].url).toContain('nom_personne=Niel')
    expect(ctx.calls[0].url).toContain('prenoms_personne=Xavier')
    expect(ctx.calls.filter((c) => /[?&]page=2(&|$)/.test(c.url))).toHaveLength(1)
  }, 20000)
})

describe.skipIf(!LIVE)('live', () => {
  it('recherche-entreprises : mandats de Xavier Niel', async () => {
    const out = await runModule(frDirigeants, person('Xavier Niel'), makeContext())
    expect(out.entities!.some((e) => e.label === 'FREEBOX')).toBe(true)
  }, 120000)
})
