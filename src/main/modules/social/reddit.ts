import { defineModule } from '@shared/modules'
import { acceptsPlatform, decodeHtml, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface RedditAbout {
  kind?: string
  data?: {
    id?: string
    name: string
    created_utc?: number
    link_karma?: number
    comment_karma?: number
    total_karma?: number
    icon_img?: string
    snoovatar_img?: string
    is_employee?: boolean
    is_mod?: boolean
    is_gold?: boolean
    verified?: boolean
    has_verified_email?: boolean
    is_suspended?: boolean
    subreddit?: { title?: string; public_description?: string; over_18?: boolean; display_name_prefixed?: string } | null
  }
}

export function parseReddit(about: RedditAbout, lang: Lang): Parsed | null {
  const d = about.data
  if (!d?.name) return null
  const bio = d.subreddit?.public_description ? decodeHtml(d.subreddit.public_description) : undefined
  const avatar = decodeHtml(d.snoovatar_img || d.icon_img || '').split('?')[0] || undefined
  return {
    profile: {
      username: d.name,
      url: `https://www.reddit.com/user/${d.name}`,
      image: avatar && !/default_avatars|avatar_default/.test(avatar) ? avatar : undefined,
      data: {
        user_id: d.id ? `t2_${d.id}` : undefined,
        display_name: d.subreddit?.title || undefined,
        bio,
        created_at: toIso(d.created_utc),
        link_karma: d.link_karma,
        comment_karma: d.comment_karma,
        total_karma: d.total_karma,
        verified_email: d.has_verified_email,
        moderator: d.is_mod,
        employee: d.is_employee || undefined,
        suspended: d.is_suspended || undefined,
        nsfw_profile: d.subreddit?.over_18 || undefined
      }
    },
    children: linkedEntities({ text: bio, lang, self: { platform: 'reddit', username: d.name } })
  }
}

export default defineModule({
  id: 'social.reddit',
  name: { fr: 'Profil Reddit', en: 'Reddit profile' },
  description: {
    fr: 'Profil Reddit public (about.json) : date de création, karma, modérateur, email vérifié, bio et avatar. Reddit bloque souvent les adresses IP de centres de données.',
    en: 'Public Reddit profile (about.json): creation date, karma, moderator, verified email, bio and avatar. Reddit often blocks datacenter IP addresses.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('reddit'),
  homepage: 'https://www.reddit.com/dev/api#GET_user_{username}_about',
  experimental: true,
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w-]{3,20}$/)
    let about: RedditAbout
    try {
      about = await ctx.fetchJson<RedditAbout>(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`, {
        query: { raw_json: 1 }
      })
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Reddit')
    }
    const parsed = parseReddit(about, ctx.lang)
    if (!parsed) return notFound(about)
    return profileOutput(input, 'reddit', parsed.profile, parsed.children, about, ctx.lang)
  }
})
