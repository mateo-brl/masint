import { defineModule } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface FxUser {
  screen_name: string
  url?: string
  id?: string
  name?: string
  description?: string
  raw_description?: { text?: string; facets?: Array<{ type?: string; original?: string; replacement?: string }> }
  location?: string
  avatar_url?: string
  banner_url?: string
  followers?: number
  following?: number
  likes?: number
  tweets?: number
  media_count?: number
  joined?: string
  protected?: boolean
  website?: { url?: string; display_url?: string } | null
  birthday?: { day?: number; month?: number; year?: number } | null
  verification?: { verified?: boolean; type?: string | null } | null
}

export function parseFx(u: FxUser, lang: Lang): Parsed {
  const facetUrls = (u.raw_description?.facets ?? []).filter((f) => f.type === 'url').map((f) => f.replacement)
  const b = u.birthday
  const birthday = b?.month && b.day ? [b.year, String(b.month).padStart(2, '0'), String(b.day).padStart(2, '0')].filter(Boolean).join('-') : undefined
  return {
    profile: {
      username: u.screen_name,
      url: `https://x.com/${u.screen_name}`,
      image: u.avatar_url?.replace(/_normal(\.\w+)$/, '_400x400$1'),
      data: {
        user_id: u.id,
        display_name: u.name,
        bio: u.description,
        location: u.location || undefined,
        website: u.website?.url,
        followers: u.followers,
        following: u.following,
        posts: u.tweets,
        likes: u.likes,
        media: u.media_count,
        protected: u.protected || undefined,
        verified: u.verification?.verified || undefined,
        verification_type: u.verification?.type ?? undefined,
        birthday,
        created_at: toIso(u.joined)
      }
    },
    children: linkedEntities({ text: u.description, urls: [u.website?.url, ...facetUrls], lang, self: { platform: 'x', username: u.screen_name } })
  }
}

export default defineModule({
  id: 'social.x',
  name: { fr: 'Profil X (Twitter)', en: 'X (Twitter) profile' },
  description: {
    fr: 'Profil X public via l’API ouverte FxTwitter (service tiers) : nom, bio, localisation, site, date de création, abonnés, nombre de posts et identifiant numérique.',
    en: 'Public X profile through the open FxTwitter API (third-party service): name, bio, location, website, creation date, followers, post count and numeric ID.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('x'),
  homepage: 'https://github.com/FxEmbed/FxEmbed',
  async run(input, ctx) {
    const username = requireUsername(input, /^\w{1,15}$/)
    let res: { code: number; user?: FxUser }
    try {
      res = await ctx.fetchJson(`https://api.fxtwitter.com/${encodeURIComponent(username)}`)
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'FxTwitter')
    }
    if (!res.user) return notFound(res)
    const parsed = parseFx(res.user, ctx.lang)
    return profileOutput(input, 'x', parsed.profile, parsed.children, res.user, ctx.lang)
  }
})
