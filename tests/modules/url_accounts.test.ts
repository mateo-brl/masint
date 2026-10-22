// Modules hors ligne autour des comptes : lecture d'URL, profil à consulter à la main, photo de
// profil et date cachée dans les identifiants. Aucune requête réseau.

import { describe, expect, it } from 'vitest'
import type { ModuleContext, OsintModule } from '@shared/modules'
import urlParse, { accountInUrl, isPlatformDomain, registrableDomain } from '../../src/main/modules/misc/urlParse'
import snowflake, { DISCORD_EPOCH, snowflakeTime, X_EPOCH } from '../../src/main/modules/misc/snowflake'
import avatarPhoto, { avatarUrl, isDefaultAvatar } from '../../src/main/modules/social/avatarPhoto'
import profileManual, { hasDedicatedModule, manualProfileUrl, profileHint } from '../../src/main/modules/social/profileManual'
import { allModules } from '../../src/main/engine/registry'
import { entity, makeContext, runModule } from '../helpers/context'

/** Contexte qui refuse tout accès réseau : ces modules n'en ont pas besoin. */
function offline(extra: Partial<ModuleContext> = {}): ModuleContext {
  const fail = async (): Promise<never> => {
    throw new Error('requête réseau inattendue')
  }
  return { ...makeContext(), fetch: fail, fetchJson: fail, fetchText: fail, resolveDns: fail, ...extra }
}

describe('misc.url_parse', () => {
  const run = (label: string, type = 'url') => runModule(urlParse, entity(type, label), offline())

  it('domaine enregistrable', () => {
    expect(registrableDomain('www.blog.example.co.uk')).toBe('example.co.uk')
    expect(registrableDomain('www.service-public.gouv.fr')).toBe('service-public.gouv.fr')
    expect(registrableDomain('shop.example.com')).toBe('example.com')
    expect(registrableDomain('mon-site.netlify.app')).toBe('mon-site.netlify.app')
    expect(isPlatformDomain('instagram.com')).toBe(true)
    expect(isPlatformDomain('lemonde.fr')).toBe(false)
  })

  it('Instagram : compte et pseudo, pas de domaine', async () => {
    const out = await run('https://www.instagram.com/nasa/')
    expect(out.entities).toEqual([
      expect.objectContaining({ ref: 'account', type: 'account', platform: 'instagram', label: 'nasa', data: { username: 'nasa', url: 'https://www.instagram.com/nasa' } }),
      expect.objectContaining({ type: 'username', label: 'nasa', from: 'account' })
    ])
  })

  it('GitHub : profil et auteur d’un dépôt', async () => {
    expect((await run('https://github.com/torvalds')).entities?.[0]).toMatchObject({ platform: 'github', label: 'torvalds', linkLabel: 'profil GitHub' })
    const repo = await run('https://github.com/torvalds/linux/blob/master/README')
    expect(repo.entities?.[0]).toMatchObject({ platform: 'github', label: 'torvalds', linkLabel: 'auteur (GitHub)' })
    expect(accountInUrl('https://github.com/orgs/nasa/repositories')).toBeNull()
    expect(accountInUrl('https://octocat.github.io/projet/')).toMatchObject({ platform: 'github', username: 'octocat' })
  })

  it('TikTok et YouTube : /@pseudo, /channel/UC...', async () => {
    expect((await run('https://www.tiktok.com/@khaby.lame')).entities?.[0]).toMatchObject({ platform: 'tiktok', label: 'khaby.lame' })
    expect((await run('https://www.tiktok.com/@khaby.lame/video/7123456789012345678')).entities?.[0]).toMatchObject({ platform: 'tiktok', label: 'khaby.lame', linkLabel: 'auteur (TikTok)' })
    expect((await run('https://www.youtube.com/@NASA')).entities?.[0]).toMatchObject({ platform: 'youtube', label: 'NASA' })
    const channel = await run('https://www.youtube.com/channel/UCLA_DiR1FfKNvjuUpBHmylQ')
    expect(channel.entities).toHaveLength(1)
    expect(channel.entities?.[0]).toMatchObject({ platform: 'youtube', label: 'UCLA_DiR1FfKNvjuUpBHmylQ' })
    expect((await run('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).entities).toEqual([])
  })

  it('LinkedIn /in/ et Facebook profile.php?id=', async () => {
    expect((await run('https://fr.linkedin.com/in/jean-exemple-123/')).entities?.[0]).toMatchObject({ platform: 'linkedin', label: 'jean-exemple-123' })
    expect((await run('https://www.linkedin.com/in/jean-exemple-123')).entities?.[0]).toMatchObject({ platform: 'linkedin', label: 'jean-exemple-123' })
    const fb = await run('https://www.facebook.com/profile.php?id=100000000000001')
    // Identifiant numérique : pas de pseudo à suivre sur d'autres sites.
    expect(fb.entities).toEqual([expect.objectContaining({ type: 'account', platform: 'facebook', label: '100000000000001' })])
  })

  it('X : auteur d’un post ; Telegram : aperçu t.me/s/', async () => {
    expect((await run('https://x.com/NASA/status/1800000000000000000')).entities?.[0]).toMatchObject({ platform: 'x', label: 'NASA' })
    expect((await run('https://t.me/s/durov')).entities?.[0]).toMatchObject({ platform: 'telegram', label: 'durov', linkLabel: 'profil Telegram' })
  })

  it('site quelconque : domaine enregistrable seulement', async () => {
    const out = await run('https://www.lemonde.fr/international/article/2026/10/22/exemple.html')
    expect(out.entities).toEqual([{ type: 'domain', label: 'lemonde.fr', linkLabel: 'domaine' }])
    expect((await run('https://shop.example.co.uk', 'website')).entities).toEqual([{ type: 'domain', label: 'example.co.uk', linkLabel: 'domaine' }])
  })

  it('grande plateforme sans profil, adresse IP, .onion', async () => {
    expect((await run('https://www.instagram.com/p/ABC123/')).entities).toEqual([])
    expect((await run('http://93.184.215.14/admin')).entities).toEqual([{ type: 'ip', label: '93.184.215.14', linkLabel: 'hôte' }])
    expect((await run('http://exampleonionaddress2345.onion/page')).entities).toEqual([])
  })
})

describe('social.profile_manual', () => {
  const acc = (platform: string, label: string, data: Record<string, string> = {}) => entity('account', label, { platform, data })

  it('ne concerne que les plateformes sans module dédié', () => {
    expect(profileManual.accepts!(acc('instagram', 'nasa'))).toBe(true)
    expect(profileManual.accepts!(acc('linkedin', 'jean-exemple'))).toBe(true)
    expect(profileManual.accepts!(acc('github', 'torvalds'))).toBe(false)
    expect(profileManual.accepts!(acc('telegram', 'durov'))).toBe(false)
    expect(profileManual.accepts!(acc('tiktok', 'khaby.lame'))).toBe(false)
    // Messagerie sans page de profil, plateforme sans modèle d'URL.
    expect(profileManual.accepts!(acc('whatsapp', '33612345678'))).toBe(false)
    expect(profileManual.accepts!(acc('leboncoin', 'vendeur'))).toBe(false)
    expect(profileManual.accepts!(acc('leboncoin', 'vendeur', { url: 'https://www.leboncoin.fr/profile/exemple' }))).toBe(true)
    // Détection fondée sur les vrais modules du registre.
    const modules = allModules().filter((m) => m.category === 'social' || m.category === 'messaging')
    expect(hasDedicatedModule(acc('reddit', 'spez'), modules)).toBe(true)
    expect(hasDedicatedModule(acc('pinterest', 'nasa'), modules)).toBe(false)
    expect(manualProfileUrl(acc('pinterest', 'nasa'))).toBe('https://www.pinterest.com/nasa/')
  })

  it('construit l’URL et l’indication', () => {
    expect(manualProfileUrl(acc('instagram', '@nasa'))).toBe('https://www.instagram.com/nasa/')
    expect(manualProfileUrl(acc('facebook', '100000000000001'))).toBe('https://www.facebook.com/profile.php?id=100000000000001')
    expect(manualProfileUrl(acc('vinted', '12345678-exemple'))).toBe('https://www.vinted.fr/member/12345678-exemple')
    expect(manualProfileUrl(acc('vinted', 'pseudo'))).toBeNull()
    expect(profileHint('linkedin', 'fr')).toMatch(/^Poste actuel.*bio, les liens, le nombre d’abonnés/)
    expect(profileHint(null, 'en')).toMatch(/bio, links, follower/)
  })

  it('propose l’ouverture du profil et complète l’URL', async () => {
    const out = await runModule(profileManual, acc('instagram', 'nasa'), offline())
    expect(out.properties).toEqual({ url: 'https://www.instagram.com/nasa/' })
    expect(out.manual).toEqual([{ label: 'Profil Instagram', url: 'https://www.instagram.com/nasa/', hint: expect.stringContaining('lien en bio') }])
    const known = await runModule(profileManual, acc('pinterest', 'nasa', { url: 'https://www.pinterest.fr/nasa/' }), offline())
    expect(known.properties).toBeUndefined()
    expect(known.manual?.[0].url).toBe('https://www.pinterest.fr/nasa/')
  })
})

describe('social.avatar_photo', () => {
  it('ignore les avatars par défaut', () => {
    expect(isDefaultAvatar('https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png')).toBe(true)
    expect(isDefaultAvatar('https://cdn.discordapp.com/embed/avatars/3.png')).toBe(true)
    expect(isDefaultAvatar('https://www.gravatar.com/avatar/abc?d=identicon')).toBe(true)
    expect(isDefaultAvatar('https://gravatar.com/avatar/abc?d=404&s=400')).toBe(false)
    expect(isDefaultAvatar('https://avatars.githubusercontent.com/u/1024025?v=4')).toBe(false)
    expect(avatarUrl(entity('account', 'x', { data: { avatar_url: 'https://cdn.example.com/a/placeholder.png' } }))).toBeNull()
    expect(avatarUrl(entity('account', 'x', { imageOrigin: 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg' }))).toBe('https://pbs.twimg.com/profile_images/1/a_400x400.jpg')
  })

  it('photo à partir de l’avatar déjà joint, sans téléchargement', async () => {
    const origin = 'https://avatars.githubusercontent.com/u/1024025?v=4'
    const input = entity('account', 'torvalds', { platform: 'github', imageId: 'att1', imageOrigin: origin, data: { username: 'torvalds' } })
    expect(avatarPhoto.accepts!(input)).toBe(true)
    expect(avatarPhoto.followUp).toBe(true)
    const ctx = offline({ attachment: async () => ({ mime: 'image/png', name: 'a.png', data: Buffer.from([0x89, 0x50]), origin }) })
    const out = await runModule(avatarPhoto, input, ctx)
    expect(out.entities).toEqual([
      { type: 'photo', label: 'Avatar GitHub : torvalds', image: 'data:image/png;base64,iVA=', data: { url: origin }, linkLabel: 'photo de profil' }
    ])
  })

  it('photo à partir d’une URL en propriété : le moteur la télécharge', async () => {
    const out = await runModule(avatarPhoto, entity('account', 'exemple', { platform: 'reddit', data: { avatar: 'https://styles.redditmedia.com/t5_1/styles/profileIcon_abc.png' } }), offline())
    expect(out.entities?.[0]).toMatchObject({ type: 'photo', label: 'Avatar Reddit : exemple', image: 'https://styles.redditmedia.com/t5_1/styles/profileIcon_abc.png' })
    expect(avatarPhoto.accepts!(entity('account', 'sans-avatar', { platform: 'reddit' }))).toBe(false)
  })
})

describe('misc.snowflake', () => {
  it('décode les identifiants Discord et X', () => {
    // Exemple de la documentation Discord : 175928847299117063 → 2016-04-30T11:18:25.796Z.
    expect(snowflakeTime('175928847299117063', DISCORD_EPOCH)).toBe('2016-04-30T11:18:25.796Z')
    // (1212092628029698048 >> 22) + 1288834974657 ms, calculé à part : 2019-12-31T19:26:16.771Z.
    expect(snowflakeTime('1212092628029698048', X_EPOCH)).toBe('2019-12-31T19:26:16.771Z')
    // Identifiant X séquentiel (avant 2010) : aucune date.
    expect(snowflakeTime('783214', X_EPOCH)).toBeNull()
    expect(snowflakeTime('12345', DISCORD_EPOCH)).toBeNull()
    expect(snowflakeTime('pas-un-nombre', X_EPOCH)).toBeNull()
  })

  it('ajoute created_at aux comptes et serveurs qui n’en ont pas', async () => {
    const x = entity('account', 'exemple', { platform: 'x', data: { user_id: '1212092628029698048' } })
    expect(snowflake.accepts!(x)).toBe(true)
    expect((await runModule(snowflake, x, offline())).properties).toEqual({ created_at: '2019-12-31T19:26:16.771Z' })
    const discordUser = entity('account', '175928847299117063', { platform: 'discord' })
    expect((await runModule(snowflake, discordUser, offline())).properties?.created_at).toBe('2016-04-30T11:18:25.796Z')
    expect(snowflake.accepts!(entity('group', 'Serveur', { platform: 'discord', data: { guild_id: '175928847299117063' } }))).toBe(true)
    expect(snowflake.accepts!(entity('account', 'exemple', { platform: 'x', data: { user_id: '1212092628029698048', created_at: '2019-12-31' } }))).toBe(false)
    expect(snowflake.accepts!(entity('account', 'exemple', { platform: 'github', data: { user_id: '1212092628029698048' } }))).toBe(false)
  })
})

describe('registre : nouveaux modules hors ligne', () => {
  it('sont découverts, sans tiret long dans les textes', () => {
    const ids = ['misc.url_parse', 'social.profile_manual', 'social.avatar_photo', 'misc.snowflake']
    const found = allModules().filter((m: OsintModule) => ids.includes(m.id))
    expect(found.map((m) => m.id).sort()).toEqual([...ids].sort())
    for (const m of found) expect(`${m.name.fr}${m.name.en}${m.description.fr}${m.description.en}`).not.toMatch(/[\u2013\u2014]/)
  })
})
