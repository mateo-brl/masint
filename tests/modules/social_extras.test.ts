// Threads, et compléments des modules GitHub, Twitch, Snapchat et Reddit.

import { describe, expect, it } from 'vitest'
import { ModuleError, type OutEntity } from '@shared/modules'
import { getPlatform } from '@shared/platforms'
import github, { matchesProfile, sshFingerprints } from '../../src/main/modules/social/github'
import reddit, { probableUtcOffset, redditActivity, type RedditListing } from '../../src/main/modules/social/reddit'
import snapchat from '../../src/main/modules/social/snapchat'
import threads, { parseThreads } from '../../src/main/modules/social/threads'
import twitch from '../../src/main/modules/social/twitch'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson, type Route } from './social_helpers'

const json = (path: string): { body: string; headers: Record<string, string> } => ({ body: fixture(`social/${path}`), headers: { 'content-type': 'application/json' } })
const html = (path: string): { body: string } => ({ body: fixture(`social/${path}`) })

function split(out: { entities?: OutEntity[] }): { account: OutEntity; children: OutEntity[] } {
  const account = out.entities!.find((e) => e.ref === 'account')!
  return { account, children: out.entities!.filter((e) => e.from === 'account') }
}

describe('social.threads', () => {
  it('lit les balises Open Graph (nasa)', () => {
    const p = parseThreads(fixture('social/threads_nasa.html'), 'fr')!
    expect(p.profile).toMatchObject({
      username: 'nasa',
      url: 'https://www.threads.com/@nasa',
      data: { user_id: '28829152388', display_name: 'NASA', followers: 12800000, posts: 149, bio: 'Making the seemingly impossible, possible. ✨' }
    })
    expect(p.profile.image).toMatch(/^https:\/\/scontent-[^/]+\.cdninstagram\.com\//)
    expect(parseThreads('<html><head></head></html>', 'fr')).toBeNull()
  })

  it('compte Threads et compte Instagram du même pseudo à vérifier', async () => {
    const ctx = fakeContext([[/threads\.com\/@nasa$/, html('threads_nasa.html')]])
    const out = await threads.run(entity('username', 'nasa'), ctx)
    const { account, children } = split(out)
    expect(account).toMatchObject({ platform: 'threads', label: 'nasa' })
    expect(children.find((c) => c.platform === 'instagram')).toMatchObject({ label: 'nasa', review: true, reviewReason: 'le pseudo Threads est le pseudo Instagram' })
    expect(ctx.calls[0].headers['sec-fetch-mode']).toBe('navigate')
  })

  it('entrée Instagram : le compte Threads est rattaché au compte Instagram', async () => {
    const ctx = fakeContext([[/threads\.com\/@nasa$/, html('threads_nasa.html')]])
    const out = await threads.run(entity('account', 'nasa', { platform: 'instagram' }), ctx)
    expect(out.entities?.[0]).toMatchObject({ ref: 'account', platform: 'threads', label: 'nasa' })
    expect(out.entities?.some((e) => e.platform === 'instagram')).toBe(false)
    expect(out.properties).toBeUndefined()
  })

  it('pseudo inconnu : renvoi vers la connexion, confirmé par le compte témoin', async () => {
    const login = (u: string) => ({ status: 302, headers: { location: `https://www.threads.com/login/?next=${u}` } })
    const ok = fakeContext([
      [/threads\.com\/@threads$/, html('threads_nasa.html')],
      [/threads\.com\/@/, login('x')]
    ])
    expect((await threads.run(entity('username', 'zq8xk2vmw93pq7'), ok)).found).toBe(false)
    const blocked = fakeContext([[/threads\.com\/@/, login('x')]])
    await expect(threads.run(entity('username', 'zq8xk2vmw93pq7'), blocked)).rejects.toMatchObject({ code: 'blocked' })
  })

  it('plateforme Threads au catalogue, URL threads.com', () => {
    expect(getPlatform('threads')?.url).toBe('https://www.threads.com/@{u}')
    expect(threads.accepts?.(entity('account', 'x', { platform: 'instagram' }))).toBe(true)
    expect(threads.accepts?.(entity('account', 'x', { platform: 'tiktok' }))).toBe(false)
  })
})

describe('GitHub : clés, organisations et emails de commits', () => {
  const routes: Route[] = [
    [/api\.github\.com\/users\/octocat$/, json('github_user.json')],
    [/\/social_accounts/, json('github_social_accounts.json')],
    [/\/events\/public/, json('github_events.json')],
    [/\/gpg_keys/, json('github_gpg_keys.json')],
    [/\/orgs/, json('github_orgs.json')],
    [/github\.com\/octocat\.keys$/, { body: fixture('social/github_keys.txt') }],
    [/\/repos\/octocat\/Spoon-Knife\/commits\//, { body: { commit: { author: { email: 'spoon@example.org', name: 'Octo Spoon' }, committer: { email: 'noreply@github.com', name: 'GitHub' } } } }]
  ]

  it('empreintes SSH au format OpenSSH (calculées hors de MASINT pour le test)', () => {
    expect(sshFingerprints(fixture('social/github_keys.txt'))).toEqual([
      'ssh-ed25519 SHA256:9zeCJ5D40xzuldq7FTe5CLv2M50Y2kq/tcB0LoTUR8s',
      'ssh-ed25519 SHA256:nLjSeJ/VC4nSq8fk77BtuTXsB009giMNt2sMM3zFXkA'
    ])
    expect(sshFingerprints('')).toEqual([])
  })

  it('nom d’auteur comparé au profil', () => {
    const user = { login: 'octocat', name: 'monalisa octocat' }
    expect(matchesProfile({ email: 'a@example.com', name: 'Mona Lisa' }, user)).toBe(true)
    expect(matchesProfile({ email: 'a@example.com', name: 'Octo Cat' }, user)).toBe(true)
    expect(matchesProfile({ email: 'octocat@example.com' }, user)).toBe(true)
    expect(matchesProfile({ email: 'b@example.com', name: 'Octo Spoon' }, user)).toBe(false)
    expect(matchesProfile({ email: 'c@example.com' }, user)).toBe(false)
  })

  it('profil complet : identifiant, clés, organisations, emails à vérifier', async () => {
    const out = await github.run(entity('username', 'octocat'), fakeContext(routes))
    const { account, children } = split(out)
    expect(account.data).toMatchObject({
      user_id: '1',
      gpg_key_ids: ['668AF837654F9416'],
      gpg_key_created_at: '2021-03-14T12:00:00.000Z',
      ssh_key_fingerprints: ['ssh-ed25519 SHA256:9zeCJ5D40xzuldq7FTe5CLv2M50Y2kq/tcB0LoTUR8s', 'ssh-ed25519 SHA256:nLjSeJ/VC4nSq8fk77BtuTXsB009giMNt2sMM3zFXkA']
    })
    expect((account.data?.pgp_fingerprints as string[])[0]).toMatch(/^[0-9A-F]{40}$/)
    const byLabel = Object.fromEntries(children.map((c) => [c.label, c]))
    // Adresses des clés GPG : vérifiée par GitHub, ou à vérifier ; noreply ignorée.
    expect(byLabel['alice@example.com']).toMatchObject({ type: 'email', linkLabel: 'email de clé GPG' })
    expect(byLabel['alice@example.com'].review).toBeUndefined()
    expect(byLabel['alice.travail@example.org']).toMatchObject({ review: true })
    expect(Object.keys(byLabel).some((l) => l.includes('noreply'))).toBe(false)
    // Commits : nom conforme au profil dans le graphe, autre auteur à vérifier.
    expect(byLabel['mona.work@example.com'].review).toBeUndefined()
    expect(byLabel['spoon@example.org']).toMatchObject({ review: true, reviewReason: expect.stringMatching(/Octo Spoon/) })
    expect(byLabel.github).toMatchObject({ type: 'organization', data: { url: 'https://github.com/github', user_id: '9919' } })
  })
})

describe('Twitch : panneaux de la chaîne', () => {
  it('liens des panneaux en pivots, sans doublon avec les réseaux sociaux', async () => {
    const out = await twitch.run(entity('username', 'ninja'), fakeContext([[/gql\.twitch\.tv/, json('twitch_ninja_gql.json')]]))
    const { children } = split(out)
    const labels = children.map((c) => `${c.platform ?? c.type}:${c.label}:${c.linkLabel}`)
    expect(labels).toEqual(expect.arrayContaining(['youtube:Ninja:lien d’un panneau Twitch', 'tiktok:ninja:lien du profil']))
    expect(labels.filter((l) => l.startsWith('tiktok:'))).toHaveLength(1)
    expect(children.some((c) => c.type === 'url' && /teamninja\.com/.test(c.label))).toBe(true)
  })
})

describe('Snapchat : snapcode', () => {
  it('URL du snapcode en propriété', async () => {
    const out = await snapchat.run(entity('username', 'john'), fakeContext([[/snapchat\.com\/@john/, html('snapchat_public.html')]]))
    expect(split(out).account.data?.snapcode_url).toBe('https://app.snapchat.com/web/deeplink/snapcode?username=john&type=SVG&bitmoji=enable')
  })
})

describe('Reddit : activité récente (compte fictif)', () => {
  const items = [
    ...(fixtureJson<RedditListing>('social/reddit_submitted_exemple.json').data?.children ?? []),
    ...(fixtureJson<RedditListing>('social/reddit_comments_exemple.json').data?.children ?? [])
  ].map((c) => c.data!)

  it('décalage horaire déduit de la tranche la plus calme', () => {
    const hours = new Array(24).fill(3)
    for (const h of [0, 1, 2, 3, 4, 5]) hours[h] = 0
    expect(probableUtcOffset(hours)).toBe('UTC+2')
    const shifted = new Array(24).fill(3)
    for (const h of [7, 8, 9, 10, 11, 12]) shifted[h] = 0
    expect(probableUtcOffset(shifted)).toBe('UTC-5')
    expect(probableUtcOffset(new Array(24).fill(1))).toBeUndefined()
  })

  it('sous-forums, heures, domaines (liens internes à Reddit exclus)', () => {
    const a = redditActivity(items)
    expect(a.top_subreddits).toEqual(['r/space (23)', 'r/photography (12)', 'r/france (5)'])
    expect(a.activity_sample_size).toBe(40)
    expect(a.probable_utc_offset).toBe('UTC+2')
    expect(a.link_domains).toEqual(['example.com (5)', 'nasa.gov (5)', 'en.wikipedia.org (4)'])
    expect((a.activity_hours_utc as string[]).every((h) => /^(0[6-9]|1\d|2[0-3]) h : \d+$/.test(h))).toBe(true)
  })

  it('module : profil et activité', async () => {
    const routes: Route[] = [
      [/user\/exemple_compte\/about\.json/, json('reddit_about_exemple.json')],
      [/user\/exemple_compte\/submitted\.json\?limit=100/, json('reddit_submitted_exemple.json')],
      [/user\/exemple_compte\/comments\.json\?limit=100/, json('reddit_comments_exemple.json')]
    ]
    const { account } = split(await reddit.run(entity('username', 'exemple_compte'), fakeContext(routes)))
    expect(account.data).toMatchObject({ total_karma: 460, probable_utc_offset: 'UTC+2', activity_sample_size: 40 })
    expect((account.data?.top_subreddits as string[])[0]).toBe('r/space (23)')
  })

  it('listes bloquées : profil seul', async () => {
    const routes: Route[] = [
      [/about\.json/, json('reddit_about_exemple.json')],
      [/\.json/, { status: 403, body: fixture('social/reddit_blocked.html') }]
    ]
    const { account } = split(await reddit.run(entity('username', 'exemple_compte'), fakeContext(routes)))
    expect(account.data?.total_karma).toBe(460)
    expect(account.data?.top_subreddits).toBeUndefined()
  })
})

describe.skipIf(!LIVE)('Threads, Twitch (live)', () => {
  const ctx = makeContext()
  it('Threads : nasa et pseudo aléatoire', async (t) => {
    try {
      const { account, children } = split(await runModule(threads, entity('username', 'nasa'), ctx))
      expect(Number(account.data?.followers)).toBeGreaterThan(1_000_000)
      expect(children.some((c) => c.platform === 'instagram' && c.review)).toBe(true)
      expect((await runModule(threads, entity('username', `zq${Date.now().toString(36)}x`), ctx)).found).toBe(false)
    } catch (e) {
      if (e instanceof ModuleError && e.code === 'blocked') t.skip(e.message)
      throw e
    }
  })
  it('Twitch : panneaux de ninja', async () => {
    const { children } = split(await runModule(twitch, entity('username', 'ninja'), ctx))
    expect(children.some((c) => c.linkLabel === 'lien d’un panneau Twitch')).toBe(true)
  })
})
