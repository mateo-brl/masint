// Forme canonique des identifiants : deux saisies de la même valeur (« 06 39 98 12 34 » tapé à
// la main et « +33639981234 » trouvé par un module) donnent la même clé de dédoublonnage.
// Les règles sont volontairement prudentes : on ne fusionne que ce qui est strictement
// équivalent (pas de suppression des points Gmail, pas d'hypothèse sur la casse d'une adresse
// crypto hors Ethereum).

import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * Types dont la clé ignore la plateforme : la valeur suffit à identifier l'entité
 * (un email trouvé avec ou sans fournisseur reste le même email).
 */
export const PLATFORM_FREE_TYPES = new Set(['email', 'phone', 'domain', 'ip', 'iban', 'crypto_wallet', 'hash'])

/** Pays par défaut d'un numéro national (même choix que `normalizePhone` dans detect.ts). */
const DEFAULT_COUNTRY = 'FR'

const collapse = (s: string): string => s.trim().replace(/\s+/g, ' ')

/** Numéro au format E.164 (extension comprise), sinon chiffres et « + » seulement. */
export function canonicalPhone(raw: string): string {
  const s = raw.trim()
  const parsed = s ? parsePhoneNumberFromString(s, DEFAULT_COUNTRY) : undefined
  if (parsed && parsed.isPossible()) return parsed.ext ? `${parsed.number};ext=${parsed.ext}` : parsed.number
  const digits = s.replace(/[^\d+]/g, '')
  return digits.startsWith('00') ? `+${digits.slice(2)}` : digits
}

export function canonicalEmail(raw: string): string {
  return raw.replace(/\s+/g, '').toLowerCase()
}

/** Nom d'hôte en minuscules, en ASCII (IDN en punycode), sans point final. */
function canonicalHost(host: string): string {
  let h = host.trim().toLowerCase().replace(/\.+$/, '')
  if (/[^\x20-\x7e]/.test(h)) {
    try {
      h = new URL(`http://${h}`).hostname
    } catch {
      /* nom invalide : gardé tel quel */
    }
  }
  return h
}

/** Domaine : minuscules, sans schéma, chemin, `www.` ni point final. */
export function canonicalDomain(raw: string): string {
  let d = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  d = d.split(/[/?#]/)[0].replace(/:\d+$/, '')
  return canonicalHost(d).replace(/^www\./, '')
}

/** URL : schéma et hôte en minuscules, sans fragment ni `/` final. Le chemin garde sa casse. */
export function canonicalUrl(raw: string): string {
  const s = raw.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      const auth = u.username ? `${u.username}${u.password ? `:${u.password}` : ''}@` : ''
      const host = u.host ? canonicalHost(u.hostname) + (u.port ? `:${u.port}` : '') : ''
      return `${u.protocol}//${auth}${host}${u.pathname}${u.search}`.replace(/\/+$/, '')
    } catch {
      /* URL invalide : traitement textuel ci-dessous */
    }
  }
  const noFragment = s.split('#')[0]
  const m = noFragment.match(/^([a-z][a-z0-9+.-]*:\/\/)?([^/?]*)(.*)$/i)
  if (!m) return noFragment.replace(/\/+$/, '')
  return `${(m[1] ?? '').toLowerCase()}${m[2].toLowerCase()}${m[3]}`.replace(/\/+$/, '')
}

/** Site web : comme avant, sans schéma ni `www.` (le site est son adresse, pas une page). */
export function canonicalWebsite(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/** Adresse IPv6 sous forme compressée (RFC 5952), IPv4 telle quelle. */
export function canonicalIp(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (!s.includes(':')) return s
  const bare = s.replace(/^\[|\]$/g, '')
  // Identifiant de zone (fe80::1%eth0) : non géré par le parseur d'URL, gardé à part.
  const [addr, zone] = bare.split('%')
  const compressed = compressIpv6(addr)
  return compressed ? (zone ? `${compressed}%${zone}` : compressed) : bare
}

/** Forme compressée d'une adresse IPv6, ou `null` si la valeur n'en est pas une. */
export function compressIpv6(addr: string): string | null {
  let s = addr.toLowerCase()
  // Adresse IPv4 en fin (::ffff:192.0.2.1) : convertie en deux groupes hexadécimaux.
  const v4 = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const b = v4.slice(2).map(Number)
    if (b.some((x) => x > 255)) return null
    s = `${v4[1]}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`
  }
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g) ?? []).length > 1) return null
  let groups: string[]
  if (s.includes('::')) {
    const [head, tail] = s.split('::')
    const h = head ? head.split(':') : []
    const t = tail ? tail.split(':') : []
    const missing = 8 - h.length - t.length
    if (missing < 1) return null
    groups = [...h, ...Array<string>(missing).fill('0'), ...t]
  } else groups = s.split(':')
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  const words = groups.map((g) => parseInt(g, 16).toString(16))
  // Plus longue suite de zéros (au moins deux groupes), la première en cas d'égalité.
  let best = -1
  let bestLen = 1
  for (let i = 0; i < 8; ) {
    if (words[i] !== '0') {
      i++
      continue
    }
    let j = i
    while (j < 8 && words[j] === '0') j++
    if (j - i > bestLen) {
      best = i
      bestLen = j - i
    }
    i = j
  }
  if (best < 0) return words.join(':')
  return `${words.slice(0, best).join(':')}::${words.slice(best + bestLen).join(':')}`
}

export function canonicalIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase()
}

/** Adresse crypto : sensible à la casse, sauf les adresses Ethereum (et EVM) mises en minuscules. */
export function canonicalWallet(raw: string): string {
  const s = raw.trim()
  return /^0x[0-9a-f]{40}$/i.test(s) ? s.toLowerCase() : s
}

/** Valeur canonique d'un libellé selon le type d'entité. */
export function canonicalValue(type: string, label: string): string {
  switch (type) {
    case 'phone':
      return canonicalPhone(label)
    case 'email':
      return canonicalEmail(label)
    case 'domain':
      return canonicalDomain(label)
    case 'url':
      return canonicalUrl(label)
    case 'website':
      return canonicalWebsite(label)
    case 'ip':
      return canonicalIp(label)
    case 'iban':
      return canonicalIban(label)
    case 'crypto_wallet':
      return canonicalWallet(label)
    case 'hash':
      return label.trim().toLowerCase()
    case 'username':
    case 'account':
      return collapse(label).toLowerCase().replace(/^@/, '')
    default:
      return collapse(label).toLowerCase()
  }
}

/**
 * Clé de dédoublonnage : `type|plateforme|valeur canonique`. La plateforme est ignorée pour les
 * types identifiés par leur seule valeur ; elle reste pour les comptes, pseudos et autres types.
 */
export function canonicalKey(type: string, label: string, platform?: string | null): string {
  const p = PLATFORM_FREE_TYPES.has(type) ? '' : (platform ?? '')
  return `${type}|${p}|${canonicalValue(type, label)}`
}
