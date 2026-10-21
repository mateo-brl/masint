import { defineModule } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface DockerHubUser {
  id: string
  orgname?: string
  username?: string
  full_name?: string
  location?: string
  company?: string
  profile_url?: string
  date_joined?: string
  gravatar_url?: string
  type?: string
}

export function parseDockerHub(u: DockerHubUser, lang: Lang): Parsed {
  const name = u.orgname ?? u.username ?? ''
  return {
    profile: {
      username: name,
      url: `https://hub.docker.com/u/${name}`,
      image: u.gravatar_url ? u.gravatar_url.replace(/([?&])s=\d+/, '$1s=400') : undefined,
      data: {
        user_id: u.id,
        display_name: u.full_name || undefined,
        location: u.location || undefined,
        company: u.company || undefined,
        website: u.profile_url || undefined,
        account_type: u.type,
        // Empreinte MD5 de l'email du compte (Gravatar) : pivot vers d'autres comptes.
        gravatar_hash: u.gravatar_url?.match(/avatar\/([a-f0-9]{32})/)?.[1],
        created_at: toIso(u.date_joined)
      }
    },
    children: linkedEntities({ urls: [u.profile_url], lang, self: { platform: 'dockerhub', username: name } })
  }
}

export default defineModule({
  id: 'social.dockerhub',
  name: { fr: 'Profil Docker Hub', en: 'Docker Hub profile' },
  description: {
    fr: 'Compte ou organisation Docker Hub : nom complet, entreprise, localisation, site, date d’inscription et empreinte Gravatar de l’email.',
    en: 'Docker Hub user or organization: full name, company, location, website, join date and Gravatar hash of the email.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('dockerhub'),
  homepage: 'https://hub.docker.com',
  async run(input, ctx) {
    const username = requireUsername(input, /^[a-z0-9_-]{2,40}$/i).toLowerCase()
    let user: DockerHubUser
    try {
      user = await ctx.fetchJson<DockerHubUser>(`https://hub.docker.com/v2/users/${encodeURIComponent(username)}`)
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Docker Hub')
    }
    const parsed = parseDockerHub(user, ctx.lang)
    return profileOutput(input, 'dockerhub', parsed.profile, parsed.children, user, ctx.lang)
  }
})
