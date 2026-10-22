// Utilitaires partagés des modules domaine, IP et web.

import { ModuleError, type HttpError, type ModuleContext } from '@shared/modules'
import type { PropValue } from '@shared/types'

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

export function isIPv4(s: string): boolean {
  return IPV4.test(s)
}

export function isIPv6(s: string): boolean {
  return s.includes(':') && /^[0-9a-f:.]+$/i.test(s) && s.split(':').length > 2
}

/** Nom d'hôte nu : sans schéma, chemin, port ni point final, en minuscules. */
export function normalizeHost(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  s = s.split(/[/?#]/)[0]
  s = s.replace(/^[^@]*@/, '')
  const bracketed = s.match(/^\[([0-9a-f:.]+)\](?::\d+)?$/)
  if (bracketed) return bracketed[1]
  // Un seul « : » : c'est un port, pas une adresse IPv6.
  if (s.split(':').length === 2) s = s.replace(/:\d+$/, '')
  return s.replace(/\.$/, '').replace(/^\*\./, '')
}

/** Domaine saisi par l'enquêteur, sans `www.`. */
export function normalizeDomain(raw: string): string {
  return normalizeHost(raw).replace(/^www\./, '')
}

export function isDomain(s: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i.test(s)
}

// Suffixes publics à deux niveaux hors forme `<générique>.<ccTLD>` (extrait de la Public Suffix
// List) et domaines d'hébergeurs où chaque client reçoit son propre nom (`<client>.github.io`).
const TWO_LEVEL_SUFFIXES = new Set([
  'github.io', 'gitlab.io', 'herokuapp.com', 'azurewebsites.net', 'cloudapp.net', 'blogspot.com', 'netlify.app',
  'vercel.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com', 'onmicrosoft.com',
  'wordpress.com', 'wixsite.com', 'myshopify.com', 'ngrok.io', 'glitch.me', 'onrender.com', 'fly.dev',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ed.jp', 'gr.jp', 'lg.jp',
  'qc.ca', 'on.ca', 'bc.ca', 'gc.ca', 'ab.ca',
  'nhs.uk', 'police.uk', 'mod.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'sch.uk',
  'presse.fr', 'tm.fr', 'nom.fr', 'cci.fr', 'notaires.fr', 'avocat.fr', 'veterinaire.fr', 'port.fr',
  'k12.us', 'us.com', 'eu.com', 'uk.com', 'de.com', 'za.com', 'br.com', 'cn.com', 'jpn.com'
])
const GENERIC_SECOND_LEVEL = /^(co|com|net|org|gov|gouv|gob|go|edu|ac|asso|or|ne|mil|nom|ltd|plc|govt|sch|res|biz|info|int|web)$/

/** Nombre de labels du suffixe public (`co.uk` → 2, `com` → 1), par approximation prudente. */
export function publicSuffixLength(host: string): number {
  const labels = host.split('.')
  if (labels.length < 3) return 1
  const tld = labels[labels.length - 1]
  if (TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join('.'))) return 2
  return tld.length === 2 && GENERIC_SECOND_LEVEL.test(labels[labels.length - 2]) ? 2 : 1
}

/**
 * Domaine enregistrable : `_spf.mozilla.com` → `mozilla.com`, `mail.exemple.co.uk` →
 * `exemple.co.uk`. Approximation sans la liste complète des suffixes publics : suffixes à deux
 * niveaux courants et forme `<générique>.<ccTLD>` (`gouv.fr`, `com.au`...).
 */
export function registrableDomain(host: string): string {
  const labels = normalizeHost(host).split('.').filter(Boolean)
  const n = publicSuffixLength(labels.join('.')) + 1
  return labels.slice(-n).join('.')
}

/** Le domaine puis ses parents (`a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`). */
export function domainAndParents(domain: string): string[] {
  const labels = domain.split('.')
  const out: string[] = []
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'))
  return out
}

/** URL complète à partir d'une saisie (ajoute `https://` si besoin). */
export function toUrl(raw: string): string {
  const s = raw.trim()
  if (/^https?:\/\//i.test(s)) return s
  return 'https://' + s.replace(/^\/+/, '')
}

export function uniq<T>(list: Iterable<T>): T[] {
  return Array.from(new Set(list))
}

/** Convertit un horodatage (secondes, millisecondes ou texte) en date ISO 8601. */
export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  let d: Date
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v)
  else d = new Date(String(v).replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Traduit une erreur réseau ou HTTP en `ModuleError` explicite. */
export function serviceError(e: unknown, service: string, keyed = false): ModuleError {
  if (e instanceof ModuleError) return e
  const status = (e as Partial<HttpError>)?.status
  if (status === 401 || (keyed && status === 403)) return new ModuleError(`${service} : clé API refusée`, 'auth')
  if (status === 403) return new ModuleError(`${service} : accès bloqué (HTTP 403)`, 'blocked')
  if (status === 429) return new ModuleError(`${service} : quota dépassé, réessayer plus tard`, 'rate_limited')
  if (status && status >= 500) return new ModuleError(`${service} indisponible (HTTP ${status})`, 'unavailable')
  if (status) return new ModuleError(`${service} : réponse inattendue (HTTP ${status})`, 'other')
  const msg = e instanceof Error ? e.message : String(e)
  return new ModuleError(`${service} injoignable : ${msg}`, 'unavailable')
}

/** GET JSON qui renvoie `null` sur 404 (résultat vide) et lève une `ModuleError` sinon. */
export async function getJsonOrNull<T>(
  ctx: ModuleContext,
  url: string,
  service: string,
  init: Parameters<ModuleContext['fetchJson']>[1] = {},
  keyed = false
): Promise<T | null> {
  try {
    return await ctx.fetchJson<T>(url, init)
  } catch (e) {
    if ((e as Partial<HttpError>)?.status === 404) return null
    throw serviceError(e, service, keyed)
  }
}

export function requireKey(ctx: ModuleContext, id: string, service: string): string {
  const key = ctx.key(id)
  if (!key) throw new ModuleError(`Clé API ${service} manquante`, 'auth')
  return key
}

/** Libellé bilingue court. */
export function tr(ctx: ModuleContext, fr: string, en: string): string {
  return ctx.lang === 'fr' ? fr : en
}

/** Petite pause interruptible (réessais). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Annulé'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('Annulé'))
    })
  })
}

/** Exécute des tâches avec un nombre maximal en parallèle. */
export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const worker = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}

/** Nom de pays (selon la langue) à partir d'un code ISO à deux lettres. */
export function countryName(code: string | null | undefined, lang: 'fr' | 'en'): string | null {
  if (!code || !/^[a-z]{2}$/i.test(code)) return null
  const c = code.toUpperCase()
  try {
    // Forme courte pour les territoires au nom officiel long (« Hong Kong » plutôt que « R.A.S. chinoise de Hong Kong »).
    const style = c === 'HK' || c === 'MO' || c === 'PS' ? 'short' : 'long'
    return new Intl.DisplayNames([lang], { type: 'region', style }).of(c) ?? c
  } catch {
    return c
  }
}

// Noms anglais renvoyés par certaines API qui diffèrent de ceux d'Intl.DisplayNames.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'great britain': 'GB',
  'united kingdom of great britain and northern ireland': 'GB',
  'russian federation': 'RU',
  'korea, republic of': 'KR',
  'republic of korea': 'KR',
  korea: 'KR',
  "korea, democratic people's republic of": 'KP',
  'viet nam': 'VN',
  'iran, islamic republic of': 'IR',
  'czech republic': 'CZ',
  'the netherlands': 'NL',
  holland: 'NL',
  turkey: 'TR',
  'hong kong': 'HK',
  macau: 'MO',
  macao: 'MO',
  'taiwan, province of china': 'TW',
  'moldova, republic of': 'MD',
  'syrian arab republic': 'SY',
  "lao people's democratic republic": 'LA',
  'tanzania, united republic of': 'TZ',
  'bolivia, plurinational state of': 'BO',
  'venezuela, bolivarian republic of': 'VE',
  macedonia: 'MK',
  'republic of north macedonia': 'MK',
  palestine: 'PS',
  'palestine, state of': 'PS',
  'ivory coast': 'CI',
  "cote d'ivoire": 'CI',
  swaziland: 'SZ',
  burma: 'MM',
  'cape verde': 'CV',
  'brunei darussalam': 'BN',
  'congo, the democratic republic of the': 'CD',
  'democratic republic of the congo': 'CD',
  'republic of the congo': 'CG',
  'vatican city': 'VA',
  'holy see (vatican city state)': 'VA'
}

const foldCountry = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

let englishCountries: Map<string, string> | null = null

/** Code ISO à deux lettres à partir d'un nom de pays en anglais (« United States » → `US`). */
export function countryCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null
  if (!englishCountries) {
    englishCountries = new Map(Object.entries(COUNTRY_ALIASES))
    try {
      const styles = [new Intl.DisplayNames(['en'], { type: 'region' }), new Intl.DisplayNames(['en'], { type: 'region', style: 'short' })]
      for (let i = 0; i < 26; i++) {
        for (let j = 0; j < 26; j++) {
          const code = String.fromCharCode(65 + i, 65 + j)
          // Codes périmés (DD, VD...) : ICU les ramène au code actuel, qu'on garde seul.
          if (Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) continue
          for (const names of styles) {
            const n = names.of(code)
            if (n && n !== code && !englishCountries.has(foldCountry(n))) englishCountries.set(foldCountry(n), code)
          }
        }
      }
    } catch {
      /* Intl incomplet : seuls les alias restent connus */
    }
  }
  const key = foldCountry(name).replace(/^the /, '')
  return englishCountries.get(key) ?? englishCountries.get(`the ${key}`) ?? null
}

/**
 * Nom de pays dans la langue de l'interface. Part du code ISO quand il est connu,
 * sinon reconnaît un code ou un nom anglais renvoyé par une API ; garde la valeur d'origine à défaut.
 */
export function localizeCountry(value: string | null | undefined, code: string | null | undefined, lang: 'fr' | 'en'): string | null {
  const v = typeof value === 'string' ? value.trim() : ''
  const c = code && /^[a-z]{2}$/i.test(code.trim()) ? code.trim() : /^[a-z]{2}$/i.test(v) ? v : countryCodeFromName(v)
  if (c) {
    const name = countryName(c, lang)
    if (name && name.toUpperCase() !== c.toUpperCase()) return name
  }
  return v || (c ? c.toUpperCase() : null)
}

/** Plafond des entités tirées de listes passives (DNS passif, co-hébergement, scans tiers). */
export const MAX_LIST_ENTITIES = 10
/** Plafond des listes affichées dans la fiche (le reste reste dans `raw`). */
export const MAX_LIST_PROPERTY = 50

/** Liste lisible dans la fiche : les premiers éléments et, à côté, le total (`<clé>_count`). */
export function cappedList(key: string, list: readonly string[], max = MAX_LIST_PROPERTY): Record<string, PropValue> {
  if (!list.length) return {}
  return { [key]: list.slice(0, max), [`${key}_count`]: list.length }
}

/** Retire les propriétés vides (null, chaîne vide, liste vide). */
export function compact(props: Record<string, PropValue | undefined>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue
    out[k] = v
  }
  return out
}
