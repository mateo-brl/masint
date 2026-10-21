import { describe, expect, it } from 'vitest'
import { ModuleError, type OsintModule, type OutEntity } from '@shared/modules'
import bluesky, { bskyHandle } from '../../src/main/modules/social/bluesky'
import chesscom from '../../src/main/modules/social/chesscom'
import codeberg from '../../src/main/modules/social/codeberg'
import devto from '../../src/main/modules/social/devto'
import dockerhub from '../../src/main/modules/social/dockerhub'
import duolingo from '../../src/main/modules/social/duolingo'
import github, { commitIdentities } from '../../src/main/modules/social/github'
import gitlab, { parseGitlabPage } from '../../src/main/modules/social/gitlab'
import gravatar from '../../src/main/modules/social/gravatar'
import hackernews from '../../src/main/modules/social/hackernews'
import huggingface from '../../src/main/modules/social/huggingface'
import keybase from '../../src/main/modules/social/keybase'
import kick from '../../src/main/modules/social/kick'
import lichess from '../../src/main/modules/social/lichess'
import linktree from '../../src/main/modules/social/linktree'
import mastodon, { INSTANCES, splitAcct } from '../../src/main/modules/social/mastodon'
import minecraft from '../../src/main/modules/social/minecraft'
import npm from '../../src/main/modules/social/npm'
import reddit from '../../src/main/modules/social/reddit'
import roblox from '../../src/main/modules/social/roblox'
import snapchat from '../../src/main/modules/social/snapchat'
import steam from '../../src/main/modules/social/steam'
import strava from '../../src/main/modules/social/strava'
import tiktok from '../../src/main/modules/social/tiktok'
import twitch from '../../src/main/modules/social/twitch'
import wikimedia from '../../src/main/modules/social/wikimedia'
import x from '../../src/main/modules/social/x'
import youtube, { parseYtAbout, parseYtPage } from '../../src/main/modules/social/youtube'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson, type Route } from './social_helpers'

const json = (path: string): { body: string; headers: Record<string, string> } => ({ body: fixture(`social/${path}`), headers: { 'content-type': 'application/json' } })
const html = (path: string): { body: string } => ({ body: fixture(`social/${path}`) })
const NOT_FOUND = { status: 404, body: '{"error":"not found"}' }

/** Compte principal produit et entités qui lui sont rattachées. */
function split(out: { entities?: OutEntity[] }): { account: OutEntity; children: OutEntity[] } {
  const account = out.entities!.find((e) => e.ref === 'account')!
  return { account, children: out.entities!.filter((e) => e.from === 'account') }
}

async function run(m: OsintModule, routes: Route[], label: string, type = 'username') {
  return m.run(entity(type, label), fakeContext(routes))
}

describe('GitHub (fixtures de la documentation officielle)', () => {
  const routes: Route[] = [
    [/api\.github\.com\/users\/octocat$/, json('github_user.json')],
    [/\/social_accounts/, json('github_social_accounts.json')],
    [/\/events\/public/, json('github_events.json')],
    [/\/repos\/octocat\/Spoon-Knife\/commits\//, { body: { commit: { author: { email: 'spoon@example.org', name: 'Octo Spoon' }, committer: { email: 'noreply@github.com', name: 'GitHub' } } } }],
    [/api\.github\.com\/users\/nobody/, NOT_FOUND]
  ]
  it('profil, comptes liés et emails de commits', async () => {
    const out = await run(github, routes, 'octocat')
    const { account, children } = split(out)
    expect(account).toMatchObject({ label: 'octocat', platform: 'github', image: 'https://github.com/images/error/octocat_happy.gif' })
    expect(account.data).toMatchObject({ display_name: 'monalisa octocat', location: 'San Francisco', company: 'GitHub', followers: 20, created_at: '2008-01-14T04:33:35.000Z' })
    const labels = children.map((c) => `${c.type}:${c.platform ?? ''}:${c.label}`)
    expect(labels).toEqual(
      expect.arrayContaining([
        'email::octocat@github.com',
        'account:x:monatheoctocat',
        'account:x:github',
        'url::https://octocat.example.com',
        'email::mona.work@example.com',
        'email::spoon@example.org'
      ])
    )
    expect(labels.some((l) => l.includes('noreply'))).toBe(false)
  })
  it('compte inexistant', async () => {
    expect((await run(github, routes, 'nobody')).found).toBe(false)
  })
  it('ignore les adresses noreply', () => {
    expect(commitIdentities([{ email: 'a@users.noreply.github.com' }, { email: 'B@x.io', name: 'B' }, { email: 'b@x.io' }])).toEqual([{ email: 'b@x.io', name: 'B' }])
  })
})

describe('GitLab', () => {
  const routes: Route[] = [
    [/api\/v4\/users\?username=dzaporozhets/, json('gitlab_users.json')],
    [/gitlab\.com\/dzaporozhets$/, html('gitlab_profile.html')],
    [/api\/v4\/users\?username=nobody/, { body: '[]' }]
  ]
  it('profil API et page publique', async () => {
    const { account, children } = split(await run(gitlab, routes, 'dzaporozhets'))
    expect(account.data).toMatchObject({ user_id: '444', display_name: 'Dmytro Zaporozhets (DZ)', bio: 'GitLab cofounder', location: 'Europe', created_at: '2012-11-08T12:00:00.000Z' })
    expect(children.map((c) => `${c.platform ?? c.type}:${c.label}`)).toEqual(
      expect.arrayContaining(['url:https://dzaporozhets.me', 'linkedin:dzaporozhets', 'x:dzaporozhets'])
    )
    expect(parseGitlabPage(fixture('social/gitlab_profile.html')).status).toContain('semi-retired')
  })
  it('compte inexistant', async () => {
    expect((await run(gitlab, routes, 'nobody')).found).toBe(false)
  })
})

describe('Codeberg', () => {
  it('profil rattaché à la plateforme Codeberg, email noreply ignoré', async () => {
    const out = await run(codeberg, [[/codeberg\.org\/api\/v1\/users\/forgejo/, json('codeberg_user.json')]], 'forgejo')
    const { account, children } = split(out)
    expect(account).toMatchObject({ label: 'forgejo', platform: 'codeberg', data: { website: 'https://forgejo.org', followers: expect.any(Number) } })
    expect(children.map((c) => c.label)).toEqual(['https://forgejo.org'])
  })
})

describe('Reddit (fixture construite d’après la documentation)', () => {
  it('profil', async () => {
    const { account, children } = split(await run(reddit, [[/reddit\.com\/user\/spez\/about\.json/, json('reddit_about.json')]], 'spez'))
    expect(account.data).toMatchObject({ user_id: 't2_1w72', total_karma: 935461, created_at: '2005-06-06T04:00:00.000Z', email_verified: true, moderator: true })
    expect(account.image).toBe('https://styles.redditmedia.com/t5_3k30p/styles/profileIcon_snoo.png')
    expect(children.map((c) => c.label)).toEqual(['hello@example.com'])
  })
  it('compte inexistant', async () => {
    expect((await run(reddit, [[/reddit/, NOT_FOUND]], 'nobody')).found).toBe(false)
  })
})

describe('Keybase', () => {
  const routes: Route[] = [
    [/usernames=chris/, json('keybase_lookup.json')],
    [/usernames=nobody/, json('keybase_missing.json')]
  ]
  it('comptes prouvés, domaine et adresses crypto', async () => {
    const { account, children } = split(await run(keybase, routes, 'chris'))
    expect(account.data).toMatchObject({ display_name: 'Chris Coyne', location: 'Maine', created_at: '2014-02-06T02:18:28.000Z' })
    const labels = children.map((c) => `${c.type}:${c.platform ?? ''}:${c.label}`)
    expect(labels).toEqual(
      expect.arrayContaining([
        'account:x:malgorithms',
        'account:github:malgorithms',
        'account:reddit:malgorithms',
        'account:hackernews:malgorithms',
        'domain::chriscoyne.com',
        'crypto_wallet:bitcoin:3LKaAcHgUja3B3ZwfJjxVdqWbxd71pE6NK'
      ])
    )
  })
  it('compte inexistant', async () => {
    expect((await run(keybase, routes, 'nobody')).found).toBe(false)
  })
})

describe('Hacker News, Lichess, Chess.com', () => {
  it('Hacker News', async () => {
    const routes: Route[] = [[/user\/pg\.json/, json('hn_user.json')], [/user\/nobody\.json/, { body: 'null' }]]
    const { account } = split(await run(hackernews, routes, 'pg'))
    expect(account.data).toMatchObject({ bio: 'Bug fixer.', karma: 157316, created_at: '2006-10-09T18:21:32.000Z', submissions: 10 })
    expect((await run(hackernews, routes, 'nobody')).found).toBe(false)
  })
  it('Lichess', async () => {
    const routes: Route[] = [[/api\/user\/thibault/, json('lichess_user.json')], [/api\/user\/nobody/, NOT_FOUND]]
    const { account, children } = split(await run(lichess, routes, 'thibault'))
    expect(account.data).toMatchObject({ display_name: 'Thibault Duplessis', created_at: '2010-11-22T08:48:00.000Z', verified: true })
    expect(children.map((c) => `${c.platform}:${c.label}`)).toEqual(expect.arrayContaining(['github:ornicar', 'mastodon:thibault@mas.to', 'twitch:ornicar2']))
    expect((await run(lichess, routes, 'nobody')).found).toBe(false)
  })
  it('Chess.com', async () => {
    const routes: Route[] = [[/pub\/player\/hikaru/, json('chesscom_player.json')], [/pub\/player\/nobody/, NOT_FOUND]]
    const { account, children } = split(await run(chesscom, routes, 'hikaru'))
    expect(account).toMatchObject({ label: 'Hikaru', data: { display_name: 'Hikaru Nakamura', country: 'États-Unis', title: 'GM', location: 'Florida' } })
    expect(children.map((c) => `${c.platform}:${c.label}`)).toEqual(['twitch:gmhikaru'])
    expect((await run(chesscom, routes, 'nobody')).found).toBe(false)
  })
})

describe('Bluesky et Mastodon', () => {
  it('handle Bluesky', () => {
    expect(bskyHandle('jay')).toBe('jay.bsky.social')
    expect(bskyHandle('@jay.bsky.team')).toBe('jay.bsky.team')
    expect(bskyHandle('bad handle')).toBeNull()
  })
  it('Bluesky', async () => {
    const routes: Route[] = [[/actor=jay\.bsky\.team/, json('bsky_profile.json')], [/getProfile/, { status: 400, body: '{"error":"InvalidRequest","message":"Profile not found"}' }]]
    const { account } = split(await run(bluesky, routes, 'jay.bsky.team'))
    expect(account.data).toMatchObject({ user_id: 'did:plc:oky5czdrnfjpqslsw2a5iclo', followers: 594469, verified: true, created_at: '2022-11-17T06:31:40.296Z' })
    expect((await run(bluesky, routes, 'nobody')).found).toBe(false)
  })
  it('Mastodon : plusieurs instances, comptes locaux seulement', async () => {
    expect(splitAcct('@Gargron@mastodon.social')).toEqual(['Gargron', 'mastodon.social'])
    const routes: Route[] = [
      [/mastodon\.social\/api\/v1\/accounts\/lookup/, json('mastodon_account.json')],
      // Compte distant connu de l'instance : ignoré
      [/mas\.to\/api/, { body: { ...fixtureJson<Record<string, unknown>>('social/mastodon_account.json'), acct: 'Gargron@mastodon.social' } }],
      [/api\/v1\/accounts\/lookup/, { status: 404, body: '{"error":"Record not found"}' }]
    ]
    const out = await run(mastodon, routes, 'Gargron')
    expect(out.found).toBe(true)
    const accounts = out.entities!.filter((e) => e.type === 'account' && e.ref)
    expect(accounts.map((a) => a.label)).toEqual(['Gargron@mastodon.social'])
    expect(accounts[0].data).toMatchObject({ display_name: 'Eugen Rochko', followers: 383379, created_at: '2016-03-16T00:00:00.000Z' })
    expect(out.entities!.some((e) => e.platform === 'github' && e.label === 'Gargron')).toBe(true)
    expect((out.raw as { checked: string[] }).checked).toEqual(INSTANCES)
  })
  it('Mastodon : instance indiquée sur un compte', async () => {
    const ctx = fakeContext([[/mastodon\.social\/api\/v1\/accounts\/lookup\?acct=Gargron/, json('mastodon_account.json')]])
    const out = await mastodon.run(entity('account', 'Gargron@mastodon.social', { platform: 'mastodon' }), ctx)
    expect(ctx.calls).toHaveLength(1)
    expect(out.properties).toMatchObject({ instance: 'mastodon.social', posts: 82621 })
  })
})

describe('X, Twitch, Kick', () => {
  it('X via FxTwitter', async () => {
    const routes: Route[] = [[/fxtwitter\.com\/elonmusk/, json('fxtwitter_user.json')], [/fxtwitter/, { status: 404, body: '{"code":404,"message":"User not found"}' }]]
    const { account, children } = split(await run(x, routes, 'elonmusk'))
    expect(account.data).toMatchObject({ user_id: '44196397', display_name: 'Elon Musk', created_at: '2009-06-02T20:12:29.000Z' })
    expect(account.image).toMatch(/_400x400\.jpg$/)
    expect(children.map((c) => c.label)).toEqual(['http://terafab.ai'])
    expect((await run(x, routes, 'nobody')).found).toBe(false)
  })
  it('X : un 404 isolé de FxTwitter ne conclut pas à l’absence', async () => {
    let n = 0
    const flaky: Route[] = [[/fxtwitter\.com\/elonmusk/, () => (n++ < 2 ? { status: 404, body: '{"code":404,"message":"User not found"}' } : json('fxtwitter_user.json'))]]
    expect((await run(x, flaky, 'elonmusk')).found).toBe(true)
    expect(n).toBe(3)
  })
  it('Twitch', async () => {
    const routes: Route[] = [[/gql\.twitch\.tv/, (_u, init) => (JSON.stringify(init.json).includes('"xqc"') ? json('twitch_gql.json') : { body: '{"data":{"user":null}}' })]]
    const { account, children } = split(await run(twitch, routes, 'xQc'))
    expect(account.data).toMatchObject({ user_id: '71092938', followers: 12642371, role: 'partner', created_at: '2014-09-12T23:50:05.989Z' })
    expect(children.map((c) => `${c.platform ?? c.type}:${c.label}`)).toEqual(expect.arrayContaining(['x:xQc', 'youtube:UCmDTrq0LNgPodDOFZiSbsww']))
    expect((await run(twitch, routes, 'nobody')).found).toBe(false)
  })
  it('Kick', async () => {
    const routes: Route[] = [[/channels\/xqc/, json('kick_channel.json')], [/channels\//, { status: 404, body: '{"message":"Channel not found."}' }]]
    const { account, children } = split(await run(kick, routes, 'xqc'))
    expect(account.data).toMatchObject({ followers: 1295757, verified: true, created_at: '2022-10-22T06:59:51.000Z' })
    expect(children.map((c) => `${c.platform}:${c.label}`)).toEqual(expect.arrayContaining(['instagram:xqcow1', 'x:xqc', 'discord:xqcow']))
    expect((await run(kick, routes, 'nobody')).found).toBe(false)
  })
})

describe('YouTube', () => {
  it('page de chaîne et panneau « À propos »', async () => {
    const page = parseYtPage(fixture('social/youtube_channel.html'))!
    expect(page).toMatchObject({ channelId: 'UCBJycsmduvYEL83R_U4JriQ', title: 'Marques Brownlee', handle: 'mkbhd', subscribers: 21400000 })
    expect(page.aboutToken).toBeTruthy()
    const about = parseYtAbout(fixtureJson('social/youtube_about.json'))!
    expect(about).toMatchObject({ country: 'United States', views: 5802580406, videos: 1860, joined: '2008-03-21T12:00:00.000Z', hasBusinessEmail: true })
    const ctx = fakeContext([
      [/youtube\.com\/@mkbhd/, html('youtube_channel.html')],
      [/youtubei\/v1\/browse/, json('youtube_about.json')]
    ])
    const out = await youtube.run(entity('username', 'mkbhd'), ctx)
    const { account, children } = split(out)
    expect(account.data).toMatchObject({ user_id: 'UCBJycsmduvYEL83R_U4JriQ', location: 'États-Unis', created_at: '2008-03-21T12:00:00.000Z' })
    expect(children.map((c) => `${c.platform ?? c.type}:${c.label}`)).toEqual(expect.arrayContaining(['email:business@mkbhd.com', 'x:MKBHD']))
    expect(ctx.calls[0].headers['accept-language']).toMatch(/^en/)
  })
  it('chaîne inexistante', async () => {
    expect((await run(youtube, [[/youtube/, { status: 404, body: '<html>404</html>' }]], 'nobody')).found).toBe(false)
  })
})

describe('TikTok, Snapchat, Steam, Strava', () => {
  it('TikTok', async () => {
    const routes: Route[] = [[/@khaby\.lame/, html('tiktok_profile.html')], [/@nobody/, html('tiktok_missing.html')]]
    const { account } = split(await run(tiktok, routes, 'khaby.lame'))
    expect(account.data).toMatchObject({ user_id: '127905465618821121', display_name: 'Khabane lame', followers: 162979497, videos: 1359, created_at: '2016-08-10T22:02:34.000Z' })
    expect((await run(tiktok, routes, 'nobody')).found).toBe(false)
    // Compte privé : TikTok répond le code 10222 mais fournit le profil de base.
    const priv = split(await run(tiktok, [[/@khaby\.lame/, html('tiktok_private.html')]], 'khaby.lame'))
    expect(priv.account).toMatchObject({ platform: 'tiktok', data: { private: true } })
  })
  it('Snapchat (profil public)', async () => {
    const routes: Route[] = [[/snapchat\.com\/@john/, html('snapchat_public.html')], [/snapchat/, { status: 404, body: '' }]]
    const { account, children } = split(await run(snapchat, routes, 'john'))
    expect(account.data).toMatchObject({ display_name: 'John Shahidi', location: 'California', followers: 228500 })
    expect(children.map((c) => `${c.platform}:${c.label}`)).toEqual(['x:john'])
    expect((await run(snapchat, routes, 'nobody')).found).toBe(false)
  })
  it('Steam', async () => {
    const routes: Route[] = [[/id\/robinwalker/, html('steam_profile.xml')], [/id\//, html('steam_missing.xml')]]
    const { account, children } = split(await run(steam, routes, 'robinwalker'))
    expect(account).toMatchObject({ label: 'robinwalker', data: { user_id: '76561197960435530', real_name: 'Robin Walker', location: 'Bellevue, Washington, United States', created_at: '2003-09-12T12:00:00.000Z' } })
    expect(children.filter((c) => c.type === 'group').map((c) => c.label)).toEqual(['Valve', 'Dota 2 Internal'])
    expect((await run(steam, routes, 'nobody')).found).toBe(false)
  })
  it('Strava', async () => {
    const routes: Route[] = [[/athletes\/kipchoge/, html('strava_athlete.html')], [/athletes\//, { status: 404, body: '' }]]
    const { account } = split(await run(strava, routes, 'kipchoge'))
    expect(account.data).toMatchObject({ user_id: '114546588', display_name: 'Eddie Fuller', country: 'Jamaïque' })
    expect((await run(strava, routes, 'nobody')).found).toBe(false)
  })
})

describe('Duolingo, Docker Hub, npm, Hugging Face, DEV', () => {
  it('Duolingo', async () => {
    const routes: Route[] = [[/users\?username=luis/i, json('duolingo_users.json')], [/users\?username=/, { body: '{"users":[]}' }]]
    const { account } = split(await run(duolingo, routes, 'Luis'))
    expect(account.data).toMatchObject({ user_id: '14', location: 'Guatemala', linked_logins: ['Facebook', 'Google'], created_at: '2011-11-30T02:43:57.000Z' })
    expect((await run(duolingo, routes, 'nobody')).found).toBe(false)
    // Limitation : liste vide y compris pour le compte témoin
    await expect(run(duolingo, [[/users/, { body: '{"users":[]}' }]], 'nobody')).rejects.toThrow(/limitée/)
  })
  it('Docker Hub', async () => {
    const routes: Route[] = [[/v2\/users\/bitnami/, json('dockerhub_user.json')], [/v2\/users\//, { status: 404, body: '{"message":"User not found"}' }]]
    const { account, children } = split(await run(dockerhub, routes, 'bitnami'))
    expect(account.data).toMatchObject({ display_name: 'Bitnami Secure Images', company: 'VMware', gravatar_hash: '85bcf547a6bf62b855df2c682af81a4e' })
    expect(children.map((c) => c.label)).toEqual(['https://bitnami.com'])
    expect((await run(dockerhub, routes, 'nobody')).found).toBe(false)
  })
  it('npm', async () => {
    const routes: Route[] = [[/maintainer%3Asindresorhus/, json('npm_search.json')], [/search/, { body: '{"objects":[],"total":0}' }]]
    const { account, children } = split(await run(npm, routes, 'sindresorhus'))
    expect((account.data?.package_names as string[]).length).toBe(3)
    expect(children.map((c) => c.label)).toEqual(['sindresorhus@gmail.com'])
    expect((await run(npm, routes, 'nobody')).found).toBe(false)
  })
  it('Hugging Face', async () => {
    const routes: Route[] = [[/users\/julien-c\/overview/, json('huggingface_overview.json')], [/overview/, { status: 404, body: '{"error":"This user does not exist"}' }]]
    const { account, children } = split(await run(huggingface, routes, 'julien-c'))
    expect(account.data).toMatchObject({ display_name: 'Julien Chaumond', created_at: '2019-11-23T17:38:57.000Z' })
    expect(children.filter((c) => c.type === 'organization')).toHaveLength(3)
    expect((await run(huggingface, routes, 'nobody')).found).toBe(false)
  })
  it('DEV', async () => {
    const routes: Route[] = [[/by_username\?url=ben/, json('devto_user.json')], [/by_username/, NOT_FOUND]]
    const { account, children } = split(await run(devto, routes, 'ben'))
    expect(account.data).toMatchObject({ display_name: 'Ben Halpern', location: 'NY', created_at: '2015-12-27T12:00:00.000Z' })
    expect(children.map((c) => `${c.platform ?? c.type}:${c.label}`)).toEqual(['url:http://benhalpern.com', 'x:bendhalpern', 'github:benhalpern'])
    expect((await run(devto, routes, 'nobody')).found).toBe(false)
  })
})

describe('Gravatar, Linktree, Roblox, Minecraft, Wikimedia', () => {
  it('Gravatar', async () => {
    const routes: Route[] = [[/gravatar\.com\/beau\.json/, json('gravatar_profile.json')], [/gravatar/, { status: 404, body: '"User not found"' }]]
    const { account, children } = split(await run(gravatar, routes, 'beau'))
    expect(account.data).toMatchObject({ display_name: 'Beau Lebens', location: 'Golden, CO', company: 'Automattic', email_hash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(children.map((c) => `${c.platform ?? c.type}:${c.label}`)).toEqual(expect.arrayContaining(['email:beau@automattic.com', 'x:beaulebens', 'github:beaulebens', 'linkedin:beaulebens']))
    expect((await run(gravatar, routes, 'nobody')).found).toBe(false)
  })
  it('Linktree', async () => {
    const routes: Route[] = [[/linktr\.ee\/selenagomez/, html('linktree_page.html')], [/linktr\.ee/, { status: 404, body: '' }]]
    const { account, children } = split(await run(linktree, routes, 'selenagomez'))
    expect(account.data).toMatchObject({ country: 'États-Unis', timezone: 'America/Los_Angeles', created_at: '2020-01-24T10:15:25.000Z' })
    expect(children.map((c) => `${c.platform ?? c.type}:${c.label}`)).toEqual(expect.arrayContaining(['instagram:selenagomez', 'tiktok:selenagomez', 'x:selenagomez']))
    expect((await run(linktree, routes, 'nobody')).found).toBe(false)
  })
  it('Roblox', async () => {
    const routes: Route[] = [
      [/usernames\/users/, (_u, init) => ({ body: JSON.stringify(init.json).includes('builderman') ? { data: [{ id: 156, name: 'builderman' }] } : { data: [] } })],
      [/users\.roblox\.com\/v1\/users\/156$/, json('roblox_user.json')],
      [/avatar-headshot/, { body: { data: [{ targetId: 156, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/x/420/420/AvatarHeadshot/Png' }] } }],
      [/followers\/count/, { body: { count: 69891271 } }],
      [/friends\/count/, { body: { count: 0 } }],
      [/username-history/, { body: { data: [] } }]
    ]
    const { account } = split(await run(roblox, routes, 'builderman'))
    expect(account).toMatchObject({ image: 'https://tr.rbxcdn.com/x/420/420/AvatarHeadshot/Png', data: { user_id: '156', followers: 69891271, created_at: '2006-03-08T17:17:52.900Z' } })
    expect((await run(roblox, routes, 'nobody')).found).toBe(false)
  })
  it('Minecraft', async () => {
    const routes: Route[] = [[/minecraft\/Notch/, { body: '{"id":"069a79f444e94726a5befca90e38aaf5","name":"Notch"}' }], [/minecraft\//, { status: 404, body: '{}' }]]
    const { account } = split(await run(minecraft, routes, 'Notch'))
    expect(account.data).toMatchObject({ user_id: '069a79f4-44e9-4726-a5be-fca90e38aaf5' })
    expect((await run(minecraft, routes, 'nobody')).found).toBe(false)
  })
  it('Wikimedia', async () => {
    const routes: Route[] = [[/guiuser=Jimbo\+Wales/, json('wikimedia_globaluserinfo.json')], [/globaluserinfo/, json('wikimedia_missing.json')]]
    const { account } = split(await run(wikimedia, routes, 'Jimbo_Wales'))
    expect(account).toMatchObject({ label: 'Jimbo Wales', platform: 'wikipedia', data: { home_wiki: 'enwiki', groups: ['founder'], created_at: '2008-04-12T16:22:49.000Z' } })
    expect((account.data?.active_wikis as string[])[0]).toMatch(/^en\.wikipedia\.org/)
    expect((await run(wikimedia, routes, 'nobody')).found).toBe(false)
  })
})

describe.skipIf(!LIVE)('live', () => {
  const ctx = makeContext()
  const cases: Array<[string, OsintModule, string, string]> = (
    [
      [gitlab, 'dzaporozhets', 'Dmytro'],
      [codeberg, 'forgejo', 'Forgejo'],
      [keybase, 'chris', 'Chris Coyne'],
      [hackernews, 'pg', 'Bug fixer.'],
      [lichess, 'thibault', 'Thibault'],
      [chesscom, 'hikaru', 'Hikaru Nakamura'],
      [bluesky, 'jay.bsky.team', 'Jay'],
      [mastodon, 'Gargron', 'Eugen Rochko'],
      [x, 'jack', 'jack'],
      [twitch, 'xqc', 'xQc'],
      [kick, 'xqc', 'THE BEST'],
      [youtube, 'mkbhd', 'Marques Brownlee'],
      [tiktok, 'khaby.lame', 'Khabane'],
      [snapchat, 'djkhaled305', 'DJ Khaled'],
      [steam, 'robinwalker', 'Robin Walker'],
      [strava, 'kipchoge', 'Eddie Fuller'],
      [duolingo, 'luis', 'Luis'],
      [dockerhub, 'bitnami', 'Bitnami'],
      [npm, 'sindresorhus', 'sindresorhus'],
      [huggingface, 'julien-c', 'Julien Chaumond'],
      [devto, 'ben', 'Ben Halpern'],
      [gravatar, 'beau', 'Beau Lebens'],
      [linktree, 'selenagomez', 'selenagomez'],
      [roblox, 'builderman', 'builderman'],
      [minecraft, 'Notch', 'Notch'],
      [wikimedia, 'Jimbo Wales', 'enwiki']
    ] as Array<[OsintModule, string, string]>
  ).map(([m, u, e]) => [m.id, m, u, e])

  /** Un blocage du service depuis l'adresse IP de test (pare-feu, quota) n'est pas un échec du module. */
  async function attempt(m: OsintModule, username: string, skip: (note?: string) => void) {
    try {
      return await runModule(m, entity('username', username), ctx)
    } catch (e) {
      if (e instanceof ModuleError && ['blocked', 'rate_limited', 'unavailable'].includes(e.code)) skip(e.message)
      throw e
    }
  }

  it.for(cases)('%s trouve le compte', { timeout: 60000 }, async ([, m, username, expected], { skip }) => {
    const out = (await attempt(m, username, skip))!
    expect(out.found).toBe(true)
    expect(JSON.stringify(out.entities)).toContain(expected)
  })

  it.for(cases)('%s : pseudo inexistant', { timeout: 60000 }, async ([, m], { skip }) => {
    const out = (await attempt(m, 'zq8x7v2kq9w1', skip))!
    expect(out.found).toBe(false)
  })
})
