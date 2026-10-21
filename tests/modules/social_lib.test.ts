import { describe, expect, it } from 'vitest'
import {
  acceptsPlatform,
  accountFromUrl,
  extractEmails,
  extractUrls,
  htmlToText,
  linkedEntities,
  metaContent,
  parseCompactNumber,
  profileOutput,
  toIso,
  toNumber,
  usernameOf
} from '../../src/main/modules/social/_lib'
import { entity } from '../helpers/context'

describe('lecture du pseudo', () => {
  it('pseudo, compte, URL', () => {
    expect(usernameOf(entity('username', '@bob'))).toBe('bob')
    expect(usernameOf(entity('account', 'Bob Martin', { platform: 'github', data: { username: 'bobm' } }))).toBe('bobm')
    expect(usernameOf(entity('account', 'https://github.com/bobm', { platform: 'github' }))).toBe('bobm')
  })

  it('accepte un pseudo ou un compte de la bonne plateforme', () => {
    const acc = acceptsPlatform('github')
    expect(acc(entity('username', 'bob'))).toBe(true)
    expect(acc(entity('account', 'bob', { platform: 'github' }))).toBe(true)
    expect(acc(entity('account', 'bob', { platform: 'gitlab' }))).toBe(false)
    expect(acceptsPlatform('codeberg')(entity('account', 'bob (Codeberg)', { data: { site: 'Codeberg' } }))).toBe(true)
  })
})

describe('URL de profils', () => {
  it.each([
    ['https://twitter.com/jack', 'x', 'jack'],
    ['https://x.com/jack/', 'x', 'jack'],
    ['https://www.instagram.com/nasa/', 'instagram', 'nasa'],
    ['https://github.com/torvalds', 'github', 'torvalds'],
    ['https://www.youtube.com/@mkbhd', 'youtube', 'mkbhd'],
    ['https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ', 'youtube', 'UCBJycsmduvYEL83R_U4JriQ'],
    ['https://t.me/durov', 'telegram', 'durov'],
    ['https://www.linkedin.com/in/john-doe-123', 'linkedin', 'john-doe-123'],
    ['https://www.reddit.com/user/spez', 'reddit', 'spez'],
    ['https://bsky.app/profile/jay.bsky.team', 'bluesky', 'jay.bsky.team'],
    ['https://www.tiktok.com/@khaby.lame', 'tiktok', 'khaby.lame'],
    ['https://foo.tumblr.com', 'tumblr', 'foo'],
    ['https://www.facebook.com/profile.php?id=100004', 'facebook', '100004'],
    ['twitch.tv/xqc', 'twitch', 'xqc'],
    ['https://lichess.org/@/thibault', 'lichess', 'thibault']
  ])('%s', (url, platform, username) => {
    expect(accountFromUrl(url)).toMatchObject({ platform, username })
  })

  it('fédivers et URL non reconnues', () => {
    expect(accountFromUrl('https://mas.to/@thibault')).toEqual({ platform: 'mastodon', username: 'thibault@mas.to', label: 'thibault@mas.to' })
    expect(accountFromUrl('https://github.com/chalk/ansi-styles')).toBeNull()
    expect(accountFromUrl('https://x.com/home')).toBeNull()
    expect(accountFromUrl('https://example.com/about')).toBeNull()
  })
})

describe('texte libre', () => {
  it('emails et liens', () => {
    const t = 'Pro : contact@mkbhd.com. Site https://mkbhd.com/shop, aussi twitter.com/MKBHD et logo@2x.png'
    expect(extractEmails(t)).toEqual(['contact@mkbhd.com'])
    expect(extractUrls(t)).toEqual(['https://mkbhd.com/shop', 'https://twitter.com/MKBHD'])
  })

  it('HTML vers texte', () => {
    expect(htmlToText('<p>Hello &amp; bye<br/>line</p><p><a href="https://a.io/x">a.io/x</a></p>')).toBe('Hello & bye\nline\n\na.io/x')
  })

  it('entités liées dédoublonnées, sans le compte lui-même', () => {
    const out = linkedEntities({
      text: 'me: bob@example.com https://github.com/bob https://bob.dev',
      urls: ['https://x.com/bob', 'https://github.com/bob'],
      emails: ['BOB@example.com', 'x@users.noreply.github.com'],
      lang: 'fr',
      self: { platform: 'x', username: 'bob' }
    })
    expect(out.map((e) => `${e.type}:${e.platform ?? ''}:${e.label}`)).toEqual(['email::bob@example.com', 'account:github:bob', 'url::https://bob.dev'])
  })
})

describe('conversions', () => {
  it('dates et nombres', () => {
    expect(toIso(1160418092)).toBe('2006-10-09T18:21:32.000Z')
    expect(toIso(1290415680000)).toBe('2010-11-22T08:48:00.000Z')
    expect(toIso('Tue Jun 02 20:12:29 +0000 2009')).toBe('2009-06-02T20:12:29.000Z')
    expect(toIso('0001-01-01T00:00:00Z')).toBeUndefined()
    expect(toNumber('10 299 929')).toBe(10299929)
    expect(toNumber('1,295,757')).toBe(1295757)
    expect(parseCompactNumber('21.4M subscribers')).toBe(21400000)
    expect(parseCompactNumber('1.8K videos')).toBe(1800)
    expect(parseCompactNumber('532 subscribers')).toBe(532)
  })

  it('balises meta', () => {
    const html = '<meta property="og:title" content="A &amp; B"><meta content="desc" name="description">'
    expect(metaContent(html, 'og:title')).toBe('A & B')
    expect(metaContent(html, 'description')).toBe('desc')
  })
})

describe('sortie de profil', () => {
  const profile = { username: 'bob', url: 'https://github.com/bob', image: 'https://img/bob.png', data: { display_name: 'Bob', bio: '' } }
  const child = { type: 'email', label: 'bob@example.com' }

  it('depuis un pseudo : crée le compte et y rattache les entités', () => {
    const out = profileOutput(entity('username', 'bob'), 'github', profile, [child])
    expect(out.found).toBe(true)
    expect(out.entities?.[0]).toMatchObject({ ref: 'account', type: 'account', label: 'bob', platform: 'github', image: 'https://img/bob.png' })
    expect(out.entities?.[0].data).toEqual({ username: 'bob', url: 'https://github.com/bob', display_name: 'Bob' })
    expect(out.entities?.[1]).toMatchObject({ type: 'email', from: 'account' })
  })

  it('depuis un compte : fusionne les propriétés et attache l’avatar au nœud d’entrée', () => {
    const input = entity('account', 'Bob', { platform: 'github' })
    const out = profileOutput(input, 'github', profile, [child])
    expect(out.properties).toMatchObject({ display_name: 'Bob', username: 'bob' })
    expect(out.entities?.[0]).toEqual({ type: 'account', label: 'Bob', platform: 'github', image: 'https://img/bob.png' })
    expect(out.entities?.[1].from).toBeUndefined()
  })

  it('plateforme absente du catalogue : nom du site dans le libellé', () => {
    const out = profileOutput(entity('username', 'bob'), 'sourcehut', { ...profile, site: 'SourceHut' })
    expect(out.entities?.[0]).toMatchObject({ label: 'bob (SourceHut)', data: { site: 'SourceHut' } })
    expect(out.entities?.[0].platform).toBeUndefined()
  })
})
