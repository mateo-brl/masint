// Registres publics français : API tabulaire de data.gouv.fr, répertoire des élus, Annuaire
// Santé (RPPS), annuaire des avocats, commande publique (DECP, BOAMP, TED), aides de minimis,
// Transparence Santé et installations classées. Les fixtures de professionnels de santé et
// d'avocats sont FICTIVES ; les autres viennent des services réels (entreprises, élus de premier
// plan, organismes publics).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectEntity, isRpps } from '@shared/detect'
import { ModuleError, type OsintModule } from '@shared/modules'
import {
  clearDatasetCache,
  companyName,
  datasetResources,
  euros,
  latestResourceId,
  mainResources,
  mapPool,
  sirenOf,
  siretOf,
  tabularQuery,
  upperVariants,
  withRetry,
  type DgResource
} from '../../src/main/modules/company/_datagouv'
import aides, { minimisOutput, type MinimisRecord } from '../../src/main/modules/company/aides'
import icpe, { icpeOutput, rubriques, type IcpeResponse } from '../../src/main/modules/company/icpe'
import { modules as marches, boampOutput, decpContracts, decpOutput, namesWinner, tedOutput, tedTitle, type BoampRecord, type DecpRow, type TedNotice } from '../../src/main/modules/company/marchesPublics'
import { modules as avocats, groupFirms, pickFirm, sameLawyer, type AvocatRow } from '../../src/main/modules/person/avocats'
import rneElus, { birthCheck, collectivity, groupIdentities, rneFiles, rneKind, rneOutput, type RneRow } from '../../src/main/modules/person/rneElus'
import rpps, { firstNameVariants, groupRpps, knownRpps, type RppsRow } from '../../src/main/modules/person/rpps'
import { modules as transparence, declarantsMatching, declarantsWhere, sameBeneficiary, totalsProperties } from '../../src/main/modules/person/transparenceSante'
import { splitName } from '../../src/main/modules/person/_name'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixtureJson, type Route } from './social_helpers'

const fx = <T = object>(name: string): T => fixtureJson<T>(`registres/${name}`)
const byId = (list: OsintModule[], id: string): OsintModule => list.find((m) => m.id === id)!
const TAB = /tabular-api\.data\.gouv\.fr\/api\/resources\/([^/]+)\/data/
const DATASET_404: Route = [/www\.data\.gouv\.fr\/api\/1\/datasets\//, { status: 404, body: { message: 'Not found' } }]
const EMPTY_PAGE = { data: [], links: { next: null }, meta: { page: 1, page_size: 50, total: 0 } }
const params = (url: string): URLSearchParams => new URL(url).searchParams

beforeEach(() => clearDatasetCache())
afterEach(() => vi.useRealTimers())

describe('API tabulaire de data.gouv.fr', () => {
  it('construit les filtres, le tri et la pagination', () => {
    expect(
      tabularQuery(
        [
          { column: "Nom de l'élu", op: 'in', value: ['GRÉGOIRE', 'GREGOIRE'] },
          { column: 'titulaire_id', op: 'greater', value: '479766842' }
        ],
        { page: 2, pageSize: 200, sort: { column: 'montant', desc: true } }
      )
    ).toEqual({ "Nom de l'élu__in": 'GRÉGOIRE,GREGOIRE', titulaire_id__greater: '479766842', montant__sort: 'desc', page: '2', page_size: '200' })
  })

  it('choisit le fichier analysé le plus récent', () => {
    const resources = fx<{ resources: DgResource[] }>('datagouv_avocats.json').resources
    expect(mainResources(resources)[0].id).toBe('b9ff8dd7-0ea9-4dad-82fc-421f21a969ff')
    // Fichier non analysé par l'API tabulaire : écarté.
    expect(mainResources([{ id: 'x', title: 'a.csv', type: 'main', last_modified: '2030-01-01', extras: {} }])).toEqual([])
  })

  it('variantes, montants et identifiants', () => {
    expect(upperVariants('Grégoire')).toEqual(['GRÉGOIRE', 'GREGOIRE'])
    expect(upperVariants('martin')).toEqual(['MARTIN'])
    expect(euros(292048833.33)).toBe('292 048 833,33 €')
    expect(euros(null)).toBeNull()
    expect(sirenOf('Capgemini', { siren: '479 766 842' })).toBe('479766842')
    expect(sirenOf('47976684200724', {})).toBe('479766842')
    expect(sirenOf('Capgemini', {})).toBeNull()
    expect(siretOf('AXIOMAUTO', { siret: '52788711100021' })).toBe('52788711100021')
    expect(siretOf('527887111', {})).toBeNull()
    expect(companyName('479766842', {})).toBeNull()
    expect(companyName('479766842', { name: 'CAPGEMINI TECHNOLOGY SERVICES' })).toBe('CAPGEMINI TECHNOLOGY SERVICES')
  })

  it('retente les coupures puis lève une erreur « indisponible »', async () => {
    vi.useFakeTimers()
    const ctx = makeContext()
    let calls = 0
    const run = withRetry(
      ctx,
      async () => {
        calls++
        throw new TypeError('fetch failed')
      },
      { service: 'Test', attempts: 3, delayMs: 10 }
    )
    const check = expect(run).rejects.toMatchObject({ code: 'unavailable' })
    await vi.runAllTimersAsync()
    await check
    expect(calls).toBe(3)
  })

  it('ne retente pas une erreur définitive', async () => {
    let calls = 0
    const err = Object.assign(new Error('HTTP 400'), { status: 400, body: '' })
    await expect(
      withRetry(
        makeContext(),
        async () => {
          calls++
          throw err
        },
        { service: 'Test' }
      )
    ).rejects.toBe(err)
    expect(calls).toBe(1)
  })

  it('met en cache le jeu de données et se rabat sur la ressource connue', async () => {
    const ctx = fakeContext([[/datasets\/annuaire-des-avocats-de-france\//, { body: fx('datagouv_avocats.json') }], DATASET_404])
    await datasetResources(ctx, 'annuaire-des-avocats-de-france')
    await datasetResources(ctx, 'annuaire-des-avocats-de-france')
    expect(ctx.calls).toHaveLength(1)
    expect(await latestResourceId(ctx, 'jeu-inconnu', () => true, 'connue')).toBe('connue')
  })

  it('exécute les appels par lots sans perdre les échecs', async () => {
    const out = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('raté')
      return n * 10
    })
    expect(out.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect((out[2] as PromiseFulfilledResult<number>).value).toBe(30)
  })
})

describe('détection du numéro RPPS', () => {
  it('reconnaît un RPPS valide sans le confondre avec un téléphone', () => {
    expect(isRpps('10999999997')).toBe(true)
    expect(isRpps('10999999998')).toBe(false)
    expect(isRpps('20999999997')).toBe(false)
    expect(detectEntity('10999999997')).toEqual({ type: 'id_document', value: '10999999997' })
    // Clé fausse : ce n'est pas un RPPS, le numéro reste un téléphone.
    expect(detectEntity('10999999998')?.type).toBe('phone')
    expect(detectEntity('+14155552671')?.type).toBe('phone')
    expect(detectEntity('14155552671')?.type).toBe('phone')
  })
})

describe('person.rne_elus', () => {
  const maires = fx<{ data: RneRow[] }>('rne_maires_gregoire.json').data
  const cm = fx<{ data: RneRow[] }>('rne_cm_gregoire.json').data
  const epci = fx<{ data: RneRow[] }>('rne_epci_gregoire.json').data
  const rows = [...maires.map((row) => ({ kind: 'mai' as const, row })), ...cm.map((row) => ({ kind: 'cm' as const, row })), ...epci.map((row) => ({ kind: 'epci' as const, row }))]

  it('reconnaît les douze fichiers du jeu de données', () => {
    expect(rneKind('elus-maires-mai.csv')).toBe('mai')
    expect(rneKind('elus-representants-Parlement-européen-rpe.csv')).toBe('rpe')
    expect(rneKind('notice.pdf')).toBeNull()
    const files = rneFiles(fx<{ resources: DgResource[] }>('datagouv_rne.json').resources)
    expect(files).toHaveLength(12)
    expect(files.find((f) => f.kind === 'mai')?.id).toBe('2876a346-d50c-4911-934e-19ee07b0e503')
  })

  it('décrit la collectivité de chaque mandat', () => {
    expect(collectivity('mai', maires[0])).toEqual({ label: 'Paris (commune, 75)', data: { kind: 'commune', citycode: '75056', department: 'Paris' } })
    expect(collectivity('epci', epci[0])).toMatchObject({ label: 'Metropole Du Grand Paris', data: { kind: 'EPCI', siren: '200054781' } })
    expect(collectivity('dep', {})?.label).toBe('Assemblée nationale')
  })

  it('regroupe les lignes par personne et dédoublonne « Maire »', () => {
    const ids = groupIdentities(rows)
    expect(ids).toHaveLength(2)
    const greg = ids.find((i) => i.birthDate === '1977-12-24')!
    expect(greg.mandates.map((m) => m.role)).toEqual(['Maire', 'Conseiller communautaire'])
    expect(birthCheck('1977-12-24', { year: 1977, month: 12, day: 24 })).toBe('same')
    expect(birthCheck('1977-12-24', { year: 1977, month: 12 })).toBe('compatible')
    expect(birthCheck('1977-12-24', { year: 1978 })).toBe('different')
    expect(birthCheck('1977-12-24', null)).toBe('unknown')
  })

  it('naissance identique : mandats dans la fiche, collectivités dans le graphe', () => {
    const out = rneOutput(groupIdentities(rows), { year: 1977, month: 12, day: 24 })
    expect(out.properties.elected_mandates).toEqual([
      'Maire · Paris (commune, 75) · depuis le 22/03/2026',
      'Conseiller communautaire · Metropole Du Grand Paris · depuis le 22/03/2026'
    ])
    expect(out.properties.socio_professional_category).toBe("Cadre administratif et commercial d'entreprise")
    expect(out.properties.rne_namesakes_excluded).toBe(1)
    expect(out.entities.map((e) => [e.type, e.label, e.linkLabel, e.review])).toEqual([
      ['administration', 'Paris (commune, 75)', 'mandat : Maire', undefined],
      ['administration', 'Metropole Du Grand Paris', 'mandat : Conseiller communautaire', undefined]
    ])
  })

  it('sans date de naissance : chaque homonyme est à vérifier', () => {
    const out = rneOutput(groupIdentities(rows), null)
    expect(out.properties).toEqual({ rne_namesakes_count: 2 })
    expect(out.entities.every((e) => e.review)).toBe(true)
    expect(out.entities[0].reviewReason).toContain('né(e) le 24/12/1977')
    const partial = rneOutput(groupIdentities(rows), { year: 1977, month: 12 })
    expect(partial.entities[0].reviewReason).toMatch(/^naissance compatible/)
    expect(partial.properties.rne_namesakes_excluded).toBe(1)
  })

  it('interroge les douze fichiers et signale ceux qui manquent', async () => {
    const answers: Record<string, object> = {
      '2876a346-d50c-4911-934e-19ee07b0e503': fx('rne_maires_gregoire.json'),
      'd5f400de-ae3f-4966-8cb6-a85c70c6c24a': fx('rne_cm_gregoire.json'),
      '41d95d7d-b172-4636-ac44-32656367cdc7': fx('rne_epci_gregoire.json')
    }
    const ctx = fakeContext([
      [/datasets\/repertoire-national-des-elus-1\//, { body: fx('datagouv_rne.json') }],
      [/b78f8945-509f-4609-a4a7-3048b8370479/, { status: 400, body: { errors: ['colonne inconnue'] } }],
      [TAB, (url) => ({ body: answers[TAB.exec(url)![1]] ?? EMPTY_PAGE })]
    ])
    const progress: number[] = []
    ctx.progress = (done) => void progress.push(done)
    const out = await runModule(rneElus, entity('person', 'Emmanuel Grégoire', { data: { birth_date: '1977-12-24' } }), ctx)
    expect(out.properties?.elected_mandates).toHaveLength(2)
    expect(out.properties?.rne_files_unavailable).toEqual(['Sénateur'])
    const q = params(ctx.calls.find((c) => c.url.includes('2876a346'))!.url)
    expect(q.get("Nom de l'élu__in")).toBe('GRÉGOIRE,GREGOIRE')
    expect(q.get("Prénom de l'élu__contains")).toBe('Emmanuel')
    expect(progress.at(-1)).toBe(11)
  })
})

describe('person.rpps (professionnels fictifs)', () => {
  const nom = fx<{ data: RppsRow[] }>('rpps_nom_fictif.json')
  const routes = (body: unknown): Route[] => [DATASET_404, [TAB, { body }]]

  it('regroupe les activités par numéro RPPS', () => {
    const people = groupRpps(nom.data)
    expect(people.map((p) => p.rpps)).toEqual(['10999999997', '10999999989'])
    expect(people[0].activities).toHaveLength(2)
    expect(people[0].specialties).toEqual(['Médecine générale'])
    expect(people[1].activities).toEqual([])
    expect(knownRpps('id_document', '109 9999 9997', {})).toBe('10999999997')
    expect(knownRpps('person', 'Camille Exemple', { rpps: '10999999997' })).toBe('10999999997')
    expect(knownRpps('person', '10999999997', {})).toBeNull()
    expect(firstNameVariants(splitName(entity('person', 'Jean Claude Dupont'))!)).toEqual(['JEAN', 'JEAN-CLAUDE', 'JEAN CLAUDE'])
  })

  it('par nom : les homonymes sont à vérifier', async () => {
    const ctx = fakeContext(routes(nom))
    const out = await runModule(rpps, entity('person', 'Camille Exemple'), ctx)
    expect(out.properties).toEqual({ rpps_namesakes_count: 2 })
    expect(out.entities?.map((e) => [e.type, e.label, e.review])).toEqual([
      ['id_document', '10999999997', true],
      ['id_document', '10999999989', true]
    ])
    expect(out.entities?.[0].reviewReason).toContain('Médecin, Médecine générale, exerce à CABINET MEDICAL FICTIF DES TILLEULS, Villefictive')
    const q = params(ctx.calls.at(-1)!.url)
    expect(q.get("Nom d'exercice__in")).toBe('EXEMPLE')
    expect(q.get("Prénom d'exercice__in")).toBe('CAMILLE')
  })

  it('par numéro RPPS : fiche exacte, lieux d’exercice dans le graphe', async () => {
    const ctx = fakeContext(routes(fx('rpps_numero_fictif.json')))
    const out = await runModule(rpps, entity('person', 'Camille Exemple', { data: { rpps: '10999999997' } }), ctx)
    expect(params(ctx.calls.at(-1)!.url).get('Identifiant PP__exact')).toBe('10999999997')
    expect(out.properties).toMatchObject({
      rpps: '10999999997',
      occupation: 'Médecin',
      medical_specialties: ['Médecine générale'],
      practice_modes: ['Libéral', 'Salarié'],
      practice_phones: ['0100000000', '0200000000', '0200000001'],
      practice_emails: ['accueil@cabinet-fictif.example']
    })
    expect(out.entities?.every((e) => !e.review)).toBe(true)
    const cabinet = out.entities?.find((e) => e.label === 'CABINET MEDICAL FICTIF DES TILLEULS')
    expect(cabinet).toMatchObject({ type: 'company', data: { siret: '99999999900018', siren: '999999999' } })
    const hospital = out.entities?.find((e) => e.label === 'CENTRE HOSPITALIER FICTIF')
    expect(hospital?.data).toMatchObject({ finess: '999000001', structure_phone: '0200000000' })
    expect(out.entities?.find((e) => e.type === 'address' && e.from === cabinet?.ref)?.label).toBe('12 Rue DES TILLEULS, 99000 Villefictive')
  })

  it('pièce d’identité RPPS : le titulaire devient une personne', async () => {
    expect(rpps.accepts?.(entity('id_document', 'AB123456'))).toBe(false)
    expect(rpps.accepts?.(entity('id_document', '10999999997'))).toBe(true)
    const out = await runModule(rpps, entity('id_document', '10999999997'), fakeContext(routes(fx('rpps_numero_fictif.json'))))
    expect(out.entities?.[0]).toMatchObject({ ref: 'holder', type: 'person', label: 'Camille Exemple', data: { rpps: '10999999997', occupation: 'Médecin' } })
    expect(out.entities?.filter((e) => e.type === 'company').every((e) => e.from === 'holder')).toBe(true)
    expect(out.properties).toMatchObject({ kind: 'RPPS', document_holder: 'Camille Exemple' })
  })
})

describe('annuaire des avocats (avocats fictifs)', () => {
  const person = byId(avocats, 'person.avocats')
  const firm = byId(avocats, 'company.avocats')
  const list = byId(avocats, 'company.avocats_liste')
  const routes = (body: unknown): Route[] => [DATASET_404, [TAB, { body }]]

  it('compare nom et prénoms', () => {
    const rows = fx<{ data: AvocatRow[] }>('avocats_nom_fictif.json').data
    const name = splitName(entity('person', 'Camille Exemple'))!
    expect(rows.map((r) => sameLawyer(r, name))).toEqual([true, true, false])
    expect(sameLawyer({ avNom: 'MARTIN', avPrenom: 'Didier G.' }, splitName(entity('person', 'Didier Martin'))!)).toBe(true)
  })

  it('personne : chaque homonyme est à vérifier, avec son barreau', async () => {
    const out = await runModule(person, entity('person', 'Camille Exemple'), fakeContext(routes(fx('avocats_nom_fictif.json'))))
    expect(out.properties).toEqual({ lawyer_namesakes_count: 2 })
    expect(out.entities?.[0]).toMatchObject({
      type: 'company',
      label: 'CABINET FICTIF AVOCATS',
      data: { siren: '999999997', siret: '99999999700014', lawyer_bar: 'Paris' },
      linkLabel: 'avocat, barreau de Paris',
      review: true
    })
    expect(out.entities?.[0].reviewReason).toContain('serment le 11/01/2012, spécialités : Droit pénal, Droit des affaires')
    expect(out.entities?.[1]).toMatchObject({ type: 'organization', label: 'Barreau de Lyon', review: true })
  })

  it('cabinet par SIREN : nombre d’avocats et barreaux', async () => {
    const ctx = fakeContext(routes(fx('avocats_cabinet_siren.json')))
    const out = await runModule(firm, entity('company', 'GIDE LOYRETTE NOUEL AARPI', { data: { siren: '784355505' } }), ctx)
    expect(params(ctx.calls.at(-1)!.url).get('cbSiretSiren__contains')).toBe('784355505')
    expect(out.properties).toEqual({ lawyers_count: 3, lawyer_bars: ['Paris (2)', 'Lyon (1)'], lawyer_specialties: ['Droit fiscal', 'Droit des sociétés'] })
    expect(out.entities).toBeUndefined()
  })

  it('cabinet par nom : raison sociale identique, sinon candidats à vérifier', async () => {
    const body = fx('avocats_cabinet_nom.json')
    const exact = await runModule(firm, entity('company', 'Gide Loyrette Nouel AARPI'), fakeContext(routes(body)))
    expect(exact.properties?.lawyers_count).toBe(3)
    const vague = await runModule(firm, entity('company', 'Gide'), fakeContext(routes(body)))
    expect(vague.entities?.map((e) => [e.label, e.data?.lawyers_count, e.review])).toEqual([
      ['GIDE LOYRETTE NOUEL AARPI', 3, true],
      ['GIDE FICTIF CONSEIL', 1, true]
    ])
    const firms = groupFirms(fx<{ data: AvocatRow[] }>('avocats_cabinet_nom.json').data)
    expect(pickFirm(firms, 'GIDE LOYRETTE NOUEL AARPI')?.siren).toBe('784355505')
    expect(pickFirm(firms, 'Gide')).toBeNull()
  })

  it('liste à la demande : avocats du cabinet à vérifier', async () => {
    expect(list.ondemand).toBe(true)
    const out = await runModule(list, entity('company', '784355505'), fakeContext(routes(fx('avocats_cabinet_siren.json'))))
    expect(out.entities?.map((e) => [e.type, e.label, e.review])).toEqual([
      ['person', 'Alix Exemple', true],
      ['person', 'Dominique Fictif', true],
      ['person', 'Sacha Imaginaire', true]
    ])
    expect(out.entities?.[0].data).toMatchObject({ occupation: 'Avocat', lawyer_bar: 'Paris', oath_date: '2005-01-10', lawyer_languages: ['Anglais'] })
  })
})

describe('commande publique', () => {
  const decp = byId(marches, 'company.marches_publics')
  const ted = byId(marches, 'company.ted')
  const rows = fx<{ data: DecpRow[] }>('decp_capgemini.json').data

  it('DECP : marchés actuels sans doublons, montant cumulé, acheteurs', () => {
    const contracts = decpContracts(rows, '479766842')
    expect(contracts).toHaveLength(10)
    const out = decpOutput(contracts, 10, true, 'fr')
    expect(out.properties).toEqual({
      public_contracts_count: 10,
      public_contracts_amount: '292 048 833,33 €',
      public_contracts_first_date: '2026-03-17',
      public_contracts_last_date: '2026-08-20'
    })
    const events = out.entities.filter((e) => e.type === 'event')
    expect(events).toHaveLength(10)
    expect(events[0]).toMatchObject({ label: expect.stringContaining('(COMMUNE DE BRUNOY (MAIRIE)) : SECURITE DES SYSTEMES D INFORMATION'), data: { date: '2026-08-05', amount: '150 000 000 €' } })
    const buyers = out.entities.filter((e) => e.type === 'administration')
    expect(buyers).toHaveLength(10)
    expect(buyers[0]).toMatchObject({ label: 'COMMUNE DE BRUNOY (MAIRIE)', data: { siret: '21910114400018', siren: '219101144' }, linkLabel: 'client public : 1 marché, 150 000 000 €' })
    expect(buyers[0].data?.lat).toBeTypeOf('number')
    expect(out.links[0]).toEqual({ from: 'buyer0', to: 'contract0', label: 'acheteur' })
  })

  it('DECP : résultat partiel signalé', () => {
    const out = decpOutput(decpContracts(rows, '479766842'), 406, false, 'fr')
    expect(out.properties.public_contracts_count).toBe(406)
    expect(out.properties.public_contracts_scope).toBe('montant calculé sur les 10 marchés les plus récents')
  })

  it('DECP : requête par intervalle de SIRET', async () => {
    expect(decp.accepts?.(entity('company', 'Capgemini'))).toBe(false)
    const ctx = fakeContext([DATASET_404, [TAB, { body: fx('decp_capgemini.json') }]])
    const out = await runModule(decp, entity('company', 'CAPGEMINI TECHNOLOGY SERVICES', { data: { siren: '479766842' } }), ctx)
    const q = params(ctx.calls.at(-1)!.url)
    expect(ctx.calls.at(-1)!.url).toContain('/22847056-61df-452d-837d-8b8ceadbfc52/')
    expect([q.get('titulaire_id__greater'), q.get('titulaire_id__less'), q.get('donneesActuelles__exact')]).toEqual(['479766842', '47976684299999', 'true'])
    expect(out.properties?.public_contracts_count).toBe(10)
  })

  it('TED : titre, SIREN du lauréat et avis à vérifier', async () => {
    expect(tedTitle('France – Services de maintenance – Tierce maintenance applicative')).toBe('Tierce maintenance applicative')
    expect(namesWinner(['Capgemini Technology Services SAS'], 'CAPGEMINI TECHNOLOGY SERVICES')).toBe('same')
    expect(namesWinner(['CAPGEMINI CONSULTING'], 'CAPGEMINI')).toBe('contains')
    expect(namesWinner(['SOPRA STERIA'], 'CAPGEMINI')).toBeNull()
    const res = fx<{ notices: TedNotice[]; totalNoticeCount: number }>('ted_capgemini.json')
    const out = tedOutput(res.notices, res.totalNoticeCount, '479766842', 'fr')
    expect(out.properties).toEqual({ ted_notices_count: 76 })
    expect(out.entities[0]).toMatchObject({ data: { date: '2026-09-17', amount: '38 000 000 €', contract_buyer_country: 'FRA' } })
    expect(out.entities[0].review).toBeUndefined()
    expect(out.entities[1]).toMatchObject({ review: true })
    const ctx = fakeContext([[/api\.ted\.europa\.eu/, { body: res }]])
    const run = await runModule(ted, entity('company', 'CAPGEMINI TECHNOLOGY SERVICES', { data: { siren: '479766842' } }), ctx)
    expect(JSON.parse(ctx.calls[0].body!).query).toBe('winner-name ~ "CAPGEMINI TECHNOLOGY SERVICES" SORT BY publication-date DESC')
    expect(run.entities).toHaveLength(2)
  })
})

describe('company.icpe', () => {
  const res = fx<IcpeResponse>('icpe_axiomauto.json')

  it('site placé sur la carte avec régime, inspections et documents', () => {
    const out = icpeOutput(res.data!, 'fr')
    expect(out.properties).toEqual({ icpe_sites_count: 1 })
    expect(out.entities[0]).toMatchObject({
      type: 'place',
      label: 'Site ICPE 0003801058 : AXIOMAUTO (Amiens)',
      data: {
        lat: 49.931198,
        lon: 2.277484,
        icpe_regime: 'Enregistrement',
        seveso_status: 'Non Seveso',
        icpe_activity_status: 'En exploitation avec titre',
        last_inspection_date: '2025-04-11',
        inspections_count: 1,
        url: 'https://www.georisques.gouv.fr/risques/installations/donnees/details/0003801058'
      }
    })
    expect(out.entities[0].data?.inspection_reports).toEqual(['2025-04-11 : https://www.georisques.gouv.fr/webappReport/ws/installations/inspection/kn4b6bDaz62ekH7JDW1QexX3Agdbwdhq'])
    expect(rubriques(res.data![0])[0]).toBe('2712 Stockage, dépollution, démontage,… de VHU (Enregistrement, 27 265 m2)')
  })

  it('n’accepte qu’un SIRET et ignore les sites d’un autre SIRET', async () => {
    expect(icpe.accepts?.(entity('company', '527887111'))).toBe(false)
    const other = { ...res, data: [{ ...res.data![0], siret: '11111111111111' }] }
    const ctx = fakeContext([[/georisques\.gouv\.fr/, { body: other }]])
    const out = await runModule(icpe, entity('company', 'AXIOMAUTO', { data: { siret: '52788711100021' } }), ctx)
    expect(out.entities).toBeUndefined()
    expect(params(ctx.calls[0].url).get('siret')).toBe('52788711100021')
  })
})

describe('Transparence Santé (professionnel fictif)', () => {
  const person = byId(transparence, 'person.transparence_sante')
  const company = byId(transparence, 'company.transparence_sante')
  const TS = /transparence\.sante\.gouv\.fr/

  it('totaux par nature de lien', () => {
    expect(totalsProperties(fx<{ results: never[] }>('transparence_totaux_fictif.json').results)).toEqual({
      industry_declarations_count: 19,
      industry_payments_total: '8 534,5 €',
      industry_agreements_count: 5,
      industry_benefits_total: '1 534,5 €',
      industry_fees_total: '3 000 €',
      industry_last_date: '2026-02-01'
    })
    expect(sameBeneficiary({ identite: 'EXEMPLE', prenom: 'Camille' }, splitName(entity('person', 'Camille Exemple'))!)).toBe(true)
    expect(sameBeneficiary({ identite: 'EXEMPLE', prenom: 'Camille-Anne' }, splitName(entity('person', 'Camille Exemple'))!)).toBe(false)
  })

  it('avec le RPPS : totaux dans la fiche, payeurs à vérifier', async () => {
    const ctx = fakeContext([
      [TS, (url) => ({ body: params(url).get('group_by') === 'lien_interet' ? fx('transparence_totaux_fictif.json') : fx('transparence_payeurs_fictif.json') })]
    ])
    const out = await runModule(person, entity('id_document', '10999999997'), ctx)
    expect(ctx.calls.every((c) => params(c.url).get('where') === 'beneficiaire_identifiant = "10999999997"')).toBe(true)
    expect(out.properties?.industry_payments_total).toBe('8 534,5 €')
    expect(out.entities?.map((e) => [e.type, e.label, e.data?.siren, e.review])).toEqual([
      ['company', 'LABORATOIRE FICTIF SA', '999999993', true],
      ['company', 'PHARMA IMAGINAIRE', undefined, true]
    ])
    expect(out.entities?.[0].linkLabel).toBe('versements déclarés : 5 200 € (9 déclarations)')
  })

  it('avec le seul nom : numéros RPPS des homonymes à vérifier', async () => {
    const ctx = fakeContext([[TS, { body: fx('transparence_noms_fictif.json') }]])
    const out = await runModule(person, entity('person', 'Camille Exemple'), ctx)
    expect(params(ctx.calls[0].url).get('where')).toBe('search(identite, "Exemple") and search(prenom, "Camille")')
    expect(out.properties).toEqual({ industry_namesakes_count: 2 })
    expect(out.entities?.map((e) => [e.type, e.label, e.review])).toEqual([
      ['id_document', '10999999997', true],
      ['id_document', '10999999989', true]
    ])
    expect(out.entities?.[0].reviewReason).toContain('Médecin, 8 534,5 € déclarés')
  })

  it('laboratoire : propriétés seulement, sans nœud de personne', async () => {
    const ctx = fakeContext([
      [
        TS,
        (url) => {
          const q = params(url)
          if (q.get('group_by') === 'lien_interet') return { body: fx('transparence_totaux_fictif.json') }
          return { body: { total_count: 1, results: [{ beneficiaries: 7 }] } }
        }
      ]
    ])
    const out = await runModule(company, entity('company', 'LABORATOIRE FICTIF SA', { data: { siren: '999999993' } }), ctx)
    expect(ctx.calls).toHaveLength(2)
    expect(params(ctx.calls[0].url).get('where')).toBe('numero_siren = "999999993"')
    expect(out.properties).toMatchObject({ industry_declarations_count: 19, industry_beneficiaries_count: 7 })
    expect(out.entities).toBeUndefined()
  })

  it('laboratoire par nom : seules les entités dont le nom commence ainsi', async () => {
    const found = {
      results: [
        { raison_sociale: 'LABORATOIRE FICTIF SA', numero_siren: '999999993', n: 12 },
        { raison_sociale: 'LABORATOIRE FICTIF RECHERCHE', numero_siren: 'NULL', n: 3 },
        { raison_sociale: 'AUTRE LABORATOIRE FICTIF', numero_siren: '999999985', n: 40 }
      ]
    }
    expect(declarantsMatching(found.results, 'Laboratoire Fictif').map((p) => p.raison_sociale)).toEqual(['LABORATOIRE FICTIF SA', 'LABORATOIRE FICTIF RECHERCHE'])
    expect(declarantsWhere(declarantsMatching(found.results, 'Laboratoire Fictif'))).toBe('numero_siren = "999999993" or raison_sociale = "LABORATOIRE FICTIF RECHERCHE"')
    const ctx = fakeContext([
      [
        TS,
        (url) => {
          const q = params(url)
          if (q.get('group_by') === 'raison_sociale, numero_siren') return { body: found }
          if (q.get('group_by') === 'lien_interet') return { body: fx('transparence_totaux_fictif.json') }
          return { body: { results: [{ beneficiaries: 4 }] } }
        }
      ]
    ])
    const out = await runModule(company, entity('company', 'Laboratoire Fictif'), ctx)
    expect(out.properties?.industry_declarant_entities).toEqual(['LABORATOIRE FICTIF SA (999999993)', 'LABORATOIRE FICTIF RECHERCHE'])
    expect(params(ctx.calls[1].url).get('where')).toBe('numero_siren = "999999993" or raison_sociale = "LABORATOIRE FICTIF RECHERCHE"')
    const none = fakeContext([[TS, { body: { results: [{ raison_sociale: 'CABINET ORANGE SANTE', numero_siren: '999999977', n: 1 }] } }]])
    expect(await runModule(company, entity('company', 'Orange'), none)).toEqual({ raw: { total: 0 } })
  })
})

describe.skipIf(!LIVE)('registres publics : services réels', () => {
  /** Les hôtes de l'État coupent parfois la connexion depuis un bac à sable : le test est alors ignoré. */
  const live = async (t: { skip: (note?: string) => void }, run: () => Promise<void>): Promise<void> => {
    try {
      await run()
    } catch (e) {
      if (e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) return t.skip(e.message)
      if (e instanceof Error && /fetch failed/.test(e.message)) return t.skip(e.message)
      throw e
    }
  }

  it('répertoire des élus : Emmanuel Grégoire, maire de Paris', async (t) => {
    await live(t, async () => {
      const out = await runModule(rneElus, entity('person', 'Emmanuel Grégoire', { data: { birth_date: '1977-12-24' } }))
      expect(out.properties?.elected_mandates).toContain('Maire · Paris (commune, 75) · depuis le 22/03/2026')
    })
  }, 300000)

  it('Annuaire Santé : colonnes valides (nom fictif, aucun résultat)', async (t) => {
    await live(t, async () => {
      const out = await runModule(rpps, entity('person', 'Zorglub Fictivus'))
      expect(out.entities ?? []).toEqual([])
    })
  }, 300000)

  it('avocats : Gide Loyrette Nouel par SIREN', async (t) => {
    await live(t, async () => {
      const out = await runModule(byId(avocats, 'company.avocats'), entity('company', 'GIDE LOYRETTE NOUEL AARPI', { data: { siren: '784355505' } }))
      expect(Number(out.properties?.lawyers_count)).toBeGreaterThan(50)
    })
  }, 300000)

  it('avocats : colonnes valides (nom fictif, aucun résultat)', async (t) => {
    await live(t, async () => {
      const out = await runModule(byId(avocats, 'person.avocats'), entity('person', 'Zorglub Fictivus'))
      expect(out.entities ?? []).toEqual([])
    })
  }, 300000)

  it('DECP : Capgemini Technology Services', async (t) => {
    await live(t, async () => {
      const out = await runModule(byId(marches, 'company.marches_publics'), entity('company', 'CAPGEMINI TECHNOLOGY SERVICES', { data: { siren: '479766842' } }))
      expect(Number(out.properties?.public_contracts_count)).toBeGreaterThan(300)
    })
  }, 400000)

  it('BOAMP : avis d’attribution de Capgemini', async (t) => {
    await live(t, async () => {
      const out = await runModule(byId(marches, 'company.boamp'), entity('company', 'CAPGEMINI'))
      expect(Number(out.properties?.boamp_awards_count)).toBeGreaterThan(100)
      expect(out.entities?.every((e) => e.review)).toBe(true)
    })
  }, 120000)

  it('TED : lauréat identifié par son SIREN', async (t) => {
    await live(t, async () => {
      const out = await runModule(byId(marches, 'company.ted'), entity('company', 'CAPGEMINI TECHNOLOGY SERVICES', { data: { siren: '479766842' } }))
      expect(Number(out.properties?.ted_notices_count)).toBeGreaterThan(10)
      expect(out.entities?.some((e) => !e.review)).toBe(true)
    })
  }, 120000)

  it('Transparence Santé : déclarations de Sanofi', async (t) => {
    await live(t, async () => {
      const out = await runModule(byId(transparence, 'company.transparence_sante'), entity('company', 'sanofi'))
      expect(Number(out.properties?.industry_declarations_count)).toBeGreaterThan(100000)
      expect(out.entities).toBeUndefined()
    })
  }, 300000)

  it('Transparence Santé : nom fictif, aucun bénéficiaire', async (t) => {
    await live(t, async () => {
      const out = await runModule(byId(transparence, 'person.transparence_sante'), entity('person', 'Zorglub Fictivus'))
      expect(out.entities ?? []).toEqual([])
    })
  }, 300000)

  it('Géorisques : AXIOMAUTO à Amiens', async (t) => {
    await live(t, async () => {
      const out = await runModule(icpe, entity('company', '52788711100021'))
      expect(out.entities?.[0]).toMatchObject({ type: 'place', data: { lat: expect.any(Number), lon: expect.any(Number) } })
    })
  }, 120000)
})
