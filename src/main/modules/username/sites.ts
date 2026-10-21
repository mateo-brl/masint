import { defineModule, ModuleError, type InputEntity, type ModuleContext, type ModuleOutput, type OsintModule, type OutEntity } from '@shared/modules'
import { PLATFORMS } from '@shared/platforms'
import { usernameOf } from '../social/_lib'
import { scanSites, selectSites, type SherlockSite, type SiteResult } from './_sherlock'

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

/** Plateforme du catalogue correspondant exactement à un site Sherlock (sinon undefined). */
export function platformForSite(name: string): string | undefined {
  if (ALIASES[name]) return ALIASES[name]
  // Homonymes hors réseaux sociaux (Polygon : le site d'actualité, pas la blockchain).
  if (name === 'Polygon' || name === 'Wix') return undefined
  return BY_NAME.get(norm(name))
}

/** Entité compte pour un site où le pseudo a été trouvé. */
export function accountEntity(site: SherlockSite, result: SiteResult, username: string, lang: 'fr' | 'en'): OutEntity {
  const platform = platformForSite(site.name)
  const host = (() => {
    try {
      return new URL(result.url).hostname.replace(/^www\./, '')
    } catch {
      return site.name
    }
  })()
  const label = platform === 'mastodon' ? `${username}@${host}` : platform ? username : `${username} (${site.name})`
  const url = result.url.replace(/\/$/, '') === site.urlMain.replace(/\/$/, '') ? undefined : result.url
  return {
    type: 'account',
    label,
    ...(platform ? { platform } : {}),
    data: { username, site: site.name, ...(url ? { url } : {}), site_url: site.urlMain },
    linkLabel: lang === 'fr' ? `présent sur ${site.name}` : `found on ${site.name}`
  }
}

async function run(input: InputEntity, ctx: ModuleContext, nsfw: boolean): Promise<ModuleOutput> {
  const username = usernameOf(input)
  if (!username || /\s/.test(username)) throw new ModuleError('Pseudo vide ou contenant des espaces', 'invalid_input')
  const sites = selectSites({ nsfw })
  const started = Date.now()
  const results = await scanSites(sites, username, ctx, { concurrency: 16, timeoutMs: 12000 })
  if (ctx.signal.aborted) throw new ModuleError('Recherche interrompue', 'other')
  const byName = new Map(sites.map((s) => [s.name, s]))
  const found = results.filter((r) => r.status === 'claimed')
  const count = (s: SiteResult['status']): number => results.filter((r) => r.status === s).length
  return {
    entities: found.map((r) => accountEntity(byName.get(r.site)!, r, username, ctx.lang)),
    raw: {
      username,
      tested: results.length,
      found: found.length,
      not_found: count('available'),
      invalid_username: count('illegal'),
      blocked_by_waf: count('waf'),
      errors: count('error'),
      duration_ms: Date.now() - started,
      accounts: found.map((r) => ({ site: r.site, url: r.url })),
      unreachable: results.filter((r) => r.status === 'error' || r.status === 'waf').map((r) => `${r.site} (${r.error ?? r.httpStatus ?? r.status})`)
    }
  }
}

const sites = defineModule({
  id: 'username.sites',
  name: { fr: 'Pseudo sur des centaines de sites', en: 'Username on hundreds of sites' },
  description: {
    fr: "Recherche le pseudo sur plus de 400 sites (base Sherlock, sans les sites adultes) et crée un compte par site où il existe. Les sites connus pour donner des faux positifs sont écartés. Dure environ une minute.",
    en: 'Looks for the username on 400+ sites (Sherlock database, adult sites excluded) and creates one account per site where it exists. Sites known to give false positives are skipped. Takes about a minute.'
  },
  category: 'username',
  inputTypes: ['username'],
  homepage: 'https://github.com/sherlock-project/sherlock',
  timeoutMs: 300_000,
  run: (input, ctx) => run(input, ctx, false)
})

const sitesNsfw = defineModule({
  id: 'username.sites_nsfw',
  name: { fr: 'Pseudo sur les sites adultes', en: 'Username on adult sites' },
  description: {
    fr: 'Même recherche limitée aux sites pour adultes de la base Sherlock. Lancée uniquement sur demande.',
    en: 'Same search restricted to the adult sites of the Sherlock database. Only runs on demand.'
  },
  category: 'username',
  inputTypes: ['username'],
  homepage: 'https://github.com/sherlock-project/sherlock',
  // Jamais lancé automatiquement : uniquement sur demande explicite.
  ondemand: true,
  timeoutMs: 120_000,
  run: (input, ctx) => run(input, ctx, true)
})

export const modules: OsintModule[] = [sites, sitesNsfw]
