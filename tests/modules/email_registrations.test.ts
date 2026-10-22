// Vérifications de comptes email silencieuses (suite) et serveur de clés Proton.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModuleError, type OsintModule } from '@shared/modules'
import proton, { parseProton, PROTON_DOMAINS } from '../../src/main/modules/email/proton'
import {
  modules,
  myspaceCsrf,
  parseAnydo,
  parseCodecademy,
  parseDiigo,
  parseFirefox,
  parseFlickr,
  parseInsightly,
  parseMyspace,
  parsePlurk,
  parseRambler,
  parseXvideos
} from '../../src/main/modules/email/registrations'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext } from './social_helpers'

const fx: Record<string, any> = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/email/registrations.json'), 'utf8'))
const text = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/email', name), 'utf8')
const byId = (id: string): OsintModule => modules.find((m) => m.id === id)!

describe('vérifications de comptes email, suite (parsing)', () => {
  it('Firefox', () => {
    expect(parseFirefox(200, fx.firefox_found).found).toBe(true)
    expect(parseFirefox(200, fx.firefox_notfound).found).toBe(false)
    expect(() => parseFirefox(400, fx.firefox_invalid)).toThrow(/invalide/)
  })

  it('Rambler', () => {
    expect(parseRambler(fx.rambler_found)).toMatchObject({ found: true, data: { account_type: 'external' } })
    expect(parseRambler(fx.rambler_notfound).found).toBe(false)
    expect(() => parseRambler(fx.rambler_invalid)).toThrow(/invalide/)
  })

  it('Codecademy', () => {
    expect(parseCodecademy(400, fx.codecademy_found).found).toBe(true)
    expect(parseCodecademy(200, fx.codecademy_notfound).found).toBe(false)
    expect(() => parseCodecademy(400, fx.codecademy_invalid)).toThrow(/invalide/)
  })

  it('Any.do', () => {
    expect(parseAnydo(fx.anydo_found).found).toBe(true)
    expect(parseAnydo(fx.anydo_notfound).found).toBe(false)
    expect(() => parseAnydo({})).toThrow(/inattendue/)
  })

  it('Plurk et Diigo (réponses texte)', () => {
    expect(parsePlurk('True').found).toBe(true)
    expect(parsePlurk('False\n').found).toBe(false)
    expect(() => parsePlurk('<html>')).toThrow()
    expect(parseDiigo('0').found).toBe(true)
    expect(parseDiigo('1').found).toBe(false)
    expect(() => parseDiigo('')).toThrow()
  })

  it('Myspace : jeton du formulaire et réponse', () => {
    expect(myspaceCsrf(text('myspace_signup.html'))).toMatch(/^ZXhlbXBs/)
    expect(myspaceCsrf('<html></html>')).toBeNull()
    expect(parseMyspace(fx.myspace_found).found).toBe(true)
    expect(parseMyspace(fx.myspace_notfound).found).toBe(false)
  })

  it('Insightly (messages anglais et français)', () => {
    expect(parseInsightly(fx.insightly_found).found).toBe(true)
    expect(parseInsightly(fx.insightly_found_fr).found).toBe(true)
    expect(parseInsightly('true').found).toBe(false)
    expect(() => parseInsightly(fx.insightly_invalid)).toThrow(/invalide/)
  })

  it('XVideos : même code pour une adresse prise et une adresse invalide', () => {
    expect(parseXvideos(fx.xvideos_found).found).toBe(true)
    expect(parseXvideos(fx.xvideos_found_fr).found).toBe(true)
    expect(parseXvideos(fx.xvideos_notfound).found).toBe(false)
    expect(() => parseXvideos(fx.xvideos_invalid)).toThrow(/invalide/)
  })

  it('Flickr : seule la présence est concluante', () => {
    expect(parseFlickr(fx.flickr_found).found).toBe(true)
    expect(parseFlickr(fx.flickr_unknown).found).toBeNull()
    expect(() => parseFlickr({ stat: 'ok', state_code: '9' })).toThrow(/inattendue/)
  })

  it('drapeaux et textes des modules', () => {
    expect(byId('email.xvideos').ondemand).toBe(true)
    expect(modules.filter((m) => m.ondemand).map((m) => m.id)).toEqual(['email.xvideos'])
    const ids = modules.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of [...modules, proton])
      for (const t of [m.name.fr, m.name.en, m.description.fr, m.description.en]) expect(t).not.toMatch(/[–—]/)
  })
})

describe('vérifications de comptes email, suite (modules, fetch simulé)', () => {
  it('Firefox : User-Agent d’outil, compte créé au nom du service', async () => {
    const ctx = fakeContext([[/account\/status/, { body: fx.firefox_found }]])
    const out = await runModule(byId('email.firefox'), entity('email', 'jean@example.com'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.[0]).toMatchObject({ type: 'account', label: 'Firefox : jean@example.com' })
    expect(ctx.calls[0].headers['user-agent']).toMatch(/^MASINT/)
    expect(JSON.parse(ctx.calls[0].body!)).toEqual({ email: 'jean@example.com' })
  })

  it('Firefox : un refus 406 est signalé comme blocage', async () => {
    const ctx = fakeContext([[/account\/status/, { status: 406, body: '' }]])
    await expect(runModule(byId('email.firefox'), entity('email', 'jean@example.com'), ctx)).rejects.toMatchObject({ code: 'blocked' })
  })

  it('Rambler : corps JSON-RPC', async () => {
    const ctx = fakeContext([[/id\.rambler\.ru\/jsonrpc/, { body: fx.rambler_notfound }]])
    const out = await runModule(byId('email.rambler'), entity('email', 'jean@example.com'), ctx)
    expect(out.found).toBe(false)
    expect(JSON.parse(ctx.calls[0].body!)).toEqual({ method: 'Rambler::Id::get_email_account_info', params: [{ email: 'jean@example.com' }], rpc: '2.0' })
  })

  it('Myspace : jeton lu sur la page puis envoyé dans l’en-tête Hash', async () => {
    const ctx = fakeContext([
      [/myspace\.com\/signup$/, { body: text('myspace_signup.html') }],
      [/validateemail/, { body: fx.myspace_found }]
    ])
    const out = await runModule(byId('email.myspace'), entity('email', 'jean@example.com'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.[0]).toMatchObject({ platform: 'myspace', label: 'jean@example.com' })
    const post = ctx.calls.find((c) => /validateemail/.test(c.url))!
    expect(post.headers.hash).toMatch(/^ZXhlbXBs/)
    expect(post.body).toBe('email=jean%40example.com')
  })

  it('Flickr : absence non concluante, ni trouvé ni absent', async () => {
    const ctx = fakeContext([[/identity-api\.flickr\.com/, { body: fx.flickr_unknown }]])
    const out = await runModule(byId('email.flickr'), entity('email', 'jean@example.com'), ctx)
    expect(out.found).toBeUndefined()
    expect(out.entities).toBeUndefined()
  })

  it('quota dépassé', async () => {
    const ctx = fakeContext([[/plurk/, { status: 429, body: '' }]])
    await expect(runModule(byId('email.plurk'), entity('email', 'jean@example.com'), ctx)).rejects.toMatchObject({ code: 'rate_limited' })
  })
})

describe('email.proton', () => {
  it('lit la clé d’une adresse hébergée chez Proton', () => {
    const r = parseProton(text('proton_found.txt'), 'security@proton.me')
    expect(r.found).toBe(true)
    expect(r.data).toMatchObject({ pgp_key_created_at: '2022-05-03', pgp_fingerprints: ['C4BC9337CC23A0BA855A3EF32EE753BBBA66EE76'] })
    expect(parseProton(text('proton_notfound.txt'), 'jean@example.com').found).toBe(false)
  })

  it('adresse fourre-tout : la clé du catch-all ne prouve rien pour l’adresse', () => {
    const r = parseProton(text('proton_catchall.txt'), 'jean@example.com')
    expect(r).toEqual({ found: null, properties: { proton_catchall: 'catchall@example.com' } })
  })

  it('quota de recherches de clés', () => {
    expect(() => parseProton('{"Code":2028,"Error":"Too many recent failed key server lookups","Details":{}}', 'jean@example.com')).toThrow(ModuleError)
  })

  it('exclut les domaines de Proton, où toute adresse reçoit une clé leurre', () => {
    // Clé renvoyée pour une adresse aléatoire de proton.me : impossible à distinguer d'une vraie.
    expect(parseProton(text('proton_decoy.txt'), 'qv7r2m9xk4tz8w1nl3pj6@proton.me').found).toBe(true)
    expect(PROTON_DOMAINS.has('proton.me')).toBe(true)
    expect(proton.accepts?.(entity('email', 'jean@proton.me'))).toBe(false)
    expect(proton.accepts?.(entity('email', 'jean@pm.me'))).toBe(false)
    expect(proton.accepts?.(entity('email', 'jean@example.com'))).toBe(true)
    expect(proton.experimental).toBe(true)
  })
})

describe.skipIf(!LIVE)('vérifications de comptes email, suite (live)', () => {
  const ctx = makeContext()
  const absent = `qv7r2m9xk4tz8w${Date.now().toString(36)}@gmail.com`
  for (const m of modules) {
    it(m.id, async (t) => {
      try {
        expect((await runModule(m, entity('email', 'test@gmail.com'), ctx)).found).toBe(true)
        // Flickr ne conclut jamais à l'absence.
        expect((await runModule(m, entity('email', absent), ctx)).found).toBe(m.id === 'email.flickr' ? undefined : false)
      } catch (e) {
        if (e instanceof ModuleError && (e.code === 'blocked' || e.code === 'rate_limited')) t.skip(e.message)
        throw e
      }
    })
  }
  it('email.proton : adresse Gmail sans clé', async (t) => {
    try {
      expect((await runModule(proton, entity('email', absent), ctx)).found).toBe(false)
      // Le format de l'index ne change pas : clé d'une adresse publique de Proton.
      const res = await ctx.fetchText('https://api.protonmail.ch/pks/lookup', { query: { op: 'index', search: 'security@proton.me' } })
      expect(parseProton(res, 'security@proton.me')).toMatchObject({ found: true, data: { pgp_key_created_at: '2022-05-03' } })
    } catch (e) {
      if (e instanceof ModuleError && e.code === 'rate_limited') t.skip(e.message)
      throw e
    }
  })
})
