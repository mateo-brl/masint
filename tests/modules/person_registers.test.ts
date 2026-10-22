// Registres publics des personnes : mandats d'élu local, filtre de naissance côté serveur
// pour les mandats de dirigeant, déclarations à la HATVP.

import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import frDirigeants, { birthRange, matchesPerson } from '../../src/main/modules/person/frDirigeants'
import frElus, { eluVerdict, matchesElu, selectMandates, type ReCollectivite } from '../../src/main/modules/person/frElus'
import hatvp from '../../src/main/modules/person/hatvp'
import { declarationsOutput, documentLabel, parseListe, resetHatvpCache } from '../../src/main/modules/person/_hatvp'
import { splitName } from '../../src/main/modules/person/_name'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson } from './social_helpers'

const person = (label: string, data = {}) => entity('person', label, { data })
const fr = { lang: 'fr' as const }

const skippable = (e: unknown): boolean =>
  (e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || (e instanceof Error && /fetch failed/.test(e.message))

describe('person.fr_dirigeants : filtre de naissance côté serveur', () => {
  it('bornes du mois ou de l’année', () => {
    expect(birthRange({ year: 1964, month: 12, day: 3 })).toEqual({ date_naissance_personne_min: '1964-12-01', date_naissance_personne_max: '1964-12-31' })
    expect(birthRange({ year: 1964, month: 2 })).toEqual({ date_naissance_personne_min: '1964-02-01', date_naissance_personne_max: '1964-02-29' })
    expect(birthRange({ year: 1964 })).toEqual({ date_naissance_personne_min: '1964-01-01', date_naissance_personne_max: '1964-12-31' })
    expect(birthRange(null)).toBeNull()
  })

  it('nom à particule et tiret : même dirigeant', () => {
    const name = splitName({ label: 'Antoine de Saint-Affrique', data: {} })!
    expect(matchesPerson({ nom: 'BERNARD DE SAINT AFFRIQUE', prenoms: 'ANTOINE', type_dirigeant: 'personne physique' }, name)).toBe(true)
  })

  it('transmet les bornes à l’API quand la date de naissance est connue', async () => {
    const ctx = fakeContext([[/recherche-entreprises/, { body: { results: [], total_results: 0, total_pages: 0 } }]])
    await runModule(frDirigeants, person('Antoine de Saint-Affrique', { birth_date: '1964-12' }), ctx)
    expect(ctx.calls[0].url).toContain('date_naissance_personne_min=1964-12-01')
    expect(ctx.calls[0].url).toContain('date_naissance_personne_max=1964-12-31')
  })
})

describe('person.fr_elus', () => {
  const res = fixtureJson<{ results: ReCollectivite[] }>('person/recherche_elus.json')
  const name = splitName({ label: 'Emmanuel Grégoire', data: {} })!
  // Homonyme fictif : même nom, autre mois de naissance, autre collectivité.
  const homonyme: ReCollectivite = {
    siren: '000000000',
    nom_complet: 'COMMUNE D’EXEMPLE',
    nature_juridique: '7210',
    complements: { collectivite_territoriale: { elus: [{ nom: 'GREGOIRE', prenoms: 'Emmanuel', annee_de_naissance: '1990-01', fonction: 'Conseiller municipal' }] } }
  }

  it('nom identique et mois de naissance', () => {
    expect(matchesElu({ nom: 'GRÉGOIRE', prenoms: 'Emmanuel Jean' }, name)).toBe(true)
    expect(matchesElu({ nom: 'GRÉGOIRE-DUPONT', prenoms: 'Emmanuel' }, name)).toBe(false)
    expect(eluVerdict({ annee_de_naissance: '1977-12' }, { year: 1977, month: 12, day: 1 })).toBe('confirmed')
    expect(eluVerdict({ annee_de_naissance: '1977-12' }, { year: 1977, month: 11 })).toBe('excluded')
    expect(eluVerdict({ annee_de_naissance: '1977-12' }, null)).toBe('possible')
  })

  it('date de naissance connue : homonyme écarté, mandats confirmés', () => {
    const { kept, excluded } = selectMandates([...res.results, homonyme], name, { year: 1977, month: 12 })
    expect(kept.map((m) => m.collectivite.siren)).toEqual(['217500016', '200054781'])
    expect(kept.every((m) => m.verdict === 'confirmed')).toBe(true)
    expect(excluded).toHaveLength(1)
  })

  it('module : sans date de naissance, tout est à vérifier avec les mois publiés', async () => {
    const ctx = fakeContext([[/recherche-entreprises/, { body: { results: [...res.results, homonyme], total_results: 3 } }]])
    const out = await runModule(frElus, person('Emmanuel Grégoire'), ctx)
    expect(ctx.calls[0].url).toContain('type_personne=elu')
    expect(out.entities).toHaveLength(3)
    expect(out.entities?.every((e) => e.review && e.type === 'administration')).toBe(true)
    expect(out.entities?.[0].linkLabel).toBe('élu de · Maire · né(e) 12/1977')
    expect(out.entities?.[0].reviewReason).toMatch(/aussi un\(e\) élu\(e\) né\(e\) en 01\/1990/)
    expect(out.properties).toEqual({ elected_offices_count: 3 })
  })

  it('module : mois de naissance identique, mandat ajouté au graphe', async () => {
    const ctx = fakeContext([[/recherche-entreprises/, { body: { results: res.results, total_results: 2 } }]])
    const out = await runModule(frElus, person('Emmanuel Grégoire', { birth_date: '1977-12' }), ctx)
    expect(ctx.calls[0].url).toContain('date_naissance_personne_min=1977-12-01')
    expect(out.entities?.some((e) => e.review)).toBe(false)
    expect(out.entities?.[0]).toMatchObject({ label: 'VILLE DE PARIS', data: { siren: '217500016' } })
  })
})

describe('person.hatvp', () => {
  const list = parseListe(fixture('person/hatvp_liste.csv'))

  it('lit liste.csv sans les déclarations non publiées', () => {
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({ prenom: 'Jean', nom: 'Exemple', typeMandat: 'depute', datePublication: '2024-07-30', urlDossier: '/pages_nominatives/exemple-jean' })
    expect(documentLabel('dsp')).toBe('Déclaration de situation patrimoniale')
  })

  it('un responsable par page nominative, toujours à vérifier', () => {
    const out = declarationsOutput(fr, list, splitName({ label: 'Jean Exemple', data: {} })!)
    expect(out.properties).toEqual({ hatvp_declarations: 2 })
    expect(out.entities).toHaveLength(1)
    expect(out.entities?.[0]).toMatchObject({
      type: 'document',
      review: true,
      data: { url: 'https://www.hatvp.fr/pages_nominatives/exemple-jean', hatvp_mandates: ['Député'], hatvp_documents_count: 2 }
    })
    expect(declarationsOutput(fr, list, splitName({ label: 'Jean Modele', data: {} })!).properties).toEqual({ hatvp_declarations: 0 })
  })

  it('module : fichier téléchargé une fois', async () => {
    resetHatvpCache()
    const ctx = fakeContext([[/liste\.csv/, { body: fixture('person/hatvp_liste.csv') }]])
    await runModule(hatvp, person('Jean Exemple'), ctx)
    const out = await runModule(hatvp, person('Jeanne Exemple'), ctx)
    expect(out.entities?.[0].label).toBe('HATVP : Jeanne Exemple (Maire d’Exempleville)'.replace('’', "'"))
    expect(ctx.calls).toHaveLength(1)
  })
})

describe.skipIf(!LIVE)('registres des personnes (live)', () => {
  const live = (name: string, fn: () => Promise<void>, timeout = 120000): void => {
    it(name, async (t) => {
      try {
        await fn()
      } catch (e) {
        if (skippable(e)) t.skip()
        throw e
      }
    }, timeout)
  }

  live('élus : Emmanuel Grégoire', async () => {
    const out = await runModule(frElus, person('Emmanuel Grégoire'), makeContext())
    expect(out.entities?.some((e) => e.label === 'VILLE DE PARIS')).toBe(true)
    const known = await runModule(frElus, person('Emmanuel Grégoire', { birth_date: '1977-12' }), makeContext())
    expect(known.entities?.find((e) => e.label === 'VILLE DE PARIS')?.review).toBeFalsy()
    expect(known.entities?.some((e) => /SURESNES/.test(e.label))).toBe(false)
  })

  live('dirigeants : filtre de naissance, Antoine de Saint-Affrique', async () => {
    const out = await runModule(frDirigeants, person('Antoine de Saint-Affrique', { birth_date: '1964-12' }), makeContext())
    expect(out.entities?.some((e) => e.data?.siren === '552032534')).toBe(true)
  })

  live(
    'HATVP : déclarations publiées',
    async () => {
      resetHatvpCache()
      const out = await runModule(hatvp, person('Emmanuel Grégoire'), makeContext())
      expect(Number(out.properties?.hatvp_declarations)).toBeGreaterThan(0)
    },
    240000
  )
})
