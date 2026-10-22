// Listes noires de l'AMF : lecture du fichier, appariement et repli sur l'API tabulaire.

import { beforeEach, describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import amf, { amfOutput, categoryLabel, matchAmf, parseCsv, parseValue, resetAmfCache } from '../../src/main/modules/finance/amf'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, type Route } from './social_helpers'

const fr = { lang: 'fr' as const }
const entries = () => parseCsv(fixture('finance/amf_listes_noires.csv'))

const routes: Route[] = [
  [/datasets\/listes-noires/, { body: { resources: [{ id: 'd2d9df6d-1cd2-41a8-96f5-684cb3057ecb', title: 'listes-noires', format: 'csv', url: 'https://object-api.infra.data.gouv.fr/amf/LISTES_NOIRES/export.csv' }] } }],
  [/object-api\.infra\.data\.gouv\.fr/, { body: fixture('finance/amf_listes_noires.csv') }]
]

describe('finance.amf_blacklist', () => {
  beforeEach(() => resetAmfCache())

  it('analyse les valeurs publiées', () => {
    expect(parseValue('www.uniglobemarkets.com/?lang=fr / Uniglobe Markets Ltd')).toEqual({
      hosts: ['uniglobemarkets.com'],
      emails: [],
      mailDomains: [],
      names: ['Uniglobe Markets Ltd']
    })
    expect(parseValue('prénom.nom@paris-majeste.com').mailDomains).toEqual(['paris-majeste.com'])
    expect(parseValue('complaints@crypto-amf.com').emails).toEqual(['complaints@crypto-amf.com'])
    expect(categoryLabel('Produits_dérivés_sur_crypto-actifs')).toBe('Produits dérivés sur crypto-actifs')
    expect(entries()).toHaveLength(5)
  })

  it('site, adresse et domaine de messagerie identiques : inscription relevée', () => {
    const site = amfOutput(fr, matchAmf(entries(), entity('website', 'https://www.cryptobullbear.com/')))
    expect(site.properties).toMatchObject({ amf_blacklisted: true, amf_categories: ['Crypto-actifs'], amf_listing_date: '2026-09-10', amf_match: ['site identique'] })
    const mail = amfOutput(fr, matchAmf(entries(), entity('email', 'contact@paris-majeste.com')))
    expect(mail.properties).toMatchObject({ amf_blacklisted: true, amf_match: ['domaine de messagerie inscrit'] })
    expect(amfOutput(fr, matchAmf(entries(), entity('email', 'complaints@crypto-amf.com'))).properties?.amf_match).toEqual(['adresse identique'])
    expect(amfOutput(fr, matchAmf(entries(), entity('domain', 'danone.com'))).properties).toEqual({ amf_blacklisted: false })
  })

  it('nom proche : à vérifier', () => {
    const out = amfOutput(fr, matchAmf(entries(), entity('company', 'Kuvera LLC')))
    expect(out.properties).toEqual({ amf_possible_matches: 1 })
    expect(out.entities?.[0]).toMatchObject({ type: 'organization', review: true })
    expect(out.entities?.[0].reviewReason).toMatch(/09\/04\/2019/)
    const site = amfOutput(fr, matchAmf(entries(), entity('company', 'Uniglobe Markets')))
    expect(site.entities?.[0]).toMatchObject({ type: 'domain', label: 'uniglobemarkets.com', review: true })
  })

  it('module : ressource retrouvée par le jeu de données, fichier gardé en cache', async () => {
    const ctx = fakeContext(routes)
    await runModule(amf, entity('domain', 'cryptobullbear.com'), ctx)
    const out = await runModule(amf, entity('domain', 'cryptobullbear.com'), ctx)
    expect(out.properties?.amf_blacklisted).toBe(true)
    expect(ctx.calls).toHaveLength(2)
  })

  it('module : repli sur l’API tabulaire si le fichier est injoignable', async () => {
    const ctx = fakeContext([
      [/datasets\/listes-noires/, { status: 404 }],
      [/datasets\/r\//, { status: 404 }],
      [/tabular-api/, { body: { data: [{ nom: 'cryptobullbear.com', categorie: 'Crypto-actifs', date_inscription: '2026-09-10' }] } }]
    ])
    const out = await runModule(amf, entity('domain', 'cryptobullbear.com'), ctx)
    expect(out.properties?.amf_blacklisted).toBe(true)
    expect(ctx.calls.some((c) => c.url.includes('nom__contains=cryptobullbear.com'))).toBe(true)
  })
})

describe.skipIf(!LIVE)('finance.amf_blacklist (live)', () => {
  it('cryptobullbear.com figure sur la liste noire', async (t) => {
    resetAmfCache()
    try {
      const out = await runModule(amf, entity('domain', 'cryptobullbear.com'), makeContext())
      expect(out.properties?.amf_blacklisted).toBe(true)
    } catch (e) {
      if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || (e instanceof Error && /fetch failed/.test(e.message))) t.skip()
      throw e
    }
  }, 120000)
})
