import { createHash } from 'node:crypto'
import { defineModule, type ModuleContext, type OutEntity } from '@shared/modules'
import { parseArmoredKeys } from '../email/_pgp'
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

/** Clé GPG publiée sur le profil (`/users/{u}/gpg_keys`). */
export interface GithubGpgKey {
  key_id?: string
  emails?: Array<{ email?: string; verified?: boolean }>
  created_at?: string
  expires_at?: string | null
  revoked?: boolean
  raw_key?: string | null
}

export interface GithubOrg {
  login: string
  id?: number
  avatar_url?: string
  description?: string | null
}

/**
 * Empreintes SHA-256 des clés SSH publiques (`github.com/{u}.keys`), au format d'OpenSSH :
 * « ssh-ed25519 SHA256:... ». Elles identifient une clé réutilisée sur d'autres services.
 */
export function sshFingerprints(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const [type, blob] = line.trim().split(/\s+/)
    if (!type || !blob || !/^(ssh-|ecdsa-|sk-)/.test(type) || !/^[A-Za-z0-9+/]+=*$/.test(blob)) continue
    const digest = createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')
    out.push(`${type} SHA256:${digest}`)
  }
  return out
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * Le nom d'auteur d'un commit correspond-il au profil ? Égal au login, ou chaque mot du nom
 * présent dans le nom affiché ou le login (« Mona Lisa » pour « monalisa octocat »). Une adresse
 * dont la partie locale est le login compte aussi comme correspondance.
 */
export function matchesProfile(c: CommitIdentity, user: { login: string; name?: string | null }): boolean {
  const login = fold(user.login).replace(/[^a-z0-9]/g, '')
  if (fold(c.email.split('@')[0]).replace(/[^a-z0-9]/g, '') === login) return true
  if (!c.name) return false
  const words = fold(c.name).split(/[^a-z0-9]+/).filter(Boolean)
  if (!words.length) return false
  if (words.join('') === login) return true
  const profileWords = fold(`${user.login} ${user.name ?? ''}`).split(/[^a-z0-9]+/).filter(Boolean)
  const joined = profileWords.join('')
  return words.every((w) => profileWords.includes(w) || (w.length >= 3 && joined.includes(w)))
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
  extra: {
    socials?: Array<{ provider: string; url: string }>
    commits?: CommitIdentity[]
    gpgKeys?: GithubGpgKey[]
    sshKeys?: string
    orgs?: GithubOrg[]
  },
  lang: Lang
): Parsed {
  const fr = lang === 'fr'
  const identities = commitIdentities(extra.commits ?? [])
  const gpgKeys = extra.gpgKeys ?? []
  const gpgFingerprints = gpgKeys.flatMap((k) => (k.raw_key ? parseArmoredKeys(k.raw_key).map((p) => p.fingerprint) : []))
  const gpgEmails = new Map<string, boolean>()
  for (const k of gpgKeys)
    for (const e of k.emails ?? []) {
      const email = e.email?.trim().toLowerCase()
      if (!email || /noreply/.test(email)) continue
      gpgEmails.set(email, (gpgEmails.get(email) ?? false) || !!e.verified)
    }
  const children: OutEntity[] = [
    ...linkedEntities({
      text: user.bio ?? '',
      urls: [user.blog, ...(extra.socials ?? []).map((s) => s.url), user.twitter_username ? `https://x.com/${user.twitter_username}` : null],
      emails: [user.email],
      lang,
      self: { platform: 'github', username: user.login }
    }),
    // Adresses des clés GPG : vérifiées par GitHub (adresse confirmée du compte) ou à vérifier.
    ...[...gpgEmails]
      .filter(([email]) => email !== user.email?.toLowerCase())
      .map(
        ([email, verified]): OutEntity => ({
          type: 'email',
          label: email,
          linkLabel: fr ? 'email de clé GPG' : 'GPG key email',
          ...(verified
            ? {}
            : {
                review: true,
                reviewReason: fr
                  ? 'adresse inscrite dans une clé GPG du profil, non vérifiée par GitHub'
                  : 'address written in a GPG key of the profile, not verified by GitHub'
              })
        })
      ),
    // Une fusion de branche pousse aussi les commits de collègues : un auteur dont le nom ne
    // correspond pas au profil n'est qu'une piste.
    ...identities
      .filter((c) => c.email !== user.email?.toLowerCase() && !gpgEmails.has(c.email))
      .map(
        (c): OutEntity => ({
          type: 'email',
          label: c.email,
          data: c.name ? { commit_name: c.name } : {},
          linkLabel: fr ? 'email de commit' : 'commit email',
          ...(matchesProfile(c, user)
            ? {}
            : {
                review: true,
                reviewReason: fr
                  ? `auteur d'un commit poussé par ${user.login}, nom « ${c.name ?? '?'} » différent du profil (fusion ou collègue possible)`
                  : `author of a commit pushed by ${user.login}, name "${c.name ?? '?'}" differs from the profile (merge or colleague possible)`
              })
        })
      ),
    ...(extra.orgs ?? []).map(
      (o): OutEntity => ({
        type: 'organization',
        label: o.login,
        data: { url: `https://github.com/${o.login}`, user_id: o.id !== undefined ? String(o.id) : null, description: o.description || null },
        image: o.avatar_url,
        linkLabel: fr ? 'membre de l’organisation GitHub' : 'GitHub organization member'
      })
    )
  ]
  const gpgDates = gpgKeys
    .map((k) => toIso(k.created_at))
    .filter((d): d is string => !!d)
    .sort()
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
        commit_names: [...new Set(identities.map((c) => c.name).filter((n): n is string => !!n))],
        gpg_key_ids: gpgKeys.map((k) => k.key_id ?? '').filter(Boolean),
        pgp_fingerprints: [...new Set(gpgFingerprints)],
        gpg_key_created_at: gpgDates[0],
        ssh_key_fingerprints: extra.sshKeys ? sshFingerprints(extra.sshKeys) : undefined
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
    fr: "Profil GitHub public (nom, bio, entreprise, site, localisation, date de création, abonnés, identifiant stable), comptes sociaux liés, organisations publiques, clés GPG (adresses) et SSH (empreintes), emails des commits publics récents (à vérifier quand le nom d'auteur ne correspond pas au profil).",
    en: 'Public GitHub profile (name, bio, company, website, location, creation date, followers, stable ID), linked social accounts, public organizations, GPG keys (addresses) and SSH keys (fingerprints), emails from recent public commits (to review when the author name does not match the profile).'
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
    const [socials, events, gpgKeys, orgs, sshKeys] = await Promise.all([
      ctx.fetchJson<Array<{ provider: string; url: string }>>(`${API}/users/${user.login}/social_accounts`, { headers }).catch(() => []),
      ctx.fetchJson<GithubEvent[]>(`${API}/users/${user.login}/events/public`, { headers, query: { per_page: 100 } }).catch(() => []),
      ctx.fetchJson<GithubGpgKey[]>(`${API}/users/${user.login}/gpg_keys`, { headers }).catch(() => [] as GithubGpgKey[]),
      ctx.fetchJson<GithubOrg[]>(`${API}/users/${user.login}/orgs`, { headers }).catch(() => [] as GithubOrg[]),
      // Clés SSH publiques : servies par le site, hors API.
      ctx.fetchText(`https://github.com/${user.login}.keys`).catch(() => '')
    ])
    const commits = await commitsFromEvents(events, ctx, headers)
    const parsed = parseGithub(user, { socials, commits, gpgKeys, orgs, sshKeys }, ctx.lang)
    const raw = {
      user,
      socials,
      commits: commitIdentities(commits),
      gpg_keys: gpgKeys.map((k) => ({ key_id: k.key_id, emails: k.emails, created_at: k.created_at, revoked: k.revoked })),
      orgs: orgs.map((o) => o.login)
    }
    return profileOutput(input, 'github', parsed.profile, parsed.children, raw, ctx.lang)
  }
})
