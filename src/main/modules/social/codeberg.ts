import { defineModule } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface ForgejoUser {
  id: number
  login: string
  full_name?: string
  email?: string
  avatar_url?: string
  html_url?: string
  location?: string
  website?: string
  description?: string
  pronouns?: string
  created?: string
  followers_count?: number
  following_count?: number
  starred_repos_count?: number
}

export function parseForgejo(u: ForgejoUser, lang: Lang): Parsed {
  return {
    profile: {
      username: u.login,
      url: u.html_url,
      site: 'Codeberg',
      image: u.avatar_url,
      data: {
        user_id: String(u.id),
        display_name: u.full_name,
        bio: u.description,
        location: u.location,
        website: u.website,
        pronouns: u.pronouns,
        followers: u.followers_count,
        following: u.following_count,
        created_at: toIso(u.created)
      }
    },
    children: linkedEntities({ text: u.description, urls: [u.website], emails: [u.email], lang })
  }
}

export default defineModule({
  id: 'social.codeberg',
  name: { fr: 'Profil Codeberg', en: 'Codeberg profile' },
  description: {
    fr: 'Profil Codeberg (forge Forgejo) : nom, bio, site, localisation, date de création, abonnés et email s’il est public.',
    en: 'Codeberg (Forgejo forge) profile: name, bio, website, location, creation date, followers and email when public.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('codeberg'),
  homepage: 'https://codeberg.org',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w.-]{1,40}$/)
    let user: ForgejoUser
    try {
      user = await ctx.fetchJson<ForgejoUser>(`https://codeberg.org/api/v1/users/${encodeURIComponent(username)}`)
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Codeberg')
    }
    const parsed = parseForgejo(user, ctx.lang)
    return profileOutput(input, 'codeberg', parsed.profile, parsed.children, user, ctx.lang)
  }
})
