// Registres publics des entreprises : compléments de l'annuaire (labels, élus, établissements),
// GLEIF, BODACC et BALO, Journal officiel des associations, répertoire de la HATVP.

import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import { complementLabels, complementProperties, electedOfficials, establishmentEntities } from '../../src/main/modules/company/_complements'
import { rnaOf, sirenOf } from '../../src/main/modules/company/_ids'
import bodacc, { addressKey, announcementsOutput, baloCategory, describe as describeNotice, history, type CompanyBodaccRecord } from '../../src/main/modules/company/bodacc'
import gleif, { candidatesOutput as gleifCandidates, gleifOutput, isLei, type GleifRecord } from '../../src/main/modules/company/gleif'
import hatvpLobbying from '../../src/main/modules/company/hatvpLobbying'
import joAssociations, { annonceType, associationOutput, candidatesOutput as joaCandidates, type JoaRecord } from '../../src/main/modules/company/joAssociations'
import registry, { companyOutput, type ReResult } from '../../src/main/modules/company/recherche'
import { lobbyingOutput, parseAgora, resetHatvpCache } from '../../src/main/modules/person/_hatvp'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson } from './social_helpers'

const fr = { lang: 'fr' as const }
const company = (label: string, data = {}) => entity('company', label, { data })

const skippable = (e: unknown): boolean =>
  (e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || (e instanceof Error && /fetch failed/.test(e.message))

describe('identifiants de la fiche', () => {
  it('SIREN et RNA', () => {
    expect(sirenOf({ label: 'Danone', data: { siren: '552 032 534' } })).toBe('552032534')
    expect(sirenOf({ label: '55203253400703', data: {} })).toBe('552032534')
    expect(sirenOf({ label: 'Danone', data: {} })).toBeNull()
    expect(rnaOf({ label: 'w521000703', data: {} })).toBe('W521000703')
    expect(rnaOf({ label: 'Restos', data: { rna: 'W521000703' } })).toBe('W521000703')
  })
})

describe('company.fr_registry : compléments et établissements', () => {
  const danone = fixtureJson<{ results: ReResult[] }>('company/recherche_danone_etab.json').results[0]
  const paris = fixtureJson<{ results: ReResult[] }>('company/recherche_paris.json').results[0]

  it('labels et indicateurs présents', () => {
    expect(complementLabels(fr, danone.complements)).toEqual([
      'Établissement sanitaire ou social (FINESS)',
      'Index de l’égalité professionnelle déclaré (Egapro)'
    ])
    expect(complementProperties(fr, danone.complements)).toEqual({
      company_labels: ['Établissement sanitaire ou social (FINESS)', 'Index de l’égalité professionnelle déclaré (Egapro)'],
      finess_ids: ['750073173']
    })
  })

  it('élus d’une collectivité en propriété, fonction d’abord, sans date de naissance', () => {
    expect(electedOfficials(paris.complements)).toEqual(['Emmanuel Grégoire (Maire)'])
    const out = companyOutput(fr, paris)
    expect(out.properties).toMatchObject({ elected_officials: ['Emmanuel Grégoire (Maire)'], elected_officials_count: 1 })
    expect(JSON.stringify(out.properties)).not.toContain('1977')
  })

  it('établissements secondaires : entités adresse avec SIRET, sans le siège', () => {
    const list = establishmentEntities(fr, danone.matching_etablissements, danone.siege?.siret)
    expect(list.map((e) => e.data?.siret)).toEqual(['55203253400711', '55203253400679'])
    expect(list[0]).toMatchObject({ type: 'address', linkLabel: 'établissement', data: { city: 'GIF-SUR-YVETTE', country: 'France' } })
    const out = companyOutput(fr, danone)
    expect(out.entities?.filter((e) => e.linkLabel === 'établissement')).toHaveLength(2)
  })

  it('recherche par SIREN : seconde recherche par nom pour les établissements', async () => {
    const bySiren = { ...danone, matching_etablissements: [] }
    const ctx = fakeContext([
      [/q=552032534/, { body: { results: [bySiren], total_results: 1 } }],
      [/q=DANONE/, { body: { results: [danone], total_results: 1 } }]
    ])
    const out = await runModule(registry, company('552032534'), ctx)
    expect(out.entities?.filter((e) => e.linkLabel === 'établissement')).toHaveLength(2)
    expect(ctx.calls).toHaveLength(2)
  })
})

describe('company.gleif', () => {
  const danone = fixtureJson<{ data: GleifRecord[] }>('company/gleif_danone.json').data[0]
  const children = fixtureJson<{ data: GleifRecord[]; meta: { pagination: { total: number } } }>('company/gleif_children.json')

  it('contrôle le LEI', () => {
    expect(isLei('969500KMUQ2B6CBAF162')).toBe(true)
    expect(isLei('969500KMUQ2B6CBAF163')).toBe(false)
  })

  it('maison mère et filiales', () => {
    const out = gleifOutput(fr, danone, { directParent: null, ultimateParent: danone, children: children.data, childrenTotal: 27 })
    expect(out.properties).toMatchObject({ lei: '969500KMUQ2B6CBAF162', siren: '552032534', jurisdiction: 'FR', lei_status: 'ISSUED', lei_children_count: 27 })
    // La maison mère ultime est l'entreprise elle-même : aucun lien.
    expect(out.entities?.map((e) => e.linkLabel)).toEqual(['filiale', 'filiale'])
    expect(out.entities?.find((e) => e.label === 'DANONE PRODUITS FRAIS FRANCE')?.data).toMatchObject({ siren: '672039971' })
    const sub = gleifOutput(fr, children.data[0], { directParent: danone, ultimateParent: danone, children: [], childrenTotal: 0 })
    expect(sub.entities).toEqual([expect.objectContaining({ label: 'DANONE', linkLabel: 'société mère (directe et ultime)' })])
  })

  it('recherche par nom : à vérifier', () => {
    const out = gleifCandidates(fr, [danone, ...children.data], 'Danone S.A.')
    expect(out.entities).toHaveLength(1)
    expect(out.entities?.[0]).toMatchObject({ review: true, label: 'DANONE' })
  })

  it('module : SIREN, parent absent (404), filiales', async () => {
    const ctx = fakeContext([
      [/lei-records\?.*registeredAs/, { body: fixtureJson('company/gleif_danone.json') }],
      [/direct-parent/, { status: 404, body: { errors: [] } }],
      [/ultimate-parent/, { body: fixtureJson('company/gleif_parent.json') }],
      [/direct-children/, { body: fixtureJson('company/gleif_children.json') }]
    ])
    const out = await runModule(gleif, company('Danone', { siren: '552032534' }), ctx)
    expect(out.properties?.lei).toBe('969500KMUQ2B6CBAF162')
    expect(out.entities).toHaveLength(2)
  })
})

describe('company.bodacc', () => {
  const records = fixtureJson<{ results: CompanyBodaccRecord[] }>('company/bodacc_danone.json').results
  const casino = fixtureJson<{ results: CompanyBodaccRecord[] }>('company/bodacc_casino.json').results

  it('résume les annonces', () => {
    expect(describeNotice(records[0])).toEqual({ kind: 'Modifications diverses', detail: 'capital (augmentation)' })
    expect(describeNotice(records[1]).detail).toBe('Comptes consolidés et rapports, clôture 31/12/2025')
    expect(describeNotice(casino[0]).detail).toBe('Jugement d’ouverture d’une procédure de sauvegarde du 25/10/2023'.replace(/’/g, "'"))
    expect(addressKey('17 BD HAUSSMANN 75009 PARIS')).toBe(addressKey('17 boulevard Haussmann 75009 Paris'))
  })

  it('anciens dirigeants, anciennes adresses et procédures collectives', () => {
    const h = history(records)
    expect(h.formerOfficers).toEqual(['Faber, Emmanuel (Administrateur, départ publié en 05/2021)'])
    expect(h.formerAddresses).toEqual(['17 boulevard Haussmann 75009 Paris (publiée jusqu’en 08/2025)'])
    expect(history(casino).proceedings[0]).toMatch(/^10\/11\/2023 : Jugement d'ouverture/)
  })

  it('événements datés, les plus récents d’abord, et total', () => {
    const balo = fixtureJson<{ total_count: number; results: never[] }>('company/balo_danone.json')
    const out = announcementsOutput(fr, '552032534', { records, total: 107 }, { records: balo.results, total: balo.total_count })
    expect(out.properties).toMatchObject({ bodacc_announcements: 107, bodacc_last_date: '2026-09-02', balo_announcements: 125 })
    const events = out.entities!.filter((e) => e.type === 'event')
    expect(events[0]).toMatchObject({ label: 'BODACC 02/09/2026 : Modifications diverses (capital (augmentation))', data: { date: '2026-09-02' } })
    const baloEvent = events.find((e) => e.label.startsWith('BALO'))!
    expect(baloEvent.label).toBe('BALO 13/05/2026 : Comptes annuels (DANONE)')
    expect(baloEvent.data?.url).toBe('https://www.journal-officiel.gouv.fr/telechargements/BALO/pdf/2026/0513/202605132601520.pdf')
    expect(baloCategory({ id_annonce: 'x', facette_categorie_libelle: 'AVIS DE CONVOCATION/AVIS DE REUNION##' })).toBe('Avis de convocation/avis de reunion')
  })

  it('module : accepté seulement avec un SIREN, BALO facultatif', async () => {
    expect(bodacc.accepts!(company('Danone'))).toBe(false)
    const ctx = fakeContext([
      [/bodacc-datadila/, { body: fixtureJson('company/bodacc_danone.json') }],
      [/balo/, { status: 404 }]
    ])
    const out = await runModule(bodacc, company('Danone', { siren: '552032534' }), ctx)
    expect(out.properties?.bodacc_announcements).toBe(107)
    expect(out.properties?.balo_announcements).toBeUndefined()
    expect(ctx.calls[0].url).toContain(encodeURIComponent('registre like "552032534"').replace(/%20/g, '+'))
  })
})

describe('company.jo_associations', () => {
  const rna = fixtureJson<{ total_count: number; results: JoaRecord[] }>('company/joa_rna.json')
  const titre = fixtureJson<{ total_count: number; results: JoaRecord[] }>('company/joa_titre.json')

  it('fiche par RNA : comptes annuels datés, site, SIREN, anciens titres', () => {
    expect(annonceType(rna.results[0])).toBe('Comptes annuels')
    const out = associationOutput(fr, rna.results, rna.total_count)
    expect(out.properties).toMatchObject({ rna: 'W521000703', siren: '439687765', website: 'https://www.restosducoeur.org', jo_announcements: 14 })
    expect(out.properties?.previous_names).toContain('RESTAURANTS DU COEURS RELAIS DU COEUR HM')
    expect(out.entities?.[0]).toMatchObject({ type: 'event', label: 'JO Associations 21/10/2026 : Comptes annuels (clôture 30/04/2026)' })
    expect(out.entities?.some((e) => e.type === 'website')).toBe(true)
  })

  it('recherche par nom : associations de même titre à vérifier', () => {
    const out = joaCandidates(fr, titre.results, 'Restaurants du coeur', titre.total_count)
    expect(out.entities?.every((e) => e.review)).toBe(true)
  })

  it('entreprise acceptée seulement si c’est une association', () => {
    expect(joAssociations.accepts!(company('Danone', { siren: '552032534', legal_form: 'SA à conseil d’administration' }))).toBe(false)
    expect(joAssociations.accepts!(company('Restos 52', { siren: '439687765', legal_form: 'Association déclarée' }))).toBe(true)
    expect(joAssociations.accepts!(entity('organization', 'Restos du coeur'))).toBe(true)
  })

  it('module : SIREN puis RNA', async () => {
    const ctx = fakeContext([
      [/jo_associations\/records/, { body: fixtureJson('company/joa_rna.json') }],
      [/osop-entites/, { body: { total_count: 0, results: [] } }]
    ])
    const out = await runModule(joAssociations, entity('organization', 'Restos du coeur 52', { data: { siren: '439687765' } }), ctx)
    expect(out.properties?.rna).toBe('W521000703')
    expect(ctx.calls.some((c) => c.url.includes('W521000703'))).toBe(true)
  })
})

describe('company.hatvp_lobbying', () => {
  const list = parseAgora(JSON.parse(fixture('company/hatvp_agora.json')))

  it('lit le répertoire et résume le dernier exercice', () => {
    expect(list[0]).toMatchObject({ id: '123456782', category: 'Société commerciale', registeredAt: '2018-03-15', period: '01/01/2024 - 31/12/2024', staff: 2, activities: 1 })
    expect(list[0].topics).toEqual(['Numérique', 'Économie'])
  })

  it('SIREN identique : propriétés ; nom seul : à vérifier', () => {
    const direct = lobbyingOutput(fr, list, { label: 'Exemple Conseil SAS', data: { siren: '123456782' } })
    expect(direct.properties).toMatchObject({ hatvp_lobbyist: true, hatvp_lobbying_expenses: '>= 100 000 € et < 200 000 €' })
    const byName = lobbyingOutput(fr, list, { label: 'Exemple Conseil', data: {} })
    expect(byName.entities?.[0]).toMatchObject({ review: true })
    expect(lobbyingOutput(fr, list, { label: 'Autre', data: {} }).properties).toEqual({ hatvp_lobbyist: false })
  })

  it('module : page de maintenance signalée comme indisponibilité', async () => {
    resetHatvpCache()
    const ctx = fakeContext([[/agora_repertoire/, { status: 200, body: '<!DOCTYPE html><html>maintenance</html>' }]])
    await expect(runModule(hatvpLobbying, company('Danone', { siren: '552032534' }), ctx)).rejects.toMatchObject({ code: 'unavailable' })
  }, 15000)
})

describe.skipIf(!LIVE)('registres des entreprises (live)', () => {
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

  live('annuaire : élus de la Ville de Paris et établissements de Danone', async () => {
    const paris = await runModule(registry, company('217500016'), makeContext())
    expect(Number(paris.properties?.elected_officials_count)).toBeGreaterThan(100)
    const danone = await runModule(registry, company('552032534'), makeContext())
    expect(danone.properties?.company_labels).toBeTruthy()
    expect(danone.entities?.some((e) => e.linkLabel === 'établissement')).toBe(true)
  })

  live('GLEIF : LEI et filiales de Danone', async () => {
    const out = await runModule(gleif, company('Danone', { siren: '552032534' }), makeContext())
    expect(out.properties?.lei).toBe('969500KMUQ2B6CBAF162')
    expect(Number(out.properties?.lei_children_count)).toBeGreaterThan(20)
  })

  live('BODACC et BALO de Danone', async () => {
    const out = await runModule(bodacc, company('Danone', { siren: '552032534' }), makeContext())
    expect(Number(out.properties?.bodacc_announcements)).toBeGreaterThan(100)
    expect(out.entities?.some((e) => e.label.startsWith('BALO'))).toBe(true)
  })

  live('JO associations : RNA W521000703', async () => {
    const out = await runModule(joAssociations, entity('organization', 'W521000703'), makeContext())
    expect(out.properties?.siren).toBe('439687765')
  })

  live('HATVP : répertoire des représentants d’intérêts', async () => {
    resetHatvpCache()
    const out = await runModule(hatvpLobbying, company('Danone', { siren: '552032534' }), makeContext())
    expect(out.properties?.hatvp_lobbyist).toBe(true)
  }, 300000)
})
