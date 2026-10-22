import { describe, expect, it } from 'vitest'
import {
  BLACKLIST,
  allSites,
  checkSite,
  compileRegex,
  evaluate,
  interpolate,
  isLegal,
  profileUrlFor,
  scanSites,
  selectSites,
  type SherlockSite
} from '../../src/main/modules/username/_sherlock'
import { tierSites } from '../../src/main/modules/username/_catalog'
import { accountEntity, modules, platformForSite } from '../../src/main/modules/username/sites'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext } from './social_helpers'

const site = (s: Partial<SherlockSite>): SherlockSite => ({
  name: 'Test',
  url: 'https://example.com/u/{}',
  urlMain: 'https://example.com/',
  errorType: 'status_code',
  ...s
})

describe('base Sherlock', () => {
  it('charge les sites et sépare les sites adultes', () => {
    const all = allSites()
    expect(all.length).toBeGreaterThan(400)
    expect(all.some((s) => s.name.startsWith('$'))).toBe(false)
    const sfw = selectSites({ nsfw: false })
    const nsfw = selectSites({ nsfw: true })
    expect(nsfw.length).toBeGreaterThan(10)
    expect(sfw.every((s) => !s.isNSFW)).toBe(true)
    expect(nsfw.every((s) => s.isNSFW)).toBe(true)
    expect(sfw.length + nsfw.length).toBe(all.length - Object.keys(BLACKLIST).filter((n) => all.some((s) => s.name === n)).length)
  })

  it('écarte les sites de la liste noire, qui existent tous dans la base', () => {
    const names = new Set(allSites().map((s) => s.name))
    for (const n of Object.keys(BLACKLIST)) expect(names.has(n), n).toBe(true)
    const sfw = selectSites({ nsfw: false }).map((s) => s.name)
    expect(sfw).not.toContain('Spotify')
    expect(sfw).not.toContain('HudsonRock')
    expect(sfw).toContain('GitHub')
  })

  it('compile toutes les expressions regexCheck en JavaScript', () => {
    for (const s of allSites()) if (s.regexCheck) expect(compileRegex(s.regexCheck), `${s.name}: ${s.regexCheck}`).not.toBeNull()
    // Syntaxe Python {,n}
    expect(compileRegex('^[\\w-]{,34}$')!.test('abc')).toBe(true)
    expect(compileRegex('^[\\w-]{,3}$')!.test('abcd')).toBe(false)
  })

  it('applique regexCheck comme re.search (non ancré)', () => {
    expect(isLegal(site({ regexCheck: '^[a-z]+$' }), 'abc')).toBe(true)
    expect(isLegal(site({ regexCheck: '^[a-z]+$' }), 'ab.c')).toBe(false)
    expect(isLegal(site({ regexCheck: '[a-z0-9]{4,16}' }), '..abcd..')).toBe(true)
  })

  it('interpole le pseudo dans les chaînes, objets et listes', () => {
    expect(interpolate({ q: 'x', v: { name: '{}' }, l: ['{}', 1] }, 'bob')).toEqual({ q: 'x', v: { name: 'bob' }, l: ['bob', 1] })
    expect(profileUrlFor(site({}), 'a b')).toBe('https://example.com/u/a%20b')
  })
})

describe('règles de détection', () => {
  it('status_code', () => {
    const s = site({})
    expect(evaluate(s, { status: 200, text: '' })).toBe('claimed')
    expect(evaluate(s, { status: 404, text: '' })).toBe('available')
    expect(evaluate(s, { status: 301, text: '' })).toBe('available')
    expect(evaluate(site({ errorCode: 204 }), { status: 204, text: '' })).toBe('available')
    expect(evaluate(site({ errorCode: [200, 410] }), { status: 200, text: '' })).toBe('available')
    // Blocage ou quota : absence non démontrée
    expect(evaluate(s, { status: 403, text: '' })).toBe('error')
    expect(evaluate(s, { status: 429, text: '' })).toBe('error')
  })

  it('message (chaîne ou liste)', () => {
    const s = site({ errorType: 'message', errorMsg: ['No such user', 'Sorry.'] })
    expect(evaluate(s, { status: 200, text: '<p>No such user.</p>' })).toBe('available')
    expect(evaluate(s, { status: 200, text: '<p>Sorry.</p>' })).toBe('available')
    expect(evaluate(s, { status: 200, text: '<h1>bob</h1>' })).toBe('claimed')
    expect(evaluate(site({ errorType: 'message', errorMsg: 'gone' }), { status: 200, text: 'gone' })).toBe('available')
    // Page d'erreur HTTP sans le message attendu : pas un compte
    expect(evaluate(s, { status: 503, text: 'maintenance' })).toBe('error')
  })

  it('response_url', () => {
    const s = site({ errorType: 'response_url' })
    expect(evaluate(s, { status: 200, text: '' })).toBe('claimed')
    expect(evaluate(s, { status: 302, text: '' })).toBe('available')
  })

  it('reconnaît les pages de pare-feu', () => {
    expect(evaluate(site({}), { status: 200, text: '<html><span id="challenge-error-text">x</span>' })).toBe('waf')
  })
})

describe('requêtes', () => {
  it('HEAD pour status_code, GET pour message, POST JSON avec en-têtes, redirections manuelles', async () => {
    const ctx = fakeContext([
      [/head\.test\/u\/bob/, { status: 200 }],
      [/msg\.test\/u\/bob/, { status: 200, body: 'Profile of bob' }],
      [/api\.test\/check/, (_u, init) => ({ status: 200, body: String(init.json && JSON.stringify(init.json)).includes('bob') ? '{"taken":true}' : '{"taken":false}' })],
      [/redir\.test\/u\/bob/, { status: 302, headers: { location: '/' } }]
    ])
    const sites = [
      site({ name: 'Head', url: 'https://head.test/u/{}' }),
      site({ name: 'Msg', url: 'https://msg.test/u/{}', errorType: 'message', errorMsg: 'not found' }),
      site({
        name: 'Api',
        url: 'https://api.test/u/{}',
        urlProbe: 'https://api.test/check',
        errorType: 'message',
        errorMsg: '{"taken":false}',
        request_method: 'POST',
        request_payload: { username: '{}' },
        headers: { 'X-Test': '1' }
      }),
      site({ name: 'Redir', url: 'https://redir.test/u/{}', errorType: 'response_url' }),
      site({ name: 'Illegal', url: 'https://never.test/{}', regexCheck: '^\\d+$' })
    ]
    const progress: Array<[number, number, string | undefined]> = []
    ctx.progress = (done, total, detail) => void progress.push([done, total, detail])
    const res = await scanSites(sites, 'bob', ctx, { concurrency: 4 })
    const by = Object.fromEntries(res.map((r) => [r.site, r.status]))
    expect(by).toEqual({ Head: 'claimed', Msg: 'claimed', Api: 'claimed', Redir: 'available', Illegal: 'illegal' })
    // Pastille : 0/5 au départ, une avance par site, et le nombre de comptes trouvés.
    expect(progress[0]).toEqual([0, 5, 'sites'])
    expect(progress.map(([d]) => d)).toEqual([0, 1, 2, 3, 4, 5])
    expect(progress.at(-1)?.[2]).toMatch(/^sites · 3 trouvés · /)
    const call = (host: string) => ctx.calls.find((c) => c.url.includes(host))!
    expect(call('head.test').method).toBe('HEAD')
    expect(call('msg.test').method).toBe('GET')
    expect(call('msg.test').headers['accept-language']).toMatch(/^en/)
    expect(call('api.test').method).toBe('POST')
    expect(call('api.test').body).toBe('{"username":"bob"}')
    expect(call('api.test').headers['x-test']).toBe('1')
    expect(ctx.calls.some((c) => c.url.includes('never.test'))).toBe(false)
  })

  it('défi anti-robot signalé par les en-têtes (AWS WAF, Cloudflare) : ni compte ni absence', async () => {
    const ctx = fakeContext([
      [/aws\.test/, { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } }],
      [/cf\.test/, { status: 403, headers: { 'cf-mitigated': 'challenge' } }]
    ])
    expect((await checkSite(site({ url: 'https://aws.test/{}' }), 'bob', ctx)).status).toBe('waf')
    expect((await checkSite(site({ url: 'https://cf.test/{}', errorType: 'message', errorMsg: 'x' }), 'bob', ctx)).status).toBe('waf')
  })

  it('Twitch : message d’erreur réduit à la phrase, quelle que soit la ponctuation de la balise', () => {
    const twitch = allSites().find((s) => s.name === 'Twitch')!
    const phrase = 'Twitch is the world&#39;s leading video platform and community for gamers.'
    expect(twitch.errorMsg).toBe(phrase)
    expect(evaluate(twitch, { status: 200, text: `<meta property="og:description" content="${phrase}">` })).toBe('available')
    expect(evaluate(twitch, { status: 200, text: `<meta name="description" content='${phrase}'>` })).toBe('available')
    expect(evaluate(twitch, { status: 200, text: '<meta name="description" content="xQc streams live on Twitch!">' })).toBe('claimed')
  })

  it('rapporte les erreurs réseau sans lever', async () => {
    const ctx = fakeContext([])
    ctx.fetch = async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })
    }
    const r = await checkSite(site({}), 'bob', ctx)
    expect(r).toMatchObject({ status: 'error', error: 'ECONNRESET' })
  })
})

describe('entités produites', () => {
  it('associe les sites aux plateformes du catalogue', () => {
    expect(platformForSite('GitHub')).toBe('github')
    expect(platformForSite('Twitter')).toBe('x')
    expect(platformForSite('Steam Community (User)')).toBe('steam')
    expect(platformForSite('mastodon.social')).toBe('mastodon')
    expect(platformForSite('Polygon')).toBeUndefined()
    expect(platformForSite('Gitee')).toBe('gitee')
    expect(platformForSite('Instructables')).toBeUndefined()
  })

  it('crée un compte avec plateforme, ou avec le nom du site sinon', () => {
    const gh = allSites().find((s) => s.name === 'GitHub')!
    expect(accountEntity(gh, { site: 'GitHub', url: 'https://www.github.com/bob', status: 'claimed' }, 'bob', 'fr')).toMatchObject({
      type: 'account',
      label: 'bob',
      platform: 'github',
      data: { username: 'bob', url: 'https://www.github.com/bob', site: 'GitHub' }
    })
    const site = allSites().find((s) => s.name === 'Instructables')!
    const e = accountEntity(site, { site: 'Instructables', url: 'https://www.instructables.com/member/bob', status: 'claimed' }, 'bob', 'fr')
    expect(e.platform).toBeUndefined()
    expect(e.label).toBe('bob (Instructables)')
    const masto = allSites().find((s) => s.name === 'mastodon.social')!
    expect(accountEntity(masto, { site: 'mastodon.social', url: 'https://mastodon.social/@bob', status: 'claimed' }, 'bob', 'fr').label).toBe('bob@mastodon.social')
  })

  it('module : refuse un pseudo avec espaces, trouve les comptes simulés', async () => {
    const [sitesModule] = modules
    await expect(runModule(sitesModule, entity('username', 'jean dupont'))).rejects.toThrow()
    const ctx = fakeContext([[/github\.com\/bob$/, { status: 200 }], [/.*/, { status: 404, body: 'not found' }]])
    const out = await sitesModule.run(entity('username', 'bob'), ctx)
    expect(out.entities?.some((e) => e.platform === 'github')).toBe(true)
    // Palier Essentiel : sites Sherlock plus le complément Maigret.
    expect((out.raw as { tested: number }).tested).toBe(tierSites('essential').length)
  }, 60000)
})

/** Erreur de réseau ou de service (quota, panne, blocage) : le test en direct est sauté, pas en échec. */
function isNetworkTrouble(e: unknown): boolean {
  const code = (e as { code?: string })?.code
  return (code !== undefined && ['rate_limited', 'unavailable', 'blocked'].includes(code)) || /fetch failed/i.test(String((e as Error)?.message ?? e))
}

async function live<T>(t: { skip: () => void }, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isNetworkTrouble(e)) t.skip()
    throw e
  }
}

// Pseudo aléatoire, qui ne doit exister nulle part.
const randomName = (): string => `zq${Math.random().toString(36).slice(2, 11).replace(/\d/g, 'k')}x`

describe.skipIf(!LIVE)('live', () => {
  it('aucun faux positif sur un pseudo aléatoire (palier Essentiel, durée mesurée)', async (t) => {
    const out = await live(t, () => runModule(modules[0], entity('username', randomName()), makeContext()))
    const raw = out.raw as { tested: number; duration_ms: number; errors: number; blocked_by_waf: number }
    console.log(`username.sites : ${raw.tested} sites en ${Math.round(raw.duration_ms / 1000)} s (${raw.errors} erreurs, ${raw.blocked_by_waf} pare-feu)`)
    expect(out.entities?.map((e) => e.data?.site)).toEqual([])
  }, 300000)

  it('trouve de nombreux comptes pour le pseudo témoin de la base Sherlock', async (t) => {
    // « blue » est le `username_claimed` de nombreux sites Sherlock (pseudo témoin public).
    const out = await live(t, () => runModule(modules[0], entity('username', 'blue'), makeContext()))
    const sites = out.entities?.map((e) => e.data?.site) ?? []
    expect(sites.length).toBeGreaterThan(40)
    expect(sites).toEqual(expect.arrayContaining(['Telegram', 'Docker Hub']))
  }, 300000)

  it('Twitch : témoin trouvé, pseudo aléatoire absent (message d’erreur corrigé)', async (t) => {
    const twitch = allSites().find((s) => s.name === 'Twitch')!
    const ctx = makeContext()
    const claimed = await live(t, () => checkSite(twitch, twitch.username_claimed!, ctx))
    const random = await live(t, () => checkSite(twitch, randomName(), ctx))
    if (claimed.status === 'error' || random.status === 'error' || claimed.status === 'waf' || random.status === 'waf') t.skip()
    expect(claimed.status).toBe('claimed')
    expect(random.status).toBe('available')
  }, 60000)
})
