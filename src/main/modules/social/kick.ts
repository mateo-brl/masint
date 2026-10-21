import { defineModule } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, toNumber, type Lang, type Parsed } from './_lib'

export interface KickChannel {
  id: number
  user_id?: number
  slug: string
  is_banned?: boolean
  verified?: boolean
  followers_count?: number | string
  livestream?: { created_at?: string } | null
  recent_categories?: Array<{ name?: string }>
  chatroom?: { created_at?: string }
  user?: {
    id?: number
    username?: string
    bio?: string | null
    profile_pic?: string | null
    instagram?: string | null
    twitter?: string | null
    youtube?: string | null
    discord?: string | null
    tiktok?: string | null
    facebook?: string | null
  }
}

/** Liens sociaux saisis comme identifiants (« xqcow1/ », « channel/UC... ») vers des URL. */
function socialUrls(u: NonNullable<KickChannel['user']>): string[] {
  const clean = (v?: string | null): string => (v ?? '').trim().replace(/^@/, '').replace(/\/$/, '')
  const out: string[] = []
  const add = (base: string, v?: string | null): void => {
    const c = clean(v)
    if (c) out.push(/^https?:\/\//.test(c) ? c : base + c)
  }
  add('https://instagram.com/', u.instagram)
  add('https://x.com/', u.twitter)
  add('https://www.youtube.com/', u.youtube)
  add('https://www.tiktok.com/@', u.tiktok)
  add('https://www.facebook.com/', u.facebook)
  return out
}

export function parseKick(c: KickChannel, lang: Lang): Parsed {
  const u = c.user ?? {}
  const children = linkedEntities({ text: u.bio ?? undefined, urls: socialUrls(u), lang, self: { platform: 'kick', username: c.slug } })
  const discord = (u.discord ?? '').trim()
  if (discord) {
    const invite = /discord\.(gg|com\/invite)\//.test(discord)
    children.push(
      invite
        ? { type: 'url', label: discord, data: { url: discord.startsWith('http') ? discord : `https://${discord}` }, linkLabel: 'Discord' }
        : { type: 'account', label: discord, platform: 'discord', data: { username: discord }, linkLabel: lang === 'fr' ? 'pseudo Discord affiché' : 'Discord username shown' }
    )
  }
  return {
    profile: {
      username: u.username ?? c.slug,
      url: `https://kick.com/${c.slug}`,
      image: u.profile_pic ?? undefined,
      data: {
        user_id: String(u.id ?? c.user_id ?? ''),
        bio: u.bio ?? undefined,
        followers: toNumber(c.followers_count),
        verified: c.verified || undefined,
        banned: c.is_banned || undefined,
        live: c.livestream ? true : undefined,
        categories: (c.recent_categories ?? []).map((x) => x.name).filter((n): n is string => !!n),
        created_at: toIso(c.chatroom?.created_at)
      }
    },
    children
  }
}

export default defineModule({
  id: 'social.kick',
  name: { fr: 'Chaîne Kick', en: 'Kick channel' },
  description: {
    fr: 'Chaîne Kick : bio, abonnés, vérification, catégories récentes, date de création et comptes Instagram, X, YouTube, TikTok, Discord renseignés.',
    en: 'Kick channel: bio, followers, verification, recent categories, creation date and the Instagram, X, YouTube, TikTok, Discord accounts filled in.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('kick'),
  homepage: 'https://kick.com',
  async run(input, ctx) {
    const slug = requireUsername(input, /^[\w-]{1,30}$/).toLowerCase()
    let channel: KickChannel
    try {
      channel = await ctx.fetchJson<KickChannel>(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`)
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Kick')
    }
    const parsed = parseKick(channel, ctx.lang)
    const { playback_url: _, ...raw } = channel as KickChannel & { playback_url?: string }
    return profileOutput(input, 'kick', parsed.profile, parsed.children, raw, ctx.lang)
  }
})
