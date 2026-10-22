// Lecture et rapprochement des indices masqués (email ou téléphone de récupération) tels que
// les affichent Apple, Microsoft, Adobe ou roso.info : `a•••••@g•••••.com (Apple)`,
// `+33 •• •• •• •• 42`, `********59 (US)`. Fonctions pures, testées hors ligne.
//
// Le nombre de caractères masqués n'est jamais pris en compte : selon le service, il reflète
// la longueur réelle ou reste fixe (Adobe affiche toujours cinq puces).

import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
import { countryName } from '../domain/_util'

/** Suite de caractères de masquage : étoiles, puces, points médians, points de suspension. */
const MASK_RUN = /(?:[*•●∗·⋅…■▪◦]|\.{2,})+/g
const HAS_MASK = /[*•●∗·⋅…■▪◦]|\.{2,}/
/** Dans un numéro, les lettres x et le dièse masquent aussi des chiffres (`+33 6 XX XX XX 42`). */
const PHONE_MASK_CHARS = /[*•●∗·⋅…■▪◦xX#]/g

export interface Hint {
  kind: 'email' | 'phone'
  /** Valeur masquée telle qu'affichée par le service, sans la source. */
  mask: string
  /** Services qui ont renvoyé l'indice (« Apple », « Microsoft »). */
  sources: string[]
  /** Pays indiqué à côté d'un téléphone (`********59 (US)`). */
  country?: string
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Forme comparable d'un indice : minuscules, sans séparateurs, chaque suite masquée réduite
 * à `•`. `a*****@g*****.com` et `a•••••@g•••••.com` donnent la même clé.
 */
export function maskKey(h: Pick<Hint, 'kind' | 'mask'>): string {
  const s = h.kind === 'email' ? h.mask.toLowerCase().replace(MASK_RUN, '•') : h.mask.replace(PHONE_MASK_CHARS, '•').replace(/[^\d+•]/g, '')
  return `${h.kind}:${s.replace(/\s+/g, '').replace(/•+/g, '•')}`
}

/**
 * Lit un indice : `a•••••@g•••••.com (Apple, Sleeper)`, `Microsoft : te*****@gmail.com`,
 * `********59 (US)`. Renvoie `null` pour une valeur non masquée ou illisible.
 */
export function parseHint(raw: string, defaultSource?: string): Hint | null {
  let s = String(raw ?? '').trim()
  if (!s || s.length > 200) return null
  const sources: string[] = []
  let country: string | undefined

  // Préfixe « Service : valeur ».
  const prefixed = s.match(/^([A-Za-zÀ-ÿ][^:@]{0,40}?)\s+:\s+(.+)$/)
  if (prefixed) {
    sources.push(prefixed[1].trim())
    s = prefixed[2].trim()
  }
  // Suffixes entre parenthèses : sources (`(Apple, Sleeper)`) ou pays (`(US)`).
  for (let m = s.match(/^(.*\S)\s*\(([^()]+)\)$/); m; m = s.match(/^(.*\S)\s*\(([^()]+)\)$/)) {
    const inner = m[2].trim()
    if (HAS_MASK.test(inner) || inner.includes('@') || /\d/.test(inner)) break
    if (/^[A-Z]{2}$/.test(inner)) country = inner
    else sources.push(...inner.split(/\s*,\s*/).filter(Boolean))
    s = m[1].trim()
  }
  if (!sources.length && defaultSource) sources.push(defaultSource)

  const at = s.lastIndexOf('@')
  if (at > 0 && at < s.length - 1) {
    if (!HAS_MASK.test(s) || /\s/.test(s)) return null
    return { kind: 'email', mask: s, sources: uniq(sources) }
  }
  if (!s.includes('@') && /^[+\d\s().\-/*•●∗·⋅…■▪◦xX#]+$/.test(s) && /[*•●∗·⋅…■▪◦xX#]/.test(s) && /\d/.test(s)) {
    return { kind: 'phone', mask: s, sources: uniq(sources), ...(country ? { country } : {}) }
  }
  return null
}

const uniq = <T>(list: T[]): T[] => Array.from(new Set(list))

// ---------------------------------------------------------------------------
// Emails

export interface EmailMask {
  mask: string
  /** Fragments visibles de la partie locale, séparés par les parties masquées. */
  local: string[]
  /** Fragments visibles du domaine. */
  domain: string[]
}

export function parseEmailMask(mask: string): EmailMask | null {
  const m = mask.trim().toLowerCase()
  const at = m.lastIndexOf('@')
  if (at <= 0 || at === m.length - 1) return null
  return { mask, local: m.slice(0, at).split(MASK_RUN), domain: m.slice(at + 1).split(MASK_RUN) }
}

const fragmentsRe = (parts: string[]): RegExp => new RegExp(`^${parts.map(escapeRe).join('[^@]*')}$`)

/** Domaine affiché en clair (`te*****@gmail.com`), sinon `undefined`. */
export const exactDomain = (m: EmailMask): string | undefined => (m.domain.length === 1 ? m.domain[0] : undefined)
/** Début visible de la partie locale (`a` pour `a•••••`). */
export const localPrefix = (m: EmailMask): string => m.local[0]
/** Fin visible de la partie locale (`s` pour `p•••••s`). */
export const localSuffix = (m: EmailMask): string => (m.local.length > 1 ? m.local[m.local.length - 1] : '')
/** Nombre de caractères visibles dans la partie locale. */
export const localVisible = (m: EmailMask): number => m.local.join('').length
/** Fin visible du domaine, extension comprise (`.com` pour `g•••••.com`). */
export const domainSuffix = (m: EmailMask): string => (m.domain.length > 1 ? m.domain[m.domain.length - 1] : '')

/** L'adresse complète est-elle compatible avec le masque ? */
export function emailMatches(m: EmailMask, email: string): boolean {
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at <= 0) return false
  return fragmentsRe(m.local).test(e.slice(0, at)) && fragmentsRe(m.domain).test(e.slice(at + 1))
}

/** Domaines de la liste compatibles avec le domaine masqué, dans l'ordre de la liste. */
export function domainsMatching(m: EmailMask, domains: readonly string[]): string[] {
  const exact = exactDomain(m)
  if (exact) return [exact]
  const re = fragmentsRe(m.domain)
  return domains.filter((d) => re.test(d))
}

// ---------------------------------------------------------------------------
// Téléphones

export interface PhoneMask {
  mask: string
  /** Indicatif pays sans `+` (`33`), s'il est visible ou indiqué à côté. */
  cc?: string
  /** Chiffres visibles en tête du numéro national (sans le 0 initial). */
  leading: string
  /** Chiffres visibles en fin de numéro. */
  trailing: string
  /** Nombre de positions masquées (indicatif seulement). */
  hidden: number
}

const CALLING_CODES = new Set(getCountries().map((c) => getCountryCallingCode(c) as string))

export function parsePhoneMask(mask: string, country?: string): PhoneMask | null {
  const s = mask.replace(PHONE_MASK_CHARS, '•')
  if (!s.includes('•')) return null
  let rest = s.replace(/[^\d+•]/g, '')
  let cc: string | undefined
  if (/^(\+|00)/.test(rest)) {
    rest = rest.replace(/^(\+|00)/, '')
    const digits = rest.match(/^\d*/)?.[0] ?? ''
    // Les indicatifs forment un code préfixe : un seul début de la suite peut convenir.
    for (let n = 1; n <= Math.min(3, digits.length); n++) {
      if (CALLING_CODES.has(digits.slice(0, n))) {
        cc = digits.slice(0, n)
        break
      }
    }
    if (cc) rest = rest.slice(cc.length)
  } else if (rest.startsWith('0')) {
    // Format national : le 0 initial ne fait pas partie du numéro.
    rest = rest.slice(1)
  }
  if (rest.includes('+')) return null
  if (!cc && country) {
    try {
      cc = getCountryCallingCode(country.toUpperCase() as CountryCode)
    } catch {
      cc = undefined
    }
  }
  const leading = rest.match(/^\d*/)?.[0] ?? ''
  const trailing = rest.includes('•') ? (rest.match(/\d*$/)?.[0] ?? '') : ''
  return { mask, cc, leading, trailing, hidden: (rest.match(/•/g) ?? []).length }
}

/** Numéro complet (E.164) compatible avec le masque ; il faut au moins deux chiffres visibles. */
export function phoneMatches(m: PhoneMask, phone: string): boolean {
  const p = parsePhoneNumberFromString(phone.trim(), 'FR')
  if (!p) return false
  const nsn = String(p.nationalNumber)
  if (m.cc && m.cc !== String(p.countryCallingCode)) return false
  if (m.leading.length + m.trailing.length < 2 || m.leading.length + m.trailing.length > nsn.length) return false
  return nsn.startsWith(m.leading) && nsn.endsWith(m.trailing)
}

// Pays principal des indicatifs partagés (+44 : Royaume-Uni plutôt que Jersey).
const MAIN_COUNTRY: Record<string, string> = { '7': 'RU', '39': 'IT', '44': 'GB', '47': 'NO', '61': 'AU', '212': 'MA', '262': 'RE', '358': 'FI', '590': 'GP', '599': 'CW' }

/** Nom du pays (ou de la zone) d'un indicatif : `33` donne « France ». */
export function callingCodeLabel(cc: string, lang: 'fr' | 'en'): string {
  if (cc === '1') return lang === 'fr' ? 'Amérique du Nord' : 'North America'
  const countries = getCountries().filter((c) => getCountryCallingCode(c) === cc)
  const main = MAIN_COUNTRY[cc] ?? (countries.length === 1 ? countries[0] : undefined)
  return main ? (countryName(main, lang) ?? '') : ''
}
