import { defineModule, ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OsintModule, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { PLATFORMS } from '@shared/platforms'
import { cappedList } from '../domain/_util'
import { usernameOf } from '../social/_lib'
import { ENTITY_RANK, scan, tierSites, tierSkipped, type ScanResult, type Tier } from './_catalog'
import { DEFAULT_EGRESS, healthStore, healthy } from './_health'
import type { SiteResult } from './_sherlock'
import { dbInfo } from './_siteDb'

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

/** Correspondances manuelles nom Sherlock vers identifiant de plateforme. */
const ALIASES: Record<string, string> = {
  Twitter: 'x',
  Chess: 'chesscom',
  'DEV Community': 'devto',
  'Replit.com': 'replit',
  'Steam Community (User)': 'steam',
  'PSNProfiles.com': 'playstation',
  'Xbox Gamertag': 'xbox',
  Fosstodon: 'mastodon',
  Framapiaf: 'mastodon',
  Mamot: 'mastodon',
  'chaos.social': 'mastodon',
  'mastodon.cloud': 'mastodon',
  'mastodon.social': 'mastodon',
  'mastodon.xyz': 'mastodon',
  'mstdn.io': 'mastodon',
  'mstdn.social': 'mastodon',
  'social.tchncs.de': 'mastodon'
}

const BY_NAME = (() => {
  const m = new Map<string, string>()
  for (const p of PLATFORMS) {
    if (p.category !== 'social' && p.category !== 'messaging') continue
    m.set(norm(p.id), p.id)
    if (!m.has(norm(p.name))) m.set(norm(p.name), p.id)
  }
  return m
})()

/** Plateforme du catalogue correspondant exactement à un site Sherlock ou Maigret (sinon undefined). */
export function platformForSite(name: string): string | undefined {
  if (ALIASES[name]) return ALIASES[name]
  // Homonymes hors réseaux sociaux (Polygon : le site d'actualité, pas la blockchain).
  if (name === 'Polygon' || name === 'Wix') return undefined
  return BY_NAME.get(norm(name))
}

/** Entité compte pour un site où le pseudo a été trouvé. Recherche approximative : à vérifier. */
export function accountEntity(
  site: { name: string; urlMain: string; similar?: boolean },
  result: SiteResult,
  username: string,
  lang: 'fr' | 'en'
): OutEntity {
  const fr = lang === 'fr'
  const platform = platformForSite(site.name)
  // Sites Maigret nommés d'après leur gabarit (`{username}.tilda.ws`) : nom réel du site.
  const name = site.name.split('{username}').join(username)
  const host = (() => {
    try {
      return new URL(result.url).hostname.replace(/^www\./, '')
    } catch {
      return name
    }
  })()
  const label = platform === 'mastodon' ? `${username}@${host}` : platform ? username : `${username} (${name})`
  const url = result.url.replace(/\/$/, '') === site.urlMain.replace(/\/$/, '') ? undefined : result.url
  return {
    type: 'account',
    label,
    ...(platform ? { platform } : {}),
    data: { username, site: name, ...(url ? { url } : {}), site_url: site.urlMain },
    linkLabel: fr ? `présent sur ${name}` : `found on ${name}`,
    // Même pseudo sur un autre site : rien ne dit que c'est la même personne.
    strength: 'weak',
    ...(site.similar
      ? {
          review: true,
          reviewReason: fr
            ? `${name} fait une recherche approximative : le compte peut porter un pseudo proche`
            : `${name} runs a fuzzy search: the account may use a similar username`
        }
      : {})
  }
}

/** Moteur de forum lisible (`DiscourseJson` → Discourse), null pour les règles génériques. */
export function engineLabel(engine: string | undefined): string | null {
  if (!engine || /^engine/i.test(engine)) return null
  return engine.replace(/\/.*$/, '').replace(/Json$/, '')
}

/** Résumé des comptes de longue traîne : « 12 comptes sur des forums et sites peu connus : Discourse 5, XenForo 3, autres 4 ». */
export function forumsSummary(results: ScanResult[], lang: 'fr' | 'en'): string {
  const fr = lang === 'fr'
  const counts = new Map<string, number>()
  let other = 0
  for (const r of results) {
    const e = engineLabel(r.def.engine)
    if (e) counts.set(e, (counts.get(e) ?? 0) + 1)
    else other++
  }
  const parts = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([e, n]) => `${e} ${n}`)
  if (other) parts.push(`${fr ? 'autres' : 'other'} ${other}`)
  const n = results.length
  return fr
    ? `${n} compte${n > 1 ? 's' : ''} sur des forums et sites peu connus : ${parts.join(', ')}`
    : `${n} account${n > 1 ? 's' : ''} on forums and niche sites: ${parts.join(', ')}`
}

const SETTINGS: Record<Tier, { concurrency: number; timeoutMs: number }> = {
  essential: { concurrency: 16, timeoutMs: 12000 },
  nsfw: { concurrency: 16, timeoutMs: 12000 },
  extended: { concurrency: 24, timeoutMs: 10000 }
}

async function run(input: InputEntity, ctx: ModuleContext, tier: Tier): Promise<ModuleOutput> {
  const username = usernameOf(input)
  if (!username || /\s/.test(username) || username.length > 100) throw new ModuleError('Pseudo vide, trop long ou contenant des espaces', 'invalid_input')
  const egress = ctx.egress ?? DEFAULT_EGRESS
  const { sites, failed } = healthy(tierSites(tier), egress)
  const started = Date.now()
  const results = await scan(sites, username, ctx, SETTINGS[tier])
  if (ctx.signal.aborted) throw new ModuleError('Recherche interrompue', 'other')
  const found = results.filter((r) => r.status === 'claimed')
  // Palier Étendu : seuls les sites connus deviennent des comptes ; la longue traîne (forums) est résumée.
  const asAccount = (r: ScanResult): boolean => tier !== 'extended' || r.def.essential || (r.def.rank !== null && r.def.rank <= ENTITY_RANK)
  const accounts = found.filter(asAccount)
  const forums = found.filter((r) => !asAccount(r))
  const count = (s: SiteResult['status']): number => results.filter((r) => r.status === s).length
  const properties: Record<string, PropValue> = forums.length
    ? { ...cappedList('forums_found', forums.map((r) => r.url)), forums_summary: forumsSummary(forums, ctx.lang) }
    : {}
  const health = healthStore().get(egress)
  const db = dbInfo()
  return {
    entities: accounts.map((r) => accountEntity(r.def, r, username, ctx.lang)),
    ...(forums.length ? { properties } : {}),
    raw: {
      username,
      tier,
      tested: results.length,
      found: found.length,
      not_found: count('available'),
      invalid_username: count('illegal'),
      blocked_by_waf: count('waf'),
      errors: count('error'),
      skipped_failing: failed.map((s) => s.name),
      skipped_rules: tierSkipped(tier).length,
      network: egress,
      health_checked_at: health.checkedAt ? new Date(health.checkedAt).toISOString() : null,
      maigret_db: { source: db.source, updated_at: db.updatedAt },
      duration_ms: Date.now() - started,
      accounts: accounts.map((r) => ({ site: r.site, url: r.url, ...(r.def.similar ? { similar_search: true } : {}) })),
      forums: forums.map((r) => ({ site: r.site, url: r.url })),
      unreachable: results.filter((r) => r.status === 'error' || r.status === 'waf').map((r) => `${r.site} (${r.error ?? r.httpStatus ?? r.status})`)
    }
  }
}

const sites = defineModule({
  id: 'username.sites',
  name: { fr: 'Pseudo sur des centaines de sites', en: 'Username on hundreds of sites' },
  description: {
    fr: "Recherche le pseudo sur environ 700 sites (base Sherlock complétée par les sites les plus fréquentés et les sites français de la base Maigret, sans les sites adultes) et crée un compte par site où il existe. Les sites connus pour donner des faux positifs, et ceux en échec au dernier contrôle témoin, sont écartés. Dure environ une minute.",
    en: 'Looks for the username on about 700 sites (Sherlock database plus the most visited and French sites of the Maigret database, adult sites excluded) and creates one account per site where it exists. Sites known to give false positives, and those failing the last witness check, are skipped. Takes about a minute.'
  },
  category: 'username',
  inputTypes: ['username'],
  homepage: 'https://github.com/sherlock-project/sherlock',
  timeoutMs: 300_000,
  run: (input, ctx) => run(input, ctx, 'essential')
})

const sitesExtended = defineModule({
  id: 'username.sites_extended',
  name: { fr: 'Pseudo sur des milliers de sites', en: 'Username on thousands of sites' },
  description: {
    fr: 'Recherche étendue sur environ 7 200 sites (toutes les bases Sherlock et Maigret, dont des forums Discourse, XenForo, uCoz, wikis, forges Gitea et GitLab...). Les sites connus deviennent des comptes ; les forums et sites peu fréquentés sont résumés dans la fiche du pseudo. Lancée uniquement sur demande, dure plusieurs minutes.',
    en: 'Extended search on about 7,200 sites (the whole Sherlock and Maigret databases, including Discourse, XenForo and uCoz forums, wikis, Gitea and GitLab forges...). Well-known sites become accounts; forums and niche sites are summarised on the username card. Only runs on demand, takes several minutes.'
  },
  category: 'username',
  inputTypes: ['username'],
  homepage: 'https://github.com/soxoj/maigret',
  // Plusieurs milliers de requêtes : jamais lancé automatiquement.
  ondemand: true,
  timeoutMs: 1_800_000,
  run: (input, ctx) => run(input, ctx, 'extended')
})

const sitesNsfw = defineModule({
  id: 'username.sites_nsfw',
  name: { fr: 'Pseudo sur les sites adultes', en: 'Username on adult sites' },
  description: {
    fr: 'Même recherche limitée aux sites pour adultes et de rencontre des bases Sherlock et Maigret. Lancée uniquement sur demande.',
    en: 'Same search restricted to the adult and dating sites of the Sherlock and Maigret databases. Only runs on demand.'
  },
  category: 'username',
  inputTypes: ['username'],
  homepage: 'https://github.com/sherlock-project/sherlock',
  // Jamais lancé automatiquement : uniquement sur demande explicite.
  ondemand: true,
  timeoutMs: 180_000,
  run: (input, ctx) => run(input, ctx, 'nsfw')
})

export const modules: OsintModule[] = [sites, sitesNsfw, sitesExtended]
