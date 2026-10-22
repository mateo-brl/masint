// Véhicules : plaques néerlandaises et registre RDW. La fixture porte une plaque fictive ;
// aucune donnée sur le détenteur n'est demandée ni reprise.

import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError, type ModuleOutput } from '@shared/modules'
import { analyzePlate, dutchPlate } from '../../src/main/modules/misc/licensePlate'
import rdw, { acceptsPlate, brandCase, rdwDate } from '../../src/main/modules/vehicle/rdw'
import { entity, LIVE, runModule } from '../helpers/context'
import { fakeContext, fixtureJson } from './social_helpers'

async function liveRun(t: TestContext, run: () => Promise<ModuleOutput>): Promise<ModuleOutput | null> {
  try {
    return await run()
  } catch (e) {
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String((e as Error)?.message))) {
      t.skip()
      return null
    }
    throw e
  }
}

describe('plaques néerlandaises', () => {
  it('reconnaît les séries et met les tirets', () => {
    expect(dutchPlate('54-JSG-5')).toEqual({ kenteken: '54JSG5', formatted: '54-JSG-5', sidecode: 7 })
    expect(dutchPlate('54jsg5')).toMatchObject({ formatted: '54-JSG-5' })
    expect(dutchPlate('NL 54-JSG-5')?.kenteken).toBe('54JSG5')
    expect(dutchPlate('GB-12-34')).toMatchObject({ formatted: 'GB-12-34', sidecode: 1 })
    expect(dutchPlate('1-KBB-12')).toMatchObject({ formatted: '1-KBB-12', sidecode: 8 })
    expect(dutchPlate('ZZ-123-B')).toMatchObject({ formatted: 'ZZ-123-B', sidecode: 9 })
    // Voyelles absentes des séries récentes, formats étrangers refusés.
    expect(dutchPlate('12-ABE-3')).toBeNull()
    expect(dutchPlate('AB-123-CD')).toBeNull()
    expect(dutchPlate('1234 BCD')).toBeNull()
  })

  it('l’analyse de plaque propose les Pays-Bas', () => {
    const r = analyzePlate('54-JSG-5')
    expect(r.normalized).toBe('54-JSG-5')
    expect(r.matches[0]).toMatchObject({ country: 'NL', format: { fr: 'néerlandais (série 7)' } })
    // Les formats existants ne changent pas.
    expect(analyzePlate('AB-123-CD').matches.map((m) => m.country)).toEqual(['FR', 'IT'])
  })

  it('RDW seulement pour un format néerlandais plausible', () => {
    expect(acceptsPlate({ label: '54-JSG-5', data: {} })).toBe(true)
    expect(acceptsPlate({ label: '54-JSG-5', data: { country_code: 'NL' } })).toBe(true)
    expect(acceptsPlate({ label: 'AB-123-CD', data: {} })).toBe(false)
    // Plaque FNI qui a aussi la forme d'une série néerlandaise : seulement si les Pays-Bas sont possibles.
    expect(acceptsPlate({ label: '12-BB-75', data: { country_code: 'FR' } })).toBe(false)
    expect(acceptsPlate({ label: '12-BB-75', data: { country_code: 'FR', possible_countries: ['France', 'Pays-Bas'] } })).toBe(true)
    expect(rdw.accepts?.(entity('license_plate', '54-JSG-5'))).toBe(true)
  })

  it('outils', () => {
    expect(rdwDate('20090813')).toBe('2009-08-13')
    expect(rdwDate(undefined)).toBeNull()
    expect(brandCase('TOYOTA AYGO')).toBe('Toyota Aygo')
    expect(brandCase('BMW')).toBe('BMW')
    expect(brandCase('MERCEDES-BENZ')).toBe('Mercedes-Benz')
  })
})

describe('vehicle.rdw (hors ligne)', () => {
  const routes = (): Parameters<typeof fakeContext>[0] => [
    [/m9d7-ebf2\.json/, { body: fixtureJson('vehicle/rdw_vehicle.json') }],
    [/8ys7-d773\.json/, { body: fixtureJson('vehicle/rdw_fuel.json') }],
    [/t49b-isb7\.json/, { body: fixtureJson('vehicle/rdw_recall_status.json') }],
    [/j9yg-7rg9\.json/, { body: fixtureJson('vehicle/rdw_recalls.json') }],
    [/sgfe-77wx\.json/, { body: fixtureJson('vehicle/rdw_inspections.json') }]
  ]

  it('véhicule, contrôle technique et rappel, sans détenteur', async () => {
    const ctx = fakeContext(routes())
    const out = await rdw.run(entity('license_plate', '00-ZZZ-0'), ctx)
    expect(out.properties).toMatchObject({ normalized: '00-ZZZ-0', country: 'Pays-Bas', country_code: 'NL' })
    const vehicle = out.entities?.find((e) => e.type === 'vehicle')
    expect(vehicle).toMatchObject({
      label: 'Toyota Aygo (00-ZZZ-0)',
      linkLabel: 'véhicule immatriculé',
      data: {
        plate: '00-ZZZ-0',
        brand: 'Toyota',
        model: 'Aygo',
        color: 'vert',
        vehicle_kind: 'voiture particulière',
        first_registration_date: '2009-08-13',
        inspection_expiry_date: '2027-07-08',
        last_inspection_date: '2026-07-08',
        fuel: 'essence',
        euro_standard: 'EURO 4',
        open_recall: false
      }
    })
    const recall = out.entities?.find((e) => e.type === 'event')
    expect(recall).toMatchObject({
      label: 'Rappel constructeur MGP180561 (RDW)',
      from: vehicle?.ref,
      data: { date: '2018-12-19', recall_reference: 'MGP180561', recall_status: 'réparation signalée par le constructeur' }
    })
    expect(out.entities?.some((e) => e.type === 'person')).toBe(false)
    expect(JSON.stringify(out)).not.toMatch(/tenaamstelling\b|datum_tenaamstelling"|wam_verzekerd/)
    // Plaque envoyée sans tiret ; champs du détenteur jamais demandés.
    const first = new URL(ctx.calls[0].url)
    expect(first.searchParams.get('kenteken')).toBe('00ZZZ0')
    expect(first.searchParams.get('$select')).not.toMatch(/datum_tenaamstelling,|wam_verzekerd/)
    expect(new URL(ctx.calls.find((c) => c.url.includes('j9yg-7rg9'))!.url).searchParams.get('$where')).toBe("referentiecode_rdw in ('MGP180561')")
  })

  it('plaque inconnue : rien', async () => {
    const ctx = fakeContext([[/m9d7-ebf2\.json/, { body: [] }]])
    expect(await rdw.run(entity('license_plate', '00-ZZZ-0'), ctx)).toEqual({})
    expect(ctx.calls).toHaveLength(1)
  })
})

describe.skipIf(!LIVE)('vehicle.rdw : service réel', () => {
  it('54-JSG-5 : Toyota Aygo verte de 2009, un rappel', async (t) => {
    const out = await liveRun(t, () => runModule(rdw, entity('license_plate', '54-JSG-5')))
    if (!out) return
    expect(out.entities?.find((e) => e.type === 'vehicle')?.data).toMatchObject({ brand: 'Toyota', model: 'Aygo', color: 'vert', first_registration_date: '2009-08-13' })
    expect(out.entities?.some((e) => e.type === 'event' && e.data?.recall_reference === 'MGP180561')).toBe(true)
  })
})
