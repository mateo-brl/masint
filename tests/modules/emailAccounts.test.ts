import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModuleError, type FetchOptions, type OsintModule } from '@shared/modules'
import {
  modules,
  parseAdobe,
  parseBitmoji,
  parseChess,
  parseDeezer,
  parseDuolingo,
  parseEventbrite,
  parseFreelancer,
  parseLastpass,
  parseMailru,
  parseSpotify,
  parseTwitter,
  parseWordpress
} from '../../src/main/modules/email/accounts'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fx: Record<string, any> = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/email/accounts.json'), 'utf8'))
const byId = (id: string): OsintModule => modules.find((m) => m.id === id)!

describe('vérifications de comptes email (parsing)', () => {
  it('Spotify', () => {
    expect(parseSpotify(fx.spotify_found).found).toBe(true)
    expect(parseSpotify(fx.spotify_notfound).found).toBe(false)
    expect(() => parseSpotify({ status: 130 })).toThrow(/invalide/)
  })

  it('Deezer', () => {
    expect(parseDeezer(fx.deezer_found).found).toBe(true)
    expect(parseDeezer(fx.deezer_notfound).found).toBe(false)
    expect(() => parseDeezer({ results: { availability: false, domain_validity: false } })).toThrow(/invalide/)
  })

  it('X (Twitter)', () => {
    expect(parseTwitter(fx.twitter_found).found).toBe(true)
    expect(parseTwitter(fx.twitter_notfound).found).toBe(false)
  })

  it('Chess.com', () => {
    expect(parseChess(fx.chess_found).found).toBe(true)
    expect(parseChess(fx.chess_notfound).found).toBe(false)
  })

  it('WordPress.com', () => {
    expect(parseWordpress(403, fx.wordpress_found).found).toBe(true)
    expect(parseWordpress(404, fx.wordpress_notfound).found).toBe(false)
  })

  it('LastPass', () => {
    expect(parseLastpass('no').found).toBe(true)
    expect(parseLastpass('ok\n').found).toBe(false)
    expect(() => parseLastpass('emailinvalid')).toThrow()
  })

  it('Freelancer', () => {
    expect(parseFreelancer(409, fx.freelancer_found).found).toBe(true)
    expect(parseFreelancer(200, fx.freelancer_notfound).found).toBe(false)
  })

  it('Adobe : moyens de connexion, avatar par défaut ignoré', () => {
    const r = parseAdobe(fx.adobe_found)
    expect(r.found).toBe(true)
    expect(r.data?.login_methods).toEqual(['password', 'otp', 'facebook'])
    expect(r.image).toBeUndefined()
    expect(parseAdobe(fx.adobe_notfound).found).toBe(false)
  })

  it('Duolingo', () => {
    expect(parseDuolingo(fx.duolingo_found).found).toBe(true)
    expect(parseDuolingo(fx.duolingo_notfound).found).toBe(false)
    const withPhoto = parseDuolingo({ users: [{ username: 'jdoe', picture: '//simg-ssl.duolingo.com/avatars/123/abc', hasGoogleId: true }] })
    expect(withPhoto.label).toBe('jdoe')
    expect(withPhoto.image).toBe('https://simg-ssl.duolingo.com/avatars/123/abc/xlarge')
    expect(withPhoto.data?.linked_logins).toEqual(['Google'])
  })

  it('Duolingo : liste vide suspecte quand le compte témoin est absent aussi', async () => {
    const m = byId('email.duolingo')
    const reply = (blocked: boolean) => async (_url: string, init?: FetchOptions) => {
      const isControl = String((init?.query as Record<string, string> | undefined)?.username ?? '') === 'duolingo'
      return new Response(JSON.stringify(isControl && !blocked ? fx.duolingo_found : fx.duolingo_notfound))
    }
    const ok = await runModule(m, entity('email', 'absent@example.com'), { ...makeContext(), fetch: reply(false) })
    expect(ok.found).toBe(false)
    await expect(runModule(m, entity('email', 'absent@example.com'), { ...makeContext(), fetch: reply(true) })).rejects.toThrow(/bridée/)
  })

  it('Snapchat / Bitmoji', () => {
    expect(parseBitmoji(200, fx.bitmoji_found).found).toBe(true)
    expect(parseBitmoji(204, null).found).toBe(false)
  })

  it('Eventbrite', () => {
    const r = parseEventbrite(fx.eventbrite_found)
    expect(r).toMatchObject({ found: true, data: { user_id: '941247935' } })
    expect(parseEventbrite(fx.eventbrite_notfound).found).toBe(false)
  })

  it('Mail.ru', () => {
    expect(parseMailru(fx.mailru_found).found).toBe(true)
    expect(parseMailru(fx.mailru_notfound).found).toBe(false)
    expect(byId('email.mailru').accepts?.(entity('email', 'ivan@bk.ru'))).toBe(true)
    expect(byId('email.mailru').accepts?.(entity('email', 'ivan@gmail.com'))).toBe(false)
  })

  it('identifiants uniques et textes bilingues sans tiret long', () => {
    const ids = modules.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of modules) {
      for (const t of [m.name.fr, m.name.en, m.description.fr, m.description.en]) expect(t).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('crée un compte nommé par l’adresse quand la plateforme manque au catalogue', async () => {
    const m = byId('email.lastpass')
    const ctx = { ...makeContext(), fetch: async () => new Response('no') }
    const out = await runModule(m, entity('email', 'jean@example.com'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.[0].label).toMatch(/jean@example\.com$/)
  })
})

describe.skipIf(!LIVE)('vérifications de comptes email (live)', () => {
  const ctx = makeContext()
  const absent = `zq8xk2vmw93pq7.${Date.now().toString(36)}@gmail.com`
  const cases: Array<[string, string]> = [
    ['email.spotify', 'john@gmail.com'],
    ['email.deezer', 'john@gmail.com'],
    ['email.twitter', 'john@gmail.com'],
    ['email.chesscom', 'john@gmail.com'],
    ['email.wordpress', 'john@gmail.com'],
    ['email.lastpass', 'john@gmail.com'],
    ['email.freelancer', 'john@gmail.com'],
    ['email.adobe', 'john@gmail.com'],
    ['email.duolingo', 'john@gmail.com'],
    ['email.snapchat', 'john@gmail.com'],
    ['email.eventbrite', 'john@gmail.com']
  ]
  for (const [id, present] of cases) {
    it(id, async (t) => {
      try {
        expect((await runModule(byId(id), entity('email', present), ctx)).found).toBe(true)
        expect((await runModule(byId(id), entity('email', absent), ctx)).found).toBe(false)
      } catch (e) {
        // Service qui bride l'IP de test : signalé explicitement par le module, pas un échec du parseur.
        if (e instanceof ModuleError && (e.code === 'blocked' || e.code === 'rate_limited')) t.skip(e.message)
        if (e instanceof Error && e.name === 'TimeoutError') t.skip(`${id} : délai dépassé (IP bridée ?)`)
        throw e
      }
    }, 90000)
  }

  it('email.mailru', async () => {
    expect((await runModule(byId('email.mailru'), entity('email', 'test@mail.ru'), ctx)).found).toBe(true)
    expect((await runModule(byId('email.mailru'), entity('email', 'zq8xk2vmw93pq7@mail.ru'), ctx)).found).toBe(false)
  })
})
