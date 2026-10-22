// Tests hors ligne des modules roso.info : les réponses viennent de fixtures construites
// d'après le code client du site (voir tests/fixtures/roso/*.json, clé `_source`).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ModuleError, type ModuleOutput, type OsintModule, type OutEntity } from '@shared/modules'
import { entity } from '../helpers/context'
import { fixture, mockContext, NO_MAINTENANCE, TEST_KEY, type Route } from '../fixtures/roso/mock'
import { pool, RosoClient, toRosoError } from '../../src/main/modules/roso/_client'
import {
  accountEntities,
  addGeneric,
  emailsOf,
  genericExtract,
  imageUrl,
  isoDate,
  maskMatches,
  phonesOf,
  pivotProperties,
  rosoPlatform,
  stealerEntities
} from '../../src/main/modules/roso/_parse'
import { USERNAME_SITES } from '../../src/main/modules/roso/_sites'
import rosoEmail, { finalizeEmailModules } from '../../src/main/modules/roso/email'
import rosoUsername, { parseUsernamePage, resetUsernameCache } from '../../src/main/modules/roso/username'
import rosoPhone, { parseTwilio, phonePlatforms, phoneTiming } from '../../src/main/modules/roso/phone'
import rosoIp from '../../src/main/modules/roso/ip'
import rosoDomain, { rdapContacts } from '../../src/main/modules/roso/domain'
import rosoName from '../../src/main/modules/roso/name'
import rosoPartial, { expandMask, partialTiming } from '../../src/main/modules/roso/partialNumber'
import rosoCrypto from '../../src/main/modules/roso/crypto'
import rosoIban from '../../src/main/modules/roso/iban'

type J = Record<string, any>

/** Appels à ctx.progress, pour vérifier la pastille de progression. */
function trackProgress(ctx: { progress: (done: number, total: number, detail?: string) => void }): Array<[number, number, string | undefined]> {
  const calls: Array<[number, number, string | undefined]> = []
  ctx.progress = (done, total, detail) => void calls.push([done, total, detail])
  return calls
}

/** La pastille part de 0 et finit à son total, sans jamais le dépasser. */
function expectFinished(calls: Array<[number, number, string | undefined]>): void {
  expect(calls.length).toBeGreaterThan(1)
  expect(calls[0][0]).toBe(0)
  const [done, total] = calls.at(-1)!
  expect(done).toBe(total)
  expect(calls.every(([d, t]) => d <= t)).toBe(true)
}

const find = (out: ModuleOutput, type: string, label?: string): OutEntity | undefined =>
  out.entities?.find((e) => e.type === type && (label === undefined || e.label === label))
const labels = (out: ModuleOutput, type: string): string[] => (out.entities ?? []).filter((e) => e.type === type).map((e) => e.label)

async function expectError(p: Promise<unknown>, code: ModuleError['code'], msg?: RegExp): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(ModuleError)
  expect((err as ModuleError).code).toBe(code)
  if (msg) expect((err as ModuleError).message).toMatch(msg)
}

beforeAll(() => {
  partialTiming.delayMs = 0
  phoneTiming.batchDelayMs = 0
})

describe('roso.info : déclaration des modules', () => {
  const all: OsintModule[] = [rosoEmail, rosoUsername, rosoPhone, rosoIp, rosoDomain, rosoName, rosoPartial, rosoCrypto, rosoIban]
  it('sont tous à la demande, catégorie roso, clé roso', () => {
    const ids = all.map((m) => m.id)
    expect(ids).toEqual(['roso.email', 'roso.username', 'roso.phone', 'roso.ip', 'roso.domain', 'roso.name', 'roso.partial_number', 'roso.crypto', 'roso.iban'])
    for (const m of all) {
      expect(m.ondemand).toBe(true)
      expect(m.category).toBe('roso')
      expect(m.homepage).toBe('https://roso.info')
      expect(m.keys).toEqual([{ id: 'roso', label: 'roso.info API key (roso_…)', url: 'https://roso.info/account.html' }])
      expect(m.name.fr && m.name.en && m.description.fr && m.description.en).toBeTruthy()
      expect(JSON.stringify([m.name, m.description])).not.toMatch(/[\u2013\u2014]/)
    }
  })
  it('répartit numéros complets et partiels', () => {
    expect(rosoPhone.accepts!(entity('phone', '+33612345678'))).toBe(true)
    expect(rosoPhone.accepts!(entity('phone', '+33 6 12 34 56 *8'))).toBe(false)
    expect(rosoPartial.accepts!(entity('keyword', '+33 6 12 34 56 *8'))).toBe(true)
    expect(rosoPartial.accepts!(entity('phone', '+33612345678'))).toBe(false)
    expect(rosoPartial.accepts!(entity('keyword', '+33 6 ** ** 56 *8'))).toBe(false)
  })
})

describe('roso.info : client', () => {
  it('traduit les erreurs du site', async () => {
    const e = fixture<J>('errors.json')
    expect(toRosoError(401, e.invalidKey, 'email')).toMatchObject({ code: 'auth', message: expect.stringMatching(/Clé API roso\.info invalide/) })
    expect(toRosoError(401, e.apiKeyRequired, 'email').code).toBe('auth')
    expect(toRosoError(401, e.keyRevoked, 'email').message).toMatch(/révoquée/)
    expect(toRosoError(403, e.forbidden, 'email')).toMatchObject({ code: 'auth', message: expect.stringMatching(/non autorisé/) })
    expect(toRosoError(429, e.noCredits, 'email')).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/Crédits/) })
    expect(toRosoError(429, e.cooldown, 'email')).toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/attente/) })
    expect(toRosoError(400, e.captcha, 'email')).toMatchObject({ code: 'blocked', message: expect.stringMatching(/captcha/) })
    expect(toRosoError(503, {}, 'email').code).toBe('unavailable')
    expect(toRosoError(401, e.invalidKey, 'email', 'en').message).toMatch(/Invalid roso\.info API key/)
  })

  it('exige la clé et envoie X-API-Key', async () => {
    expect(() => new RosoClient(mockContext([], { key: null }).ctx, 'email')).toThrow(ModuleError)
    const { ctx, calls } = mockContext([['GET', '/api/auth/status', { body: { success: true, credits: 20, tier: 'patreon' } }]])
    const st = await new RosoClient(ctx, 'auth').status()
    expect(st.credits).toBe(20)
    expect(calls[0].headers['x-api-key']).toBe(TEST_KEY)
    expect(calls[0].url.searchParams.get('api_key')).toBe(TEST_KEY)
  })

  it('réessaie les 5xx mais jamais un lancement qui débite des crédits', async () => {
    let n = 0
    const { ctx } = mockContext([
      ['GET', '/flaky', () => (++n < 2 ? { status: 502, body: {} } : { body: { success: true } })],
      ['POST', '/api/gateway/email/start', { status: 502, body: {} }]
    ])
    const c = new RosoClient(ctx, 'email')
    expect((await c.get('/flaky')).ok).toBe(true)
    expect(n).toBe(2)
    await expectError(c.launch('/api/gateway/email/start', {}), 'unavailable')
  })

  it('signale la maintenance', async () => {
    const { ctx } = mockContext([['GET', '/api/maintenance/status', { body: fixture<J>('errors.json').maintenance }]])
    await expectError(rosoEmail.run(entity('email', 'a@b.fr'), ctx), 'unavailable', /maintenance/)
  })

  it('pool borne la concurrence et propage une erreur fatale', async () => {
    let active = 0
    let peak = 0
    const signal = new AbortController().signal
    await pool([1, 2, 3, 4, 5, 6, 7], 3, signal, async () => {
      peak = Math.max(peak, ++active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(peak).toBe(3)
    await expect(pool([1, 2, 3], 2, signal, async (x) => { if (x === 2) throw new ModuleError('stop', 'auth') })).rejects.toThrow('stop')
  })
})

describe('roso.info : parsing tolérant', () => {
  it('ne plante jamais sur des profils vides ou étranges', () => {
    for (const p of [null, undefined, 42, 'x', [], {}, { username: null, avatar: 12, followers: 'abc' }]) {
      const out = accountEntities(p, { site: 'zomato', query: 'jdoe', ref: 'a', lang: 'fr' })
      expect(out[0]).toMatchObject({ type: 'account', label: 'jdoe (Zomato)' })
    }
    expect(stealerEntities('nope', { refPrefix: 'x', lang: 'fr' })).toEqual([])
  })
  it('associe les identifiants roso aux plateformes MASINT', () => {
    expect(rosoPlatform('twitter')).toBe('x')
    expect(rosoPlatform('github')).toBe('github')
    expect(rosoPlatform('chess')).toBe('chesscom')
    expect(rosoPlatform('mfosstodonorg')).toBe('mastodon')
    expect(rosoPlatform('googlemaps')).toBe('google')
    expect(rosoPlatform('constructor')).toBeUndefined()
    expect(rosoPlatform('zhihu')).toBeUndefined()
  })
  it('rend absolues les images et écarte les avatars par défaut', () => {
    expect(imageUrl('/api/uc/proxy-image?url=x')).toBe('https://roso.info/api/uc/proxy-image?url=x')
    expect(imageUrl('//cdn.site/a.png')).toBe('https://cdn.site/a.png')
    expect(imageUrl('https://x/default_avatar.png')).toBeUndefined()
    expect(imageUrl('https://cdn.eyecon-app.com/p.jpg')).toMatch(/^https:\/\/roso\.info\/api\/uc\/proxy-image\?url=/)
    expect(imageUrl('javascript:alert(1)')).toBeUndefined()
  })
  it('normalise les dates', () => {
    expect(isoDate('2023-04-12')).toBe('2023-04-12')
    expect(isoDate(1700000000)).toBe('2023-11-14T22:13:20.000Z')
    expect(isoDate('12/04/2023')).toBe('2023-04-12')
    expect(isoDate('pas une date')).toBeUndefined()
  })
  it('lit les emails et téléphones masqués sous les clés affichées par le site', () => {
    expect(emailsOf({ maskedEmail: 'd•••@e•••.com', email_hint: 'j**n@o****.fr', matchedEmail: 'Contact@Example.com' })).toEqual({
      full: ['contact@example.com'],
      masked: ['d•••@e•••.com', 'j**n@o****.fr']
    })
    expect(phonesOf({ maskedPhones: ['+33 •• •• •• •• 12'], phone_hint: '******5678', masked_phone: '+1 ***-***-0199' }).masked).toEqual([
      '******5678',
      '+1 ***-***-0199',
      '+33 •• •• •• •• 12'
    ])
  })

  it('rapproche un masque de la valeur recherchée seulement quand il en montre assez', () => {
    expect(maskMatches('j***@g***.com', 'jean@gmail.com')).toBe(true)
    expect(maskMatches('j***@g***.com', 'jean@example.com')).toBe(false)
    expect(maskMatches('+33 6 •• •• •• 78', '+33612345678')).toBe(true)
    expect(maskMatches('+33 6 •• •• •• 78', '+33612345679')).toBe(false)
    // Deux chiffres visibles : trop peu pour conclure que c'est le même numéro.
    expect(maskMatches('•• •• •• •• 78', '+33612345678')).toBe(false)
    expect(maskMatches('jean@gmail.com', 'jean@gmail.com')).toBe(false)
  })

  it('regroupe les pivots avec leurs plateformes, sans le masque de la valeur recherchée', () => {
    const props = pivotProperties(
      [
        { site: 'apple-iforgot', profile: { kind: 'phone', maskedEmail: 'd•••@e•••.com' } },
        { site: 'sleeper', profile: { maskedEmail: 'D•••@E•••.com', maskedPhone: '+33 6 •• •• •• 78' } },
        { site: 'explurger', profile: { city: 'Lyon', countryCode: 'FR' } },
        { site: 'instagram', profile: { location: 'Lyon, France' } },
        { site: 'whatsapp', profile: {} }
      ],
      '+33612345678',
      'fr'
    )
    expect(props).toEqual({
      masked_emails: ['d•••@e•••.com (Apple, Sleeper)'],
      masked_phones: [],
      locations: ['Lyon, France (Explurger, Instagram)']
    })
  })

  it('repli générique : emails, téléphones, URL, pseudos', () => {
    const ex = genericExtract({ a: { contact: 'x@y.fr', mobile: '+33 6 12 34 56 78', masked: 'j***@g.com' }, list: [{ profile_url: 'https://site/x' }, { login: 'bob_42' }] })
    expect(ex.emails).toEqual(['x@y.fr'])
    expect(ex.phones).toEqual(['+33612345678'])
    expect(ex.urls).toEqual(['https://site/x'])
    expect(ex.usernames).toEqual(['bob_42'])
    const out = accountEntities({ nested: { link: 'https://forum.example/u/bob' }, extra: { login: 'bob_42', mail: 'bob@example.org' } }, { site: 'forumx', query: 'bob', ref: 'a', lang: 'fr' })
    addGeneric(out, { nested: { link: 'https://forum.example/u/bob' }, extra: { login: 'bob_42', mail: 'bob@example.org' } }, 'a', 'bob', 'fr')
    expect(out[0].data).toMatchObject({ url: 'https://forum.example/u/bob', username: 'bob_42' })
    expect(out.find((e) => e.type === 'email')?.label).toBe('bob@example.org')
  })
})

describe('roso.email', () => {
  const fx = fixture<J>('email.json')
  const routes = (): Route[] => [
    NO_MAINTENANCE,
    ['POST', '/api/gateway/email/start', { body: fx.start }],
    ['GET', '/api/ec/email/meta', { body: fx.meta }],
    ['POST', /^\/api\/gateway\/email\/module\//, (c) => {
      const mod = c.url.pathname.split('/').pop()!
      return fx.modules[mod] ? { body: fx.modules[mod] } : { status: 404, body: { success: false } }
    }],
    ['POST', '/api/gateway/email/complete', { body: { success: true } }]
  ]

  it('filtre la liste des modules comme le site', () => {
    expect(finalizeEmailModules(['github', 'gumroad', 'bandlab', 'email', '*', 'gmail'], ['gumroad'], null)).toEqual(['googlemaps', 'gmail', 'github'])
    expect(finalizeEmailModules(['github', 'spotify'], [], ['spotify'])).toEqual(['spotify'])
  })

  it('enchaîne start, meta, modules et complete', async () => {
    const { ctx, calls } = mockContext(routes())
    const progress = trackProgress(ctx)
    const out = await rosoEmail.run(entity('email', 'Jean.Dupont@Example.com'), ctx)
    expectFinished(progress)
    const start = calls.find((c) => c.url.pathname === '/api/gateway/email/start')!
    expect(start.body).toEqual({ email: 'jean.dupont@example.com' })
    expect(start.headers['x-api-key']).toBe(TEST_KEY)
    const mods = calls.filter((c) => c.url.pathname.startsWith('/api/gateway/email/module/'))
    expect(mods[0].url.pathname).toBe('/api/gateway/email/module/googlemaps')
    expect(mods[0].headers['x-session-id']).toBe('sess_7f3a')
    expect(mods[0].body).toEqual({ email: 'jean.dupont@example.com', sessionId: 'sess_7f3a' })
    const called = mods.map((c) => c.url.pathname.split('/').pop())
    expect(called).not.toContain('gumroad')
    expect(called).not.toContain('bandlab')
    expect(called).toContain('yahoo')
    const complete = calls.find((c) => c.url.pathname === '/api/gateway/email/complete')!
    expect((complete.body as J).sessionId).toBe('sess_7f3a')

    expect(out.properties).toMatchObject({ roso_credits_left: 17, roso_tier: 'patreon', roso_errors: 1, breaches: ['Adobe', 'Canva'] })
    expect(out.properties?.roso_found_count).toBe(9)
    const gh = find(out, 'account', 'jdupont')!
    expect(gh).toMatchObject({ platform: 'github', image: 'https://avatars.githubusercontent.com/u/1?v=4' })
    expect(gh.data).toMatchObject({ url: 'https://github.com/jdupont', location: 'Paris, France', created_at: '2015-03-02T10:00:00.000Z', followers: 12 })
    expect(find(out, 'account', 'Jean Dupont')?.platform).toBe('google')
    expect(find(out, 'person', 'Jean Dupont')).toBeTruthy()
    expect(find(out, 'account', 'jean.dupont@example.com')?.platform).toBe('spotify')
    expect(find(out, 'breach', 'Adobe')?.data).toMatchObject({ breach_date: '2013-10-04', records: 152445165 })
    expect(find(out, 'breach', 'combo_list_2021.txt')).toBeTruthy()
    const st = find(out, 'infostealer', 'DESKTOP-ABC123')!
    expect(st.data).toMatchObject({ os: 'Windows 10 Pro', stealer_family: 'RedLine', ip: '81.***.***.12' })
    expect(labels(out, 'ip')).toEqual([])
    expect(labels(out, 'domain').sort()).toEqual(['dupont-jean.fr', 'jd-photo.com'])
    expect(find(out, 'account', 'jean.dupont@example.com')?.data).toBeDefined()
    const apple = out.entities!.find((e) => e.platform === 'apple')!
    expect(apple.data).toMatchObject({ masked_phones: ['+33 •• •• •• •• 42'], masked_emails: ['j••••@g••••.com'] })
    // Les mêmes pivots, regroupés sur l'adresse recherchée avec leur plateforme.
    expect(out.properties).toMatchObject({
      masked_phones: ['+33 •• •• •• •• 42 (Apple)'],
      masked_emails: ['j••••@g••••.com (Apple)'],
      locations: expect.arrayContaining(['Paris, France (GitHub)'])
    })
    expect(progress.some(([, , d]) => d?.startsWith('modules · '))).toBe(true)
    const duo = find(out, 'account', 'jeandup')!
    expect(duo.image).toBe('https://simg-ssl.duolingo.com/ssr-avatars/123/SSR-abc/large')
    expect(find(out, 'phone', '+33612345678')?.from).toBe('acc_duolingo')
    expect(JSON.stringify(out.raw)).not.toContain(TEST_KEY)
  })

  it('arrête tout sur une clé refusée', async () => {
    const e = fixture<J>('errors.json')
    const { ctx } = mockContext([NO_MAINTENANCE, ['POST', '/api/gateway/email/start', { status: 401, body: e.apiKeyRequired }]])
    await expectError(rosoEmail.run(entity('email', 'a@b.fr'), ctx), 'auth', /invalide/)
    const r2 = mockContext([NO_MAINTENANCE, ['POST', '/api/gateway/email/start', { status: 429, body: e.noCredits }]])
    await expectError(rosoEmail.run(entity('email', 'a@b.fr'), r2.ctx), 'rate_limited')
    const r3 = mockContext([NO_MAINTENANCE, ['POST', '/api/gateway/email/start', { status: 400, body: e.captcha }]])
    await expectError(rosoEmail.run(entity('email', 'a@b.fr'), r3.ctx), 'blocked', /captcha/)
    const r4 = mockContext([
      NO_MAINTENANCE,
      ['POST', '/api/gateway/email/start', { body: fx.start }],
      ['GET', '/api/ec/email/meta', { body: fx.meta }],
      ['POST', /^\/api\/gateway\/email\/module\//, { status: 401, body: e.invalidKey }]
    ])
    await expectError(rosoEmail.run(entity('email', 'a@b.fr'), r4.ctx), 'auth')
  })
})

describe('roso.username', () => {
  const fx = fixture<J>('username.json')

  it('lit la liste des sites dans la page du site', () => {
    const html = readFileSync(join(__dirname, '../fixtures/roso/username_page.html'), 'utf8')
    const { sites, paths } = parseUsernamePage(html)
    expect(sites).toEqual(['twitter', 'github', 'hudsonrock', 'ninegag', 'wayback', 'zorinosforum', 'audius'])
    expect(paths).toEqual({ hudsonrock: '/api/uc/hudsonrock/username', ninegag: '/api/uc/9gag/profile', wayback: '/api/uc/wayback/check' })
    expect(parseUsernamePage('<html></html>').sites).toEqual([])
  })

  it('fait tout le scan en un module et convertit les comptes', async () => {
    resetUsernameCache()
    const { ctx, calls } = mockContext([
      NO_MAINTENANCE,
      ['GET', '/username/', { status: 503, body: 'down' }],
      ['POST', '/api/gateway/username/start', { body: fx.start }],
      ['POST', /^\/api\/uc\//, (c) => {
        const seg = c.url.pathname.split('/')[3]
        const site = seg === '9gag' ? 'ninegag' : seg
        return { body: fx.found[site] ?? { success: true, exists: false } }
      }]
    ])
    const progress = trackProgress(ctx)
    const out = await rosoUsername.run(entity('username', '@jdoe'), ctx)
    expectFinished(progress)
    const checks = calls.filter((c) => c.url.pathname.startsWith('/api/uc/'))
    expect(checks.length).toBe(USERNAME_SITES.length)
    expect(checks.every((c) => c.headers['x-api-key'] === TEST_KEY && (c.body as J).username === 'jdoe')).toBe(true)
    expect(checks.some((c) => c.url.pathname === '/api/uc/hudsonrock/username')).toBe(true)
    expect(checks.some((c) => c.url.pathname === '/api/uc/wayback/check')).toBe(true)

    expect(out.properties).toMatchObject({ roso_credits_left: 15, roso_found_count: 4, roso_sites_checked: USERNAME_SITES.length, roso_errors: 1 })
    expect(out.properties?.roso_wayback_platforms).toEqual(['Twitter'])
    expect(find(out, 'account', 'jdoe')).toBeTruthy()
    const tw = out.entities!.find((e) => e.platform === 'x')!
    expect(tw).toMatchObject({ label: 'jdoe', image: 'https://pbs.twimg.com/profile_images/1/abc_400x400.jpg' })
    expect(tw.data).toMatchObject({ followers: 321, bio: 'Hello world', url: 'https://x.com/jdoe' })
    expect(find(out, 'account', 'jdoe (Zhihu)')?.data).toMatchObject({ site: 'zhihu', url: 'https://www.zhihu.com/people/jdoe' })
    expect(find(out, 'email', 'john.doe@example.org')).toMatchObject({ from: 'acc_github' })
    expect(find(out, 'person', 'John Doe')).toBeTruthy()
    expect(find(out, 'infostealer', 'LAPTOP-JD')).toBeTruthy()
    expect(find(out, 'ip', '203.0.113.7')?.from).toBe('hr0')
    expect(labels(out, 'url')).toEqual(['https://web.archive.org/web/20190102000000/https://twitter.com/jdoe'])
  })
})

describe('roso.phone', () => {
  const fx = fixture<J>('phone.json')

  it('choisit les vérifications selon le pays', () => {
    expect(phonePlatforms('+33612345678')).toContain('callfilter')
    expect(phonePlatforms('+33612345678')).not.toContain('phonely')
    expect(phonePlatforms('+447700900123')).toContain('phonely')
    expect(phonePlatforms('+12025550123')).not.toContain('callfilter')
  })

  it('lance phone/log puis les autochecks, le HLR et FunStat', async () => {
    const { ctx, calls } = mockContext([
      NO_MAINTENANCE,
      ['POST', '/api/gateway/phone/log', { body: fx.log }],
      ['GET', /^\/api\/gateway\/twilio\/lookup\//, { body: fx.twilio }],
      ['GET', /^\/api\/gateway\/twilio\/callfilter\//, { body: fx.callfilter }],
      ['GET', '/api/funstat', { body: fx.funstat }],
      ['POST', /^\/api\/autocheck\/check\//, (c) => ({ body: fx.autocheck[c.url.pathname.split('/').pop()!] ?? { exists: false } })]
    ])
    const progress = trackProgress(ctx)
    const out = await rosoPhone.run(entity('phone', '06 12 34 56 78'), ctx)
    expect(calls.find((c) => c.url.pathname === '/api/gateway/phone/log')?.body).toEqual({ phone: '+33612345678' })
    const auto = calls.filter((c) => c.url.pathname.startsWith('/api/autocheck/check/'))
    expect(auto.length).toBe(phonePlatforms('+33612345678').length - 2)
    expect(auto[0].headers['x-roso-client']).toBe('phone')
    expect(auto[0].body).toEqual({ phoneNumber: '+33612345678' })
    expect(calls.find((c) => c.url.pathname === '/api/funstat')?.url.searchParams.get('id')).toBe('123456789')

    expect(out.properties).toMatchObject({ carrier: 'Orange', line_type: 'mobile', hlr_status: 'active', roso_credits_left: 14 })
    expect(find(out, 'carrier', 'Orange')).toMatchObject({ platform: 'orange' })
    expect(find(out, 'account', 'jdupont_tg')?.platform).toBe('telegram')
    expect(out.entities!.find((e) => e.platform === 'whatsapp')).toMatchObject({ label: '+33612345678', image: 'https://pps.whatsapp.net/v/t61.24694-24/abc.jpg' })
    expect(find(out, 'person', 'Jean Dupont')).toBeTruthy()
    expect(find(out, 'address', '12 rue de la Paix, 75002 Paris')?.data).toMatchObject({ city: 'Paris', postcode: '75002' })
    expect(out.properties?.roso_found_on).toEqual(expect.arrayContaining(['Telegram', 'WhatsApp', 'CallApp']))
    expect(out.properties?.roso_errors).toBe(1)

    // Twilio : validité et pays, comme sur le site.
    expect(out.properties).toMatchObject({ twilio_valid: true, twilio_country: 'France' })
    // Pivots sur le numéro : l'email masqué d'Apple (et de Sleeper), les lieux ; le téléphone
    // masqué de Sleeper est celui qu'on cherche, il n'est pas répété.
    expect(out.properties?.masked_emails).toEqual(['d•••••@e•••••.com (Sleeper, Apple)'])
    expect(out.properties?.masked_phones).toBeUndefined()
    expect(out.properties?.locations).toEqual(expect.arrayContaining(['Lyon, France (Explurger)']))
    // Le compte Apple garde aussi son email masqué.
    expect(out.entities!.find((e) => e.platform === 'apple')?.data).toMatchObject({ masked_emails: ['d•••••@e•••••.com'] })

    // Pastille : 0/N au départ, puis une avance par plateforme jusqu'à N/N.
    const total = phonePlatforms('+33612345678').length
    expect(progress[0]).toEqual([0, total, 'plateformes'])
    expect(progress.at(-1)?.[0]).toBe(total)
    expect(progress.every(([, t]) => t === total)).toBe(true)
    expect(progress.some(([, , d]) => /^plateformes · \d+ trouvés · /.test(d ?? ''))).toBe(true)
  })

  it('lit la réponse Twilio brute ou enveloppée', () => {
    const fx = fixture<J>('phone.json')
    expect(parseTwilio(fx.twilio, 'en')).toMatchObject({ carrier: 'Orange', line_type: 'mobile', mccmnc: '208/01', twilio_valid: true, twilio_country: 'France' })
    expect(parseTwilio({ data: { phone_number: '+447700900123', valid: false, country_code: 'GB', caller_name: { caller_name: 'ACME LTD' } } }, 'fr')).toMatchObject({
      twilio_valid: false,
      twilio_country: 'Royaume-Uni',
      twilio_caller_name: 'ACME LTD'
    })
  })

  it('remonte un refus de lancement', async () => {
    const { ctx } = mockContext([NO_MAINTENANCE, ['POST', '/api/gateway/phone/log', { status: 403, body: fixture<J>('errors.json').forbidden }]])
    await expectError(rosoPhone.run(entity('phone', '+33612345678'), ctx), 'auth', /non autorisé/)
  })
})

describe('roso.ip', () => {
  const fx = fixture<J>('ip.json')
  it('géolocalise et agrège les sources CTI', async () => {
    const { ctx, calls } = mockContext([
      NO_MAINTENANCE,
      ['POST', '/api/gateway/ip/start', { body: fx.start }],
      ['GET', '/api/gateway/ip/lookup', { body: fx.lookup }],
      ['GET', /^\/api\/ip-preprod\/lookup\//, (c) => ({ body: fx.sources[c.url.pathname.split('/').pop()!] ?? { status: 'error' } })]
    ])
    const progress = trackProgress(ctx)
    const out = await rosoIp.run(entity('ip', '1.1.1.1'), ctx)
    expectFinished(progress)
    expect(calls.find((c) => c.url.pathname === '/api/gateway/ip/start')?.body).toEqual({ ip: '1.1.1.1' })
    expect(calls.filter((c) => c.url.pathname.startsWith('/api/ip-preprod/lookup/')).length).toBe(13)
    expect(out.properties).toMatchObject({ country: 'Australie', city: 'Brisbane', asn: 'AS13335', reverse: 'one.one.one.one', lat: -27.4679, lon: 153.0281, roso_credits_left: 13 })
    expect(out.properties?.flags).toEqual(['hosting', 'anycast'])
    expect(out.properties?.roso_sources).toEqual(['virustotal', 'otx'])
    expect(out.properties?.roso_virustotal).toEqual({ Malveillant: 0, Réputation: 120 })
    expect(find(out, 'asn', 'AS13335')).toBeTruthy()
    expect(find(out, 'hosting')?.platform).toBe('cloudflare')
    expect(find(out, 'domain', 'one.one.one.one')).toBeTruthy()
    expect(find(out, 'organization', 'APNIC and Cloudflare DNS Resolver project')).toBeTruthy()
  })
})

describe('roso.domain', () => {
  const fx = fixture<J>('domain.json')
  it('lit les contacts RDAP en ignorant les valeurs masquées', () => {
    const { registrar, contacts } = rdapContacts(fx.rdap.data)
    expect(registrar).toBe('RESERVED-Internet Assigned Numbers Authority')
    expect(contacts).toEqual([{ role: 'registrant', name: 'Jane Registrant', org: 'Example Org', email: 'jane@example.com', phone: '+33.612345678' }])
  })

  it('agrège les modules du scan domaine', async () => {
    const map: Record<string, unknown> = {
      cti: fx.cti,
      rdap: fx.rdap,
      crtsh: fx.crtsh,
      'whois-history': fx.whoisHistory,
      intelx: fx.intelx,
      hudsonrock: fx.hudsonrock,
      wayback: fx.wayback,
      virustotal: fx.virustotal,
      urlscan: fx.urlscan,
      abuseipdb: fx.abuseipdb,
      otx: fx.otx
    }
    const { ctx, calls } = mockContext([
      NO_MAINTENANCE,
      ['POST', '/api/gateway/domain/start', { body: fx.start }],
      ['GET', /^\/api\/gateway\/domain\//, (c) => ({ body: map[c.url.pathname.replace('/api/gateway/domain/', '')] ?? { success: false } })]
    ])
    const progress = trackProgress(ctx)
    const out = await rosoDomain.run(entity('domain', 'https://www.Example.com/page'), ctx)
    expectFinished(progress)
    expect(calls.find((c) => c.url.pathname === '/api/gateway/domain/start')?.body).toEqual({ domain: 'example.com' })
    expect(calls.find((c) => c.url.pathname === '/api/gateway/domain/cti')?.url.searchParams.get('visual')).toBe('1')
    expect(out.properties).toMatchObject({
      registrar: 'RESERVED-Internet Assigned Numbers Authority',
      created_at: '1995-08-14T04:00:00Z',
      expires_at: '2027-08-13T04:00:00Z',
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
      roso_credits_left: 11,
      roso_intelx_records: 1,
      roso_hudsonrock_total: 3,
      roso_hudsonrock_families: ['RedLine', 'Vidar'],
      roso_vt_malicious: 1,
      roso_urlscan_scans: 1200,
      roso_otx_pulses: 2,
      roso_whois_history_records: 2
    })
    expect(out.properties?.roso_wayback_urls).toEqual(['https://example.com/', 'https://example.com/old'])
    const site = find(out, 'website', 'https://www.example.com/')!
    expect(site.image).toBe('data:image/jpeg;base64,iVBORw0KGgo=')
    expect(site.data).toMatchObject({ title: 'Example Domain', server: 'ECAcc', lat: 34.0522, lon: -118.2437 })
    expect(labels(out, 'email').sort()).toEqual(['contact@example.com', 'jane@example.com', 'john.old@example.net'])
    expect(find(out, 'organization', 'Example Org')).toBeTruthy()
    expect(find(out, 'person', 'Jane Registrant')).toBeTruthy()
    expect(find(out, 'person', 'John Old')).toBeTruthy()
    expect(find(out, 'phone', '+33612345678')).toBeTruthy()
    expect(labels(out, 'person')).not.toContain('Data Protected')
    expect(labels(out, 'domain').sort()).toEqual(['api.example.com', 'cdn.example.com', 'mail.example.com', 'www.example.com'])
    expect(labels(out, 'ip').sort()).toEqual(['198.51.100.4', '2606:2800:21f:cb07:6820:80da:af6b:8b2c', '93.184.215.14'])
    expect(find(out, 'ip', '93.184.215.14')?.data).toMatchObject({ abuse_reports: 2 })
    expect(JSON.stringify(out.raw)).not.toContain('iVBORw0KGgo=')
  })
})

describe('roso.name', () => {
  it('convertit les profils candidats', async () => {
    const fx = fixture<J>('name.json')
    const { ctx, calls } = mockContext([NO_MAINTENANCE, ['POST', '/api/gateway/name/search', { body: fx.search }]])
    const progress = trackProgress(ctx)
    const out = await rosoName.run(entity('person', 'Jean  Dupont', { data: { city: 'Lyon' } }), ctx)
    expectFinished(progress)
    expect(calls.find((c) => c.url.pathname === '/api/gateway/name/search')?.body).toMatchObject({ firstName: 'Jean', lastName: 'Dupont', location: 'Lyon', fullName: 'Jean Dupont', q: 'Jean Dupont' })
    expect(out.properties).toMatchObject({ roso_credits_left: 12, roso_found_count: 3 })
    expect(find(out, 'account', 'jean-dupont-42')).toMatchObject({ platform: 'linkedin', image: 'https://media.licdn.com/abc.jpg' })
    expect(find(out, 'account', 'jean-dupont-42')?.data).toMatchObject({ match_score: 0.92, location: 'Lyon' })
    expect(find(out, 'person', 'Jean Dupont')).toBeTruthy()
    expect(find(out, 'email', 'jdupont@laposte.net')?.from).toBe('cand_1')
    expect(find(out, 'phone', '+33611223344')).toBeTruthy()
  })
})

describe('roso.partial_number', () => {
  const fx = fixture<J>('partial.json')
  it('développe les masques comme le site', () => {
    const one = expandMask('+33 6 12 34 56 *8')
    expect(one.ok).toBe(true)
    expect(one.combos.length).toBe(10)
    expect(one.combos[7].phone).toBe('+33612345678')
    expect(expandMask('06 12 34 56 **').combos.length).toBe(100)
    expect(expandMask('06 12 34 56 **').combos[0].phone).toBe('+33612345600')
    expect(expandMask('+33612345678').reason).toBe('no_stars')
    expect(expandMask('+33 6 ** ** 5* 78').reason).toBe('too_many_stars')
    expect(expandMask('+33 6 12 a4 56 *8').reason).toBe('junk')
    expect(expandMask('12 34 56 *8').reason).toBe('no_country_code')
  })

  it('teste chaque combinaison et garde les hits', async () => {
    const { ctx, calls } = mockContext([
      ['POST', '/api/gateway/partial-number/start', { body: fx.start }],
      ['POST', '/api/gateway/partial-number/check', (c) => ({ body: (c.body as J).phone === fx.hitPhone ? fx.hit : fx.miss })]
    ])
    const progress = trackProgress(ctx)
    const out = await rosoPartial.run(entity('keyword', '+33 6 12 34 56 *8'), ctx)
    expectFinished(progress)
    expect(progress.at(-1)?.[2]).toMatch(/^combinaisons · /)
    expect(calls.filter((c) => c.url.pathname.endsWith('/check')).length).toBe(10)
    expect(calls[0].body).toEqual({})
    expect(out.properties).toMatchObject({ roso_credits_left: 5, roso_combinations: 10, roso_checked: 10, roso_found_count: 1 })
    const cand = find(out, 'phone', '+33612345678')!
    expect(cand.data).toMatchObject({ roso_services: ['CallApp', 'Eyecon'] })
    expect(cand.image).toBe('https://s3.callapp.com/photos/xyz.jpg')
    expect(labels(out, 'person').sort()).toEqual(['Jean D.', 'Jean Dupont'])
  })

  it("s'arrête sur une limite CallApp / Eyecon", async () => {
    const { ctx, calls } = mockContext([
      ['POST', '/api/gateway/partial-number/start', { body: fx.start }],
      ['POST', '/api/gateway/partial-number/check', { body: fx.rateLimited }]
    ])
    const out = await rosoPartial.run(entity('keyword', '+33 6 12 34 56 *8'), ctx)
    expect(calls.filter((c) => c.url.pathname.endsWith('/check')).length).toBe(1)
    expect(out.properties?.roso_stopped).toMatch(/callapp/)
  })
})

describe('roso.crypto', () => {
  it('interroge les modules du catalogue', async () => {
    const fx = fixture<J>('crypto.json')
    const { ctx, calls } = mockContext([
      NO_MAINTENANCE,
      ['GET', '/api/gateway/crypto/meta', { body: fx.meta }],
      ['POST', /^\/api\/gateway\/crypto\//, (c) => ({ body: fx.modules[c.url.pathname.split('/').pop()!] ?? { success: true, exists: false } })]
    ])
    const progress = trackProgress(ctx)
    const out = await rosoCrypto.run(entity('crypto_wallet', '0x1234567890abcdef1234567890abcdef12345678', { platform: 'ethereum' }), ctx)
    expectFinished(progress)
    const mods = calls.filter((c) => c.method === 'POST')
    expect(mods.length).toBe(6)
    expect(mods[0].body).toEqual({ address: '0x1234567890abcdef1234567890abcdef12345678', api_key: TEST_KEY })
    expect(out.properties).toMatchObject({ chain: 'ethereum', balance: '1.23 ETH', tx_count: 42, first_seen: '2020-01-01T00:00:00.000Z', roso_found_count: 4, roso_errors: 1 })
    expect(out.properties?.roso_labels).toEqual(['Binance 14', 'Hot Wallet'])
    expect(find(out, 'account', 'cryptojean')).toMatchObject({ platform: 'opensea', image: 'https://i.seadn.io/abc.png' })
    expect(find(out, 'email', 'cryptojean@proton.me')).toBeTruthy()
    expect(find(out, 'domain', 'jean.eth')).toBeTruthy()
    expect(find(out, 'organization', 'Binance')).toBeTruthy()
    expect(JSON.stringify(out.raw)).not.toContain(TEST_KEY)
  })
})

describe('roso.iban', () => {
  it('vérifie un IBAN', async () => {
    const fx = fixture<J>('iban.json')
    const { ctx, calls } = mockContext([NO_MAINTENANCE, ['POST', '/api/gateway/iban/check', { body: fx.check }]])
    const progress = trackProgress(ctx)
    const out = await rosoIban.run(entity('iban', 'FR76 3000 6000 0112 3456 7890 189'), ctx)
    expectFinished(progress)
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ iban: 'FR7630006000011234567890189' })
    expect(out.properties).toMatchObject({ valid: true, bic: 'BNPAFRPPXXX', bank: 'BNP PARIBAS', country: 'France', roso_credits_left: 19, sepa: ['credit_transfer', 'direct_debit', 'instant'] })
    expect(find(out, 'bank', 'BNP PARIBAS')?.data).toMatchObject({ bic: 'BNPAFRPPXXX', branch: '00001 · PARIS CENTRE' })
    expect(find(out, 'address', '16 boulevard des Italiens, 75009 Paris')?.from).toBe('bank')
    await expectError(rosoIban.run(entity('iban', 'FR7630006000011234567890188'), ctx), 'invalid_input')
  })
})

describe('roso.domain : contacts RDAP', () => {
  it('ignore les valeurs masquées et les contacts du registrar', async () => {
    const { rdapContacts } = await import('../../src/main/modules/roso/domain')
    const vcard = (fields: Array<[string, string]>): unknown => ['vcard', fields.map(([k, v]) => [k, {}, 'text', v])]
    const { registrar, contacts } = rdapContacts({
      entities: [
        { roles: ['registrar'], vcardArray: vcard([['fn', 'Exemple Registrar SA']]) },
        { roles: ['registrant'], vcardArray: vcard([['fn', '***'], ['email', 'REDACTED FOR PRIVACY']]) },
        { roles: ['administrative'], vcardArray: vcard([['fn', 'Ano Nymous']]) },
        { roles: ['technical'], vcardArray: vcard([['fn', 'Exemple Registrar SA'], ['email', 'tech@registrar.example']]) },
        { roles: ['billing'], vcardArray: vcard([['fn', 'Dupont Conseil SARL']]) }
      ]
    })
    expect(registrar).toBe('Exemple Registrar SA')
    expect(contacts).toEqual([{ role: 'billing', org: 'Dupont Conseil SARL' }])
  })
})
