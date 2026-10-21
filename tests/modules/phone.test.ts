import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import type { FetchOptions } from '@shared/modules'
import { classifyAmazon } from '../../src/main/modules/email/_amazon'
import { interpretMsa } from '../../src/main/modules/email/_microsoft'
import { parseLeakcheck } from '../../src/main/modules/email/leakcheck'
import amazon from '../../src/main/modules/phone/amazon'
import { hlrOutput, hlrTimestamp, modules as hlrModules, parseHlrLookups, parseHlrlookup } from '../../src/main/modules/phone/hlr'
import leakcheck from '../../src/main/modules/phone/leakcheck'
import links, { phoneFormats } from '../../src/main/modules/phone/links'
import microsoft from '../../src/main/modules/phone/microsoft'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fx = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/phone', name), 'utf8')
const json = <T = any>(name: string): T => JSON.parse(fx(name)) as T

describe('phone.links', () => {
  it('liste les écritures du numéro', () => {
    const p = parsePhoneNumberFromString('+33612345678')!
    expect(phoneFormats(p)).toEqual(['+33612345678', '+33 6 12 34 56 78', '06 12 34 56 78', '0612345678', '06.12.34.56.78'])
  })

  it('prépare les liens, dont les annuaires français', async () => {
    const out = await runModule(links, entity('phone', '06 12 34 56 78'))
    const byEngine = Object.fromEntries((out.entities ?? []).map((e) => [e.data?.engine as string, e.data?.url as string]))
    expect(byEngine.WhatsApp).toBe('https://wa.me/33612345678')
    expect(byEngine.Telegram).toBe('https://t.me/+33612345678')
    expect(byEngine['PagesJaunes (annuaire inversé)']).toContain('quoiqui=0612345678')
    expect(byEngine.Truecaller).toBe('https://www.truecaller.com/search/fr/0612345678')
    expect(out.entities?.every((e) => e.type === 'search_link' && e.label.endsWith('+33612345678'))).toBe(true)
  })

  it("n'ajoute pas les annuaires français à un numéro étranger", async () => {
    const out = await runModule(links, entity('phone', '+14155552671'))
    const engines = out.entities?.map((e) => e.data?.engine)
    expect(engines).toContain('Spokeo')
    expect(engines).not.toContain('Tellows')
  })
})

describe('phone.microsoft et phone.amazon (parsing)', () => {
  it('Microsoft : numéro inconnu', () => {
    expect(interpretMsa(json('microsoft_notfound.json')).found).toBe(false)
  })

  it('Amazon : compte trouvé avec numéro masqué', () => {
    const r = classifyAmazon(fx('amazon_found.html'), 'https://www.amazon.com/ax/claim/auth?arb=x')
    expect(r.found).toBe(true)
    expect(r.hints).toEqual(['+1 ***-***-71'])
    expect(classifyAmazon(fx('amazon_notfound.html'), 'https://www.amazon.com/ax/claim/intent?claimType=phoneNumber').found).toBe(false)
  })

  it('vérifie le compte sous le format E.164 (fetch simulé)', async () => {
    const posted: string[] = []
    const ctx = {
      ...makeContext(),
      fetch: async (url: string, init?: FetchOptions) => {
        if (/login\.srf/.test(url))
          return new Response(readFileSync(resolve(__dirname, '../fixtures/email/microsoft_login.html'), 'utf8'))
        posted.push((init?.json as { username: string }).username)
        return new Response(fx('microsoft_notfound.json'))
      }
    }
    const out = await runModule(microsoft, entity('phone', '06 39 98 12 34'), ctx)
    expect(out.found).toBe(false)
    expect(posted).toEqual(['+33639981234'])
  })
})

describe('HLR (parsing)', () => {
  it('normalise les horodatages', () => {
    expect(hlrTimestamp('2020-08-07 19:16:17.676+0300')).toBe('2020-08-07T16:16:17.676Z')
    expect(hlrTimestamp('2022-09-08T10:04:27Z')).toBe('2022-09-08T10:04:27.000Z')
  })

  it('hlr-lookups.com : ligne active portée', () => {
    const h = parseHlrLookups(json('hlr_lookups.json'), '+14156226819')
    expect(h).toMatchObject({ state: 'active', status: 'connected', ported: true, roaming: false, mccmnc: '310260' })
    expect(h.imsi).toBeUndefined()
    const out = hlrOutput(h, 'fr', {})
    const hlr = out.entities?.find((e) => e.type === 'hlr')
    expect(hlr).toMatchObject({ platform: 'hlr_active', label: 'HLR +14156226819' })
    const carriers = out.entities?.filter((e) => e.type === 'carrier').map((e) => e.label)
    expect(carriers).toEqual(['T-Mobile US', 'Verizon Wireless'])
    expect(out.entities?.find((e) => e.label === 'T-Mobile US')?.platform).toBe('tmobile')
    expect(out.properties).toMatchObject({ hlr_status: 'connected', ported: true, current_carrier: 'T-Mobile US' })
  })

  it('hlrlookup.com : ligne active portée', () => {
    const h = parseHlrlookup(json('hlrlookup.json'), '+447540822872')
    expect(h).toMatchObject({ state: 'active', status: 'live', ported: true, mccmnc: '23430', lineType: 'MOBILE' })
    const out = hlrOutput(h, 'en', {})
    expect(out.entities?.filter((e) => e.type === 'carrier').map((e) => e.label)).toEqual(['EE Limited (T-Mobile)', 'O2 (UK)'])
    expect(out.entities?.find((e) => e.label === 'O2 (UK)')?.platform).toBe('o2')
  })

  it('ligne résiliée et statut indéterminé', () => {
    const dead = parseHlrlookup({ results: [{ error: 'NONE', live_status: 'DEAD' }] }, '+33600000000')
    expect(hlrOutput(dead, 'fr', {}).entities?.[0].platform).toBe('hlr_inactive')
    const unknown = parseHlrLookups({ connectivity_status: 'UNDETERMINED', processing_status: 'COMPLETED' }, '+33600000000')
    expect(hlrOutput(unknown, 'fr', {}).entities?.some((e) => e.type === 'hlr')).toBe(false)
    expect(() => parseHlrLookups({ processing_status: 'REJECTED', error_description: 'Invalid MSISDN' }, '+1')).toThrow(/Invalid/)
  })

  it('modules à la demande, à clé et secret', () => {
    for (const m of hlrModules) {
      expect(m.ondemand).toBe(true)
      expect(m.keys?.length).toBe(2)
    }
  })
})

describe('phone.leakcheck (parsing)', () => {
  it('lit les sources', () => {
    const out = parseLeakcheck(json('leakcheck_found.json'), 'fr')
    expect(out.entities?.length).toBeGreaterThan(0)
    expect((out.properties?.leak_fields as string[]).includes('phone')).toBe(true)
  })
})

describe.skipIf(!LIVE)('téléphone (live)', () => {
  const ctx = makeContext()

  it('phone.microsoft', async () => {
    // Numéro d'exemple classique, sans compte au moment de l'écriture. La plage ARCEP réservée
    // à la fiction (06 39 98 xx xx) est refusée comme invalide par Microsoft et Amazon.
    expect((await runModule(microsoft, entity('phone', '+33612345678'), ctx)).found).toBe(false)
    await expect(runModule(microsoft, entity('phone', '+33639981234'), ctx)).rejects.toThrow(/invalide/)
  })

  it('phone.amazon', async () => {
    const found = await runModule(amazon, entity('phone', '+14155552671'), ctx)
    expect(found.found).toBe(true)
    expect(found.entities?.[0].data?.recovery_hints).toBeTruthy()
    expect((await runModule(amazon, entity('phone', '+33612345678'), ctx)).found).toBe(false)
  }, 60000)

  it('phone.leakcheck', async () => {
    expect((await runModule(leakcheck, entity('phone', '+14155552671'), ctx)).entities?.length).toBeGreaterThan(0)
  })
})
