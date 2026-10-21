import { defineModule } from '@shared/modules'
import { acceptsPlatform, decodeHtml, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface GitlabUser {
  id: number
  username: string
  name?: string
  state?: string
  avatar_url?: string
  web_url?: string
  public_email?: string
}

const text = (html: string): string => decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Informations de la page de profil publique (l'API détaillée exige désormais une authentification). */
export function parseGitlabPage(html: string): {
  bio?: string
  location?: string
  member_since?: string
  status?: string
  job?: string
  links: string[]
} {
  const bio = html.match(/<p class="profile-user-bio[^"]*">([\s\S]*?)<\/p>/)
  const location = html.match(/itemprop="addressLocality">([\s\S]*?)<\/span>/)
  const since = html.match(/Member since ([A-Za-z]+ \d{1,2}, \d{4})/)
  const status = html.match(/<div class="gl-my-2 cover-status[^"]*">([\s\S]*?)<\/div>\s*<\/div>/)
  const job = html.match(/itemprop="jobTitle"[^>]*>([\s\S]*?)<\/span>/)
  const contact = html.match(/<h2[^>]*>Contact<\/h2>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/)
  const links = contact ? [...contact[1].matchAll(/href="([^"]+)"/g)].map((m) => decodeHtml(m[1])).filter((u) => /^https?:|^mailto:/.test(u)) : []
  return {
    bio: bio ? text(bio[1]) || undefined : undefined,
    location: location ? text(location[1]) || undefined : undefined,
    member_since: since ? toIso(`${since[1]} 12:00 UTC`) : undefined,
    status: status ? text(status[1]) || undefined : undefined,
    job: job ? text(job[1]) || undefined : undefined,
    links
  }
}

export function parseGitlab(user: GitlabUser, html: string, lang: Lang): Parsed {
  const page = parseGitlabPage(html)
  const emails = [user.public_email, ...page.links.filter((l) => l.startsWith('mailto:')).map((l) => l.slice(7))]
  return {
    profile: {
      username: user.username,
      url: user.web_url ?? `https://gitlab.com/${user.username}`,
      image: user.avatar_url,
      data: {
        user_id: String(user.id),
        display_name: user.name,
        state: user.state,
        bio: page.bio,
        location: page.location,
        occupation: page.job,
        status: page.status,
        created_at: page.member_since
      }
    },
    children: linkedEntities({
      text: page.bio,
      urls: page.links.filter((l) => !l.startsWith('mailto:')),
      emails,
      lang,
      self: { platform: 'gitlab', username: user.username }
    })
  }
}

export default defineModule({
  id: 'social.gitlab',
  name: { fr: 'Profil GitLab', en: 'GitLab profile' },
  description: {
    fr: 'Profil GitLab.com public : nom, bio, localisation, date d’inscription, statut, email public et liens de contact (site, LinkedIn, X...).',
    en: 'Public GitLab.com profile: name, bio, location, join date, status, public email and contact links (website, LinkedIn, X...).'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('gitlab'),
  homepage: 'https://gitlab.com',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w.-]{1,255}$/)
    let users: GitlabUser[]
    try {
      users = await ctx.fetchJson<GitlabUser[]>('https://gitlab.com/api/v4/users', { query: { username } })
    } catch (e) {
      rethrow(e, 'GitLab')
    }
    const user = users[0]
    if (!user) return notFound()
    const html = await ctx.fetchText(`https://gitlab.com/${encodeURIComponent(user.username)}`).catch(() => '')
    const parsed = parseGitlab(user, html, ctx.lang)
    return profileOutput(input, 'gitlab', parsed.profile, parsed.children, { user, page: parseGitlabPage(html) }, ctx.lang)
  }
})
