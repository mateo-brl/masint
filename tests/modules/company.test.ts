import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { frenchVat, headcountLabel, legalFormLabel, luhnOk, nafLabel, normName, titleCase } from '../../src/main/modules/company/_fr'
import { chOutput, officerName } from '../../src/main/modules/company/companiesHouse'
import { parseOpenCorporates } from '../../src/main/modules/company/opencorporates'
import registry, { candidatesOutput, companyOutput, pickResult, searchQuery } from '../../src/main/modules/company/recherche'
import vies, { frenchKeyOk, parseVat, viesOutput } from '../../src/main/modules/company/vies'
import { entity, LIVE, runModule } from '../helpers/context'

const json = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/company', name), 'utf8'))
const fr = { lang: 'fr' as const }

describe('company : référentiels', () => {
  it('SIREN, TVA et libellés INSEE', () => {
    expect(luhnOk('552032534')).toBe(true)
    expect(frenchVat('552032534')).toBe('FR27552032534')
    expect(nafLabel('70.10Z')).toBe('Activités des sièges sociaux')
    expect(legalFormLabel('5710')).toBe('Société par actions simplifiée (SAS)')
    expect(legalFormLabel('5505')).toBe("SA à conseil d'administration")
    expect(headcountLabel('42', '2024')).toBe('1 000 à 1 999 salariés (2024)')
    expect(normName('Danone S.A.')).toBe('danone')
    expect(titleCase('BERNARD DE SAINT AFFRIQUE')).toBe('Bernard de Saint Affrique')
    expect(titleCase('JEAN-PIERRE')).toBe('Jean-Pierre')
  })
})

describe('company.fr_registry (hors ligne)', () => {
  const res = json('recherche_danone.json')

  it('reconnaît SIREN, SIRET et raison sociale', () => {
    expect(searchQuery('552 032 534', {})).toEqual({ q: '552032534', siren: '552032534' })
    expect(searchQuery('55203253400703', {})).toEqual({ q: '552032534', siren: '552032534' })
    expect(searchQuery('Danone', { siren: '552032534' }).siren).toBe('552032534')
    expect(searchQuery('Danone', {})).toEqual({ q: 'Danone', siren: null })
  })

  it('choisit le résultat exact ou renvoie les candidats', () => {
    expect(pickResult(res.results, 'Danone SA', null)?.siren).toBe('552032534')
    expect(pickResult(res.results, 'x', '672039971')?.nom_complet).toContain('DANONE PRODUITS FRAIS')
    expect(pickResult(res.results, 'Danon', null)).toBeNull()
    const c = candidatesOutput(fr, res.results)
    expect(c.entities).toHaveLength(4)
    expect(c.entities?.[0]).toMatchObject({ type: 'company', label: 'DANONE', data: { siren: '552032534' } })
    expect(c.properties).toBeUndefined()
  })

  it('produit identité, siège géolocalisé, TVA et dirigeants', () => {
    const out = companyOutput(fr, res.results[0])
    expect(out.properties).toMatchObject({
      name: 'DANONE',
      siren: '552032534',
      siret: '55203253400703',
      vat: 'FR27552032534',
      activity: '70.10Z Activités des sièges sociaux',
      created_at: '1955-01-01',
      status: 'active',
      employees: '1 000 à 1 999 salariés (2024)'
    })
    expect(String(out.properties?.revenue)).toMatch(/€ \(20\d\d\)$/)
    const addr = out.entities!.find((e) => e.type === 'address')!
    expect(addr.label).toBe('59-61 RUE LA FAYETTE 75009 PARIS')
    expect(addr.data?.lat).toBeCloseTo(48.876, 2)
    expect(addr.data?.postcode).toBe('75009')
    expect(out.entities!.find((e) => e.type === 'vat')?.label).toBe('FR27552032534')
    const ceo = out.entities!.find((e) => e.type === 'person')!
    expect(ceo.label).toBe('Antoine Bernard de Saint Affrique')
    expect(ceo.linkLabel).toBe('Directeur Général')
    expect(ceo.data?.birth_date).toBe('1964-12')
    const auditor = out.entities!.find((e) => e.type === 'company')!
    expect(auditor.linkLabel).toMatch(/Commissaire aux comptes/)
    expect(auditor.data?.siren).toMatch(/^\d{9}$/)
  })
})

describe('company.vies (hors ligne)', () => {
  it('analyse le numéro saisi', () => {
    expect(parseVat('FR 27 552 032 534')).toEqual({ country: 'FR', number: '27552032534' })
    expect(parseVat('GR123456789')?.country).toBe('EL')
    expect(parseVat('552032534')).toBeNull()
    expect(frenchKeyOk('27552032534')).toBe(true)
    expect(frenchKeyOk('28552032534')).toBe(false)
  })

  it('numéro valide : raison sociale et adresse', () => {
    const out = viesOutput(fr, json('vies_be_valid.json'))
    expect(out.properties).toMatchObject({ valid: true, country: 'Belgique', registered_name: 'SA ELECTRABEL' })
    expect(out.properties?.registered_address).toBe('Boulevard Simon Bolivar 36, 1000 Bruxelles')
    expect(out.entities?.map((e) => e.type)).toEqual(['company', 'address'])
    expect(out.entities?.[1].from).toBe('company')
  })

  it('numéro invalide et service saturé', () => {
    const out = viesOutput(fr, json('vies_be_invalid.json'))
    expect(out.properties?.valid).toBe(false)
    expect(out.entities).toHaveLength(0)
    expect(() => viesOutput(fr, json('vies_busy.json'))).toThrow(/saturé/)
  })
})

describe('company : services à clé (format documenté)', () => {
  it('OpenCorporates', () => {
    const out = parseOpenCorporates(fr, {
      results: {
        total_count: 1,
        companies: [{ company: { name: 'BARCLAYS BANK PLC', company_number: '01026167', jurisdiction_code: 'gb', incorporation_date: '1971-07-10', current_status: 'Active', opencorporates_url: 'https://opencorporates.com/companies/gb/01026167' } }]
      }
    })
    expect(out.entities?.[0]).toMatchObject({ type: 'company', label: 'BARCLAYS BANK PLC', data: { jurisdiction: 'GB', created_at: '1971-07-10' } })
  })

  it('Companies House', () => {
    expect(officerName('SMITH, John Andrew')).toBe('John Andrew Smith')
    const out = chOutput(
      fr,
      { company_name: 'EXAMPLE LTD', company_number: '01234567', company_status: 'active', registered_office_address: { address_line_1: '1 High Street', locality: 'London', postal_code: 'E1 1AA' } },
      { items: [{ name: 'SMITH, John', officer_role: 'director', appointed_on: '2020-01-01', date_of_birth: { month: 3, year: 1980 } }, { name: 'ACME SECRETARIES LIMITED', officer_role: 'corporate-secretary' }] }
    )
    expect(out.properties?.address).toBe('1 High Street, London, E1 1AA')
    expect(out.entities?.map((e) => e.type)).toEqual(['address', 'person', 'company'])
    expect(out.entities?.[1].data?.birth_date).toBe('1980-03')
  })
})

describe.skipIf(!LIVE)('company : services réels', () => {
  it('Recherche d’entreprises', async () => {
    const out = await runModule(registry, entity('company', '552032534'))
    expect(out.properties?.name).toBe('DANONE')
  })

  it('VIES', async () => {
    const out = await runModule(vies, entity('vat', 'BE0403170701'))
    expect(out.properties?.valid).toBe(true)
  })
})
