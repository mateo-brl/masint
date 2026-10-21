import { defineModule } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface DevtoUser {
  id: number
  username: string
  name?: string
  summary?: string | null
  location?: string | null
  website_url?: string | null
  twitter_username?: string | null
  github_username?: string | null
  joined_at?: string
  profile_image?: string
}

export function parseDevto(u: DevtoUser, lang: Lang): Parsed {
  return {
    profile: {
      username: u.username,
      url: `https://dev.to/${u.username}`,
      image: u.profile_image,
      data: {
        user_id: String(u.id),
        display_name: u.name,
        bio: u.summary ?? undefined,
        location: u.location ?? undefined,
        website: u.website_url ?? undefined,
        created_at: u.joined_at ? toIso(`${u.joined_at} 12:00 UTC`) : undefined
      }
    },
    children: linkedEntities({
      text: u.summary ?? undefined,
      urls: [
        u.website_url,
        u.twitter_username ? `https://x.com/${u.twitter_username}` : null,
        u.github_username ? `https://github.com/${u.github_username}` : null
      ],
      lang,
      self: { platform: 'devto', username: u.username }
    })
  }
}

export default defineModule({
  id: 'social.devto',
  name: { fr: 'Profil DEV', en: 'DEV profile' },
  description: {
    fr: 'Profil DEV (dev.to, API publique) : nom, bio, localisation, site, date d’inscription et comptes GitHub et X déclarés.',
    en: 'DEV (dev.to, public API) profile: name, bio, location, website, join date and declared GitHub and X accounts.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('devto'),
  homepage: 'https://developers.forem.com/api',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w-]{1,40}$/)
    let user: DevtoUser
    try {
      user = await ctx.fetchJson<DevtoUser>('https://dev.to/api/users/by_username', { query: { url: username } })
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'DEV')
    }
    const parsed = parseDevto(user, ctx.lang)
    return profileOutput(input, 'devto', parsed.profile, parsed.children, user, ctx.lang)
  }
})
