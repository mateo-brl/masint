// Lieux français : entreprises à une adresse (SIRENE géolocalisée), immobilier (cadastre,
// DVF, DPE, Sitadel) et permis d'une entreprise. Fixtures : bâtiments publics (Hôtel de Ville
// de Paris, Amiens, Carcassonne) ; les entrepreneurs individuels y sont anonymisés.

import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError, type ModuleOutput } from '@shared/modules'
import { nearestParcel, parseParcel, type CadastreCollection } from '../../src/main/modules/location/_cadastre'
import { parseDpe, type DpeResponse } from '../../src/main/modules/location/_dpe'
import { parseDvfApi, parseGeoDvfCsv, saleEntity, type DvfCollection } from '../../src/main/modules/location/_dvf'
import { bbox, sameAddress, splitStreet, streetWords } from '../../src/main/modules/location/_france'
import { fixMojibake, inDistrict, parcelFilters, parsePermit, type Permit } from '../../src/main/modules/location/_sitadel'
import entreprises, { companiesOutput, DOMICILIATION_THRESHOLD, type NearResponse } from '../../src/main/modules/location/entreprisesAdresse'
import immobilier from '../../src/main/modules/location/immobilier'
import sitadel, { permitsOutput, sirenOf } from '../../src/main/modules/company/sitadel'
import { entity, LIVE, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson, type Route } from './social_helpers'

const fr = { lang: 'fr' as const }
const HDV = { lat: 48.856508, lon: 2.352059 }
const near = (): NearResponse => fixtureJson('location/near_point_hotel_de_ville.json')
const empty = { total: 0, page: 1, pageSize: '10', data: [] }

/** Aucune sortie ne doit contenir de personne : ni entité, ni clé évoquant un propriétaire. */
function expectNoPerson(out: ModuleOutput): void {
  expect(out.entities?.some((e) => e.type === 'person')).toBe(false)
  expect(JSON.stringify(out)).not.toMatch(/owner|proprietaire|propriétaire|acquereur|acquéreur|vendeur/i)
}

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

describe('location : adresses françaises', () => {
  it('sépare le numéro et la voie', () => {
    expect(splitStreet('25 Rue de Belfort')).toEqual({ housenumber: '25', street: 'Rue de Belfort' })
    expect(splitStreet('4 bis Avenue Foch')).toEqual({ housenumber: '4bis', street: 'Avenue Foch' })
    expect(splitStreet('Place du Capitole')).toEqual({ housenumber: null, street: 'Place du Capitole' })
  })

  it('reconnaît une adresse SIRENE abrégée', () => {
    expect(streetWords("Place de l'Hôtel de Ville - Esplanade de la Libération")).toEqual(['HOTEL', 'VILLE', 'LIBERATION'])
    const place = { housenumber: '4', street: "Place de l'Hôtel de Ville - Esplanade de la Libération", postcode: '75004' }
    expect(sameAddress(place, '4 PL HOTEL VILLE ESP LIBERATION 75004 PARIS 04', '75004')).toBe(true)
    expect(sameAddress(place, '5 RUE DE LOBAU 75004 PARIS', '75004')).toBe(false)
    expect(sameAddress(place, '4 PL HOTEL VILLE ESP LIBERATION 69001 LYON', '69001')).toBe(false)
    expect(sameAddress({ housenumber: null, street: 'Rue de Rivoli', postcode: null }, '4 RUE DE RIVOLI')).toBe(false)
  })

  it('calcule un carré d’environ 50 m autour du point', () => {
    const [w, s, e, n] = bbox({ lat: 43.216589, lon: 2.359097 }, 50)
    expect(n - s).toBeCloseTo(0.0009, 4)
    expect(e - w).toBeGreaterThan(n - s)
  })
})

describe('location.entreprises_adresse (hors ligne)', () => {
  it('compte, signale la domiciliation et ne nomme pas les entrepreneurs individuels', () => {
    const place = { ...HDV, housenumber: '4', street: "Place de l'Hôtel de Ville - Esplanade de la Libération", postcode: '75004' }
    const out = companiesOutput(fr, place, near())
    expect(out.properties).toMatchObject({ domiciled_companies: 66, domiciliation_center: true, individual_entrepreneurs_seen: 2 })
    const companies = out.entities ?? []
    expect(companies.length).toBeGreaterThan(5)
    expect(companies.length).toBeLessThanOrEqual(15)
    expect(companies.every((e) => e.type === 'company' && e.review === true)).toBe(true)
    expect(companies.some((e) => /ENTREPRENEUR INDIVIDUEL/.test(e.label))).toBe(false)
    // Même adresse et en activité d'abord.
    expect(companies[0]).toMatchObject({ label: 'VILLE DE PARIS', linkLabel: 'entreprise domiciliée', data: { siren: '217500016', siret: '21750001600019' } })
    expect(companies[0].reviewReason).toBe('établissement à cette adresse (SIRENE)')
    const closed = companies.find((e) => e.label === 'AGENCE METROPOLITAINE DES MOBILITES PARTAGEES')
    expect(closed?.reviewReason).toMatch(/fermé$/)
    expect(companies.indexOf(closed!)).toBeGreaterThan(companies.findIndex((e) => e.label === 'FONDS DEPARTEMENT DE PARIS (DPA)'))
  })

  it('pas de signal sous le seuil', () => {
    const out = companiesOutput(fr, HDV, { ...near(), total_results: DOMICILIATION_THRESHOLD - 1 })
    expect(out.properties?.domiciliation_center).toBeUndefined()
    expect(out.properties?.domiciled_companies).toBe(49)
  })

  it('interroge near_point dans un rayon de 30 m autour des coordonnées', async () => {
    const ctx = fakeContext([
      [/geocodage\/reverse/, { body: fixtureJson('location/geopf_reverse.json') }],
      [/recherche-entreprises\.api\.gouv\.fr\/near_point/, { body: near() }]
    ])
    const out = await entreprises.run(entity('coordinates', '48.856508, 2.352059'), ctx)
    const call = new URL(ctx.calls.find((c) => c.url.includes('near_point'))!.url)
    expect(call.searchParams.get('radius')).toBe('0.03')
    expect(call.searchParams.get('lat')).toBe('48.856508')
    expect(call.searchParams.get('long')).toBe('2.352059')
    expect(call.searchParams.get('per_page')).toBe('25')
    expect(out.properties?.domiciled_companies).toBe(66)
  })

  it('hors de France : rien', async () => {
    const ctx = fakeContext([])
    expect(await entreprises.run(entity('coordinates', '52.5163, 13.3777'), ctx)).toEqual({})
    expect(ctx.calls).toHaveLength(0)
  })
})

describe('location.immobilier : sources (hors ligne)', () => {
  it('cadastre : parcelle sous le point, ou la plus proche', () => {
    const amiens = parseParcel(fixtureJson<CadastreCollection>('location/cadastre_point_amiens.json').features?.[0])
    expect(amiens).toMatchObject({ idu: '80021000VD0067', section: 'VD', number: '0067', area: 3556, insee: '80021', communeInsee: '80021', dep: '80', distance: null })
    const carcassonne = nearestParcel(fixtureJson('location/cadastre_box_carcassonne.json'), { lat: 43.216589, lon: 2.359097 })
    expect(carcassonne).toMatchObject({ idu: '11069000AL0119', area: 1060 })
    expect(carcassonne!.distance).toBeLessThanOrEqual(5)
    // Paris : l'IDU porte l'arrondissement, la commune reste 75056.
    expect(parseParcel(fixtureJson<CadastreCollection>('location/cadastre_paris_ae0003.json').features?.[0])).toMatchObject({ insee: '75104', communeInsee: '75056', dep: '75' })
  })

  it('DVF : ventes de la parcelle d’abord, mutations éloignées écartées', () => {
    const sales = parseDvfApi(fixtureJson<DvfCollection>('location/dvf_geomutations_carcassonne.json'), { lat: 43.216589, lon: 2.359097 }, '11069000AL0119')
    expect(sales.length).toBeGreaterThan(4)
    const onParcel = sales.filter((s) => s.onParcel)
    expect(onParcel.length).toBe(4)
    expect(sales.slice(0, 4).every((s) => s.onParcel)).toBe(true)
    expect(onParcel.map((s) => s.date)).toEqual([...onParcel.map((s) => s.date)].sort().reverse())
    // Les ventes de plusieurs communes (parcelles dispersées) ne sont pas des voisines.
    expect(sales.every((s) => s.parcels.every((p) => p.startsWith('11069')))).toBe(true)
    expect(sales.filter((s) => !s.onParcel).every((s) => s.distance !== null && s.distance <= 50)).toBe(true)
  })

  it('DVF : événement daté rattaché au bien, sans personne', () => {
    const [s] = parseDvfApi(fixtureJson<DvfCollection>('location/dvf_geomutations_carcassonne.json'), { lat: 43.216589, lon: 2.359097 }, '11069000AL0119')
    const e = saleEntity(s, 'fr')
    expect(e.type).toBe('event')
    expect(e.label).toMatch(/^Vente du \d{2}\/\d{2}\/\d{4} : [\d ]+ € \(/)
    expect(e.linkLabel).toBe('vente de la parcelle')
    expect(e.data).toMatchObject({ date: s.date, parcels: ['11069000AL0119'], source: 'DVF (DGFiP)' })
    expect(typeof e.data?.price).toBe('number')
  })

  it('geo-dvf : lignes regroupées par mutation, parcelles voisines seulement', () => {
    const sales = parseGeoDvfCsv(fixture('location/geodvf_amiens_2024.csv'), { lat: 49.89335, lon: 2.295 }, '80021000VD0067')
    expect(sales.length).toBeGreaterThan(0)
    expect(sales.every((s) => s.parcels.every((p) => p.startsWith('80021000VD')))).toBe(true)
    const hdv = sales.find((s) => s.id === '2024-975214')
    expect(hdv).toMatchObject({ price: 263850, builtArea: 108, address: '8 PL DE L HOTEL DE VILLE, 80000 Amiens' })
    expect(hdv?.type).toBe('appartement, dépendance')
  })

  it('DPE : classes, numéros et dates, le plus récent d’abord', () => {
    const r = parseDpe(fixtureJson<DpeResponse>('location/dpe_belfort_carcassonne.json'), '11069_0550_00025')
    expect(r.total).toBe(8)
    expect(r.dpe.map((d) => d.date)).toEqual([...r.dpe.map((d) => d.date)].sort().reverse())
    expect(r.dpe.find((d) => d.number === '2511E0687948D')).toMatchObject({ energyClass: 'C', ghgClass: 'A', buildingType: 'appartement', area: 46 })
  })

  it('Sitadel : libellés réparés, parcelles, filtres et arrondissements', () => {
    expect(fixMojibake('13 Ã\u0080 28 RUE')).toBe('13 À 28 RUE')
    expect(fixMojibake('SAINT-LAURENT-SUR-SAAÃ\u0082Â\u0094NE')).toBe('SAINT-LAURENT-SUR-SAÔNE')
    expect(fixMojibake('RUE DE LA RAÃ\u0082Â\u0089SISTANCE')).toBe('RUE DE LA RÉSISTANCE')
    expect(parcelFilters('80086', '0G', '0104')).toEqual({ COMM: 'eq:80086', SEC_CADASTRE1: 'in:G,0G', NUM_CADASTRE1: 'eq:104' })
    expect(parcelFilters('80021', 'VD', '0067').SEC_CADASTRE1).toBe('eq:VD')
    const demolition = fixtureJson<{ data: Array<Record<string, string>> }>('location/sitadel_demolition_oph.json').data[0]
    const p = parsePermit('demolition', demolition)!
    expect(p).toMatchObject({ number: '08056126M0004', type: 'PD', applicantSiren: '315667410', parcels: ['AE 681', 'AE 682', 'AE 684'] })
    expect(p.place).toBe('13 À 28 RUE D_AUSTRALIE, 80500 MONTDIDIER')
    const paris = { number: '07510112V0009' } as Permit
    expect(inDistrict(paris, '75101')).toBe(true)
    expect(inDistrict(paris, '75104')).toBe(false)
  })
})

describe('location.immobilier (hors ligne)', () => {
  const dido: Route = [/dido\/api\/v1\/datafiles\/[^/]+\/rows/, { body: empty }]

  it('adresse : parcelle la plus proche, ventes, DPE, sans aucune personne', async () => {
    const ctx = fakeContext([
      [/geocodage\/search/, { body: fixtureJson('location/geopf_search_belfort.json') }],
      [/cadastre\/parcelle\?geom=.*Point/, { body: { type: 'FeatureCollection', features: [] } }],
      [/cadastre\/parcelle\?geom=.*Polygon/, { body: fixtureJson('location/cadastre_box_carcassonne.json') }],
      [/apidf-preprod\.cerema\.fr\/dvf_opendata\/geomutations/, { body: fixtureJson('location/dvf_geomutations_carcassonne.json') }],
      [/data\.ademe\.fr\/.*dpe03existant\/lines/, { body: fixtureJson('location/dpe_belfort_carcassonne.json') }],
      dido
    ])
    const out = await immobilier.run(entity('address', '25 rue de Belfort 11000 Carcassonne'), ctx)
    expect(out.properties).toMatchObject({
      cadastral_parcel: '11069000AL0119',
      cadastral_section: 'AL',
      parcel_area_m2: 1060,
      dvf_sales_parcel: 4,
      dvf_source: 'API DVF+ open-data (Cerema)',
      dpe_count: 8,
      dpe_class: 'C',
      building_permits_count: 0
    })
    expect(out.properties?.dpe_records).toContain('2511E0687948D : C / GES A (2025-02-28, appartement, 46 m²)')
    const events = out.entities ?? []
    expect(events.length).toBeGreaterThan(0)
    expect(events.length).toBeLessThanOrEqual(10)
    expect(events.every((e) => e.type === 'event' && typeof e.data?.date === 'string')).toBe(true)
    expectNoPerson(out)
    // Le DPE est cherché par identifiant BAN, sans le complément d'adresse (noms d'occupants).
    const dpe = new URL(ctx.calls.find((c) => c.url.includes('dpe03existant'))!.url)
    expect(dpe.searchParams.get('identifiant_ban_eq')).toBe('11069_0550_00025')
    expect(dpe.searchParams.get('select')).not.toMatch(/complement/)
    // Sitadel : la parcelle (section à deux lettres, numéro sans zéros).
    const permits = new URL(ctx.calls.find((c) => c.url.includes('/dido/'))!.url)
    expect(permits.searchParams.get('SEC_CADASTRE1')).toBe('eq:AL')
    expect(permits.searchParams.get('NUM_CADASTRE1')).toBe('eq:119')
  })

  it('API DVF en panne : repli sur les fichiers geo-dvf de la commune', async () => {
    const year = new Date().getFullYear() - 2
    const ctx = fakeContext([
      [/geocodage\/reverse/, { body: { type: 'FeatureCollection', features: [] } }],
      [/cadastre\/parcelle/, { body: fixtureJson('location/cadastre_point_amiens.json') }],
      [/apidf-preprod\.cerema\.fr/, { status: 503, body: 'Service Unavailable' }],
      [new RegExp(`geo-dvf/latest/csv/${year}/communes/80/80021\\.csv`), { body: fixture('location/geodvf_amiens_2024.csv') }],
      [/geo-dvf\/latest\/csv/, { status: 404, body: 'not found' }],
      dido
    ])
    const out = await immobilier.run(entity('coordinates', '49.89335, 2.295'), ctx)
    expect(out.properties).toMatchObject({ cadastral_parcel: '80021000VD0067', parcel_area_m2: 3556, dvf_source: 'geo-dvf (Etalab)' })
    expect(Number(out.properties?.dvf_sales_nearby)).toBeGreaterThan(0)
    expect(out.entities?.some((e) => e.data?.place === '8 PL DE L HOTEL DE VILLE, 80000 Amiens')).toBe(true)
    // Coordonnées sans adresse BAN à moins de 30 m : pas de recherche de DPE.
    expect(ctx.calls.some((c) => c.url.includes('dpe03existant'))).toBe(false)
    expectNoPerson(out)
  })

  it('une source en panne est signalée sans faire échouer les autres', async () => {
    const ctx = fakeContext([
      [/geocodage\/reverse/, { body: { type: 'FeatureCollection', features: [] } }],
      [/cadastre\/parcelle/, { body: fixtureJson('location/cadastre_point_amiens.json') }],
      [/apidf-preprod\.cerema\.fr/, { status: 400, body: 'bad request' }],
      [/dido\//, { status: 500, body: 'erreur' }]
    ])
    const out = await immobilier.run(entity('coordinates', '49.8941, 2.2957'), ctx)
    expect(out.properties?.cadastral_parcel).toBe('80021000VD0067')
    expect((out.properties?.unavailable_sources as string[]).length).toBe(2)
  })

  it('hors de France : module non proposé ; adresse française inconnue : erreur explicite', async () => {
    const berlin = entity('address', 'Unter den Linden 1, Berlin', { data: { country: 'Allemagne' } })
    expect(immobilier.accepts?.(berlin)).toBe(false)
    expect(immobilier.accepts?.(entity('coordinates', '52.5163, 13.3777'))).toBe(false)
    expect(immobilier.accepts?.(entity('address', '25 rue de Belfort 11000 Carcassonne'))).toBe(true)
    expect(await immobilier.run(berlin, fakeContext([]))).toEqual({})
    const ctx = fakeContext([[/geocodage\/search/, { body: { type: 'FeatureCollection', features: [] } }]])
    await expect(immobilier.run(entity('address', '12 rue Imaginaire 75004 Paris'), ctx)).rejects.toThrow(/Base Adresse Nationale/)
  })
})

describe('company.sitadel (hors ligne)', () => {
  it('SIREN depuis la fiche, un SIRET ou le libellé', () => {
    expect(sirenOf('OPH Amiens', { siren: '315667410' })).toBe('315667410')
    expect(sirenOf('31566741000015', {})).toBe('315667410')
    expect(sirenOf('315 667 410', {})).toBe('315667410')
    expect(sirenOf('123456789', {})).toBeNull()
    expect(sirenOf('Danone', {})).toBeNull()
  })

  it('permis de l’entreprise, les plus récents d’abord, dans les quatre fichiers', async () => {
    const ctx = fakeContext([
      [/datafiles\/8b35affb/, { body: fixtureJson('location/sitadel_logements_oph.json') }],
      [/datafiles\/1a9a2f0c/, { body: fixtureJson('location/sitadel_demolition_oph.json') }],
      [/datafiles\/[^/]+\/rows/, { body: empty }]
    ])
    const out = await sitadel.run(entity('company', 'Office public de l’habitat', { data: { siren: '315667410' } }), ctx)
    expect(out.properties?.building_permits_count).toBe(89 + 34)
    const events = out.entities ?? []
    expect(events.length).toBeGreaterThan(3)
    expect(events.map((e) => e.data?.date)).toEqual([...events.map((e) => e.data?.date)].sort().reverse())
    expect(events[0]).toMatchObject({ type: 'event', linkLabel: 'demandeur du permis', data: { applicant_siren: '315667410', permit_type: 'Permis de démolir (démolition)' } })
    expect(ctx.calls).toHaveLength(4)
    for (const c of ctx.calls) {
      const u = new URL(c.url)
      expect(u.searchParams.get('SIREN_DEM')).toBe('eq:315667410')
      expect(u.searchParams.get('orderBy')).toBe('-DATE_REELLE_AUTORISATION')
    }
    expectNoPerson(out)
  })

  it('aucune autorisation : compteur à zéro', () => {
    expect(permitsOutput(fr, 0, [])).toEqual({ properties: { building_permits_count: 0 } })
  })
})

describe.skipIf(!LIVE)('lieux et immobilier : services réels', () => {
  it('location.entreprises_adresse : Hôtel de Ville de Paris', async (t) => {
    const out = await liveRun(t, () => runModule(entreprises, entity('coordinates', '48.856508, 2.352059')))
    if (!out) return
    expect(Number(out.properties?.domiciled_companies)).toBeGreaterThan(DOMICILIATION_THRESHOLD)
    expect(out.entities?.some((e) => e.label === 'VILLE DE PARIS')).toBe(true)
  })

  it('location.immobilier : parcelle VD 67 à Amiens', async (t) => {
    const out = await liveRun(t, () => runModule(immobilier, entity('coordinates', '49.8941, 2.2957')))
    if (!out) return
    expect(out.properties).toMatchObject({ cadastral_parcel: '80021000VD0067', parcel_area_m2: 3556 })
    expectNoPerson(out)
  })

  it('location.immobilier : DPE du 25 rue de Belfort à Carcassonne', async (t) => {
    const out = await liveRun(t, () => runModule(immobilier, entity('address', '25 rue de Belfort 11000 Carcassonne')))
    if (!out) return
    const records = (out.properties?.dpe_records as string[] | undefined) ?? [String(out.properties?.dpe_number)]
    expect(records.some((r) => r.startsWith('2511E0687948D : C'))).toBe(true)
    expect(Number(out.properties?.dvf_sales_parcel) + Number(out.properties?.dvf_sales_nearby)).toBeGreaterThan(0)
  })

  it('company.sitadel : OPH d’Amiens', async (t) => {
    const out = await liveRun(t, () => runModule(sitadel, entity('company', 'OPH Amiens', { data: { siren: '315667410' } })))
    if (!out) return
    expect(Number(out.properties?.building_permits_count)).toBeGreaterThanOrEqual(55)
  })
})
