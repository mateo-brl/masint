import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { accountEntity, compact, fetchRetry, httpFailure, readJson, requireEmail, tr } from './_lib'

interface CommitItem {
  html_url?: string
  commit?: { author?: { name?: string; email?: string; date?: string } }
  author?: { login?: string; id?: number; avatar_url?: string; html_url?: string; type?: string } | null
  repository?: { full_name?: string; html_url?: string }
}

export interface CommitSearch {
  total_count?: number
  items?: CommitItem[]
}

/** Résultat de la recherche de commits par adresse d'auteur. */
export function parseGithubCommits(json: CommitSearch, lang: 'fr' | 'en'): ModuleOutput {
  const items = json.items ?? []
  if (!json.total_count || !items.length) return { found: false }
  const names = Array.from(new Set(items.map((i) => i.commit?.author?.name ?? '').filter(Boolean)))
  const repos = Array.from(new Set(items.map((i) => i.repository?.full_name ?? '').filter(Boolean)))
  const dates = items.map((i) => i.commit?.author?.date ?? '').filter(Boolean).sort()
  const entities: OutEntity[] = []
  const seen = new Set<string>()
  for (const i of items) {
    const a = i.author
    if (!a?.login || seen.has(a.login)) continue
    seen.add(a.login)
    entities.push(
      accountEntity('github', 'GitHub', a.login, {
        data: compact({ username: a.login, user_id: a.id ? String(a.id) : undefined, url: a.html_url }),
        image: a.avatar_url,
        linkLabel: tr({ lang }, 'auteur de commits', 'commit author')
      })
    )
  }
  return {
    found: true,
    properties: compact({
      github_commits: json.total_count,
      github_commit_names: names,
      github_repos: repos,
      github_last_commit_date: dates[dates.length - 1]
    }),
    entities,
    raw: { total_count: json.total_count, names, repos, logins: Array.from(seen) }
  }
}

export default defineModule({
  id: 'email.github',
  name: { fr: 'Commits GitHub', en: 'GitHub commits' },
  description: {
    fr: "Recherche les commits publics signés avec l'adresse : compte GitHub associé, noms utilisés dans les commits, dépôts et date du dernier commit. Clé facultative (limite de 10 recherches par minute sans clé).",
    en: 'Searches public commits authored with the address: linked GitHub account, names used in commits, repositories and last commit date. Optional key (10 searches per minute without one).'
  },
  category: 'email',
  inputTypes: ['email'],
  keys: [{ id: 'github', label: 'GitHub API key', url: 'https://github.com/settings/tokens', optional: true }],
  homepage: 'https://github.com/search?type=commits',
  experimental: true,
  async run(input, ctx) {
    const email = requireEmail(input)
    const key = ctx.key('github')
    const res = await fetchRetry(ctx, 'https://api.github.com/search/commits', {
      query: { q: `author-email:${email}`, sort: 'author-date', order: 'desc', per_page: 30 },
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(key ? { authorization: `Bearer ${key}` } : {})
      }
    })
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw httpFailure('GitHub', 429)
    if (res.status === 401) throw new ModuleError('GitHub : clé API refusée', 'auth')
    if (res.status === 422) return { found: false }
    if (!res.ok) throw httpFailure('GitHub', res.status)
    return parseGithubCommits(await readJson<CommitSearch>(res, 'GitHub'), ctx.lang)
  }
})
