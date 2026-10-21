// Détection du type d'entité à partir d'une saisie libre.

export interface Detection {
  type: string
  /** Valeur normalisée (téléphone en E.164, domaine sans schéma...). */
  value: string
  platform?: string
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-f:]+$/i
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i
const COORDS = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/
const CVE = /^CVE-\d{4}-\d{4,}$/i
const ASN = /^AS\d{1,10}$/i
const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/

export function normalizePhone(raw: string, defaultCountryCode = '33'): string | null {
  let d = raw.replace(/[\s().-]/g, '')
  if (!/^\+?\d{8,15}$/.test(d)) return null
  if (d.startsWith('+')) return d
  if (d.startsWith('00')) return '+' + d.slice(2)
  if (/^0[1-9]\d{8}$/.test(d)) return '+' + defaultCountryCode + d.slice(1)
  return '+' + d
}

export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rem = 0
  for (const ch of digits) rem = (rem * 10 + Number(ch)) % 97
  return rem === 1
}

export function detectCryptoChain(q: string): string | null {
  if (/^(bc1)[a-z0-9]{25,62}$/.test(q) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(q)) return 'bitcoin'
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) return 'ethereum'
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(q)) return 'tron'
  if (/^(ltc1)[a-z0-9]{25,62}$/.test(q) || /^[LM][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(q)) return 'litecoin'
  if (/^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/.test(q)) return 'dogecoin'
  if (/^4[0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/.test(q)) return 'monero'
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(q)) return 'xrp'
  if (/^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(q)) return 'ton'
  if (/^addr1[a-z0-9]{50,}$/.test(q)) return 'cardano'
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) && !/^\d+$/.test(q)) return 'solana'
  return null
}

export function hashAlgorithm(q: string): string | null {
  if (!/^[a-f0-9]+$/i.test(q)) return null
  switch (q.length) {
    case 32:
      return 'MD5'
    case 40:
      return 'SHA-1'
    case 64:
      return 'SHA-256'
    case 128:
      return 'SHA-512'
    default:
      return null
  }
}

/** Devine le type d'entité correspondant à une saisie. Renvoie `null` si la saisie est vide. */
export function detectEntity(raw: string): Detection | null {
  const q = raw.trim()
  if (!q) return null

  if (EMAIL.test(q)) return { type: 'email', value: q.toLowerCase() }
  if (CVE.test(q)) return { type: 'cve', value: q.toUpperCase() }
  if (ASN.test(q)) return { type: 'asn', value: q.toUpperCase() }
  if (CIDR.test(q)) return { type: 'cidr', value: q }
  if (IPV4.test(q) || (IPV6.test(q) && q.includes(':') && q.split(':').length > 2))
    return { type: 'ip', value: q.toLowerCase() }
  if (MAC.test(q)) return { type: 'mac_address', value: q.toUpperCase().replace(/-/g, ':') }

  const coords = q.match(COORDS)
  if (coords && Math.abs(Number(coords[1])) <= 90 && Math.abs(Number(coords[2])) <= 180)
    return { type: 'coordinates', value: `${Number(coords[1])}, ${Number(coords[2])}` }

  const compact = q.replace(/\s+/g, '').toUpperCase()
  if (isValidIban(compact)) return { type: 'iban', value: compact }

  const algo = hashAlgorithm(q)
  if (algo && algo !== 'SHA-1') return { type: 'hash', value: q.toLowerCase() }

  if (!/\s/.test(q)) {
    const chain = detectCryptoChain(q)
    if (chain && !(chain === 'solana' && /^[a-z]+$/i.test(q)))
      return { type: 'crypto_wallet', value: q, platform: chain }
  }

  const phone = normalizePhone(q)
  if (phone) return { type: 'phone', value: phone }

  if (/^https?:\/\//i.test(q)) {
    try {
      const u = new URL(q)
      if (u.pathname === '/' && !u.search) return { type: 'domain', value: u.hostname.replace(/^www\./, '') }
      return { type: 'url', value: q }
    } catch {
      /* saisie invalide : on continue */
    }
  }

  if (DOMAIN.test(q)) return { type: 'domain', value: q.toLowerCase().replace(/^www\./, '') }

  if (/^[\p{L}'’.-]+(\s+[\p{L}'’.-]+)+$/u.test(q)) return { type: 'person', value: q }

  if (/^@?[\w.-]{2,40}$/.test(q)) return { type: 'username', value: q.replace(/^@/, '') }

  return { type: 'keyword', value: q }
}
