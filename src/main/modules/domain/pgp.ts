// Adresses du domaine publiées dans les serveurs de clés PGP (keyserver.ubuntu.com, index
// « machine readable »). Une clé ancienne ne prouve pas que l'adresse sert encore : les
// adresses attendent dans « À vérifier ».

import { defineModule, ModuleError, type HttpError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { cappedList, compact, isDomain, isoDate, normalizeDomain, serviceError } from './_util'

const LOOKUP = 'https://keyserver.ubuntu.com/pks/lookup'
const MAX_ENTITIES = 20

export interface PgpUid {
  name: string | null
  email: string | null
}

export interface PgpKey {
  fingerprint: string
  /** Création et expiration, en ISO 8601. */
  created: string | null
  expires: string | null
  revoked: boolean
  uids: PgpUid[]
}

export interface PgpAddress {
  email: string
  name: string | null
  fingerprint: string
  created: string | null
  expires: string | null
  revoked: boolean
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const date = (v: string | undefined): string | null => (v && /^\d+$/.test(v) && Number(v) > 0 ? isoDate(Number(v)) : null)

/** `Nom (commentaire) <adresse>` → nom et adresse ; une adresse seule ou un nom seul aussi. */
export function parseUid(uid: string): PgpUid {
  const s = uid.trim()
  const m = s.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/)
  if (m) {
    const name = m[1].replace(/\s*\([^)]*\)\s*$/, '').trim()
    return { name: name || null, email: m[2].toLowerCase() }
  }
  if (/^[^\s@<>]+@[^\s@<>]+$/.test(s)) return { name: null, email: s.toLowerCase() }
  return { name: s || null, email: null }
}

/**
 * Index « mr » (draft-shaw-openpgp-hkp) : `pub:<empreinte>:<algo>:<taille>:<création>:<expiration>:<drapeaux>`
 * suivi de lignes `uid:<uid encodé en URL>:<création>:<expiration>:<drapeaux>`.
 */
export function parseMachineReadable(text: string): PgpKey[] {
  const keys: PgpKey[] = []
  for (const line of text.split(/\r?\n/)) {
    const f = line.split(':')
    if (f[0] === 'pub' && f[1]) {
      keys.push({ fingerprint: f[1].toUpperCase(), created: date(f[4]), expires: date(f[5]), revoked: /r/i.test(f[6] ?? ''), uids: [] })
    } else if (f[0] === 'uid' && keys.length && f[1]) {
      keys[keys.length - 1].uids.push(parseUid(decode(f[1])))
    }
  }
  return keys
}

/** Adresses du domaine (ou d'un sous-domaine), une par adresse, la clé la plus récente d'abord. */
export function domainAddresses(domain: string, keys: PgpKey[]): PgpAddress[] {
  const best = new Map<string, PgpAddress>()
  for (const key of keys) {
    for (const uid of key.uids) {
      const host = uid.email?.split('@')[1]
      if (!uid.email || !host || !(host === domain || host.endsWith(`.${domain}`))) continue
      const candidate: PgpAddress = { email: uid.email, name: uid.name, fingerprint: key.fingerprint, created: key.created, expires: key.expires, revoked: key.revoked }
      const prev = best.get(uid.email)
      // Une clé valide l'emporte sur une clé révoquée, puis la plus récente.
      const better = !prev || (prev.revoked && !key.revoked) || (prev.revoked === key.revoked && (key.created ?? '') > (prev.created ?? ''))
      if (better) best.set(uid.email, { ...candidate, name: candidate.name ?? prev?.name ?? null })
    }
  }
  return Array.from(best.values()).sort((a, b) => (b.created ?? '').localeCompare(a.created ?? '') || a.email.localeCompare(b.email))
}

export function buildPgpOutput(keys: PgpKey[], addresses: PgpAddress[], lang: 'fr' | 'en'): ModuleOutput {
  if (!addresses.length) return {}
  const fr = lang === 'fr'
  const entities: OutEntity[] = addresses.slice(0, MAX_ENTITIES).map((a) => {
    const year = a.created?.slice(0, 4)
    return {
      type: 'email',
      label: a.email,
      data: compact({
        display_name: a.name,
        pgp_fingerprint: a.fingerprint,
        pgp_key_created_at: a.created,
        pgp_key_expires_at: a.expires,
        pgp_key_revoked: a.revoked || null
      }),
      linkLabel: fr ? 'clé PGP publiée' : 'published PGP key',
      review: true,
      reviewReason: fr
        ? `clé PGP publiée${year ? ` en ${year}` : ''}, adresse peut-être inactive`
        : `PGP key published${year ? ` in ${year}` : ''}, address may be inactive`
    }
  })
  return {
    properties: compact({
      pgp_keys: keys.length,
      ...cappedList('pgp_emails', addresses.map((a) => a.email))
    }),
    entities,
    raw: { keys: keys.length, addresses }
  }
}

export default defineModule({
  id: 'domain.pgp',
  name: { fr: 'Clés PGP du domaine', en: 'Domain PGP keys' },
  description: {
    fr: 'Cherche le domaine dans le serveur de clés PGP keyserver.ubuntu.com : adresses du domaine (ou de ses sous-domaines) qui ont publié une clé, avec le nom porté et la date de la clé. Les 20 plus récentes sont proposées à vérifier : une clé ancienne ne prouve pas que l’adresse sert encore.',
    en: 'Searches the keyserver.ubuntu.com PGP key server for the domain: addresses of the domain (or its subdomains) that published a key, with the name and key date. The 20 most recent are offered for review: an old key does not prove the address is still in use.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  homepage: 'https://keyserver.ubuntu.com',
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    let text: string
    try {
      text = await ctx.fetchText(LOOKUP, { query: { search: domain, op: 'index', options: 'mr' }, timeoutMs: 30000 })
    } catch (e) {
      // Le serveur répond 404 « Not Found » quand aucune clé ne correspond.
      if ((e as Partial<HttpError>).status === 404) return {}
      throw serviceError(e, 'keyserver.ubuntu.com')
    }
    const keys = parseMachineReadable(text)
    return buildPgpOutput(keys, domainAddresses(domain, keys), ctx.lang)
  }
})
