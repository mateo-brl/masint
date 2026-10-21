// Lecture tolérante des réponses de roso.info. Les formats sont déduits du code
// d'affichage du site : aucun champ n'est garanti, rien ne doit lever d'exception.

import type { OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { findPlatformByName, getPlatform, profileUrl } from '@shared/platforms'
import { normalizePhone } from '@shared/detect'
import { localizeCountry } from '../domain/_util'
import { ROSO_BASE } from './_client'
import { MASTODON_SITES, SITE_NAMES } from './_sites'

export type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
export const asObj = (v: unknown): Obj => (isObj(v) ? v : {})
export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function str(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
  return undefined
}

/** Première valeur texte non vide parmi les clés. */
export function pick(o: Obj, ...keys: string[]): string {
  for (const k of keys) {
    const v = str(o[k])
    if (v) return v
  }
  return ''
}

export function pickNum(o: Obj, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = num(o[k])
    if (v !== undefined) return v
  }
  return undefined
}

export function strList(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : []
  return asArr(v)
    .map((x) => (isObj(x) ? pick(x, 'name', 'value', 'url', 'domain', 'service', 'title') : str(x)))
    .filter(Boolean)
}

export const uniq = <T>(list: T[]): T[] => Array.from(new Set(list))

export function stripHtml(v: string): string {
  return v
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Date ISO (`YYYY-MM-DD` ou ISO complet) depuis une chaîne ou un horodatage. */
export function isoDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e11 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 ? undefined : d.toISOString()
  }
  const s = str(v)
  if (!s) return undefined
  if (/^\d{10,13}$/.test(s)) return isoDate(Number(s))
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const fr = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,24}$/i
export const isEmail = (v: string): boolean => EMAIL_RE.test(v)
/** Valeur partiellement masquée (`j***@g***.com`, `+33 •• •• 12`...). */
export const isMasked = (v: string): boolean => /[*•●∗…]|x{3,}/i.test(v)

/** Numéro complet en E.164, ou null s'il est masqué / invalide. */
export function fullPhone(v: unknown): string | null {
  const s = str(v)
  if (!s || isMasked(s)) return null
  const digits = s.replace(/[^\d+]/g, '')
  if (!digits.startsWith('+') && !digits.startsWith('00') && !/^0[1-9]\d{8}$/.test(digits)) return null
  return normalizePhone(s)
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
export const isIp = (v: string): boolean => IPV4.test(v) || (/^[0-9a-f:]+$/i.test(v) && v.split(':').length > 2)
export const isDomain = (v: string): boolean => /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(v)

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * URL d'image téléchargeable par le moteur : rend absolues les URL relatives de roso.info,
 * écarte les avatars par défaut. Le proxy d'image `/api/uc/proxy-image` est public (pas de clé).
 */
export function imageUrl(v: unknown): string | undefined {
  let u = str(v)
  if (!u) return undefined
  if (u.startsWith('data:image/')) return u
  if (u.startsWith('//')) u = 'https:' + u
  else if (u.startsWith('/')) u = ROSO_BASE + u
  if (!isHttpUrl(u)) return undefined
  if (/placeholder|default.?avatar|default_profile|gravatar\.com\/avatar\/0+\b|[?&]d=blank|\/avatar\/default/i.test(u)) return undefined
  // Le site fait passer ces hôtes par son proxy (blocage du hotlinking).
  if (/eyecon-app\.com/i.test(u)) return `${ROSO_BASE}/api/uc/proxy-image?url=${encodeURIComponent(u)}`
  return u
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

const norm = (v: string): string =>
  v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

/** Identifiants roso.info qui diffèrent de ceux de platforms.ts. */
const PLATFORM_ALIASES: Record<string, string> = {
  twitter: 'x',
  chess: 'chesscom',
  lastfm: 'last.fm',
  itch: 'itchio',
  xboxgamertag: 'xbox',
  psnprofiles: 'playstation',
  namemc: 'minecraft',
  googlemaps: 'google',
  gmaps: 'google',
  mapscontrib: 'google',
  gmail: 'google',
  googlecalendar: 'google',
  googlechat: 'google',
  youtube: 'youtube',
  apple: 'apple',
  appleid: 'apple',
  appleiforgot: 'apple',
  icloud: 'apple',
  appledev: 'apple',
  outlookcom: 'microsoft',
  outlookfr: 'microsoft',
  hotmailcom: 'microsoft',
  hotmailfr: 'microsoft',
  live: 'microsoft',
  protonmail: 'proton',
  yahoo: 'yahoo',
  mastodonmulti: 'mastodon',
  ninegag: '',
  vkontakte: 'vk',
  ok: 'okru',
  fb: 'facebook',
  facebookmessenger: 'messenger',
  hackernews: 'hackernews',
  ycombinator: 'hackernews',
  steamcommunity: 'steam',
  epic: 'epicgames',
  riot: 'riotgames',
  npmjs: 'npm',
  docker: 'dockerhub',
  fivehundredpx: '500px',
  dev: 'devto',
  wordpresscom: 'wordpress',
  blogspot: 'blogger',
  etsypeople: 'etsy',
  etsyshop: 'etsy',
  samsunghealth: '',
  weward: 'weward',
  hudsonrock: 'hudsonrock'
}

/** Plateforme de platforms.ts correspondant à un identifiant de module roso.info. */
export function rosoPlatform(site: string): string | undefined {
  const n = norm(site)
  if (!n) return undefined
  if (hasOwn(PLATFORM_ALIASES, n)) return PLATFORM_ALIASES[n] || undefined
  if (MASTODON_SITES.has(site)) return 'mastodon'
  if (getPlatform(n)) return n
  const p = findPlatformByName(site)
  if (p && (norm(p.id) === n || norm(p.name) === n)) return p.id
  return undefined
}

export function siteName(site: string): string {
  if (hasOwn(SITE_NAMES, site)) return SITE_NAMES[site]
  const p = getPlatform(rosoPlatform(site))
  if (p) return p.name
  return site.charAt(0).toUpperCase() + site.slice(1).replace(/[-_]/g, ' ')
}

// ---------------------------------------------------------------------------
// Profils

const NAME_KEYS = ['displayName', 'display_name', 'fullName', 'full_name', 'fullname', 'name', 'pushname', 'nickname', 'title']
const USER_KEYS = ['username', 'login', 'handle', 'screenName', 'screen_name', 'uniqueId', 'unique_id', 'userName', 'slug']
const ID_KEYS = ['userId', 'user_id', 'uid', 'uuid', 'gaiaId', 'id', 'accountId', 'account_id']
const URL_KEYS = ['profileUrl', 'profile_url', 'accountUrl', 'contribUrl', 'url', 'link', 'permalink']
const PHOTO_KEYS = [
  'profileImage',
  'profileImageUrl',
  'profilePictureUrl',
  'profile_picture_url',
  'profile_image_url',
  'avatar',
  'avatarUrl',
  'avatar_url',
  'photo',
  'photoUrl',
  'picture',
  'image',
  'imageUrl',
  'bitmojiUrl',
  'thumbnail'
]
const CREATED_KEYS = [
  'createdAt',
  'created_at',
  'createDate',
  'creationDate',
  'dateCreated',
  'date_created',
  'signupDate',
  'registeredAt',
  'registrationDate',
  'registerDate',
  'accountCreated',
  'joined',
  'joinedAt',
  'joinDate',
  'memberSince',
  'created',
  'ctime'
]
const SEEN_KEYS = ['lastSeen', 'last_seen', 'lastActive', 'lastActivity', 'lastLogin', 'updatedAt', 'updated_at', 'lastUpdated']
const PHONE_KEYS = [
  'phone',
  'phoneNumber',
  'phone_number',
  'formattedPhone',
  'phoneHint',
  'phoneMasked',
  'maskedPhone',
  'maskedMobile',
  'mobile',
  'r_mobile',
  'recoveryPhone',
  'recovery_phone',
  'telephonePublic'
]
const SKIP_KEYS = /^(success|exists|raw|html|rawHtml|token|password|passwords|cookie|cookies|headers|_.*)$/i

export function avatarOf(p: Obj): string | undefined {
  for (const k of PHOTO_KEYS) {
    const u = imageUrl(p[k])
    if (u) return u
  }
  const sizes = asObj(p.avatarSizes)
  return imageUrl(sizes.large) ?? imageUrl(sizes.medium) ?? imageUrl(sizes.small)
}

export function displayNameOf(p: Obj): string {
  const direct = pick(p, ...NAME_KEYS.filter((k) => k !== 'title'))
  if (direct) return direct
  return [pick(p, 'firstName', 'first_name', 'givenName'), pick(p, 'lastName', 'last_name', 'familyName')].filter(Boolean).join(' ')
}

/** Emails d'un profil : complets d'un côté, masqués de l'autre. */
export function emailsOf(p: Obj): { full: string[]; masked: string[] } {
  const raw: string[] = []
  for (const k of ['email', 'mail', 'recoveryEmail', 'masked_email', 'maskedEmail', 'emailHint']) raw.push(str(p[k]))
  for (const k of ['emails', 'emailHints', 'masked_emails']) {
    for (const e of asArr(p[k])) raw.push(isObj(e) ? pick(e, 'email', 'value', 'address') : str(e))
  }
  const full: string[] = []
  const masked: string[] = []
  for (const e of raw) {
    if (!e || !e.includes('@')) continue
    if (isMasked(e)) masked.push(e)
    else if (isEmail(e)) full.push(e.toLowerCase())
  }
  return { full: uniq(full), masked: uniq(masked) }
}

/** Téléphones d'un profil : complets (E.164) et masqués. */
export function phonesOf(p: Obj): { full: string[]; masked: string[] } {
  const raw: string[] = []
  for (const k of PHONE_KEYS) raw.push(str(p[k]))
  for (const k of ['phones', 'masked_phones', 'phoneHints']) {
    for (const ph of asArr(p[k])) raw.push(isObj(ph) ? pick(ph, 'phone', 'number', 'value', 'mask') : str(ph))
  }
  for (const m of asArr(p.recoveryMethods)) {
    const o = asObj(m)
    if (/phone|sms|mobile/i.test(pick(o, 'recoveryMethod', 'type'))) raw.push(pick(o, 'mask', 'value', 'phone'))
  }
  const full: string[] = []
  const masked: string[] = []
  for (const ph of raw) {
    if (!ph || !/\d/.test(ph)) continue
    const e164 = fullPhone(ph)
    if (e164) full.push(e164)
    else if (isMasked(ph)) masked.push(ph)
  }
  return { full: uniq(full), masked: uniq(masked) }
}

/** Champs simples du profil, conservés pour consultation dans la fiche. */
export function flatProfile(p: Obj, max = 40): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let n = 0
  for (const [k, v] of Object.entries(p)) {
    if (n >= max) break
    if (SKIP_KEYS.test(k)) continue
    if (typeof v === 'string' && v.length > 0 && v.length <= 500) out[k] = v
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v) && v.length && v.length <= 30 && v.every((x) => typeof x === 'string' || typeof x === 'number')) out[k] = v
    else continue
    n++
  }
  return out
}

export interface AccountOpts {
  /** Identifiant du module / site roso.info (`github`, `spotify`...). */
  site: string
  /** Valeur recherchée (email, pseudo, numéro), utilisée si le profil n'a pas d'identifiant. */
  query: string
  ref: string
  from?: string
  linkLabel?: string
  lang: 'fr' | 'en'
}

const ll = (lang: 'fr' | 'en', fr: string, en: string): string => (lang === 'fr' ? fr : en)

/**
 * Compte trouvé + entités dérivées (nom, emails, téléphones). Fonctionne sur n'importe quel
 * objet profil : les champs absents sont simplement ignorés.
 */
export function accountEntities(profile: unknown, opts: AccountOpts): OutEntity[] {
  const p = asObj(profile)
  const platform = rosoPlatform(opts.site)
  const name = displayNameOf(p)
  const username = pick(p, ...USER_KEYS).replace(/^@/, '')
  const urlRaw = pick(p, ...URL_KEYS)
  const url = isHttpUrl(urlRaw) ? urlRaw : platform && username ? profileUrl(platform, username) : undefined
  const emails = emailsOf(p)
  const phones = phonesOf(p)
  const city = pick(p, 'city', 'locality', 'town', 'homeCity')
  const country = localizeCountry(pick(p, 'country'), pick(p, 'countryCode', 'country_code'), opts.lang) ?? ''
  const location = pick(p, 'location', 'locationText') || [city, country].filter(Boolean).join(', ')
  const lat = pickNum(p, 'lat', 'latitude')
  const lon = pickNum(p, 'lon', 'lng', 'longitude')

  let label = username || name || opts.query
  if (!platform) label = `${label} (${siteName(opts.site)})`

  const data: Record<string, PropValue> = {
    username: username || undefined,
    display_name: name || undefined,
    user_id: pick(p, ...ID_KEYS) || undefined,
    url,
    bio: stripHtml(pick(p, 'bio', 'about', 'description', 'headline', 'summary')) || undefined,
    location: location || undefined,
    followers: pickNum(p, 'followers', 'followersCount', 'followers_count', 'numFollowers', 'subscribers'),
    following: pickNum(p, 'following', 'followingCount', 'following_count', 'numFollowing'),
    created_at: isoDate(CREATED_KEYS.map((k) => p[k]).find((v) => isoDate(v))),
    last_seen: isoDate(SEEN_KEYS.map((k) => p[k]).find((v) => isoDate(v))),
    website: pick(p, 'website', 'blog') || undefined,
    lat,
    lon,
    masked_emails: emails.masked.length ? emails.masked : undefined,
    masked_phones: phones.masked.length ? phones.masked : undefined,
    site: platform ? undefined : opts.site,
    source: 'roso.info',
    roso_profile: Object.keys(p).length ? (flatProfile(p) as Record<string, unknown>) : undefined
  } as Record<string, PropValue>

  const out: OutEntity[] = [
    {
      ref: opts.ref,
      from: opts.from,
      type: 'account',
      label,
      platform,
      data: dropEmpty(data),
      image: avatarOf(p),
      linkLabel: opts.linkLabel ?? ll(opts.lang, `compte ${siteName(opts.site)}`, `${siteName(opts.site)} account`)
    }
  ]
  if (name && /\s/.test(name) && !name.includes('@') && name.toLowerCase() !== username.toLowerCase() && name.length <= 80)
    out.push({ type: 'person', label: name, from: opts.ref, linkLabel: ll(opts.lang, 'nom affiché', 'display name') })
  for (const e of emails.full)
    if (e !== opts.query.toLowerCase()) out.push({ type: 'email', label: e, from: opts.ref, linkLabel: 'email' })
  for (const ph of phones.full)
    if (ph !== opts.query) out.push({ type: 'phone', label: ph, from: opts.ref, linkLabel: ll(opts.lang, 'téléphone', 'phone') })
  return out
}

export function dropEmpty(data: Record<string, PropValue | undefined>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && !v.length) continue
    if (isObj(v) && !Object.keys(v).length) continue
    out[k] = v
  }
  return out
}

/** Adresse postale d'un résultat (annuaires, voisinage). Ignore emails et adresses crypto. */
export function addressEntity(p: Obj, from: string, lang: 'fr' | 'en'): OutEntity | null {
  const street = pick(p, 'address', 'fullAddress', 'full_address', 'street', 'streetAddress')
  const postcode = pick(p, 'postalCode', 'postal_code', 'postcode', 'zip', 'zipCode')
  const city = pick(p, 'city', 'locality', 'town')
  if (!street || street.includes('@') || !/\s/.test(street) || /^(0x|bc1|T[1-9A-HJ-NP-Za-km-z]{20})/.test(street)) return null
  const suffix = [postcode, city].filter((x) => x && !street.includes(x)).join(' ')
  return {
    type: 'address',
    label: suffix ? `${street}, ${suffix}` : street,
    from,
    data: dropEmpty({
      street,
      postcode: postcode || undefined,
      city: city || undefined,
      country: localizeCountry(pick(p, 'country'), pick(p, 'countryCode', 'country_code'), lang) || undefined,
      lat: pickNum(p, 'lat', 'latitude'),
      lon: pickNum(p, 'lon', 'lng', 'longitude'),
      source: 'roso.info'
    }),
    linkLabel: ll(lang, 'adresse', 'address')
  }
}

// ---------------------------------------------------------------------------
// Fuites et infostealers

/** Fuites au format HIBP (`Name`, `BreachDate`, `DataClasses`...) ou proche. */
export function breachEntities(list: unknown, from: string | undefined, lang: 'fr' | 'en', limit = 100): OutEntity[] {
  const out: OutEntity[] = []
  for (const item of asArr(list).slice(0, limit)) {
    const b = isObj(item) ? item : { name: str(item) }
    const name = pick(b, 'Name', 'name', 'Title', 'title', 'source', 'database')
    if (!name) continue
    out.push({
      type: 'breach',
      label: name,
      from,
      data: dropEmpty({
        breach_date: isoDate(b.BreachDate ?? b.breachDate ?? b.date),
        records: pickNum(b, 'PwnCount', 'pwnCount', 'records', 'count'),
        data_classes: strList(b.DataClasses ?? b.dataClasses ?? b.fields),
        description: stripHtml(pick(b, 'Description', 'description')).slice(0, 2000) || undefined,
        domain: pick(b, 'Domain', 'domain') || undefined,
        source: 'roso.info'
      }),
      linkLabel: ll(lang, 'fuite', 'breach')
    })
  }
  return out
}

/** Enregistrements IntelX (`name`, `date`, `bucket`, `media`, `viewUrl`). */
export function intelxEntities(list: unknown, from: string | undefined, lang: 'fr' | 'en', limit = 25): OutEntity[] {
  const out: OutEntity[] = []
  for (const item of asArr(list).slice(0, limit)) {
    const r = asObj(item)
    const name = pick(r, 'name', 'systemid', 'bucket')
    if (!name) continue
    out.push({
      type: 'breach',
      label: name.slice(0, 160),
      from,
      data: dropEmpty({
        breach_date: isoDate(r.date),
        description: [pick(r, 'bucket'), pick(r, 'media'), pick(r, 'size')].filter(Boolean).join(' · ') || undefined,
        url: isHttpUrl(pick(r, 'viewUrl')) ? pick(r, 'viewUrl') : undefined,
        source: 'IntelX (roso.info)'
      }),
      linkLabel: ll(lang, 'mention IntelX', 'IntelX record')
    })
  }
  return out
}

/** Machines infectées Hudson Rock (snake_case ou camelCase selon les routes). */
export function stealerEntities(list: unknown, opts: { from?: string; refPrefix: string; lang: 'fr' | 'en'; limit?: number }): OutEntity[] {
  const out: OutEntity[] = []
  asArr(list)
    .slice(0, opts.limit ?? 30)
    .forEach((item, i) => {
      const s = asObj(item)
      const date = isoDate(s.date_compromised ?? s.dateCompromised ?? s.date)
      const computer = pick(s, 'computer_name', 'computerName')
      const family = pick(s, 'stealer_family', 'stealerFamily', 'family')
      const ip = pick(s, 'ip', 'ipAddress', 'ip_address')
      const logins = asArr(s.top_logins ?? s.topLogins ?? s.credentials ?? s.services)
        .map((x) => (isObj(x) ? pick(x, 'url', 'domain', 'service') : str(x)))
        .filter(Boolean)
        .slice(0, 30)
      const ref = `${opts.refPrefix}${i}`
      const label = computer || `Infostealer ${date ? date.slice(0, 10) : i + 1}${family ? ` (${family})` : ''}`
      out.push({
        ref,
        from: opts.from,
        type: 'infostealer',
        label,
        data: dropEmpty({
          date_compromised: date,
          computer_name: computer || undefined,
          os: pick(s, 'operating_system', 'operatingSystem', 'os') || undefined,
          malware_path: pick(s, 'malware_path', 'malwarePath') || undefined,
          antiviruses: strList(s.antiviruses),
          ip: ip || undefined,
          stealer_family: family || undefined,
          top_logins: logins,
          corporate_services: pickNum(s, 'total_corporate_services', 'totalCorporateServices'),
          user_services: pickNum(s, 'total_user_services', 'totalUserServices'),
          source: 'Hudson Rock (roso.info)'
        }),
        linkLabel: 'infostealer'
      })
      if (ip && isIp(ip)) out.push({ type: 'ip', label: ip, from: ref, linkLabel: ll(opts.lang, 'IP de la machine', 'machine IP') })
    })
  return out
}

// ---------------------------------------------------------------------------
// Repli générique

export interface Extracted {
  emails: string[]
  phones: string[]
  urls: string[]
  usernames: string[]
}

/**
 * Parcourt n'importe quel JSON et en extrait emails, téléphones complets, URL et pseudos.
 * Sert pour les modules dont le format n'a pas pu être observé.
 */
export function genericExtract(value: unknown, maxNodes = 5000): Extracted {
  const emails = new Set<string>()
  const phones = new Set<string>()
  const urls = new Set<string>()
  const usernames = new Set<string>()
  let seen = 0
  const walk = (v: unknown, key: string, depth: number): void => {
    if (seen++ > maxNodes || depth > 8) return
    if (typeof v === 'string') {
      const s = v.trim()
      if (!s || s.length > 2000) return
      if (isEmail(s) && !isMasked(s)) emails.add(s.toLowerCase())
      else if (/phone|mobile|tel|msisdn/i.test(key)) {
        const ph = fullPhone(s)
        if (ph) phones.add(ph)
      } else if (/^https?:\/\//i.test(s) && /url|link|website|profile|href|blog/i.test(key) && isHttpUrl(s)) urls.add(s)
      else if (/^(username|login|handle|screen_?name|nickname|uniqueId)$/i.test(key) && /^@?[\w.-]{2,40}$/.test(s)) usernames.add(s.replace(/^@/, ''))
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, key, depth + 1)
      return
    }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.test(k) || k === 'raw') walk(x, k, depth + 1)
  }
  walk(value, '', 0)
  return { emails: [...emails], phones: [...phones], urls: [...urls], usernames: [...usernames] }
}

/**
 * Complète un résultat avec le repli générique : emails et téléphones absents deviennent des
 * entités, et le compte `from` reçoit l'URL / le pseudo trouvés s'il n'en avait pas.
 */
export function addGeneric(out: OutEntity[], value: unknown, from: string, query: string, lang: 'fr' | 'en'): void {
  const known = new Set(out.map((e) => `${e.type}|${e.label.toLowerCase()}`))
  const ex = genericExtract(value)
  const account = out.find((e) => e.ref === from && e.type === 'account')
  if (account) {
    const data = { ...account.data }
    if (!data.url && ex.urls[0]) data.url = ex.urls[0]
    if (!data.username && ex.usernames[0]) data.username = ex.usernames[0]
    account.data = data
  }
  for (const e of ex.emails.slice(0, 20)) {
    if (e === query.toLowerCase() || known.has(`email|${e}`)) continue
    known.add(`email|${e}`)
    out.push({ type: 'email', label: e, from, linkLabel: 'email' })
  }
  for (const ph of ex.phones.slice(0, 20)) {
    if (ph === query || known.has(`phone|${ph}`)) continue
    known.add(`phone|${ph}`)
    out.push({ type: 'phone', label: ph, from, linkLabel: ll(lang, 'téléphone', 'phone') })
  }
}
