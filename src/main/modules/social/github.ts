import { defineModule, type ModuleContext, type OutEntity } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

const API = 'https://api.github.com'

export interface GithubUser {
  login: string
  id: number
  avatar_url?: string
  html_url?: string
  type?: string
  name?: string | null
  company?: string | null
  blog?: string | null
  location?: string | null
  email?: string | null
  hireable?: boolean | null
  bio?: string | null
  twitter_username?: string | null
  public_repos?: number
  public_gists?: number
  followers?: number
  following?: number
  created_at?: string
  updated_at?: string
}

export interface GithubEvent {
  type: string
  repo?: { name: string }
  created_at?: string
  payload?: { head?: string; commits?: Array<{ sha?: string; author?: { email?: string; name?: string } }> }
}

export interface CommitIdentity {
  email: string
  name?: string
}

/** Emails d'auteurs de commits, sans les adresses masquées `noreply`. */
export function commitIdentities(list: CommitIdentity[]): CommitIdentity[] {
  const out = new Map<string, CommitIdentity>()
  for (const c of list) {
    const email = c.email?.trim().toLowerCase()
    if (!email || !email.includes('@') || /noreply/.test(email)) continue
    if (!out.has(email)) out.set(email, { email, name: c.name })
  }
  return [...out.values()]
}

export function parseGithub(
  user: GithubUser,
  extra: { socials?: Array<{ provider: string; url: string }>; commits?: CommitIdentity[] },
  lang: Lang
): Parsed {
  const identities = commitIdentities(extra.commits ?? [])
  const children: OutEntity[] = [
    ...linkedEntities({
      text: user.bio ?? '',
      urls: [user.blog, ...(extra.socials ?? []).map((s) => s.url), user.twitter_username ? `https://x.com/${user.twitter_username}` : null],
      emails: [user.email],
      lang,
      self: { platform: 'github', username: user.login }
    }),
    ...identities
      .filter((c) => c.email !== user.email?.toLowerCase())
      .map(
        (c): OutEntity => ({
          type: 'email',
          label: c.email,
          data: c.name ? { commit_name: c.name } : {},
          linkLabel: lang === 'fr' ? 'email de commit' : 'commit email'
        })
      )
  ]
  return {
    profile: {
      username: user.login,
      url: user.html_url ?? `https://github.com/${user.login}`,
      image: user.avatar_url,
      data: {
        user_id: String(user.id),
        display_name: user.name ?? undefined,
        bio: user.bio ?? undefined,
        location: user.location ?? undefined,
        company: user.company ?? undefined,
        website: user.blog || undefined,
        account_type: user.type,
        hireable: user.hireable ?? undefined,
        followers: user.followers,
        following: user.following,
        public_repos: user.public_repos,
        public_gists: user.public_gists,
        created_at: toIso(user.created_at),
        updated_at: toIso(user.updated_at),
        commit_names: [...new Set(identities.map((c) => c.name).filter((n): n is string => !!n))]
      }
    },
    children
  }
}

async function commitsFromEvents(events: GithubEvent[], ctx: ModuleContext, headers: Record<string, string>): Promise<CommitIdentity[]> {
  const out: CommitIdentity[] = []
  const heads: Array<{ repo: string; sha: string }> = []
  for (const ev of events) {
    if (ev.type !== 'PushEvent' || !ev.payload) continue
    for (const c of ev.payload.commits ?? []) if (c.author?.email) out.push({ email: c.author.email, name: c.author.name })
    if (!ev.payload.commits?.length && ev.payload.head && ev.repo) heads.push({ repo: ev.repo.name, sha: ev.payload.head })
  }
  // Depuis fin 2025, les PushEvent ne listent plus les commits : on lit quelques commits de tête.
  for (const h of heads.slice(0, 5)) {
    try {
      const c = await ctx.fetchJson<{ commit?: { author?: { email?: string; name?: string }; committer?: { email?: string; name?: string } } }>(
        `${API}/repos/${h.repo}/commits/${h.sha}`,
        { headers }
      )
      if (c.commit?.author?.email) out.push({ email: c.commit.author.email, name: c.commit.author.name })
      if (c.commit?.committer?.email) out.push({ email: c.commit.committer.email, name: c.commit.committer.name })
    } catch {
      break
    }
  }
  return out
}

export default defineModule({
  id: 'social.github',
  name: { fr: 'Profil GitHub', en: 'GitHub profile' },
  description: {
    fr: "Profil GitHub public (nom, bio, entreprise, site, localisation, date de création, abonnés), comptes sociaux liés et emails trouvés dans les commits publics récents.",
    en: 'Public GitHub profile (name, bio, company, website, location, creation date, followers), linked social accounts and emails found in recent public commits.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('github'),
  keys: [{ id: 'github', label: 'GitHub API token', url: 'https://github.com/settings/tokens', optional: true }],
  homepage: 'https://docs.github.com/rest/users/users',
  experimental: true,
  async run(input, ctx) {
    const username = requireUsername(input, /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i)
    const token = ctx.key('github')
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
    let user: GithubUser
    try {
      user = await ctx.fetchJson<GithubUser>(`${API}/users/${encodeURIComponent(username)}`, { headers })
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'GitHub')
    }
    const [socials, events] = await Promise.all([
      ctx.fetchJson<Array<{ provider: string; url: string }>>(`${API}/users/${user.login}/social_accounts`, { headers }).catch(() => []),
      ctx.fetchJson<GithubEvent[]>(`${API}/users/${user.login}/events/public`, { headers, query: { per_page: 100 } }).catch(() => [])
    ])
    const commits = await commitsFromEvents(events, ctx, headers)
    const parsed = parseGithub(user, { socials, commits }, ctx.lang)
    return profileOutput(input, 'github', parsed.profile, parsed.children, { user, socials, commits: commitIdentities(commits) }, ctx.lang)
  }
})
