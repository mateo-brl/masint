// Listes de sanctions (DG Trésor, UE, OFAC) : lecture des formats, appariement et sortie.

import { beforeEach, describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import sanctions, { queryIdentifiers, queryNames, resetSanctionsCache } from '../../src/main/modules/finance/sanctions'
import {
  birthVerdict,
  buildIndex,
  cryptoAddresses,
  frenchDates,
  hostOf,
  matchExact,
  matchMailDomain,
  matchNames,
  nameTokens,
  ofacBirthDates,
  parseEuXml,
  parseGels,
  parseOfac,
  phoneKey,
  regimeOf,
  sanctionsOutput,
  type GelsJson
} from '../../src/main/modules/finance/_sanctions'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson, type Route } from './social_helpers'

const gels = (): GelsJson => fixtureJson<GelsJson>('finance/sanctions_gels.json')
const index = () =>
  buildIndex([
    ...parseGels(gels()),
    ...parseEuXml(fixture('finance/sanctions_eu.xml')),
    ...parseOfac(fixture('finance/sanctions_sdn.csv'), fixture('finance/sanctions_alt.csv'))
  ])

const routes: Route[] = [
  [/gels-avoirs\.dgtresor\.gouv\.fr/, { body: fixture('finance/sanctions_gels.json') }],
  [/webgate\.ec\.europa\.eu/, { body: fixture('finance/sanctions_eu.xml') }],
  [/ofac\/downloads\/sdn\.csv/, { body: fixture('finance/sanctions_sdn.csv') }],
  [/ofac\/downloads\/alt\.csv/, { body: fixture('finance/sanctions_alt.csv') }],
  [/ofac\/downloads\/sdn_comments\.csv/, { body: '' }]
]

describe('finance.sanctions : lecture des listes', () => {
  it('normalise noms, sites, téléphones et dates', () => {
    expect(nameTokens('POUTINE Vladimir Vladimirovich')).toEqual(['poutine', 'vladimir', 'vladimirovich'])
    expect(nameTokens('JSC Gruppa Kremniy El', true)).toEqual(['gruppa', 'kremniy', 'el'])
    expect(nameTokens('Влади́мир ПУ́ТИН')).toEqual(['владимир', 'путин'])
    expect(hostOf('https://www.group-kremny.ru/')).toBe('group-kremny.ru')
    expect(phoneKey('+ 7 (4832) 41-43-11')).toBe(phoneKey('+74832414311'))
    expect(frenchDates('(UE) 2022/332 du 25/02/2022 (UE Ukraine)')).toEqual(['2022-02-25'])
    expect(frenchDates('(UE) 2026/1361 du 15 juin 2026 (UE Ukraine)')).toEqual(['2026-06-15'])
    expect(regimeOf('(UE) 2022/332 du 25/02/2022 (UE Ukraine intégrité territoriale - R (UE) 269/2014)')).toBe('UE Ukraine intégrité territoriale')
    expect(ofacBirthDates('07 Oct 1952')).toEqual([{ year: 1952, month: 10, day: 7 }])
    expect(ofacBirthDates('1960 to 1962').map((b) => b.year)).toEqual([1960, 1961, 1962])
    expect(cryptoAddresses('ETH: 0x002471b8A185f9980708d0eAEC5B289714F56f8d')).toEqual(['0x002471b8A185f9980708d0eAEC5B289714F56f8d'])
  })

  it('lit le registre national des gels', () => {
    const fr = parseGels(gels())
    const kremniy = fr.find((e) => e.name === 'JSC Gruppa Kremniy El')!
    expect(kremniy).toMatchObject({ kind: 'entity', websites: ['https://group-kremny.ru/'], emails: ['group@kremny.032.ru'], euRefs: ['EU.12598.59'], listedAt: '2024-12-16' })
    expect(kremniy.identifiers).toContain('1023202741781')
    const putin = fr.find((e) => e.id === '4271')!
    expect(putin).toMatchObject({ kind: 'person', name: 'POUTINE Vladimir Vladimirovich', birthDates: [{ year: 1952, month: 10, day: 7 }], programmes: ['UE Ukraine intégrité territoriale'] })
  })

  it('lit la liste consolidée de l’UE (XML)', () => {
    const eu = parseEuXml(fixture('finance/sanctions_eu.xml'))
    expect(eu).toHaveLength(2)
    expect(eu[0]).toMatchObject({ kind: 'person', name: 'Vladimir Vladimirovich PUTIN', euRefs: ['EU.7510.16'], titles: ['President of the Russian Federation'], listedAt: '2022-02-25' })
    expect(eu[0].aliases).toContain('Vladimir Vladimirovich POUTINE')
    expect(eu[0].url).toContain('&toc=')
    expect(eu[1]).toMatchObject({ kind: 'entity', websites: ['https://group-kremny.ru/'], emails: ['group@kremny.032.ru'] })
    expect(eu[1].phones).toHaveLength(2)
  })

  it('lit la liste SDN de l’OFAC', () => {
    const ofac = parseOfac(fixture('finance/sanctions_sdn.csv'), fixture('finance/sanctions_alt.csv'))
    expect(ofac[0]).toMatchObject({ kind: 'person', name: 'PUTIN, Vladimir Vladimirovich', birthDates: [{ year: 1952, month: 10, day: 7 }], programmes: ['RUSSIA-EO14024'] })
    expect(ofac[1]).toMatchObject({ kind: 'entity', websites: ['garantex.io', 'garantex.org'], aliases: ['GARANTEX'] })
    expect(ofac[1].identifiers).toContain('0x7FF9cFad3877F21d41Da833E2F775dB0569eE3D9')
  })
})

describe('finance.sanctions : appariement', () => {
  it('correspondances exactes : site, courriel, téléphone, portefeuille, identifiant', () => {
    const idx = index()
    expect(matchExact(idx, 'website', 'https://group-kremny.ru').map((h) => h.entry.source)).toEqual(['fr', 'eu'])
    expect(matchExact(idx, 'email', 'GROUP@kremny.032.ru')).toHaveLength(2)
    expect(matchExact(idx, 'phone', '+74832414311')).toHaveLength(2)
    expect(matchExact(idx, 'crypto_wallet', '0x002471b8A185f9980708d0eAEC5B289714F56f8d')[0].entry.name).toBe('Garantex')
    expect(matchExact(idx, 'company', '', ['1023202741781'])[0].basis).toBe('identifier')
    expect(matchExact(idx, 'domain', 'example.org')).toEqual([])
    expect(matchMailDomain(idx, 'contact@group-kremny.ru')[0].basis).toBe('mail_domain')
    expect(matchMailDomain(idx, 'quelqu.un@gmail.com')).toEqual([])
  })

  it('noms : ordre et accents indifférents, dates de naissance incompatibles écartées', () => {
    const idx = index()
    const any = matchNames(idx, { names: ['Vladimir Putin'], entity: false })
    expect(any.hits.map((h) => h.entry.source).sort()).toEqual(['eu', 'ofac'])
    expect(any.hits.every((h) => h.basis === 'name')).toBe(true)
    const confirmed = matchNames(idx, { names: ['Poutine Vladimir'], entity: false, birth: { year: 1952, month: 10, day: 7 } })
    expect(confirmed.hits.map((h) => h.basis)).toEqual(['name_birth', 'name_birth'])
    const other = matchNames(idx, { names: ['Sergueï Lavrov'], entity: false, birth: { year: 1960 } })
    expect(other.hits).toEqual([])
    expect(other.excluded).toHaveLength(1)
    expect(matchNames(idx, { names: ['Gruppa Kremniy El'], entity: true }).hits).toHaveLength(2)
    expect(matchNames(idx, { names: ['Danone'], entity: true }).hits).toEqual([])
    // Un seul mot ne suffit pas pour une personne.
    expect(matchNames(idx, { names: ['Vladimir'], entity: false }).hits).toEqual([])
  })

  it('compare les dates de naissance', () => {
    expect(birthVerdict({ year: 1952, month: 10, day: 7 }, [{ year: 1952, month: 10, day: 7 }])).toBe('confirmed')
    expect(birthVerdict({ year: 1952 }, [{ year: 1952, month: 10, day: 7 }])).toBe('possible')
    expect(birthVerdict({ year: 1953 }, [{ year: 1952, circa: true }])).toBe('possible')
    expect(birthVerdict({ year: 1970 }, [{ year: 1952 }])).toBe('excluded')
    expect(birthVerdict(null, [{ year: 1952 }])).toBe('possible')
  })

  it('sortie : titulaire et événement daté pour une correspondance exacte', () => {
    const idx = index()
    const out = sanctionsOutput({ direct: matchExact(idx, 'website', 'group-kremny.ru'), review: [], excluded: 0 }, 'website', ['fr', 'eu', 'ofac'], 'fr')
    expect(out.properties).toMatchObject({ sanctioned: true, sanctions_match: ['site identique'], sanctions_eu_refs: ['EU.12598.59'], dgtresor_id: '7805' })
    expect(out.properties?.sanctions_lists).toHaveLength(2)
    expect(out.entities?.[0]).toMatchObject({ ref: 'holder0', type: 'organization', label: 'JSC Gruppa Kremniy El' })
    expect(out.entities?.[1]).toMatchObject({ type: 'event', label: 'Gel des avoirs : JSC Gruppa Kremniy El', from: 'holder0', data: { date: '2024-12-16' } })
    expect(out.entities?.some((e) => e.review)).toBe(false)
  })

  it('sortie : homonyme mis de côté avec motif, fondement, naissance et références', () => {
    const idx = index()
    const names = matchNames(idx, { names: ['Vladimir Putin'], entity: false })
    const out = sanctionsOutput({ direct: [], review: names.hits, excluded: 0 }, 'person', ['fr', 'eu', 'ofac'], 'fr')
    expect(out.properties?.sanctioned).toBeUndefined()
    expect(out.properties?.sanctions_possible_matches).toBe(1)
    const ev = out.entities![0]
    expect(ev).toMatchObject({ type: 'event', review: true, data: { date: '2022-02-25' } })
    expect(ev.reviewReason).toMatch(/homonyme possible/)
    expect(ev.reviewReason).toMatch(/07\/10\/1952/)
    expect(ev.reviewReason).toMatch(/EU\.7510\.16/)
  })
})

describe('finance.sanctions (module, hors ligne)', () => {
  beforeEach(() => resetSanctionsCache())

  it('noms et identifiants tirés de la fiche', () => {
    expect(queryNames(entity('person', 'Vladimir Poutine', { data: { aliases: ['V. V. Poutine'] } }))).toEqual(['Vladimir Poutine', 'V. V. Poutine'])
    expect(queryIdentifiers(entity('company', 'Danone', { data: { siren: '552032534' } }))).toEqual(['552032534'])
  })

  it('personne : nom et date de naissance identiques, inscription au graphe', async () => {
    const ctx = fakeContext(routes)
    const out = await runModule(sanctions, entity('person', 'Vladimir Poutine', { data: { birth_date: '1952-10-07' } }), ctx)
    expect(out.properties).toMatchObject({ sanctioned: true, sanctions_match: ['nom et date de naissance identiques'] })
    expect(out.entities?.filter((e) => !e.review)).toHaveLength(1)
    expect(ctx.calls.find((c) => c.url.includes('gels-avoirs'))?.headers['user-agent']).toMatch(/^MASINT/)
  })

  it('domaine absent des listes : non sanctionné', async () => {
    const out = await runModule(sanctions, entity('domain', 'danone.com'), fakeContext(routes))
    expect(out.properties).toMatchObject({ sanctioned: false })
    expect(out.entities).toEqual([])
  })

  it('liste indisponible : les autres sont consultées et signalées', async () => {
    const out = await runModule(sanctions, entity('email', 'group@kremny.032.ru'), fakeContext([[/webgate/, { status: 404 }], ...routes]))
    expect(out.properties).toMatchObject({ sanctioned: true, sanctions_lists_unavailable: ['Liste consolidée des sanctions de l’UE'] })
  })
})

const skippable = (e: unknown): boolean =>
  (e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || (e instanceof Error && /fetch failed/.test(e.message))

describe.skipIf(!LIVE)('finance.sanctions (live)', () => {
  it('site d’une entité sanctionnée et chef d’État', async (t) => {
    resetSanctionsCache()
    try {
      const site = await runModule(sanctions, entity('website', 'https://group-kremny.ru/'), makeContext())
      expect(site.properties).toMatchObject({ sanctioned: true })
      const person = await runModule(sanctions, entity('person', 'Vladimir Poutine', { data: { birth_date: '1952-10-07' } }), makeContext())
      expect(person.properties?.sanctioned).toBe(true)
      expect(person.properties?.sanctions_lists_unavailable).toBeUndefined()
    } catch (e) {
      if (skippable(e)) t.skip()
      throw e
    }
  }, 300000)
})
