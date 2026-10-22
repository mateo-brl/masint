// Registres d'entreprises européens : Norvège (Brreg), Finlande (PRH), Tchéquie (ARES),
// Irlande (CRO). Fixtures de grandes entreprises ; les personnes des organes y sont fictives.

import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError, type ModuleOutput } from '@shared/modules'
import { countryHint, czechIco, euNorm, finnishBusinessId, irishCroNumber, norwegianOrgNr, suffixCountry } from '../../src/main/modules/company/_eu'
import ares, { aresOutput, type AresSubject, type AresVr } from '../../src/main/modules/company/ares'
import brreg, { brregOutput, type BrregEntity, type BrregRoles } from '../../src/main/modules/company/brreg'
import cro, { croOutput, type CroResponse } from '../../src/main/modules/company/cro'
import prh, { prhOutput, type PrhResponse } from '../../src/main/modules/company/prh'
import { entity, LIVE, runModule } from '../helpers/context'
import { fakeContext, fixtureJson } from './social_helpers'

const fr = { lang: 'fr' as const }

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

const persons = (out: ModuleOutput) => (out.entities ?? []).filter((e) => e.type === 'person')

describe('registres européens : numéros et pays', () => {
  it('contrôle les numéros nationaux', () => {
    expect(norwegianOrgNr('923609016')).toBe('923609016')
    expect(norwegianOrgNr('NO 923 609 016 MVA')).toBe('923609016')
    expect(norwegianOrgNr('923609017')).toBeNull()
    expect(finnishBusinessId('0112038-9')).toBe('0112038-9')
    expect(finnishBusinessId('FI01120389')).toBe('0112038-9')
    expect(finnishBusinessId('0112038-8')).toBeNull()
    expect(czechIco('00177041')).toBe('00177041')
    expect(czechIco('CZ00177041')).toBe('00177041')
    expect(czechIco('00177042')).toBeNull()
    expect(irishCroNumber('CRO 249885', false)).toBe('249885')
    expect(irishCroNumber('249885', false)).toBeNull()
    expect(irishCroNumber('249885', true)).toBe('249885')
  })

  it('déduit le pays de la fiche ou de la forme juridique', () => {
    expect(countryHint({ country: 'Norvège' })).toBe('NO')
    expect(countryHint({ jurisdiction: 'fi' })).toBe('FI')
    expect(countryHint({ jurisdiction: 'us_de' })).toBe('US')
    expect(countryHint({ country_code: 'IE' })).toBe('IE')
    expect(countryHint({ country: 'France' })).toBe('FR')
    expect(countryHint({})).toBeNull()
    expect(suffixCountry('Equinor ASA')).toBe('NO')
    expect(suffixCountry('Nokia Oyj')).toBe('FI')
    expect(suffixCountry('Oy Nokia Ab')).toBe('FI')
    expect(suffixCountry('Škoda Auto a.s.')).toBe('CZ')
    expect(suffixCountry('Example Holdings DAC')).toBe('IE')
    expect(suffixCountry('Danone')).toBeNull()
    expect(euNorm('RYANAIR HOLDINGS PUBLIC LIMITED COMPANY')).toBe(euNorm('Ryanair Holdings PLC'))
    expect(euNorm('EQUINOR ASA')).toBe('equinor')
  })

  it('chaque module ne se propose que pour son pays', () => {
    expect(brreg.accepts?.(entity('company', '923609016'))).toBe(true)
    expect(brreg.accepts?.(entity('company', 'Equinor ASA'))).toBe(true)
    expect(brreg.accepts?.(entity('company', 'Equinor'))).toBe(false)
    expect(brreg.accepts?.(entity('company', 'Equinor', { data: { country: 'Norway' } }))).toBe(true)
    // Neuf chiffres qui forment aussi un SIREN valide (Danone) : pas sans la Norvège.
    expect(brreg.accepts?.(entity('company', '552032534'))).toBe(false)
    expect(brreg.accepts?.(entity('company', 'Equinor ASA', { data: { country: 'France' } }))).toBe(false)
    expect(prh.accepts?.(entity('company', '0112038-9'))).toBe(true)
    expect(prh.accepts?.(entity('company', 'Danone'))).toBe(false)
    expect(ares.accepts?.(entity('company', '00177041'))).toBe(true)
    expect(ares.accepts?.(entity('company', 'Škoda Auto a.s.'))).toBe(true)
    expect(cro.accepts?.(entity('company', 'CRO 249885'))).toBe(true)
    expect(cro.accepts?.(entity('company', '249885'))).toBe(false)
    expect(cro.accepts?.(entity('company', 'Ryanair Holdings PLC', { data: { country: 'Irlande' } }))).toBe(true)
  })
})

describe('company.brreg (hors ligne)', () => {
  const entityFixture = (): BrregEntity => fixtureJson('company/brreg_equinor.json')
  const roles = (): BrregRoles => fixtureJson('company/brreg_equinor_roller.json')

  it('identité, anciens noms et rôles actifs', () => {
    const out = brregOutput(fr, entityFixture(), roles())
    expect(out.properties).toMatchObject({
      name: 'EQUINOR ASA',
      company_number: '923609016',
      country: 'Norvège',
      country_code: 'NO',
      legal_form: 'Allmennaksjeselskap (ASA)',
      status: 'active',
      created_at: '1972-09-18',
      registration_date: '1995-03-12',
      vat: 'NO923609016MVA',
      registry_url: 'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016'
    })
    expect(out.properties?.previous_names).toContain("STATOIL ASA (jusqu'en 2018)")
    expect(out.entities?.find((e) => e.type === 'address')).toMatchObject({ label: 'Forusbeen 50, 4035 STAVANGER, Norge', linkLabel: 'siège' })
    expect(out.entities?.find((e) => e.type === 'website')?.label).toBe('https://www.equinor.com')
    expect(out.entities?.find((e) => e.type === 'company')).toMatchObject({ label: 'ERNST & YOUNG AS', linkLabel: 'commissaire aux comptes', data: { company_number: '976389387', country_code: 'NO' } })
  })

  it('date de naissance seulement pour départager des homonymes', () => {
    const out = brregOutput(fr, entityFixture(), roles())
    const people = persons(out)
    expect(people.find((p) => p.label === 'Kari Nordmann')).toMatchObject({ linkLabel: 'directeur général', data: { first_name: 'Kari', last_name: 'Nordmann' } })
    expect(people.find((p) => p.label === 'Kari Nordmann')?.review).toBeUndefined()
    const namesakes = people.filter((p) => p.label.startsWith('Ola Nordmann'))
    expect(namesakes.map((p) => p.label).sort()).toEqual(['Ola Nordmann (1965)', 'Ola Nordmann (1980)'])
    expect(namesakes.every((p) => p.review === true && /homonymes/.test(p.reviewReason ?? ''))).toBe(true)
    // Rôle radié écarté ; aucune date de naissance dans les fiches ni dans la réponse archivée.
    expect(people.some((p) => p.label.includes('Tidligere'))).toBe(false)
    expect(JSON.stringify(out)).not.toMatch(/\d{4}-01-01|fodselsdato|birth_date/)
  })

  it('recherche par nom : correspondance exacte, sinon candidats à vérifier', async () => {
    const routes: Parameters<typeof fakeContext>[0] = [
      [/\/enheter\?/, { body: fixtureJson('company/brreg_search_equinor.json') }],
      [/\/enheter\/923609016\/roller/, { body: roles() }],
      [/\/enheter\/923609016/, { body: entityFixture() }]
    ]
    const exact = await brreg.run(entity('company', 'Equinor ASA'), fakeContext(routes))
    expect(exact.properties?.company_number).toBe('923609016')
    const ctx = fakeContext(routes)
    const fuzzy = await brreg.run(entity('company', 'Equinor Norge', { data: { country: 'Norvège' } }), ctx)
    expect(fuzzy.properties).toBeUndefined()
    expect(fuzzy.entities?.length).toBeGreaterThan(1)
    expect(fuzzy.entities?.every((e) => e.type === 'company' && e.review && e.data?.country_code === 'NO')).toBe(true)
    expect(ctx.calls).toHaveLength(1)
  })
})

describe('company.prh (hors ligne)', () => {
  it('identité, noms successifs, TVA et site', async () => {
    const r = fixtureJson<PrhResponse>('company/prh_nokia.json')
    const out = prhOutput(fr, r.companies![0])
    expect(out.properties).toMatchObject({
      name: 'Nokia Oyj',
      company_number: '0112038-9',
      euid: 'FIFPRO.0112038-9',
      legal_form: 'Public limited company',
      status: 'inscrite',
      registration_date: '1896-12-19',
      vat: 'FI01120389',
      country: 'Finlande'
    })
    expect(out.properties?.previous_names).toEqual(["Oy Nokia Ab (jusqu'en 1997)"])
    expect(out.properties?.other_names).toContain('Nokia Corporation')
    expect(out.entities?.find((e) => e.type === 'address')?.label).toBe('Karakaari 7, 02610 ESPOO')
    expect(persons(out)).toHaveLength(0)
    const ctx = fakeContext([[/opendata-ytj-api\/v3\/companies/, { body: r }]])
    await prh.run(entity('company', 'FI01120389'), ctx)
    expect(new URL(ctx.calls[0].url).searchParams.get('businessId')).toBe('0112038-9')
  })
})

describe('company.ares (hors ligne)', () => {
  const subject = (): AresSubject => fixtureJson('company/ares_skoda.json')
  const vr = (): AresVr => fixtureJson('company/ares_skoda_vr.json')

  it('identité, registre public et organes en fonction, sans adresse ni naissance', () => {
    const out = aresOutput(fr, subject(), vr())
    expect(out.properties).toMatchObject({
      name: 'Škoda Auto a.s.',
      company_number: '00177041',
      vat: 'CZ00177041',
      legal_form: 'Akciová společnost (a.s.)',
      created_at: '1990-11-20',
      share_capital: '16 708 850 000 CZK',
      register_file: 'B 332, Městský soud v Praze',
      country: 'Tchéquie'
    })
    expect(out.properties?.previous_names).toContain("ŠKODA AUTO a.s. (jusqu'en 2023)")
    const people = persons(out)
    expect(people.find((p) => p.label === 'Petra Svobodová')).toMatchObject({ linkLabel: 'člen představenstva', data: { appointed_on: '2023-06-01' } })
    // Deux « Jan Novák » nés à des années différentes : départagés et à vérifier.
    expect(people.filter((p) => p.label.startsWith('Jan Novák')).map((p) => p.label).sort()).toEqual(['Jan Novák (1970)', 'Jan Novák (1990)'])
    // Membre radié écarté ; adresse et date de naissance jamais reprises.
    expect(people.some((p) => p.label.includes('Černá'))).toBe(false)
    expect(JSON.stringify(out)).not.toMatch(/adresse retirée|\d{4}-01-01|datumNarozeni/)
  })

  it('recherche par nom (POST) puis fiche et registre public', async () => {
    const ctx = fakeContext([
      [/ekonomicke-subjekty\/vyhledat/, { body: fixtureJson('company/ares_search_skoda.json') }],
      [/ekonomicke-subjekty-vr\/00177041/, { body: vr() }],
      [/ekonomicke-subjekty\/00177041/, { body: subject() }]
    ])
    const out = await ares.run(entity('company', 'Škoda Auto a.s.'), ctx)
    expect(out.properties?.company_number).toBe('00177041')
    expect(ctx.calls[0]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(ctx.calls[0].body!)).toMatchObject({ obchodniJmeno: 'Škoda Auto a.s.' })
  })
})

describe('company.cro (hors ligne)', () => {
  it('identité et dates', async () => {
    const r = fixtureJson<CroResponse>('company/cro_ryanair.json')
    const out = croOutput(fr, r.result!.records![0])
    expect(out.properties).toMatchObject({
      name: 'RYANAIR HOLDINGS PUBLIC LIMITED COMPANY',
      company_number: '249885',
      status: 'Normal',
      legal_form: 'PLC - Public Limited Company',
      registration_date: '1996-06-05',
      last_annual_return_date: '2025-10-09',
      country: 'Irlande'
    })
    expect(out.entities?.find((e) => e.type === 'address')?.label).toMatch(/^RYANAIR DUBLIN OFFICE, AIRSIDE BUSINESS PARK/)
    const ctx = fakeContext([[/datastore_search/, { body: r }]])
    await cro.run(entity('company', 'CRO 249885'), ctx)
    expect(JSON.parse(new URL(ctx.calls[0].url).searchParams.get('filters')!)).toEqual({ company_num: 249885 })
  })

  it('recherche par nom avec le pays connu', async () => {
    const ctx = fakeContext([[/datastore_search/, { body: fixtureJson('company/cro_search_ryanair.json') }]])
    const out = await cro.run(entity('company', 'Ryanair Holdings PLC', { data: { country: 'Irlande' } }), ctx)
    expect(out.properties?.company_number).toBe('249885')
    expect(new URL(ctx.calls[0].url).searchParams.get('q')).toBe('Ryanair Holdings PLC')
  })
})

describe.skipIf(!LIVE)('registres européens : services réels', () => {
  it('Brreg : Equinor', async (t) => {
    const out = await liveRun(t, () => runModule(brreg, entity('company', '923609016')))
    if (!out) return
    expect(out.properties).toMatchObject({ name: 'EQUINOR ASA', company_number: '923609016' })
    expect(persons(out).length).toBeGreaterThan(3)
  })

  it('PRH : Nokia', async (t) => {
    const out = await liveRun(t, () => runModule(prh, entity('company', '0112038-9')))
    if (!out) return
    expect(out.properties?.name).toBe('Nokia Oyj')
  })

  it('ARES : Škoda Auto', async (t) => {
    const out = await liveRun(t, () => runModule(ares, entity('company', '00177041')))
    if (!out) return
    expect(out.properties?.name).toBe('Škoda Auto a.s.')
    expect(persons(out).length).toBeGreaterThan(0)
  })

  it('CRO : Ryanair Holdings', async (t) => {
    const out = await liveRun(t, () => runModule(cro, entity('company', 'CRO 249885')))
    if (!out) return
    expect(out.properties?.name).toBe('RYANAIR HOLDINGS PUBLIC LIMITED COMPANY')
  })
})
