import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError, type ModuleOutput } from '@shared/modules'
import {
  entitySearchQuery,
  labelOf,
  parsePoint,
  parseSearchBindings,
  sparqlString,
  type EntitiesResponse
} from '../../src/main/modules/person/_wikidata'
import wikidata, { isHuman, personOutput, pickPerson, positionsHeld, wikidataDate, type WdEntity } from '../../src/main/modules/person/wikidata'
import { entity, LIVE, runModule } from '../helpers/context'
import { fakeContext, fixtureJson, type Reply, type Route } from './social_helpers'

const macron = (): EntitiesResponse => fixtureJson('person/wikidata_macron_entity.json')
const labelsSparql = (): { results: { bindings: Array<Record<string, { value: string }>> } } => fixtureJson('person/wikidata_sparql_labels_macron.json')

/** Réponse wbgetentities (libellés seuls) tirée des libellés SPARQL enregistrés. */
function apiLabels(url: string): Reply {
  const ids = (new URL(url).searchParams.get('ids') ?? '').split('|')
  const entities: Record<string, unknown> = {}
  for (const b of labelsSparql().results.bindings) {
    const id = b.item.value.split('/').pop()!
    if (ids.includes(id)) entities[id] = { id, labels: { fr: { value: b.itemLabel.value } } }
  }
  return { body: { entities } }
}

/** Erreur passagère d'un service public (quota, panne, blocage, réseau) : le test en direct est sauté. */
async function liveRun(t: TestContext, run: () => Promise<ModuleOutput>): Promise<ModuleOutput | null> {
  try {
    return await run()
  } catch (e) {
    const status = (e as { status?: number }).status
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String((e as Error)?.message)) || (status && status >= 500)) {
      t.skip()
      return null
    }
    throw e
  }
}

describe('person.wikidata', () => {
  it('convertit les dates Wikidata', () => {
    expect(wikidataDate({ time: '+1867-11-07T00:00:00Z' })).toBe('1867-11-07')
    expect(wikidataDate({ time: '+1900-00-00T00:00:00Z' })).toBe('1900')
    expect(wikidataDate({ time: '+2008-01-01T00:00:00Z', precision: 9 })).toBe('2008')
    expect(wikidataDate({ time: '+2016-09-01T00:00:00Z', precision: 10 })).toBe('2016-09')
    expect(wikidataDate(undefined)).toBeNull()
  })

  it('reconnaît un être humain', () => {
    const e: WdEntity = { id: 'Q1', claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } }
    expect(isHuman(e)).toBe(true)
    expect(isHuman({ id: 'Q2' })).toBe(false)
  })

  it('lit le libellé multilingue (`mul`) quand la langue manque', () => {
    const e = macron().entities!.Q3052772
    expect(e.labels?.fr).toBeUndefined()
    expect(labelOf(e, 'fr')).toBe('Emmanuel Macron')
  })

  it('échappe la recherche SPARQL et lit les candidats', () => {
    expect(sparqlString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c d"')
    expect(entitySearchQuery('Emmanuel Macron', 'fr')).toContain('mwapi:search "Emmanuel Macron"')
    const c = parseSearchBindings(fixtureJson<{ results: { bindings: Array<Record<string, { value: string }>> } }>('person/wikidata_sparql_search_macron.json').results.bindings)
    expect(c[0]).toMatchObject({ id: 'Q3052772', label: 'Emmanuel Macron', human: true })
    expect(c.filter((x) => x.human)).toHaveLength(1)
    expect(parsePoint('Point(2.3522 48.8566)')).toEqual({ lat: 48.8566, lon: 2.3522 })
  })

  it('signale les homonymes', () => {
    const one = pickPerson('Jean Dupont', [{ id: 'Q1', label: 'Jean Dupont', human: true }, { id: 'Q2', label: 'Jean Dupont (film)', human: false }], 'fr')
    expect(one).toEqual({ id: 'Q1' })
    const two = pickPerson('Jean Dupont', [{ id: 'Q1', label: 'Jean Dupont', description: 'peintre', human: true }, { id: 'Q2', label: 'Jean Dupont', human: true }], 'fr')
    expect(two?.reviewReason).toMatch(/homonyme possible : 2 personnes.*peintre, Q1/)
    expect(pickPerson('X', [{ id: 'Q3', human: false }], 'fr')).toBeNull()
  })

  it('classe les fonctions occupées, en cours d’abord', () => {
    const names = new Map(labelsSparql().results.bindings.map((b) => [b.item.value.split('/').pop()!, { label: b.itemLabel.value }]))
    const list = positionsHeld(macron().entities!.Q3052772, names, 'fr')
    expect(list[0]).toMatch(/\(depuis 2017-05-14\)$/)
    expect(list.some((p) => /\(2014-08-26 au 2016-08-30\)$/.test(p))).toBe(true)
    // Organisation dirigée (qualificatif P2389) : la fonction est précisée.
    expect(list.some((p) => /^président ou présidente, .+ \(2016-04-06 au 2017-05-08\)$/.test(p))).toBe(true)
    expect(list).toHaveLength(5)
  })

  it('un proche homonyme de la personne garde un nœud distinct', () => {
    const p: WdEntity = {
      id: 'Q1',
      labels: { mul: { value: 'Jean Exemple' } },
      claims: { P22: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }], P40: [{ mainsnak: { datavalue: { value: { id: 'Q3' } } } }] }
    }
    const names = new Map([
      ['Q2', { label: 'Jean Exemple' }],
      ['Q3', { label: 'Marie Exemple' }]
    ])
    const out = personOutput('fr', p, names, undefined, 'jean exemple')
    expect(out.entities?.map((e) => `${e.label} | ${e.linkLabel}`)).toEqual(['Jean Exemple (Q2) | père', 'Marie Exemple | enfant'])
  })

  const checkMacron = (out: ModuleOutput): void => {
    expect(out.properties).toMatchObject({ wikidata_id: 'Q3052772', birth_date: '1977-12-21', positions_held_count: 5 })
    expect(out.properties?.positions_held).toEqual(expect.arrayContaining([expect.stringMatching(/République française \(depuis 2017-05-14\)/)]))
    const by = (type: string) => out.entities!.filter((e) => e.type === type)
    expect(by('city')[0]).toMatchObject({ label: 'Amiens', linkLabel: 'lieu de naissance' })
    expect(by('city')[0].data?.lat).toBeCloseTo(49.9, 0)
    expect(by('organization').map((e) => e.linkLabel)).toEqual(['employeur (2008 au 2012)'])
    expect(by('school').length).toBeGreaterThanOrEqual(3)
    expect(by('person').map((e) => e.linkLabel).sort()).toEqual(['conjoint ou conjointe (depuis 2007-10-20)', 'mère', 'père'])
    expect(by('person').every((e) => /^Q\d+$/.test(String(e.data?.wikidata_id)))).toBe(true)
    const accounts = Object.fromEntries(by('account').map((e) => [`${e.platform}`, e.data?.url]))
    expect(accounts).toMatchObject({
      x: 'https://x.com/EmmanuelMacron',
      instagram: 'https://www.instagram.com/emmanuelmacron/',
      facebook: 'https://www.facebook.com/EmmanuelMacron',
      linkedin: 'https://www.linkedin.com/in/emmanuelmacron',
      tiktok: 'https://www.tiktok.com/@emmanuelmacron',
      youtube: 'https://www.youtube.com/channel/UCFqGa9uitcB-fWyNZK2xImw',
      telegram: 'https://t.me/emmanuelmacron'
    })
    expect(by('website')[0].label).toBe('https://www.elysee.fr/emmanuel-macron')
    expect(by('photo')[0].image).toContain('Special:FilePath')
    expect(out.entities!.some((e) => e.review)).toBe(false)
  }

  it('construit la fiche par l’API (fixtures)', async () => {
    const routes: Route[] = [
      [/action=wbsearchentities/, { body: { search: [{ id: 'Q3052772' }, { id: 'Q29889275' }] } }],
      [/action=wbgetentities&ids=Q3052772(%7CQ29889275)?&props=labels%7Cdescriptions%7Cclaims/, { body: macron() }],
      [/action=wbgetentities&ids=Q41604&props=claims/, { body: { entities: { Q41604: { id: 'Q41604', claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 49.894, longitude: 2.302 } } } }] } } } } }],
      [/action=wbgetentities&ids=.*&props=labels&/, (url) => apiLabels(url)]
    ]
    const ctx = fakeContext(routes)
    checkMacron(await runModule(wikidata, entity('person', 'Emmanuel Macron'), ctx))
    expect(ctx.calls.every((c) => c.headers['user-agent'] === 'MASINT (https://github.com/mateo-brl/masint)')).toBe(true)
    expect(ctx.calls.some((c) => c.url.includes('query.wikidata.org'))).toBe(false)
  })

  it('se replie sur SPARQL et Special:EntityData quand l’API répond 429', async () => {
    const routes: Route[] = [
      [/www\.wikidata\.org\/w\/api\.php/, { status: 429, body: 'You are making too many requests to the API.' }],
      [/query\.wikidata\.org\/sparql.*EntitySearch/, { body: fixtureJson('person/wikidata_sparql_search_macron.json') }],
      [/query\.wikidata\.org\/sparql.*VALUES/, { body: labelsSparql() }],
      [/Special:EntityData\/Q3052772\.json$/, { body: macron() }]
    ]
    const ctx = fakeContext(routes)
    checkMacron(await runModule(wikidata, entity('person', 'Emmanuel Macron'), ctx))
    // Une seule fiche complète téléchargée : le choix du candidat se fait dans la requête SPARQL.
    expect(ctx.calls.filter((c) => c.url.includes('Special:EntityData'))).toHaveLength(1)
  })

  it('utilise l’identifiant déjà connu sans recherche', async () => {
    const routes: Route[] = [
      [/www\.wikidata\.org\/w\/api\.php/, { status: 429, body: 'quota' }],
      [/query\.wikidata\.org\/sparql.*VALUES/, { body: labelsSparql() }],
      [/Special:EntityData\/Q3052772\.json$/, { body: macron() }]
    ]
    const ctx = fakeContext(routes)
    const out = await runModule(wikidata, entity('person', 'E. Macron', { data: { wikidata_id: 'Q3052772' } }), ctx)
    expect(out.properties?.wikidata_id).toBe('Q3052772')
    expect(ctx.calls.some((c) => c.url.includes('EntitySearch'))).toBe(false)
  })

  it('met les entités en attente de vérification quand le nom est ambigu', async () => {
    const bindings = fixtureJson<{ results: { bindings: Array<Record<string, { value: string }>> } }>('person/wikidata_sparql_search_macron.json').results.bindings
    const twin = { ...bindings[0], item: { value: 'http://www.wikidata.org/entity/Q999999999' } }
    const routes: Route[] = [
      [/www\.wikidata\.org\/w\/api\.php/, { status: 429, body: 'quota' }],
      [/query\.wikidata\.org\/sparql.*EntitySearch/, { body: { results: { bindings: [bindings[0], twin] } } }],
      [/query\.wikidata\.org\/sparql.*VALUES/, { body: labelsSparql() }],
      [/Special:EntityData\/Q3052772\.json$/, { body: macron() }]
    ]
    const out = await runModule(wikidata, entity('person', 'Emmanuel Macron'), fakeContext(routes))
    expect(out.entities!.length).toBeGreaterThan(5)
    expect(out.entities!.every((e) => e.review && /homonyme possible : 2 personnes/.test(e.reviewReason ?? ''))).toBe(true)
  })
})

describe.skipIf(!LIVE)('person.wikidata (live)', () => {
  it('trouve Marie Curie', async (t) => {
    const out = await liveRun(t, () => runModule(wikidata, entity('person', 'Marie Curie')))
    if (!out) return
    expect(out.properties?.wikidata_id).toBe('Q7186')
    expect(out.properties?.death_date).toBe('1934-07-04')
  })

  it('Emmanuel Macron : fonctions, proches et comptes', async (t) => {
    const out = await liveRun(t, () => runModule(wikidata, entity('person', 'Emmanuel Macron')))
    if (!out) return
    expect(out.properties?.wikidata_id).toBe('Q3052772')
    expect(Number(out.properties?.positions_held_count)).toBeGreaterThanOrEqual(3)
    expect(out.entities?.some((e) => e.type === 'person' && /^conjoint/.test(e.linkLabel ?? ''))).toBe(true)
    expect(out.entities?.some((e) => e.type === 'account' && e.platform === 'instagram')).toBe(true)
    expect(out.entities?.some((e) => e.type === 'school')).toBe(true)
  })
})

describe('person.wikidata : quota sur Special:EntityData', () => {
  it('retente une fois puis lève une erreur de quota explicite', async () => {
    const routes: Route[] = [
      [/www\.wikidata\.org\/w\/api\.php/, { status: 429, body: 'quota' }],
      [/Special:EntityData/, { status: 429, body: 'quota' }]
    ]
    const ctx = fakeContext(routes)
    await expect(runModule(wikidata, entity('person', 'E. Macron', { data: { wikidata_id: 'Q3052772' } }), ctx)).rejects.toMatchObject({ code: 'rate_limited' })
    expect(ctx.calls.filter((c) => c.url.includes('Special:EntityData'))).toHaveLength(2)
  })
})
