// Outils partagés des modules pseudo / réseaux sociaux / messageries : lecture du
// pseudo d'entrée, sortie de profil, extraction des emails et liens d'une bio,
// reconnaissance des URL de profils connus.

import { ModuleError, type InputEntity, type ModuleOutput, type OutEntity } from '@shared/modules'
import { PLATFORMS, getPlatform } from '@shared/platforms'
import type { PropValue } from '@shared/types'

export type Lang = 'fr' | 'en'

/** Pseudo porté par l'entité d'entrée (`username`, ou `account` : data.username sinon le libellé). */
export function usernameOf(input: InputEntity): string {
  const fromData = typeof input.data.username === 'string' ? input.data.username : ''
  let raw = (input.type === 'account' && fromData ? fromData : input.label).trim()
  if (/^https?:\/\//i.test(raw)) {
    const acc = accountFromUrl(raw)
    if (acc) raw = acc.username
  }
  return raw.replace(/^@/, '').trim()
}

/**
 * Filtre `accepts` : tout pseudo, ou un compte de la plateforme donnée. Pour une plateforme
 * absente du catalogue, le compte est reconnu par `data.site`.
 */
export function acceptsPlatform(...platforms: string[]) {
  return (input: InputEntity): boolean => {
    if (input.type !== 'account') return true
    if (input.platform) return platforms.includes(input.platform)
    const site = typeof input.data.site === 'string' ? input.data.site.toLowerCase().replace(/[^a-z0-9]/g, '') : ''
    return !!site && platforms.includes(site)
  }
}

/** Lève une erreur claire si le pseudo est vide ou ne respecte pas le format de la plateforme. */
export function requireUsername(input: InputEntity, pattern?: RegExp): string {
  const u = usernameOf(input)
  if (!u || (pattern && !pattern.test(u))) throw new ModuleError(`Pseudo invalide pour ce service : « ${u} »`, 'invalid_input')
  return u
}

export interface Profile {
  /** Identifiant canonique sur la plateforme (libellé du compte). */
  username: string
  url?: string
  /** Propriétés du compte (clés snake_case). */
  data: Record<string, PropValue | undefined>
  /** URL de l'avatar. */
  image?: string
  /** Libellé du compte si différent du pseudo (ex. `user@instance`). */
  label?: string
  /** Nom du site quand la plateforme n'existe pas dans le catalogue. */
  site?: string
}

/** Résultat d'un parseur de profil : le compte et les entités qui s'y rattachent. */
export interface Parsed {
  profile: Profile
  children: OutEntity[]
}

/** Retire les valeurs vides d'un objet de propriétés. */
export function compact(data: Record<string, PropValue | undefined>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'number' && !Number.isFinite(v)) continue
    out[k] = v
  }
  return out
}

/**
 * Construit la sortie d'un module de profil.
 * - entrée `username` : crée l'entité `account` (avec avatar) et y rattache les entités filles ;
 * - entrée `account` : fusionne les propriétés dans le compte et y rattache les entités filles.
 */
export function profileOutput(
  input: InputEntity,
  platform: string,
  profile: Profile,
  children: OutEntity[] = [],
  raw?: unknown,
  lang: Lang = 'fr'
): ModuleOutput {
  const known = getPlatform(platform)
  const site = profile.site ?? known?.name ?? platform
  const data = compact({ username: profile.username, url: profile.url, ...(known ? {} : { site }), ...profile.data })
  const label = known ? (profile.label ?? profile.username) : `${profile.label ?? profile.username} (${site})`
  if (input.type === 'account') {
    const entities: OutEntity[] = []
    // Même type, libellé et plateforme que l'entrée : le moteur retrouve le nœud et y attache l'avatar.
    if (profile.image) entities.push({ type: 'account', label: input.label, platform: input.platform ?? undefined, image: profile.image })
    entities.push(...children.map((c) => ({ ...c, from: c.from === ACCOUNT_REF ? '$input' : c.from })))
    return { found: true, properties: data, entities, raw }
  }
  const account: OutEntity = {
    ref: ACCOUNT_REF,
    type: 'account',
    label,
    ...(known ? { platform } : {}),
    data,
    image: profile.image,
    linkLabel: lang === 'fr' ? `compte ${site}` : `${site} account`
  }
  return { found: true, entities: [account, ...children.map((c) => ({ ...c, from: c.from ?? ACCOUNT_REF }))], raw }
}

export const ACCOUNT_REF = 'account'

export function notFound(raw?: unknown): ModuleOutput {
  return { found: false, raw }
}

// ---------------------------------------------------------------------------
// Texte libre (bio, description)

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi
const URL_RE = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi
const BARE_URL_RE = /(?:^|[\s(])((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|me|fr|co|app|xyz|gg|tv|ai|be|ch|de|uk|eu|info|blog|link|page|site|tech)(?:\/[^\s<>"'()]*[^\s<>"'().,;:!?])?)/gi

/** Décode les entités HTML courantes. */
export function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** Convertit un fragment HTML (bio Mastodon, about Hacker News...) en texte brut. */
export function htmlToText(html: string): string {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<a\s[^>]*href="([^"]+)"[^>]*>.*?<\/a>/gis, (m, href: string) => {
        const text = m.replace(/<[^>]+>/g, '')
        return text.replace(/^https?:\/\//, '').replace(/\/$/, '') === href.replace(/^https?:\/\//, '').replace(/\/$/, '') ||
          !/^https?:/i.test(href)
          ? text
          : `${text} (${href})`
      })
      .replace(/<[^>]+>/g, '')
  ).trim()
}

export function extractEmails(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].toLowerCase().replace(/\.$/, '')
    if (!/\.(png|jpe?g|gif|webp|svg)$/.test(e)) out.add(e)
  }
  return [...out]
}

export function extractUrls(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(URL_RE)) out.add(m[0])
  const withoutFull = text.replace(URL_RE, ' ').replace(EMAIL_RE, ' ')
  for (const m of withoutFull.matchAll(BARE_URL_RE)) out.add('https://' + m[1])
  return [...out]
}

/** Normalise une URL saisie sans schéma. */
export function normalizeUrl(u: string): string | null {
  const s = u.trim()
  if (!s) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/\//, '')
  try {
    const url = new URL(withScheme)
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Entités issues d'un texte libre ou d'une liste de liens : emails, comptes reconnus, autres URL.
 * `selfPlatform`/`selfUser` évitent de relier le compte à lui-même.
 */
export function linkedEntities(
  opts: {
    text?: string
    urls?: Array<string | null | undefined>
    emails?: Array<string | null | undefined>
    lang: Lang
    self?: { platform: string; username: string }
    textLabel?: { fr: string; en: string }
    linkLabel?: { fr: string; en: string }
  }
): OutEntity[] {
  const { lang } = opts
  const textLabel = opts.textLabel ?? { fr: 'dans la bio', en: 'in bio' }
  const linkLabel = opts.linkLabel ?? { fr: 'lien du profil', en: 'profile link' }
  const out: OutEntity[] = []
  const seen = new Set<string>()
  const push = (e: OutEntity): void => {
    const key = `${e.type}|${e.platform ?? ''}|${e.label.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(e)
  }
  const emails = [...(opts.emails ?? []).filter((e): e is string => !!e), ...(opts.text ? extractEmails(opts.text) : [])]
  for (const e of emails) {
    const email = e.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || /noreply|no-reply/.test(email)) continue
    push({ type: 'email', label: email, linkLabel: lang === 'fr' ? 'email' : 'email' })
  }
  const urls: Array<{ url: string; fromText: boolean }> = [
    ...(opts.urls ?? []).filter((u): u is string => !!u).map((url) => ({ url, fromText: false })),
    ...(opts.text ? extractUrls(opts.text).map((url) => ({ url, fromText: true })) : [])
  ]
  for (const { url: rawUrl, fromText } of urls) {
    const url = normalizeUrl(rawUrl)
    if (!url) continue
    const label = fromText ? textLabel : linkLabel
    const acc = accountFromUrl(url)
    if (acc) {
      if (opts.self && acc.platform === opts.self.platform && acc.username.toLowerCase() === opts.self.username.toLowerCase()) continue
      push({
        type: 'account',
        label: acc.label ?? acc.username,
        platform: acc.platform,
        data: { username: acc.username, url },
        linkLabel: label[lang]
      })
    } else {
      push({ type: 'url', label: url.replace(/\/$/, ''), data: { url }, linkLabel: label[lang] })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Reconnaissance des URL de profils

interface UrlPattern {
  platform: string
  host: RegExp
  path: RegExp
  /** Le pseudo est dans le sous-domaine. */
  sub?: boolean
}

const RESERVED = new Set([
  'about', 'explore', 'home', 'login', 'signup', 'search', 'settings', 'share', 'intent', 'hashtag', 'i', 'p', 'watch',
  'help', 'privacy', 'terms', 'policies', 'pages', 'groups', 'events', 'channel', 'user', 'users', 'c', 'r', 'u', 'in',
  'company', 'school', 'jobs', 'feed', 'notifications', 'messages', 'stories', 'reel', 'reels', 'tv', 'video', 'videos',
  'shorts', 'playlist', 'results', 'tag', 'tags', 'status', 'posts', 'add', 'joinchat', 's', 'sharer', 'dialog', 'download'
])

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const PATTERNS: UrlPattern[] = (() => {
  const list: UrlPattern[] = []
  for (const p of PLATFORMS) {
    if (!p.url || (p.category !== 'social' && p.category !== 'messaging')) continue
    let tpl: URL
    try {
      tpl = new URL(p.url.replace('{u}', 'USERNAMEPLACEHOLDER'))
    } catch {
      continue
    }
    if (tpl.search) continue
    const host = tpl.hostname.replace(/^www\./, '')
    if (host.startsWith('USERNAMEPLACEHOLDER'.toLowerCase() + '.')) {
      list.push({ platform: p.id, host: new RegExp(`^([a-z0-9-]+)\\.${escapeRe(host.split('.').slice(1).join('.'))}$`, 'i'), path: /^\/?$/, sub: true })
      continue
    }
    const path = tpl.pathname.replace(/\/$/, '')
    if (!path.includes('USERNAMEPLACEHOLDER')) continue
    const re = escapeRe(path).replace('USERNAMEPLACEHOLDER', '([^/?#]+)')
    list.push({ platform: p.id, host: new RegExp(`^(?:www\\.|m\\.|mobile\\.)?${escapeRe(host)}$`, 'i'), path: new RegExp(`^${re}/?$`, 'i') })
  }
  const extra: Array<[string, string, RegExp]> = [
    ['x', 'twitter.com', /^\/([^/?#]+)\/?$/],
    ['x', 'x.com', /^\/([^/?#]+)\/?$/],
    ['instagram', 'instagram.com', /^\/([^/?#]+)\/?$/],
    ['facebook', 'facebook.com', /^\/([^/?#]+)\/?$/],
    ['facebook', 'fb.com', /^\/([^/?#]+)\/?$/],
    ['youtube', 'youtube.com', /^\/@([^/?#]+)\/?$/],
    ['youtube', 'youtube.com', /^\/(?:c|user)\/([^/?#]+)\/?$/],
    ['youtube', 'youtube.com', /^\/channel\/(UC[\w-]{22})\/?$/],
    ['tiktok', 'tiktok.com', /^\/@([^/?#]+)\/?$/],
    ['telegram', 't.me', /^\/([^/?#]+)\/?$/],
    ['telegram', 'telegram.me', /^\/([^/?#]+)\/?$/],
    ['linkedin', 'linkedin.com', /^\/in\/([^/?#]+)\/?$/],
    ['reddit', 'reddit.com', /^\/(?:user|u)\/([^/?#]+)\/?$/],
    ['github', 'github.com', /^\/([^/?#]+)\/?$/],
    ['twitch', 'twitch.tv', /^\/([^/?#]+)\/?$/],
    ['bluesky', 'bsky.app', /^\/profile\/([^/?#]+)\/?$/],
    ['threads', 'threads.net', /^\/@([^/?#]+)\/?$/],
    ['threads', 'threads.com', /^\/@([^/?#]+)\/?$/],
    ['snapchat', 'snapchat.com', /^\/(?:add\/|@)([^/?#]+)\/?$/],
    ['medium', 'medium.com', /^\/@([^/?#]+)\/?$/],
    ['steam', 'steamcommunity.com', /^\/(?:id|profiles)\/([^/?#]+)\/?$/],
    ['soundcloud', 'soundcloud.com', /^\/([^/?#]+)\/?$/],
    ['spotify', 'open.spotify.com', /^\/user\/([^/?#]+)\/?$/],
    ['pinterest', 'pinterest.com', /^\/([^/?#]+)\/?$/],
    ['pinterest', 'pinterest.fr', /^\/([^/?#]+)\/?$/],
    ['discord', 'discord.com', /^\/users\/(\d{15,20})\/?$/],
    ['keybase', 'keybase.io', /^\/([^/?#]+)\/?$/],
    ['kick', 'kick.com', /^\/([^/?#]+)\/?$/],
    ['patreon', 'patreon.com', /^\/([^/?#]+)\/?$/],
    ['linktree', 'linktr.ee', /^\/([^/?#]+)\/?$/],
    ['chesscom', 'chess.com', /^\/member\/([^/?#]+)\/?$/],
    ['lichess', 'lichess.org', /^\/@\/([^/?#]+)\/?$/],
    ['strava', 'strava.com', /^\/athletes\/([^/?#]+)\/?$/],
    ['whatsapp', 'wa.me', /^\/(\d{6,15})\/?$/]
  ]
  // Les motifs explicites passent avant ceux déduits du catalogue.
  return [
    ...extra.map(([platform, host, path]) => ({ platform, host: new RegExp(`^(?:www\\.|m\\.|mobile\\.)?${escapeRe(host)}$`, 'i'), path })),
    ...list
  ]
})()

export interface UrlAccount {
  platform: string
  username: string
  /** Libellé à utiliser (`user@instance` pour le fédivers). */
  label?: string
}

/** Reconnaît une URL de profil d'une plateforme connue. */
export function accountFromUrl(raw: string): UrlAccount | null {
  const norm = normalizeUrl(raw)
  if (!norm) return null
  const url = new URL(norm)
  const host = url.hostname.toLowerCase()
  const path = decodeURIComponent(url.pathname)
  if (host === 'facebook.com' || host === 'www.facebook.com' || host === 'm.facebook.com') {
    const id = url.searchParams.get('id')
    if (path === '/profile.php' && id && /^\d+$/.test(id)) return { platform: 'facebook', username: id }
  }
  for (const p of PATTERNS) {
    const h = host.match(p.host)
    if (!h) continue
    if (p.sub) {
      if (!p.path.test(path) || ['www', 'api', 'blog', 'm'].includes(h[1].toLowerCase())) continue
      return { platform: p.platform, username: h[1] }
    }
    const m = path.match(p.path)
    if (!m) continue
    const username = m[1].replace(/^@/, '')
    if (!username || RESERVED.has(username.toLowerCase()) || /\.(php|html?|aspx?)$/i.test(username)) return null
    return { platform: p.platform, username }
  }
  // Fédivers : https://instance/@pseudo
  const fedi = path.match(/^\/@([a-z0-9_.-]{1,64})\/?$/i)
  if (fedi && !/^(www\.)?(medium|tiktok|youtube|threads|snapchat|vsco|unsplash|replit|producthunt|clubhouse|flipboard)\./i.test(host)) {
    return { platform: 'mastodon', username: `${fedi[1]}@${host}`, label: `${fedi[1]}@${host}` }
  }
  return null
}

// ---------------------------------------------------------------------------
// Conversions

/** Date ISO 8601 depuis un timestamp (secondes ou millisecondes) ou une chaîne de date. */
export function toIso(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined
  let d: Date
  if (typeof v === 'number') d = new Date(v < 1e11 ? v * 1000 : v)
  else if (typeof v === 'string' && /^\d+$/.test(v)) d = new Date(Number(v) < 1e11 ? Number(v) * 1000 : Number(v))
  else d = new Date(String(v))
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1990 ? undefined : d.toISOString()
}

/** Nombre depuis une chaîne (« 10 299 929 », « 1,234 ») ; undefined si absent. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\s  ,]/g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined
  return Number(s)
}

/** « 21.4M », « 1.2K », « 1,860 » → nombre approché. */
export function parseCompactNumber(v: string | undefined): number | undefined {
  if (!v) return undefined
  const m = v.replace(/[\s  ]/g, '').match(/^([\d.,]+)([KMB])?/i)
  if (!m) return undefined
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? '').toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  const n = mult === 1 ? Number(m[1].replace(/[.,]/g, '')) : Number(m[1].replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * mult) : undefined
}

/** Contenu d'une balise meta (`property` ou `name`). */
export function metaContent(html: string, key: string): string | undefined {
  const re = new RegExp(`<meta\\s+(?:[^>]*?\\s)?(?:property|name)="${escapeRe(key)}"\\s+(?:[^>]*?\\s)?content="([^"]*)"`, 'i')
  const re2 = new RegExp(`<meta\\s+(?:[^>]*?\\s)?content="([^"]*)"\\s+(?:[^>]*?\\s)?(?:property|name)="${escapeRe(key)}"`, 'i')
  const m = html.match(re) ?? html.match(re2)
  return m ? decodeHtml(m[1]) : undefined
}

/** JSON d'un script `<script id="...">` (Next.js, TikTok). */
export function scriptJson<T = unknown>(html: string, id: string): T | undefined {
  const re = new RegExp(`<script[^>]*id="${escapeRe(id)}"[^>]*>([\\s\\S]*?)</script>`)
  const m = html.match(re)
  if (!m) return undefined
  try {
    return JSON.parse(m[1]) as T
  } catch {
    return undefined
  }
}

/** Statut HTTP d'une erreur `HttpError` levée par ctx.fetchJson / fetchText. */
export function httpStatus(e: unknown): number | undefined {
  return e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number'
    ? (e as { status: number }).status
    : undefined
}

/**
 * Refus d'un pare-feu anti-robot (Cloudflare, Akamai, « blocked by network security »...) :
 * ces services rejettent les adresses de centres de données et parfois des connexions résidentielles.
 */
export function blockedError(service: string, status = 403): ModuleError {
  return new ModuleError(
    `${service} bloque la requête (HTTP ${status}) : son pare-feu anti-robot refuse cette adresse IP. Passer par un proxy (de préférence résidentiel) ou par Tor peut aider.`,
    'blocked'
  )
}

/** Page de blocage anti-robot reconnue dans un corps de réponse. */
export function looksBlocked(body: string): boolean {
  return /blocked by network security|just a moment\.\.\.|attention required!? \| cloudflare|cf-chl-|cf_chl_opt|access denied.{0,80}(akamai|reference #)|request unsuccessful\. incapsula|perimeterx|px-captcha|datadome/i.test(
    body.slice(0, 20000)
  )
}

/** Erreur explicite pour une réponse en échec lue à la main (`ctx.fetch`). */
export function statusError(service: string, status: number, body = ''): ModuleError {
  if (status === 429 || (status === 403 && /rate.?limit|too many requests/i.test(body)))
    return new ModuleError(`${service} : trop de requêtes, réessayer plus tard`, 'rate_limited')
  if (status === 403 || looksBlocked(body)) return blockedError(service, status)
  if (status === 401) return new ModuleError(`${service} : accès refusé (HTTP ${status})`, 'blocked')
  if (status >= 500) return new ModuleError(`${service} : service indisponible (HTTP ${status})`, 'unavailable')
  return new ModuleError(`${service} : réponse inattendue (HTTP ${status})`, 'other')
}

/** Transforme une erreur HTTP en ModuleError explicite (quota, blocage). */
export function rethrow(e: unknown, service: string): never {
  const status = httpStatus(e)
  const body = String((e as { body?: unknown })?.body ?? '')
  // GitHub et d'autres API signalent un quota dépassé par un 403.
  if (status === 429 || (status === 403 && /rate.?limit|too many requests/i.test(body)))
    throw new ModuleError(`${service} : trop de requêtes, réessayer plus tard`, 'rate_limited')
  if (status === 403) throw blockedError(service, status)
  if (status === 401) throw new ModuleError(`${service} : accès refusé (HTTP ${status})`, 'blocked')
  // Défi anti-robot servi avec un 503 (mode « under attack » de Cloudflare).
  if (status && status >= 500 && looksBlocked(body)) throw blockedError(service, status)
  if (status && status >= 500) throw new ModuleError(`${service} : service indisponible (HTTP ${status})`, 'unavailable')
  if (e instanceof Error && (e.name === 'TimeoutError' || e.message === 'fetch failed'))
    throw new ModuleError(`${service} : pas de réponse (${e.name === 'TimeoutError' ? 'délai dépassé' : 'connexion impossible'})`, 'unavailable')
  throw e instanceof Error ? e : new ModuleError(String(e))
}
