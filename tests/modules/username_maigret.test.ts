// Moteur au format Maigret, paliers de sites, mise à jour de la base (empreinte SHA-256) et cache
// de santé des sites. Pseudos utilisés : témoins fournis par les bases et pseudos aléatoires.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FetchOptions } from '@shared/modules'
import { catalog, hostOf, MAIGRET_BLACKLIST, maigretDef, scan, tierSites, tierSkipped, type SiteDef } from '../../src/main/modules/username/_catalog'
import { counterCheck, HEALTH_TTL_MS, HealthStore, healthy, healthStore, randomUsernameFor, selfCheck, verdictOf } from '../../src/main/modules/username/_health'
import {
  checkMaigretSite,
  convertPythonRegex,
  decodeBody,
  evaluateMaigret,
  formatPayload,
  hasNestedQuantifier,
  isLegalFor,
  isPublicHttpUrl,
  mergeEntry,
  probeUrl,
  profileUrl,
  pyFormat,
  quoteUsername,
  skipReason,
  type MaigretData,
  type MaigretEntry,
  type MaigretSite
} from '../../src/main/modules/username/_maigret'
import { BLACKLIST, allSites, selectSites } from '../../src/main/modules/username/_sherlock'
import { configureSiteData, dbInfo, isAllowedDataUrl, loadDb, parseRemoteMeta, sha256, updateDb, validateMaigretData } from '../../src/main/modules/username/_siteDb'
import { forumsSummary, modules } from '../../src/main/modules/username/sites'
import { entity, LIVE, makeContext } from '../helpers/context'
import { fakeContext } from './social_helpers'

const FIX = resolve(__dirname, '../fixtures/username')
// Fin de ligne normalisée : l'empreinte annoncée est celle du fichier en LF.
const fixtureData = (): string => readFileSync(join(FIX, 'maigret_data.json'), 'utf8').replace(/\r\n/g, '\n')
const fixtureMeta = (): Record<string, unknown> => JSON.parse(readFileSync(join(FIX, 'maigret_db_meta.json'), 'utf8'))
const fixtureDb = (): MaigretData => JSON.parse(fixtureData()) as MaigretData

const site = (s: Partial<MaigretSite>): MaigretSite => ({ name: 'Test', url: 'https://example.test/u/{username}', urlMain: 'https://example.test', checkType: 'status_code', ...s })

describe('lecture des entrées Maigret', () => {
  it('fusionne le moteur : listes ajoutées, dictionnaires complétés, champs simples si absents', () => {
    const db = fixtureDb()
    const forum = mergeEntry('Forum Discourse', db.sites['Forum Discourse'], db.engines)
    expect(forum.checkType).toBe('message')
    expect(forum.url).toBe('{urlMain}/u/{username}/summary')
    expect(forum.presenseStrs).toEqual(['<meta name="generator" content="Discourse'])
    expect(forum.absenceStrs).toHaveLength(2)
    expect(profileUrl(forum, 'alice')).toBe('https://forum.example.test/u/alice/summary')

    const engines = { E: { site: { checkType: 'message', absenceStrs: ['b'], errors: { x: 'X' }, url: '{urlMain}/e/{username}' } } }
    const own: MaigretEntry = { engine: 'E', urlMain: 'https://f.test', checkType: 'status_code', absenceStrs: ['a'], errors: { y: 'Y' } }
    const merged = mergeEntry('F', own, engines)
    expect(merged.checkType).toBe('status_code')
    expect(merged.absenceStrs).toEqual(['a', 'b'])
    expect(merged.errors).toEqual({ y: 'Y', x: 'X' })
    expect(merged.url).toBe('{urlMain}/e/{username}')
    // Sans checkType ni moteur : status_code, comme Maigret.
    expect(mergeEntry('G', { url: 'https://g.test/{username}' }).checkType).toBe('status_code')
  })

  it('gabarits : urlMain, urlSubpath, urlProbe, getParams et encodage du pseudo', () => {
    const s = site({ url: '{urlMain}{urlSubpath}/members/{username}', urlMain: 'https://f.test/', urlSubpath: '/forum', urlProbe: '{urlMain}api?u={username}', getParams: { limit: 1 } })
    expect(profileUrl(s, 'bob')).toBe('https://f.test/forum/members/bob')
    expect(probeUrl(s, 'bob')).toBe('https://f.test/api?u=bob&limit=1')
    expect(profileUrl(site({}), 'a b/c#d')).toBe('https://example.test/u/a%20b%2Fc%23d')
    expect(quoteUsername("it's")).toBe('it%27s')
    expect(pyFormat('{{x}} {username}', { username: 'bob' })).toBe('{x} bob')
    expect(pyFormat('{inconnu}', { username: 'bob' })).toBeNull()
    expect(formatPayload({ query: '{{ user(name: "{username}") }}', n: 5, u: '{username}' }, 'a"b')).toEqual({ query: '{ user(name: "a\\"b") }', n: 5, u: 'a"b' })
  })

  it('écarte les sites désactivés, protégés, à jeton, hors web ou d’un autre type d’identifiant', () => {
    const reason = (e: MaigretEntry): string | null => skipReason(mergeEntry('S', e), e)
    const base = { url: 'https://s.test/{username}' }
    expect(reason(base)).toBeNull()
    expect(reason({ ...base, disabled: true })).toBe('disabled')
    expect(reason({ ...base, protection: ['tls_fingerprint'] })).toBe('protection')
    expect(reason({ ...base, activation: { method: 'twitter' } })).toBe('activation')
    expect(reason({ ...base, type: 'steam_id' })).toBe('type')
    expect(reason({ ...base, protocol: 'tor' })).toBe('protocol')
    expect(reason({ url: 'https://s.test/profile' })).toBe('url')
    expect(reason({ ...base, engine: 'Inconnu' })).toBe('engine')
    expect(reason({ ...base, checkType: 'regex' })).toBe('check_type')
    // URL interrogée hors du web public (base mise à jour malveillante) : jamais interrogée.
    expect(reason({ ...base, urlProbe: 'http://127.0.0.1:8080/{username}' })).toBe('url')
    expect(reason({ ...base, urlProbe: 'file:///etc/{username}' })).toBe('url')
    expect(isPublicHttpUrl('https://forum.example.org/u/x')).toBe(true)
    for (const u of ['http://localhost/x', 'http://192.168.1.1/x', 'http://10.0.0.2/', 'http://[::1]/', 'http://169.254.169.254/latest', 'ftp://example.org/'])
      expect(isPublicHttpUrl(u), u).toBe(false)
  })
})

describe('regexCheck', () => {
  it('convertit les constructions Python', () => {
    expect(convertPythonRegex('^(?P<n>[a-z]+)(?P=n)$')!.test('abab')).toBe(true)
    expect(convertPythonRegex('\\A[a-z]+\\Z')!.test('abc')).toBe(true)
    expect(convertPythonRegex('(?i)^[a-z]+$')!.test('ABC')).toBe(true)
    expect(convertPythonRegex('^[\\w-]{,3}$')!.test('abcd')).toBe(false)
    expect(convertPythonRegex('^[a-zA-Z0-9_\\.]{3,49}(?<!\\.com|\\.org|\\.net)$')!.test('bob.com')).toBe(false)
    expect(convertPythonRegex('^[^\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]+$')!.test('漢字')).toBe(false)
  })

  it('saute les constructions sans équivalent et les expressions à risque de ReDoS', () => {
    expect(convertPythonRegex('(?>a+)b')).toBeNull()
    expect(convertPythonRegex('a++')).toBeNull()
    expect(convertPythonRegex('(?x) a b')).toBeNull()
    expect(convertPythonRegex('^(a+)+$')).toBeNull()
    expect(hasNestedQuantifier('^([a-z]+)*$')).toBe(true)
    expect(hasNestedQuantifier('(\\w+\\s?)+$')).toBe(true)
    expect(hasNestedQuantifier('^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$')).toBe(false)
    expect(hasNestedQuantifier('^(?!id\\d)[a-zA-Z0-9_]*$')).toBe(false)
    expect(hasNestedQuantifier('^([a-zA-Z0-9_]){1,15}$')).toBe(false)
    // Contrôle sauté : le site reste interrogé.
    expect(isLegalFor({ regexCheck: '^(a+)+$' }, 'bob')).toBe(true)
  })

  it('applique le contrôle comme re.search, sur un pseudo de longueur bornée', () => {
    expect(isLegalFor({ regexCheck: '^[a-z]+$' }, 'bob')).toBe(true)
    expect(isLegalFor({ regexCheck: '^[a-z]+$' }, 'bob.x')).toBe(false)
    expect(isLegalFor({ regexCheck: '[a-z0-9]{4,16}' }, '..abcd..')).toBe(true)
    expect(isLegalFor({ regexCheck: '^[a-z]+$' }, 'a'.repeat(65))).toBe(false)
  })

  it('convertit les expressions de la base embarquée, sauf celles à risque', () => {
    const patterns = new Set(Object.values(loadDb().data.sites).map((s) => s.regexCheck).filter((r): r is string => !!r))
    const failed = Array.from(patterns).filter((p) => !convertPythonRegex(p))
    expect(patterns.size).toBeGreaterThan(40)
    expect(failed.length).toBeLessThanOrEqual(3)
    for (const p of failed) expect(hasNestedQuantifier(p), p).toBe(true)
  })
})

describe('détection Maigret', () => {
  const msg = site({ checkType: 'message', presenseStrs: ['profile-header'], absenceStrs: ['User not found'], errors: { 'Too many requests': 'Rate limited' } })

  it('message : chaîne de présence requise et aucune chaîne d’absence', () => {
    expect(evaluateMaigret(msg, { status: 200, text: '<div class="profile-header">bob</div>' }).status).toBe('claimed')
    expect(evaluateMaigret(msg, { status: 200, text: '<div class="profile-header">User not found</div>' }).status).toBe('available')
    expect(evaluateMaigret(msg, { status: 200, text: '<div>accueil</div>' }).status).toBe('available')
    // Sans chaîne de présence : toute page sans chaîne d'absence est un compte.
    const noPresence = site({ checkType: 'message', absenceStrs: ['404'] })
    expect(evaluateMaigret(noPresence, { status: 200, text: 'bob' }).status).toBe('claimed')
    expect(evaluateMaigret(noPresence, { status: 200, text: '404' }).status).toBe('available')
    // Pseudo non ASCII absent de la page : pas un profil.
    expect(evaluateMaigret(noPresence, { status: 200, text: 'page' }, 'пётр').status).toBe('available')
    // Écart volontaire : page d'erreur HTTP qui ressemble à un compte.
    expect(evaluateMaigret(noPresence, { status: 410, text: 'bob' }).status).toBe('error')
  })

  it('errors : une sous-chaîne connue donne une erreur, pas une absence', () => {
    const v = evaluateMaigret(msg, { status: 200, text: 'Too many requests. User not found' })
    expect(v).toEqual({ status: 'error', error: 'Rate limited' })
  })

  it('status_code, response_url, blocages et pare-feu', () => {
    const s = site({})
    expect(evaluateMaigret(s, { status: 200, text: '' }).status).toBe('claimed')
    expect(evaluateMaigret(s, { status: 404, text: '' }).status).toBe('available')
    expect(evaluateMaigret(s, { status: 403, text: '' }).status).toBe('error')
    expect(evaluateMaigret(site({ ignore403: true }), { status: 403, text: '' }).status).toBe('available')
    expect(evaluateMaigret(s, { status: 429, text: '' }).status).toBe('error')
    expect(evaluateMaigret(s, { status: 503, text: '' }).status).toBe('error')
    expect(evaluateMaigret(s, { status: 200, text: '<title>Just a moment...</title>' }).status).toBe('waf')
    expect(evaluateMaigret(s, { status: 202, text: '', headers: new Headers({ 'x-amzn-waf-action': 'challenge' }) }).status).toBe('waf')
    expect(evaluateMaigret(s, { status: 403, text: '', headers: new Headers({ 'cf-mitigated': 'challenge' }) }).status).toBe('waf')
    const redir = site({ checkType: 'response_url' })
    expect(evaluateMaigret(redir, { status: 200, text: 'profil' }).status).toBe('claimed')
    expect(evaluateMaigret(redir, { status: 302, text: '' }).status).toBe('available')
  })

  it('décode le jeu de caractères annoncé (windows-1251)', () => {
    const cp1251 = Buffer.from([0xc0, 0xe2, 0xf2, 0xee, 0xf0]) // « Автор »
    expect(decodeBody(cp1251, 'text/html; charset=windows-1251')).toBe('Автор')
    expect(decodeBody(Buffer.concat([Buffer.from('<meta charset="windows-1251">'), cp1251]), null)).toContain('Автор')
    expect(decodeBody(Buffer.from('é'), 'text/html')).toBe('é')
  })

  it('requêtes : urlProbe interrogée, URL affichée, en-têtes, POST JSON, regexCheck', async () => {
    const ctx = fakeContext([
      [/annuaire\.example\.test\/api\/membres\?login=alice/, { status: 200, body: '{"id":1}' }],
      [/api\.example\.test\/graphql/, (_u, init) => ({ status: 200, body: JSON.stringify(init.json).includes('alice') ? '{"user":{"id":1}}' : '{"user":null}' })]
    ])
    const db = fixtureDb()
    const fr = mergeEntry('Annuaire FR', db.sites['Annuaire FR'], db.engines)
    const r = await checkMaigretSite(fr, 'alice', ctx)
    expect(r).toMatchObject({ status: 'claimed', url: 'https://annuaire.example.test/membres/alice' })
    expect(ctx.calls[0].url).toBe('https://annuaire.example.test/api/membres?login=alice')
    expect(ctx.calls[0].method).toBe('GET')
    expect(ctx.calls[0].headers['accept-language']).toMatch(/^en/)

    const gql = site({
      name: 'GQL',
      url: 'https://gql.example.test/{username}',
      urlProbe: 'https://api.example.test/graphql',
      checkType: 'message',
      presenseStrs: ['"id"'],
      absenceStrs: ['"user":null'],
      requestMethod: 'POST',
      requestPayload: { query: '{{ user(login: "{username}") {{ id }} }}' },
      headers: { 'X-Test': '1' }
    })
    expect((await checkMaigretSite(gql, 'alice', ctx)).status).toBe('claimed')
    const call = ctx.calls.at(-1)!
    expect(call.method).toBe('POST')
    expect(call.body).toBe('{"query":"{ user(login: \\"alice\\") { id } }"}')
    expect(call.headers['x-test']).toBe('1')
    const n = ctx.calls.length
    expect((await checkMaigretSite(site({ regexCheck: '^\\d+$' }), 'alice', ctx)).status).toBe('illegal')
    expect(ctx.calls.length).toBe(n)
  })
})

describe('paliers', () => {
  it('Essentiel : Sherlock hors liste noire, plus le top 10 000 et les sites « fr » de Maigret', () => {
    const essential = tierSites('essential')
    const sherlock = essential.filter((s) => s.source === 'sherlock')
    const maigret = essential.filter((s) => s.source === 'maigret')
    expect(sherlock.length).toBe(selectSites({ nsfw: false }).length)
    expect(maigret.length).toBeGreaterThan(200)
    expect(essential.length).toBeGreaterThan(600)
    expect(essential.length).toBeLessThan(800)
    for (const s of maigret) expect((s.rank !== null && s.rank <= 10_000) || s.tags.includes('fr'), s.name).toBe(true)
    expect(essential.some((s) => s.nsfw)).toBe(false)
    expect(essential.some((s) => BLACKLIST[s.name] && s.source === 'sherlock')).toBe(false)
    for (const name of Object.keys(MAIGRET_BLACKLIST)) expect(essential.some((s) => s.id === `maigret:${name}`), name).toBe(false)
  })

  it('dédoublonne par hôte : l’entrée Sherlock l’emporte', () => {
    const sherlockHosts = new Set(allSites().map((s) => hostOf(s.urlMain)))
    const all = catalog().sites
    for (const s of all.filter((x) => x.source === 'maigret')) expect(sherlockHosts.has(s.host), s.name).toBe(false)
    expect(all.find((s) => s.host === 'github.com')?.source).toBe('sherlock')
  })

  it('Étendu englobe Essentiel ; sites adultes et sites sautés à part', () => {
    const essential = new Set(tierSites('essential').map((s) => s.id))
    const extended = tierSites('extended')
    expect(extended.length).toBeGreaterThan(6000)
    expect(extended.filter((s) => essential.has(s.id)).length).toBe(essential.size)
    expect(extended.some((s) => s.nsfw)).toBe(false)
    const nsfw = tierSites('nsfw')
    expect(nsfw.every((s) => s.nsfw)).toBe(true)
    expect(nsfw.some((s) => s.source === 'maigret')).toBe(true)
    // Sites sautés : protection, jeton, liste noire... jamais interrogés.
    const skipped = tierSkipped('extended')
    expect(skipped.some((s) => s.reason === 'protection')).toBe(true)
    const ids = new Set(extended.map((s) => s.id))
    for (const s of skipped) expect(ids.has(s.id)).toBe(false)
  })

  it('recherche approximative : compte à vérifier', async () => {
    const def = maigretDef(mergeEntry('Approx', { url: 'https://approx.test/search?q={username}', urlMain: 'https://approx.test', similarSearch: true, alexaRank: 10 }))
    const ctx = fakeContext([[/approx\.test/, { status: 200 }]])
    const [r] = await scan([def], 'bob', ctx)
    const { accountEntity } = await import('../../src/main/modules/username/sites')
    expect(accountEntity(r.def, r, 'bob', 'fr')).toMatchObject({ review: true, label: 'bob (Approx)' })
  })
})

describe('modules', () => {
  const [essentialModule, , extendedModule] = modules

  it('Étendu : sites connus en comptes, longue traîne dans forums_found avec un résumé', async () => {
    expect(extendedModule.id).toBe('username.sites_extended')
    expect(extendedModule.ondemand).toBe(true)
    // Un forum Discourse de longue traîne (non classé) où le compte existe.
    const forum = tierSites('extended').find((s) => s.engine === 'Discourse' && !s.essential && s.rank === null)!
    const forumUrl = forum.profileUrl('bob')
    const ctx = fakeContext([
      [/github\.com\/bob$/, { status: 200 }],
      [new RegExp(`^${forumUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), { status: 200, body: '<meta name="generator" content="Discourse 3">' }],
      [/.*/, { status: 404, body: 'not found' }]
    ])
    const out = await extendedModule.run(entity('username', 'bob'), ctx)
    expect(out.entities?.some((e) => e.platform === 'github')).toBe(true)
    expect(out.entities?.some((e) => e.data?.site === forum.name)).toBe(false)
    expect(out.properties?.forums_found).toEqual([forumUrl])
    expect(out.properties?.forums_found_count).toBe(1)
    expect(out.properties?.forums_summary).toBe('1 compte sur des forums et sites peu connus : Discourse 1')
    expect((out.raw as { tested: number }).tested).toBe(tierSites('extended').length)
  }, 120000)

  it('résumé des forums par moteur', () => {
    const r = (engine?: string): Parameters<typeof forumsSummary>[0][number] => ({ site: 'x', url: 'u', status: 'claimed', def: { engine } as SiteDef })
    expect(forumsSummary([r('DiscourseJson'), r('Discourse'), r('XenForo'), r('engine404'), r()], 'en')).toBe('5 accounts on forums and niche sites: Discourse 2, XenForo 1, other 2')
  })

  it('Essentiel : saute les sites en échec pour la sortie réseau du contexte', async () => {
    const ctx = fakeContext([[/.*/, { status: 404, body: 'not found' }]])
    ctx.egress = 'test:essentiel'
    healthStore().record('test:essentiel', [{ id: 'sherlock:GitHub', verdict: 'false_positive' }])
    const out = await essentialModule.run(entity('username', 'bob'), ctx)
    const raw = out.raw as { tested: number; skipped_failing: string[]; network: string }
    expect(raw.skipped_failing).toEqual(['GitHub'])
    expect(raw.tested).toBe(tierSites('essential').length - 1)
    expect(ctx.calls.some((c) => c.url.includes('github.com'))).toBe(false)
    expect(raw.network).toBe('test:essentiel')
  }, 60000)

  it('Adultes : un site qui « trouve » aussi un pseudo aléatoire est écarté et mis en échec', async () => {
    const nsfwModule = modules.find((m) => m.id === 'username.sites_nsfw')!
    const username = 'masinttemoin'
    const onHost = (url: string, host: string): boolean => {
      const h = new URL(url).hostname
      return h === host || h.endsWith(`.${host}`)
    }
    // Deux sites qui concluent sur le code HTTP de leur propre hôte : 200 trouvé, 404 absent.
    const answers = async (def: SiteDef, status: number): Promise<string> =>
      (await def.check(username, fakeContext([[/.*/, (url) => (onHost(url, def.host) ? { status, body: '' } : { status: 599 })]]))).status
    const picked: SiteDef[] = []
    for (const def of tierSites('nsfw')) {
      if (picked.length === 2) break
      if (def.isLegal(username) && (await answers(def, 200)) === 'claimed' && (await answers(def, 404)) === 'available') picked.push(def)
    }
    const [gate, real] = picked
    const ctx = fakeContext([
      [
        /.*/,
        (url) =>
          // Page de contrôle d'âge servie en HTTP 200 pour toute adresse du site.
          onHost(url, gate.host) || (onHost(url, real.host) && url.includes(username)) ? { status: 200, body: '' } : { status: 404, body: 'not found' }
      ]
    ])
    ctx.egress = 'test:contre'
    const out = await nsfwModule.run(entity('username', username), ctx)
    const raw = out.raw as { false_positives_discarded: string[]; found: number }
    expect(raw.false_positives_discarded).toContain(gate.name)
    expect(raw.false_positives_discarded).not.toContain(real.name)
    expect(out.entities?.some((e) => e.data?.site === real.name || e.data?.url === real.profileUrl(username))).toBe(true)
    expect(out.entities?.some((e) => e.data?.site === gate.name)).toBe(false)
    // Sauté pendant 7 jours sur cette sortie réseau seulement.
    expect(healthStore().failedIds('test:contre').has(gate.id)).toBe(true)
    expect(healthStore().failedIds('test:contre').has(real.id)).toBe(false)
    expect(healthStore().failedIds('direct').has(gate.id)).toBe(false)
  }, 60000)
})

describe('cache de santé', () => {
  it('verdict : faux positif, témoin manqué, non concluant', () => {
    expect(verdictOf('claimed', 'available')).toBe('ok')
    expect(verdictOf('claimed', 'claimed')).toBe('false_positive')
    expect(verdictOf('error', 'claimed')).toBe('false_positive')
    expect(verdictOf('available', 'available')).toBe('missed')
    expect(verdictOf('waf', 'available')).toBe('inconclusive')
    expect(verdictOf(null, 'available')).toBe('untestable')
  })

  it('contre-vérification : un site qui trouve aussi un pseudo aléatoire est écarté', async () => {
    const site = (id: string, anyName: boolean): { def: SiteDef } => ({
      def: {
        id,
        name: id,
        isLegal: () => true,
        // Page de blocage ou de contrôle d'âge : « trouvé » pour n'importe quel pseudo.
        check: async (u: string) => ({ site: id, url: `https://${id}/${u}`, status: anyName || u === 'cible' ? 'claimed' : 'available' })
      } as unknown as SiteDef
    })
    const fakes = await counterCheck([site('bloque.example', true), site('fiable.example', false)], makeContext())
    expect(Array.from(fakes)).toEqual(['bloque.example'])
  })

  it('faux positif vu pendant une recherche : site mis en échec sans effacer le dernier contrôle', () => {
    const store = new HealthStore(null)
    store.record('direct', [{ id: 'a', verdict: 'ok' }], 1000)
    store.markFailed('direct', ['x'], 'false_positive', 2000)
    expect(store.get('direct').checkedAt).toBe(1000)
    expect(Array.from(store.failedIds('direct', 3000))).toEqual(['x'])
    expect(store.failedIds('tor', 3000).size).toBe(0)
  })

  it('pseudo aléatoire compatible avec le format du site', () => {
    const digits = randomUsernameFor({ isLegal: (u) => /^\d+$/.test(u) })
    expect(digits).toMatch(/^\d{12}$/)
    expect(randomUsernameFor({ isLegal: (u) => /^[a-z]+$/.test(u) })).toMatch(/^zq[a-z]{9}x$/)
    expect(randomUsernameFor({ isLegal: () => false })).toBeNull()
  })

  it('échec mémorisé 7 jours, par sortie réseau, levé par un contrôle correct', () => {
    const dir = mkdtempSync(join(tmpdir(), 'masint-health-'))
    try {
      const file = join(dir, 'h.json')
      const store = new HealthStore(file)
      const t0 = 1_000_000
      store.record('direct', [
        { id: 'a', verdict: 'false_positive' },
        { id: 'b', verdict: 'missed' },
        { id: 'c', verdict: 'ok' },
        { id: 'd', verdict: 'inconclusive' }
      ], t0)
      expect(Array.from(store.failedIds('direct', t0 + 1)).sort()).toEqual(['a', 'b'])
      // Autre sortie réseau : aucun échec (un site bloqué en direct peut marcher via Tor).
      expect(store.failedIds('tor', t0 + 1).size).toBe(0)
      // Relu depuis le fichier.
      const again = new HealthStore(file)
      expect(again.get('direct').last).toMatchObject({ tested: 4, ok: 1, false_positive: 1, missed: 1, inconclusive: 1 })
      expect(again.failedIds('direct', t0 + HEALTH_TTL_MS - 1).size).toBe(2)
      expect(again.failedIds('direct', t0 + HEALTH_TTL_MS).size).toBe(0)
      // Un contrôle correct lève l'échec ; un résultat non concluant le laisse.
      again.record('direct', [{ id: 'a', verdict: 'ok' }, { id: 'b', verdict: 'inconclusive' }], t0 + 10)
      expect(Array.from(again.failedIds('direct', t0 + 20))).toEqual(['b'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('contrôle témoin : témoin trouvé et pseudo aléatoire absent', async () => {
    const ok = maigretDef(mergeEntry('Bon', { url: 'https://bon.test/{username}', usernameClaimed: 'alice' }))
    const fp = maigretDef(mergeEntry('Faux', { url: 'https://faux.test/{username}', usernameClaimed: 'alice' }))
    const ctx = fakeContext([
      [/bon\.test\/alice$/, { status: 200 }],
      [/bon\.test\//, { status: 404 }],
      [/faux\.test\//, { status: 200 }]
    ])
    const res = await selfCheck([ok, fp], ctx)
    expect(Object.fromEntries(res.map((r) => [r.name, r.verdict]))).toEqual({ Bon: 'ok', Faux: 'false_positive' })
    // Requêtes : uniquement le témoin public et un pseudo aléatoire.
    const asked = ctx.calls.map((c) => new URL(c.url).pathname.slice(1))
    expect(asked.filter((u) => u === 'alice')).toHaveLength(2)
    expect(asked.filter((u) => u !== 'alice').every((u) => /^zq[a-z]{9}x$/.test(u))).toBe(true)
    const { sites, failed } = healthy([ok, fp], 'test:self')
    expect(sites.length + failed.length).toBe(2)
  })
})

describe('base embarquée et mise à jour', () => {
  let dir: string | null = null
  afterEach(() => {
    configureSiteData({})
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  const serve = (meta: Record<string, unknown>, body: string | Buffer) =>
    async (url: string, _init?: FetchOptions): Promise<Response> => {
      if (url.endsWith('db_meta.json')) return new Response(JSON.stringify(meta), { status: 200 })
      if (url === meta.data_url) return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200 })
      return new Response('', { status: 404 })
    }

  it('base embarquée : attribution, date et empreinte de la base d’origine', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, '../../resources/data/maigret-sites.json'), 'utf8'))
    expect(raw.$meta.license).toMatch(/MIT/)
    expect(raw.$meta.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(raw.$meta.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(validateMaigretData(raw)).toBeNull()
    expect(dbInfo()).toMatchObject({ source: 'bundled', updatedAt: raw.$meta.updated_at })
  })

  it('n’accepte qu’une adresse HTTPS sur GitHub et une empreinte valide', () => {
    expect(isAllowedDataUrl('https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/data.json')).toBe(true)
    expect(isAllowedDataUrl('http://raw.githubusercontent.com/x')).toBe(false)
    expect(isAllowedDataUrl('https://example.com/data.json')).toBe(false)
    expect(isAllowedDataUrl('https://raw.githubusercontent.com.evil.test/x')).toBe(false)
    expect(isAllowedDataUrl('https://user:pass@raw.githubusercontent.com/x')).toBe(false)
    expect(() => parseRemoteMeta({ ...fixtureMeta(), data_sha256: 'abc' })).toThrow(/SHA-256/)
    expect(() => parseRemoteMeta({ ...fixtureMeta(), data_url: 'https://example.com/data.json' })).toThrow(/refusée/)
    expect(() => parseRemoteMeta({ ...fixtureMeta(), version: 2 })).toThrow(/non pris en charge/)
  })

  it('installe la base quand l’empreinte SHA-256 correspond (fixture)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'masint-sites-'))
    configureSiteData({ userDir: dir, minSites: 1 })
    const data = fixtureData()
    expect(sha256(data)).toBe(fixtureMeta().data_sha256)
    const out = await updateDb(serve(fixtureMeta(), data))
    expect(out).toMatchObject({ status: 'updated', updatedAt: '2099-01-01T00:00:00Z', sites: 5 })
    expect(dbInfo()).toMatchObject({ source: 'user', sites: 5 })
    expect(readFileSync(join(dir, 'maigret-sites.json'), 'utf8')).toBe(data)
    // Le catalogue suit la nouvelle base : seuls les sites utilisables et absents de Sherlock.
    const names = catalog().sites.filter((s) => s.source === 'maigret').map((s) => s.name).sort()
    expect(names).toEqual(['Annuaire FR', 'Forum Discourse', 'Profils'])
    expect(tierSites('essential').filter((s) => s.source === 'maigret').map((s) => s.name).sort()).toEqual(['Annuaire FR', 'Profils'])
    // Déjà à jour : pas de second téléchargement.
    let downloads = 0
    const again = await updateDb(async (url, init) => {
      if (!url.endsWith('db_meta.json')) downloads++
      return serve(fixtureMeta(), data)(url, init)
    })
    expect(again.status).toBe('current')
    expect(downloads).toBe(0)
  })

  it('refuse une base dont l’empreinte diffère et garde la base embarquée', async () => {
    dir = mkdtempSync(join(tmpdir(), 'masint-sites-'))
    configureSiteData({ userDir: dir, minSites: 1 })
    const tampered = fixtureData().replace('alice', 'mallory')
    await expect(updateDb(serve(fixtureMeta(), tampered))).rejects.toThrow(/SHA-256/)
    expect(dbInfo().source).toBe('bundled')
    // Schéma invalide, empreinte pourtant correcte.
    const bad = JSON.stringify({ sites: { X: { url: 42 } }, engines: {} })
    await expect(updateDb(serve({ ...fixtureMeta(), data_sha256: sha256(bad) }, bad))).rejects.toThrow(/refusée/)
    expect(dbInfo().source).toBe('bundled')
  })

  it('plafonne la taille du téléchargement', async () => {
    dir = mkdtempSync(join(tmpdir(), 'masint-sites-'))
    configureSiteData({ userDir: dir, minSites: 1 })
    const huge = Buffer.alloc(21 * 1024 * 1024, 32)
    await expect(updateDb(serve({ ...fixtureMeta(), data_sha256: sha256(huge) }, huge))).rejects.toThrow(/volumineux/)
  })
})

describe.skipIf(!LIVE)('live', () => {
  // Sites dont le contrôle témoin était correct au banc du 22/10/2026.
  const LIVE_SITES = ['maigret:forum.openstreetmap.fr', 'maigret:framacolibri.org', 'maigret:debian-fr.org', 'maigret:Calendly', 'maigret:are.na', 'maigret:darktable.fr']

  it('contrôle témoin sur quelques sites Maigret', async (t) => {
    const sites = tierSites('essential').filter((s) => LIVE_SITES.includes(s.id))
    expect(sites.length).toBeGreaterThan(2)
    const res = await selfCheck(sites, makeContext(), { concurrency: 4 })
    if (res.every((r) => r.verdict === 'inconclusive')) t.skip()
    for (const r of res) expect(['ok', 'inconclusive'], `${r.name} ${r.claimed}/${r.random} ${r.detail ?? ''}`).toContain(r.verdict)
    expect(res.filter((r) => r.verdict === 'ok').length).toBeGreaterThan(1)
  }, 120000)

  it('mise à jour réelle depuis GitHub : db_meta.json, téléchargement et empreinte', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'masint-sites-live-'))
    try {
      configureSiteData({ userDir: dir })
      const ctx = makeContext()
      const out = await updateDb(ctx.fetch, { force: true }).catch((e: Error) => {
        if (/fetch failed|délai|HTTP 5\d\d|HTTP 429/i.test(e.message)) t.skip()
        throw e
      })
      expect(out.status).toBe('updated')
      expect(out.sites).toBeGreaterThan(5000)
      expect(dbInfo().source).toBe('user')
      expect(tierSites('essential').length).toBeGreaterThan(600)
    } finally {
      configureSiteData({})
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180000)

  // Plusieurs minutes : LIVE=1 LIVE_EXTENDED=1 npx vitest run tests/modules/username_maigret.test.ts
  it.skipIf(!process.env.LIVE_EXTENDED)('palier Étendu sur un pseudo aléatoire (durée mesurée)', async () => {
    const name = `zq${Math.random().toString(36).slice(2, 11).replace(/\d/g, 'k')}x`
    const out = await modules[2].run(entity('username', name), makeContext())
    const raw = out.raw as { tested: number; duration_ms: number; found: number; errors: number; blocked_by_waf: number; accounts: unknown[]; forums: unknown[] }
    console.log(`username.sites_extended : ${raw.tested} sites en ${Math.round(raw.duration_ms / 1000)} s, ${raw.found} trouvés (${raw.errors} erreurs, ${raw.blocked_by_waf} pare-feu)`, raw.accounts, raw.forums)
    expect(raw.tested).toBe(tierSites('extended').length)
    // Faux positifs résiduels possibles en longue traîne, mais aucun compte sur un site connu.
    expect(out.entities ?? []).toEqual([])
  }, 1_800_000)
})
