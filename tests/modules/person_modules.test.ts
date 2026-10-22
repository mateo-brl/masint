import { describe, expect, it } from 'vitest'
import type { SherlockSite } from '../../src/main/modules/username/_sherlock'
import bodacc, { bodaccOutput, citation, citesPerson, type BodaccRecord } from '../../src/main/modules/person/bodacc'
import deces, { inseeDate, type MatchIdResponse } from '../../src/main/modules/person/deces'
import frDirigeants, { companiesFor, matchesPerson, type ReResponse } from '../../src/main/modules/person/frDirigeants'
import jorf, { type JorfEntry } from '../../src/main/modules/person/jorf'
import { splitName } from '../../src/main/modules/person/_name'
import searchLinks, { personManualChecks } from '../../src/main/modules/person/searchLinks'
import usernames, { candidateUsernames, probeSites, probeUsernames } from '../../src/main/modules/person/usernames'
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

describe('pseudos possibles', () => {
  it('dix variantes sans accents ni doublons', () => {
    const list = candidateUsernames({ firstNames: ['Jérôme'], lastName: 'Dupont' }).map((c) => c.username)
    expect(list).toHaveLength(10)
    expect(list.slice(0, 5)).toEqual(['jeromedupont', 'jerome.dupont', 'jdupont', 'jerome_dupont', 'dupontjerome'])
    expect(new Set(list).size).toBe(list.length)
    expect(candidateUsernames({ firstNames: ['Jean-Pierre'], lastName: 'Le Gall' }).map((c) => c.username)).toContain('jplegall')
  })

  it('GitHub interrogé par son API, sites retenus présents dans la base Sherlock', () => {
    const sites = probeSites()
    expect(sites[0]).toMatchObject({ name: 'GitHub', urlProbe: 'https://api.github.com/users/{}' })
    expect(sites.map((s) => s.name)).toEqual(expect.arrayContaining(['TikTok', 'YouTube', 'Snapchat', 'Strava']))
    expect(sites.length).toBe(12)
  })

  it('écarte un site qui dit présent un pseudo aléatoire, ne garde que les pseudos trouvés', async () => {
    const sites: SherlockSite[] = [
      { name: 'Fiable', url: 'https://fiable.test/{}', urlMain: 'https://fiable.test/', errorType: 'status_code' },
      { name: 'Bavard', url: 'https://bavard.test/{}', urlMain: 'https://bavard.test/', errorType: 'status_code' },
      { name: 'Muet', url: 'https://muet.test/{}', urlMain: 'https://muet.test/', errorType: 'status_code' }
    ]
    const ctx = fakeContext([
      [/fiable\.test\/jeandupont$/, { status: 200 }],
      [/fiable\.test\//, { status: 404 }],
      [/bavard\.test\//, { status: 200 }],
      [/muet\.test\//, { status: 503 }]
    ])
    const steps: number[] = []
    ctx.progress = (done) => steps.push(done)
    const { results, usable, skipped } = await probeUsernames(candidateUsernames({ firstNames: ['Jean'], lastName: 'Dupont' }, 3), ctx, { sites })
    expect(usable).toEqual(['Fiable'])
    expect(skipped).toEqual([
      { site: 'Bavard', reason: 'claimed' },
      { site: 'Muet', reason: 'error' }
    ])
    expect(results.map((r) => [r.username, r.found.map((f) => f.site)])).toEqual([
      ['jeandupont', ['Fiable']],
      ['jean.dupont', []],
      ['jdupont', []]
    ])
    // 3 sondes, puis 3 pseudos sur le seul site retenu.
    expect(ctx.calls).toHaveLength(6)
    expect(steps.at(-1)).toBe(6)
  })

  it('module : pseudos trouvés mis de côté avec les sites, les autres disparaissent', async () => {
    const ctx = fakeContext([
      [/youtube\.com\/@jeandupont$/, { status: 200 }],
      [/youtube\.com\/@/, { status: 404 }]
    ])
    const out = await usernames.run(person('Jean Dupont'), ctx)
    expect(out.entities).toHaveLength(1)
    expect(out.entities![0]).toMatchObject({
      type: 'username',
      label: 'jeandupont',
      review: true,
      data: { found_on: ['YouTube'], profile_urls: ['https://www.youtube.com/@jeandupont'], generated: true }
    })
    expect(out.entities![0].reviewReason).toMatch(/^existe sur YouTube : à confirmer/)
    // Sites qui ne répondent pas : écartés après la sonde, sans autre requête.
    expect(ctx.calls.filter((c) => !c.url.includes('youtube.com'))).toHaveLength(11)
  })

  it('module : aucun site utilisable', async () => {
    await expect(usernames.run(person('Jean Dupont'), fakeContext([]))).rejects.toThrow(/Aucun site/)
  })
})

describe('recherches manuelles (personne)', () => {
  it('peu de recherches, toutes avec une explication, sans tiret long', async () => {
    const checks = personManualChecks('Jean Dupont')
    expect(checks.map((c) => c.label)).toEqual(['Google', 'Réseaux sociaux (Google)', 'Documents PDF (Google)', 'Facebook', 'Pages Blanches', 'Copains d’avant'])
    expect(checks[0].url).toBe('https://www.google.com/search?q=%22Jean%20Dupont%22')
    expect(decodeURIComponent(checks[1].url)).toContain('"Jean Dupont" (site:linkedin.com/in OR site:facebook.com')
    expect(checks.every((c) => c.hint && c.hint.length > 10)).toBe(true)
    const out = await runModule(searchLinks, person('DUPONT jean'))
    expect(out.entities).toBeUndefined()
    expect(out.manual![4].url).toContain('quoiqui=Jean%20Dupont')
    expect(JSON.stringify(out)).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('décès INSEE (matchID)', () => {
  const res = fixtureJson<MatchIdResponse>('person/matchid_exemple.json')

  it('lit les dates partielles du fichier INSEE', () => {
    expect(inseeDate('19321129')).toBe('1932-11-29')
    expect(inseeDate('20190500')).toBe('2019-05')
    expect(inseeDate('19300000')).toBe('1930')
    expect(inseeDate('00000000')).toBeUndefined()
  })

  it('met chaque décès au même nom de côté, avec dates et lieux', async () => {
    const ctx = fakeContext([[/deces\.matchid\.io\/deces\/api\/v1\/search/, { body: res }]])
    const out = await deces.run(person('Camille Exemple'), ctx)
    expect(ctx.calls[0].url).toContain('firstName=Camille')
    expect(ctx.calls[0].url).toContain('fuzzy=false')
    // « Exemples » n'est pas le même nom.
    expect(out.entities).toHaveLength(2)
    expect(out.entities![0]).toMatchObject({
      type: 'event',
      label: 'Décès de Camille Louise Exemple (05/2019)',
      review: true,
      data: { date: '2019-05', place: 'Villeurbanne (69)', birth_date: '1940-03-12', birth_place: 'Lyon 3e Arrondissement (69)', gender: 'femme', url: 'https://deces.matchid.io/id/fictif0001AB' }
    })
    expect(out.entities![0].reviewReason).toMatch(/^homonyme possible/)
    expect(out.entities![1].data).toMatchObject({ birth_place: 'Casablanca, Maroc' })
    expect(out.properties).toEqual({ death_records_count: 2 })
  })

  it('date de naissance connue : transmise et signalée dans la raison', async () => {
    const ctx = fakeContext([[/deces\.matchid\.io/, { body: { response: { total: 1, persons: [res.response!.persons![0]] } } }]])
    const out = await deces.run(person('Camille Exemple', { birth_date: '1940-03-12' }), ctx)
    expect(ctx.calls[0].url).toContain('birthDate=12%2F03%2F1940')
    expect(out.entities![0].reviewReason).toBe('nom, prénom et date de naissance identiques')
  })

  it('trop d’homonymes : aucune proposition, recherche à la main', async () => {
    const many = { response: { total: 6110, persons: Array.from({ length: 20 }, (_, i) => ({ ...res.response!.persons![0], id: `x${i}` })) } }
    const out = await deces.run(person('Camille Exemple'), fakeContext([[/deces\.matchid\.io/, { body: many }]]))
    expect(out.entities).toBeUndefined()
    expect(out.properties).toEqual({ death_records_count: 6110 })
    expect(out.manual![0].url).toBe('https://deces.matchid.io/search?q=Camille%20Exemple')
  })
})

describe('BODACC', () => {
  const res = fixtureJson<{ total_count: number; results: BodaccRecord[] }>('person/bodacc_exemple.json')
  const name = { firstNames: ['Camille'], lastName: 'Exemple' }

  it('reconnaît la personne dans le texte des dirigeants, pas dans une adresse', () => {
    expect(citesPerson('Président partant : Exemple, Camille', name)).toBe(true)
    expect(citesPerson('Président : EXEMPLE Camille, Louise', name)).toBe(true)
    expect(citesPerson('Gérant : Camille Marie EXEMPLE', name)).toBe(true)
    expect(citesPerson('Gérant : EXEMPLE Paul', name)).toBe(false)
    expect(citesPerson('Gérant : MARTIN Camille', name)).toBe(false)
    expect(citation(res.results[0], name)).toMatchObject({ role: 'Président partant', company: 'EXEMPLE CONSEIL', siren: '900000001' })
    expect(citation(res.results[2], name)).toMatchObject({ role: 'Commerçant (entreprise individuelle)', siren: '900000002' })
    expect(citation(res.results[3], name)).toBeNull()
  })

  it('une entreprise par SIREN, mise de côté avec ses annonces', () => {
    const out = bodaccOutput(res.results, res.total_count, name, 'fr')
    expect(out.entities).toHaveLength(2)
    expect(out.entities![0]).toMatchObject({
      type: 'company',
      label: 'EXEMPLE CONSEIL',
      linkLabel: 'Président partant (BODACC 02/03/2026)',
      review: true,
      data: {
        siren: '900000001',
        legal_form: 'Société par actions simplifiée',
        bodacc_announcements: 2,
        bodacc_last_date: '2026-03-02',
        bodacc_events: ['02/03/2026 · Modifications diverses · Président partant', '10/05/2022 · Créations · Président'],
        url: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:B202600009001'
      }
    })
    expect(out.entities![0].reviewReason).toMatch(/^homonyme possible/)
    expect(out.entities![1]).toMatchObject({ label: 'EXEMPLE, Camille', data: { address: '69100 Villeurbanne' } })
    expect(out.properties).toEqual({ bodacc_companies_count: 2 })
  })

  it('module : requête sur les personnes citées, pagination', async () => {
    const ctx = fakeContext([[/bodacc-datadila\.opendatasoft\.com/, (url) => ({ body: /offset=0/.test(url) ? { ...res, total_count: 150 } : { total_count: 150, results: [] } })]])
    const out = await bodacc.run(person('Camille EXEMPLE'), ctx)
    expect(out.entities).toHaveLength(2)
    expect(ctx.calls).toHaveLength(2)
    expect(decodeURIComponent(ctx.calls[0].url.replace(/\+/g, ' '))).toContain('search(listepersonnes, "EXEMPLE") and search(listepersonnes, "Camille")')
  })
})

describe('Journal officiel (JORFSearch)', () => {
  const entries = fixtureJson<JorfEntry[]>('person/jorf_exemple.json')

  it('met chaque mention au même nom de côté', async () => {
    const ctx = fakeContext([[/jorfsearch\.steinertriples\.ch\/name\/Camille%20Exemple\?format=JSON/, { body: entries }]])
    const out = await jorf.run(person('Camille Exemple'), ctx)
    // « Camil Exemplé » n'est pas le même nom ; la plus récente d'abord.
    expect(out.entities).toHaveLength(3)
    expect(out.entities![0]).toMatchObject({ type: 'event', label: 'BOMI 01/02/2023 : nomination, Conseil d\'orientation', review: true })
    expect(out.entities![1]).toMatchObject({
      label: 'JORF 14/07/2021 : nomination, Chevalier, Légion d’honneur',
      data: { date: '2021-07-14', url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000099999901', rank: 'Chevalier', distinctions: ['Légion d’honneur'], other_first_names: 'Louise' }
    })
    expect(out.properties).toEqual({ jorf_mentions_count: 3 })
  })

  it('écarte une mention dont la date de naissance diffère', async () => {
    const ctx = fakeContext([[/jorfsearch/, { body: entries }]])
    const out = await jorf.run(person('Camille Exemple', { birth_date: '1975-06-01' }), ctx)
    expect(out.entities!.map((e) => e.data?.source_id)).toEqual(['INTS9999999A', 'JORFTEXT000099999901'])
  })

  it('service indisponible : recherche Légifrance à la main', async () => {
    const out = await jorf.run(person('Camille Exemple'), fakeContext([[/jorfsearch/, { status: 503, body: 'down' }]]))
    expect(out.entities).toBeUndefined()
    expect(out.manual![0].label).toBe('Légifrance (Journal officiel)')
  })
})

describe('dirigeants (recherche-entreprises)', () => {
  const res = fixtureJson<ReResponse>('person/recherche_entreprises.json')
  const name = { firstNames: ['Xavier'], lastName: 'Niel' }

  it('ne garde que les mandats de la personne cherchée', () => {
    expect(matchesPerson({ nom: 'NIEL', prenoms: 'XAVIER', type_dirigeant: 'personne physique' }, name)).toBe(true)
    expect(matchesPerson({ nom: 'NIEL', prenoms: 'JULES', type_dirigeant: 'personne physique' }, name)).toBe(false)
    expect(matchesPerson({ nom: 'NIEL (NIEL)', prenoms: 'ALEXANDRE NICOLAS XAVIER', type_dirigeant: 'personne physique' }, name)).toBe(true)
    // Sans date de naissance connue, rien n'écarte l'homonymie : à vérifier.
    const companies = companiesFor(res.results, name)
    const freebox = companies.find((c) => c.label === 'FREEBOX')!
    expect(freebox).toMatchObject({
      type: 'company',
      linkLabel: 'Président de SAS · né(e) 08/1967',
      review: true,
      data: { siren: '433910619', legal_form: 'SAS', status: 'active' }
    })
    expect(freebox.reviewReason).toMatch(/^homonyme possible/)
    // Naissance concordante : l'entreprise entre directement dans le graphe.
    const confirmed = companiesFor(res.results, name, { birth: { year: 1967, month: 8, day: 25 } }).find((c) => c.label === 'FREEBOX')!
    expect(confirmed.linkLabel).toBe('Président de SAS · né(e) 08/1967')
    expect(confirmed.review).toBeUndefined()
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

  it('matchID : décès de Jacques Chirac', async () => {
    const out = await runModule(deces, person('Jacques Chirac', { birth_date: '1932-11-29' }), makeContext())
    expect(out.entities![0]).toMatchObject({ review: true, data: { date: '2019-09-26', birth_date: '1932-11-29' } })
  }, 60000)

  it('BODACC : annonces qui citent Xavier Niel', async () => {
    const out = await runModule(bodacc, person('Xavier Niel'), makeContext())
    expect(Number(out.properties?.bodacc_companies_count)).toBeGreaterThan(0)
  }, 60000)

  it('JORFSearch : mentions de Xavier Niel au Journal officiel', async () => {
    const out = await runModule(jorf, person('Xavier Niel'), makeContext())
    expect(out.properties?.jorf_mentions_count ?? out.manual?.length).toBeTruthy()
  }, 60000)

  it('pseudos : seuls les pseudos trouvés, à vérifier', async () => {
    const out = await runModule(usernames, person('Elon Musk'), makeContext())
    expect(out.entities!.find((e) => e.label === 'elonmusk')).toMatchObject({ review: true })
    expect(out.entities!.every((e) => (e.data?.found_on as string[]).length > 0)).toBe(true)
  }, 240000)
})
