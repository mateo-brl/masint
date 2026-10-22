// Catalogue des sites de recherche de pseudo : base Sherlock (sites validés par le banc de faux
// positifs) complétée par la base Maigret, dédoublonnées par hôte (l'entrée Sherlock l'emporte).
// Paliers :
// - essential : Sherlock hors liste noire, plus les sites Maigret absents de Sherlock classés dans
//   le top 10 000 (`alexaRank`) ou marqués « fr » (environ 700 sites) ;
// - extended : tous les sites utilisables des deux bases (environ 7 200 sites) ;
// - nsfw : sites adultes et de rencontre des deux bases, uniquement sur demande.

import type { ModuleContext } from '@shared/modules'
import { checkMaigretSite, isLegalFor, isNsfw, mergeEntry, profileUrl, skipReason, type MaigretSite, type SkipReason } from './_maigret'
import { BLACKLIST, allSites, checkSite, isLegal, profileUrlFor, selectSites, type SherlockSite, type SiteResult } from './_sherlock'
import { dbVersion, loadDb } from './_siteDb'

export type Tier = 'essential' | 'extended' | 'nsfw'

/** Rang maximal (`alexaRank`) d'un site Maigret retenu dans le palier Essentiel. */
export const ESSENTIAL_RANK = 10_000
/** Rang maximal d'un site du palier Étendu qui devient un compte dans le graphe (les autres vont dans `forums_found`). */
export const ENTITY_RANK = 100_000

/**
 * Sites Maigret écartés : faux positifs mesurés par le banc (pseudo aléatoire inexistant détecté
 * comme présent). Voir resources/data/README.md.
 */
export const MAIGRET_BLACKLIST: Record<string, string> = {
  // Banc du 22/10/2026 sur le palier Essentiel, deux passages : faux positif à chaque fois.
  'git.rooty.fr': 'faux positif (forge Gitea qui répond 200 pour tout pseudo)',
  'skeptikon.fr': 'faux positif (application monopage PeerTube, HTTP 200 pour tout pseudo)',
  // Banc du 22/10/2026 sur le palier Étendu : pseudo aléatoire détecté comme présent.
  ...Object.fromEntries(
    [
      'Amperka',
      'Aqa',
      'awakening.wiki',
      'community.nanit.com',
      'Engadget',
      'feminismus.jeannette-hollmann.de',
      'forum.arturia.com',
      'forum.cuba-platform.com',
      'forum.gumloop.com',
      'forum.mineland.net',
      'forum.moonbeam.network',
      'forum.star-conflict.com',
      'forum.threefold.io',
      'forum.vivaldi.net',
      'forum.wowcircle.com',
      'forum.y8.com',
      'forums.triplea-game.org',
      'git.keks.cloud',
      'git.konjactw.dev',
      'git.tcp.direct',
      'quik',
      'rbxlegacy.wiki',
      'SportsTracker',
      'wiki-es.guildwars2.com',
      'wiki.teamfortress.com',
      'WOW Circle',
      'yamaya.ru'
    ].map((name) => [name, 'faux positif (palier Étendu)'])
  )
}

/** Site interrogeable, quelle que soit sa base d'origine. */
export interface SiteDef {
  /** Identifiant stable : `sherlock:<nom>` ou `maigret:<nom>`. */
  id: string
  name: string
  source: 'sherlock' | 'maigret'
  /** Hôte sans `www.` ni `m.`, pour le dédoublonnage. */
  host: string
  urlMain: string
  /** Rang de popularité (Maigret), null si inconnu. */
  rank: number | null
  nsfw: boolean
  /** Recherche approximative : résultat à vérifier. */
  similar: boolean
  /** Fait partie du palier Essentiel. */
  essential: boolean
  /** Moteur de forum (Discourse, XenForo...), pour le résumé. */
  engine?: string
  tags: string[]
  /** Pseudo témoin public fourni par la base. */
  claimed?: string
  /** URL publique du profil. */
  profileUrl(username: string): string
  isLegal(username: string): boolean
  check(username: string, ctx: ModuleContext, timeoutMs?: number): Promise<SiteResult>
}

export interface SkippedSite {
  id: string
  name: string
  reason: SkipReason | 'blacklist'
  /** Paliers dont le site ferait partie s'il était utilisable. */
  tiers: Tier[]
}

export interface Catalog {
  sites: SiteDef[]
  skipped: SkippedSite[]
}

/** Hôte d'une URL, sans `www.` ni `m.` (null si l'URL est invalide). */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url.replace(/\{\}|\{username\}/g, 'x'))
    return u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '') || null
  } catch {
    return null
  }
}

export function sherlockDef(s: SherlockSite): SiteDef {
  return {
    id: `sherlock:${s.name}`,
    name: s.name,
    source: 'sherlock',
    host: hostOf(s.urlMain) ?? hostOf(s.url) ?? s.name.toLowerCase(),
    urlMain: s.urlMain,
    rank: null,
    nsfw: !!s.isNSFW,
    similar: false,
    essential: !s.isNSFW,
    tags: [],
    claimed: s.username_claimed,
    profileUrl: (u) => profileUrlFor(s, u),
    isLegal: (u) => isLegal(s, u),
    check: (u, ctx, timeoutMs) => checkSite(s, u, ctx, timeoutMs)
  }
}

export function maigretDef(site: MaigretSite): SiteDef {
  const rank = typeof site.alexaRank === 'number' && site.alexaRank > 0 ? site.alexaRank : null
  const nsfw = isNsfw(site)
  const urlMain = site.urlMain ?? profileUrl(site, 'x')?.replace(/[^/]*$/, '') ?? ''
  return {
    id: `maigret:${site.name}`,
    name: site.name,
    source: 'maigret',
    host: hostOf(site.urlMain) ?? hostOf(profileUrl(site, 'x') ?? undefined) ?? site.name.toLowerCase(),
    urlMain,
    rank,
    nsfw,
    similar: !!site.similarSearch,
    essential: !nsfw && ((rank !== null && rank <= ESSENTIAL_RANK) || !!site.tags?.includes('fr')),
    engine: site.engine,
    tags: site.tags ?? [],
    claimed: site.usernameClaimed,
    profileUrl: (u) => profileUrl(site, u) ?? urlMain,
    isLegal: (u) => isLegalFor(site, u),
    check: (u, ctx, timeoutMs) => checkMaigretSite(site, u, ctx, timeoutMs)
  }
}

let cached: { version: number; catalog: Catalog } | null = null

/** Catalogue complet, recalculé quand la base Maigret change. */
export function catalog(): Catalog {
  const version = dbVersion()
  if (cached?.version === version) return cached.catalog
  const sites: SiteDef[] = []
  const skipped: SkippedSite[] = []
  const sherlock = allSites()
  const sherlockHosts = new Set<string>()
  for (const s of sherlock) {
    const def = sherlockDef(s)
    sherlockHosts.add(def.host)
    if (BLACKLIST[s.name]) skipped.push({ id: def.id, name: s.name, reason: 'blacklist', tiers: s.isNSFW ? ['nsfw'] : ['essential', 'extended'] })
  }
  // Sites Sherlock retenus (même sélection que l'ancien module, liste noire appliquée).
  sites.push(...selectSites({ nsfw: false }).map(sherlockDef), ...selectSites({ nsfw: true }).map(sherlockDef))

  const db = loadDb().data
  for (const [name, entry] of Object.entries(db.sites)) {
    if (!entry || typeof entry !== 'object') continue
    const site = mergeEntry(name, entry, db.engines)
    // Désactivé par Maigret : absent de la base embarquée, ni compté ni proposé.
    if (site.disabled) continue
    const def = maigretDef(site)
    // Hôte déjà couvert par Sherlock : l'entrée Sherlock, validée par le banc, l'emporte.
    if (sherlockHosts.has(def.host)) continue
    const tiers: Tier[] = def.nsfw ? ['nsfw'] : def.essential ? ['essential', 'extended'] : ['extended']
    const reason = MAIGRET_BLACKLIST[name] ? 'blacklist' : skipReason(site, entry, db.engines)
    if (reason) skipped.push({ id: def.id, name, reason, tiers })
    else sites.push(def)
  }
  const result = { sites, skipped }
  cached = { version, catalog: result }
  return result
}

/** Sites d'un palier (avant le filtre de santé). */
export function tierSites(tier: Tier): SiteDef[] {
  const { sites } = catalog()
  if (tier === 'nsfw') return sites.filter((s) => s.nsfw)
  if (tier === 'essential') return sites.filter((s) => s.essential)
  return sites.filter((s) => !s.nsfw)
}

/** Sites d'un palier écartés par les règles fixes (liste noire, protection, jeton dynamique...). */
export function tierSkipped(tier: Tier): SkippedSite[] {
  return catalog().skipped.filter((s) => s.tiers.includes(tier))
}

export interface ScanResult extends SiteResult {
  def: SiteDef
}

/**
 * Interroge une liste de sites avec une concurrence limitée. L'avancement (« 410/700 · sites ·
 * 12 trouvés · GitHub ») est signalé à la pastille après chaque site.
 */
export async function scan(
  sites: SiteDef[],
  username: string,
  ctx: ModuleContext,
  opts: { concurrency?: number; timeoutMs?: number } = {}
): Promise<ScanResult[]> {
  const queue = [...sites]
  const results: ScanResult[] = []
  const fr = ctx.lang === 'fr'
  let found = 0
  const detail = (current?: string): string =>
    ['sites', found ? (fr ? `${found} trouvé${found > 1 ? 's' : ''}` : `${found} found`) : '', current ?? ''].filter(Boolean).join(' · ')
  ctx.progress(0, sites.length, detail())
  const worker = async (): Promise<void> => {
    while (queue.length && !ctx.signal.aborted) {
      const def = queue.shift()!
      const result = await def.check(username, ctx, opts.timeoutMs)
      results.push({ ...result, def })
      if (result.status === 'claimed') found++
      ctx.progress(results.length, sites.length, detail(def.name))
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 16, sites.length) }, worker))
  return results.sort((a, b) => a.site.localeCompare(b.site))
}
