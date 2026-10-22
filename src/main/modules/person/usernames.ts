// Pseudos construits à partir du prénom et du nom, testés sur un petit ensemble de sites dont la
// détection est fiable (moteur Sherlock). Seuls les pseudos trouvés quelque part sont proposés,
// dans « À vérifier » : un même pseudo peut appartenir à quelqu'un d'autre.

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import { allSites, checkSite, type SherlockSite, type SiteStatus } from '../username/_sherlock'
import { compactPart, initials, splitName, type PersonName } from './_name'

/** Pseudos les plus courants construits à partir d'un prénom et d'un nom, du plus probable au moins probable. */
export function candidateUsernames(n: PersonName, limit = 10): Array<{ username: string; pattern: string }> {
  const f = compactPart(n.firstNames[0])
  const l = compactPart(n.lastName)
  if (!f || !l) return []
  const fi = initials(n.firstNames[0])
  const li = l.charAt(0)
  const list: Array<[string, string]> = [
    [f + l, 'prenomnom'],
    [`${f}.${l}`, 'prenom.nom'],
    [fi + l, 'pnom'],
    [`${f}_${l}`, 'prenom_nom'],
    [l + f, 'nomprenom'],
    [`${fi}.${l}`, 'p.nom'],
    [`${l}.${f}`, 'nom.prenom'],
    [`${fi}_${l}`, 'p_nom'],
    [`${f}-${l}`, 'prenom-nom'],
    [l + fi, 'nomp'],
    [f + li, 'prenomn'],
    [`${l}_${f}`, 'nom_prenom']
  ]
  const seen = new Set<string>()
  const out: Array<{ username: string; pattern: string }> = []
  for (const [username, pattern] of list) {
    if (seen.has(username) || username.length < 3) continue
    seen.add(username)
    out.push({ username, pattern })
    if (out.length >= limit) break
  }
  return out
}

/** Pseudos testés : les plus probables seulement, pour limiter le nombre de requêtes. */
const CANDIDATES = 8

/**
 * Sites testés : grand public, et détection vérifiée (pseudo connu trouvé, pseudo aléatoire
 * absent). Instagram, X, Facebook et Reddit bloquent les requêtes automatiques : absents.
 */
export const PROBE_SITES = ['TikTok', 'Snapchat', 'YouTube', 'Twitch', 'Pinterest', 'SoundCloud', 'Steam Community (User)', 'Telegram', 'Chess', 'Strava', 'Linktree']

/** Sites retenus, GitHub interrogé par son API (la page de profil est souvent bloquée). */
export function probeSites(): SherlockSite[] {
  const sites = allSites()
  const out = PROBE_SITES.map((n) => sites.find((s) => s.name === n)).filter((s): s is SherlockSite => !!s)
  const github = sites.find((s) => s.name === 'GitHub')
  if (github) out.unshift({ ...github, url: 'https://github.com/{}', urlMain: 'https://github.com/', urlProbe: 'https://api.github.com/users/{}' })
  return out
}

/** Pseudo aléatoire, valide presque partout, qui ne doit exister nulle part. */
const canaryName = (): string => `zq${Math.random().toString(36).slice(2, 10).replace(/\d/g, 'k')}x`

export interface ProbeResult {
  username: string
  pattern: string
  found: Array<{ site: string; url: string }>
}

/**
 * Teste les pseudos. Chaque site est d'abord interrogé avec un pseudo aléatoire : s'il le dit
 * présent (page de blocage, détection cassée) ou ne répond pas, il est écarté pour cette fois.
 */
export async function probeUsernames(
  candidates: Array<{ username: string; pattern: string }>,
  ctx: ModuleContext,
  opts: { sites?: SherlockSite[]; concurrency?: number; timeoutMs?: number } = {}
): Promise<{ results: ProbeResult[]; usable: string[]; skipped: Array<{ site: string; reason: SiteStatus }> }> {
  const sites = opts.sites ?? probeSites()
  const timeoutMs = opts.timeoutMs ?? 10000
  const concurrency = opts.concurrency ?? 8
  let done = 0
  let total = sites.length + candidates.length * sites.length
  const step = (detail: string): void => ctx.progress(++done, total, detail)

  const run = async <T>(jobs: Array<() => Promise<T>>): Promise<T[]> => {
    const out: T[] = new Array(jobs.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < jobs.length && !ctx.signal.aborted) {
        const i = next++
        out[i] = await jobs[i]()
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker))
    return out
  }

  const canaries = await run(
    sites.map((s) => async () => {
      const r = await checkSite(s, canaryName(), ctx, timeoutMs)
      step(s.name)
      return r
    })
  )
  const usable = sites.filter((_, i) => canaries[i]?.status === 'available')
  const skipped = sites.map((s, i) => ({ site: s.name, reason: canaries[i]?.status ?? 'error' })).filter((x) => x.reason !== 'available')
  total = sites.length + candidates.length * usable.length

  // Ordre pseudo par pseudo : les requêtes simultanées visent des sites différents.
  const jobs = candidates.flatMap((c) =>
    usable.map((s) => async () => {
      const r = await checkSite(s, c.username, ctx, timeoutMs)
      step(`${c.username} · ${s.name}`)
      return { candidate: c.username, site: s.name, url: r.url, status: r.status }
    })
  )
  const checks = await run(jobs)
  const results = candidates.map((c) => ({
    ...c,
    found: checks.filter((x) => x && x.candidate === c.username && x.status === 'claimed').map((x) => ({ site: x.site, url: x.url }))
  }))
  return { results, usable: usable.map((s) => s.name), skipped }
}

export function usernameEntity(r: ProbeResult, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const sites = r.found.map((f) => f.site.replace(/ Community \(User\)$/, '').replace(/^Chess$/, 'Chess.com'))
  return {
    type: 'username',
    label: r.username,
    data: { pattern: r.pattern, generated: true, found_on: sites, profile_urls: r.found.map((f) => f.url) },
    linkLabel: fr ? 'pseudo possible' : 'possible username',
    review: true,
    reviewReason: fr
      ? `existe sur ${sites.join(', ')} : à confirmer (un même pseudo peut appartenir à quelqu’un d’autre)`
      : `exists on ${sites.join(', ')}: to be confirmed (the same username may belong to someone else)`
  }
}

export default defineModule({
  id: 'person.usernames',
  name: { fr: 'Pseudos possibles (vérifiés)', en: 'Possible usernames (checked)' },
  description: {
    fr: 'Construit les pseudos les plus courants à partir du prénom et du nom (jeandupont, jean.dupont, jdupont...) et les teste sur une douzaine de sites à la détection fiable (GitHub, TikTok, Snapchat, YouTube, Twitch, Pinterest, Steam, Telegram, Strava...). Seuls les pseudos trouvés sont proposés dans « À vérifier », avec les sites où ils existent.',
    en: 'Builds the most common usernames from the first and last name (jeandupont, jean.dupont, jdupont...) and checks them on a dozen sites with reliable detection (GitHub, TikTok, Snapchat, YouTube, Twitch, Pinterest, Steam, Telegram, Strava...). Only usernames found somewhere are listed in "To review", with the sites where they exist.'
  },
  category: 'person',
  inputTypes: ['person'],
  timeoutMs: 240_000,
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const candidates = candidateUsernames(name, CANDIDATES)
    const { results, usable, skipped } = await probeUsernames(candidates, ctx)
    if (ctx.signal.aborted) throw new ModuleError('Recherche interrompue', 'other')
    if (!usable.length) throw new ModuleError('Aucun site de test ne répond correctement pour le moment', 'unavailable')
    const found = results.filter((r) => r.found.length)
    return {
      entities: found.map((r) => usernameEntity(r, ctx.lang)),
      raw: {
        first_names: name.firstNames,
        last_name: name.lastName,
        sites_tested: usable,
        sites_skipped: skipped,
        candidates: results.map((r) => ({ username: r.username, pattern: r.pattern, found_on: r.found.map((f) => f.site) }))
      }
    }
  }
})
