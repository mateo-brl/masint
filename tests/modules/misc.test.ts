import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import plate, { analyzePlate, ukPeriod } from '../../src/main/modules/misc/licensePlate'
import mac, { macOutput, parseMac } from '../../src/main/modules/misc/macVendor'
import ua, { parseUserAgent } from '../../src/main/modules/misc/userAgent'
import { entity, LIVE, runModule } from '../helpers/context'

const json = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/misc', name), 'utf8'))
const fr = { lang: 'fr' as const }

describe('misc.mac_vendor', () => {
  it('normalise et repère les adresses locales', () => {
    expect(parseMac('fc-fb-fb-01-fa-21')).toEqual({ mac: 'FC:FB:FB:01:FA:21', oui: 'FC:FB:FB', local: false, multicast: false })
    expect(parseMac('DA:A1:19:00:00:01')?.local).toBe(true)
    expect(parseMac('nope')).toBeNull()
  })

  it('constructeur trouvé', () => {
    const out = macOutput(fr, parseMac('FC:FB:FB:01:FA:21')!, json('macvendorlookup_cisco.json')[0])
    expect(out.properties).toMatchObject({ vendor: 'Cisco Systems, Inc', vendor_country: 'États-Unis', oui_block: 'MA-L', locally_administered: false })
    expect(out.entities?.[0]).toMatchObject({ type: 'organization', label: 'Cisco Systems, Inc' })
  })

  it('adresse aléatoire : pas de requête', async () => {
    const out = await runModule(mac, entity('mac_address', 'DA:A1:19:12:34:56'))
    expect(out.properties?.locally_administered).toBe(true)
    expect(out.entities).toHaveLength(0)
  })
})

describe('misc.user_agent', () => {
  it('Chrome sur Windows', () => {
    const i = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')
    expect(i).toMatchObject({ browser: 'Chrome', browserVersion: '141.0.0.0', engine: 'Blink', os: 'Windows', osVersion: '10 / 11', deviceType: 'desktop' })
  })

  it('Safari sur iPhone et navigateur Instagram', () => {
    const i = parseUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 323.0.3.23.54 (iPhone15,3; iOS 17_4_1; fr_FR; fr; scale=3.00; 1290x2796; 577210397)'
    )
    expect(i).toMatchObject({ os: 'iOS', osVersion: '17.4.1', deviceType: 'mobile', deviceModel: 'iPhone', app: 'Instagram', engine: 'WebKit' })
  })

  it('Samsung Internet sur Android : modèle et appareil', async () => {
    const s = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'
    const out = await runModule(ua, entity('user_agent', s))
    expect(out.properties).toMatchObject({ browser: 'Samsung Internet', os: 'Android', os_version: '13', device_type: 'mobile', device_model: 'SM-S918B', device_vendor: 'Samsung' })
    expect(out.entities?.[0]).toMatchObject({ type: 'device', label: 'Samsung SM-S918B' })
  })

  it('Firefox, Edge, robots et outils', () => {
    expect(parseUserAgent('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toMatchObject({ browser: 'Firefox', engine: 'Gecko', os: 'Ubuntu' })
    expect(parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68')).toMatchObject({ browser: 'Microsoft Edge', os: 'macOS', osVersion: '10.15.7' })
    expect(parseUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toMatchObject({ browser: 'Googlebot', deviceType: 'bot' })
    expect(parseUserAgent('curl/8.5.0')).toMatchObject({ browser: 'curl', browserVersion: '8.5.0', deviceType: 'tool' })
    // Le modèle réduit « K » des navigateurs Chrome récents n'est pas un modèle.
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36').deviceModel).toBeNull()
  })
})

describe('misc.license_plate', () => {
  it('SIV et FNI', () => {
    expect(analyzePlate('ab-123-cd')).toMatchObject({ normalized: 'AB-123-CD', matches: [{ country: 'FR' }, { country: 'IT' }] })
    expect(analyzePlate('AB123CD').normalized).toBe('AB-123-CD')
    const fni = analyzePlate('1234 AB 75').matches[0]
    expect(fni.details.department).toBe('Paris (75)')
    expect(analyzePlate('123 ABC 2A').matches[0].details.department).toBe('Corse-du-Sud (2A)')
    expect(analyzePlate('WW-123-AB').matches[0].details.temporary).toBe(true)
    expect(analyzePlate('IO-123-AB').matches.some((m) => m.country === 'FR')).toBe(false)
  })

  it('autres pays', () => {
    expect(analyzePlate('1234 BCD').matches[0].country).toBe('ES')
    expect(analyzePlate('1-ABC-123').matches[0].country).toBe('BE')
    expect(analyzePlate('B-AB 1234').matches[0]).toMatchObject({ country: 'DE', details: { city: 'Berlin' } })
    expect(analyzePlate('VD 123456').matches[0]).toMatchObject({ country: 'CH', details: { canton: 'Vaud (VD)' } })
    const uk = analyzePlate('LA62 XYZ').matches[0]
    expect(uk).toMatchObject({ country: 'GB', details: { region: 'London' } })
    expect(ukPeriod('62').fr).toBe('septembre 2012 à février 2013')
    expect(ukPeriod('12').en).toBe('March to August 2012')
  })

  it('propriétés du module', async () => {
    const out = await runModule(plate, entity('license_plate', 'AB-123-CD'))
    expect(out.properties).toMatchObject({ country: 'France', country_code: 'FR', plate_format: 'SIV (depuis 2009)', possible_countries: ['France', 'Italie'] })
    expect(await runModule(plate, entity('license_plate', '???'))).toEqual({})
  })
})

describe.skipIf(!LIVE)('misc : services réels', () => {
  it('constructeur MAC', async () => {
    const out = await runModule(mac, entity('mac_address', '00:1A:11:00:00:00'))
    expect(out.properties?.vendor).toMatch(/Google/)
  })
})
