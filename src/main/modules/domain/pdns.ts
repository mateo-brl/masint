// Historique DNS passif de Mnemonic (api.mnemonic.no), public et sans clé (1 000 requêtes
// par jour) : anciennes IP d'un domaine, ou noms qui ont pointé vers une IP.

import { defineModule, ModuleError, type HttpError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { sharedInfrastructure, sharedLabel } from './_hosting'
import { cappedList, compact, isDomain, isIPv4, isIPv6, isoDate, MAX_LIST_ENTITIES, normalizeHost, serviceError } from './_util'

const API = 'https://api.mnemonic.no/pdns/v3'
const LIMIT = 100
/** Noms tirés d'une IP : au-delà de 50, l'adresse est mutualisée (hébergement partagé, CDN). */
const MAX_IP_NAMES = 15
const SHARED_THRESHOLD = 50

export interface MnemonicRecord {
  query?: string
  answer?: string
  rrtype?: string
  rrclass?: string
  firstSeenTimestamp?: number
  lastSeenTimestamp?: number
  times?: number
}

export interface MnemonicResponse {
  responseCode?: number
  count?: number
  data?: MnemonicRecord[]
}

interface Seen {
  value: string
  first: number
  last: number
}

const clean = (s: string | undefined): string => (s ?? '').trim().toLowerCase().replace(/\.$/, '')
const day = (ms: number): string => (isoDate(ms) ?? '').slice(0, 10)
/** « valeur (2016-01-15 → 2018-04-05) » : lisible dans une liste de la fiche. */
const span = (s: Seen): string => `${s.value} (${day(s.first)} → ${day(s.last)})`

/** Regroupe les enregistrements par valeur, en gardant la première et la dernière observation. */
function group(records: MnemonicRecord[], pick: (r: MnemonicRecord) => string | null): Seen[] {
  const out = new Map<string, Seen>()
  for (const r of records) {
    const value = pick(r)
    if (!value) continue
    const first = r.firstSeenTimestamp ?? r.lastSeenTimestamp ?? 0
    const last = r.lastSeenTimestamp ?? first
    const prev = out.get(value)
    if (!prev) out.set(value, { value, first, last })
    else out.set(value, { value, first: Math.min(prev.first, first), last: Math.max(prev.last, last) })
  }
  // Les plus récemment vus d'abord.
  return Array.from(out.values()).sort((a, b) => b.last - a.last)
}

const seenData = (s: Seen): Record<string, PropValue> => compact({ first_seen: isoDate(s.first), last_seen: isoDate(s.last) })

/** Domaine : anciennes IP (A, AAAA) en entités, CNAME, MX et NS historiques en propriétés. */
export function parseDomainPdns(domain: string, res: MnemonicResponse | null, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const all = res?.data ?? []
  const own = all.filter((r) => clean(r.query) === domain)
  const ofType = (...types: string[]): MnemonicRecord[] => own.filter((r) => types.includes(clean(r.rrtype)))
  const ips = group(ofType('a', 'aaaa'), (r) => {
    const v = clean(r.answer)
    return isIPv4(v) || isIPv6(v) ? v : null
  })
  const host = (r: MnemonicRecord): string | null => {
    const v = clean(r.answer).replace(/^\d+\s+/, '')
    return isDomain(v) ? v : null
  }
  const cnames = group(ofType('cname'), host)
  const mx = group(ofType('mx'), host)
  const ns = group(ofType('ns'), host)
  // Autres noms dont le CNAME désignait ce domaine (miroir, campagne, hameçonnage possible).
  const cnamedBy = group(
    all.filter((r) => clean(r.rrtype) === 'cname' && clean(r.answer) === domain),
    (r) => (isDomain(clean(r.query)) ? clean(r.query) : null)
  )
  if (!ips.length && !cnames.length && !mx.length && !ns.length && !cnamedBy.length) return {}

  // Une IP de CDN ou d'infrastructure partagée n'apprend rien sur le propriétaire : propriété seulement.
  const dedicated = ips.filter((s) => !sharedInfrastructure(s.value))
  const entities: OutEntity[] = dedicated.slice(0, MAX_LIST_ENTITIES).map((s) => ({
    type: 'ip',
    label: s.value,
    data: { ...seenData(s), version: isIPv4(s.value) ? 'IPv4' : 'IPv6' },
    linkLabel: fr ? 'a résolu vers' : 'resolved to'
  }))
  const firsts = [...ips, ...cnames, ...mx, ...ns].map((s) => s.first).filter((t) => t > 0)
  return {
    properties: compact({
      pdns_first_seen: firsts.length ? isoDate(Math.min(...firsts)) : null,
      ...cappedList('pdns_ips', ips.map(span)),
      pdns_shared_ips: ips.filter((s) => sharedInfrastructure(s.value)).map((s) => `${s.value} (${sharedLabel(sharedInfrastructure(s.value)!, lang)})`),
      ...cappedList('pdns_cnames', cnames.map(span)),
      ...cappedList('pdns_mx', mx.map(span)),
      ...cappedList('pdns_ns', ns.map(span)),
      ...cappedList('pdns_cnamed_by', cnamedBy.map(span)),
      pdns_records: res?.count ?? all.length
    }),
    entities,
    raw: { count: res?.count, data: all.slice(0, LIMIT) }
  }
}

/** IP : noms qui y ont pointé (A, AAAA), en entités sauf pour une adresse mutualisée. */
export function parseIpPdns(ip: string, res: MnemonicResponse | null, lang: 'fr' | 'en', hint: { asn?: unknown; org?: unknown } = {}): ModuleOutput {
  const fr = lang === 'fr'
  const all = res?.data ?? []
  const names = group(
    all.filter((r) => ['a', 'aaaa'].includes(clean(r.rrtype)) && clean(r.answer) === ip),
    (r) => (isDomain(clean(r.query)) ? clean(r.query) : null)
  )
  if (!names.length) return {}
  const shared = sharedInfrastructure(ip, hint)
  const crowded = Math.max(res?.count ?? 0, names.length) > SHARED_THRESHOLD
  const entities: OutEntity[] =
    shared || crowded
      ? []
      : names.slice(0, MAX_IP_NAMES).map((s) => ({
          type: 'domain',
          label: s.value,
          data: seenData(s),
          linkLabel: fr ? 'historique DNS' : 'DNS history'
        }))
  return {
    properties: compact({
      ...cappedList('pdns_hostnames', names.map(span)),
      shared_infrastructure: shared ? sharedLabel(shared, lang) : crowded ? (fr ? 'adresse mutualisée (plus de 50 noms)' : 'shared address (over 50 names)') : null,
      pdns_records: res?.count ?? all.length
    }),
    entities,
    raw: { count: res?.count, data: all.slice(0, LIMIT) }
  }
}

async function lookup(ctx: ModuleContext, value: string): Promise<MnemonicResponse | null> {
  try {
    // Valeur déjà validée (domaine ou IP) : placée telle quelle dans le chemin, comme dans la documentation.
    return await ctx.fetchJson<MnemonicResponse>(`${API}/${value}`, { query: { limit: LIMIT }, timeoutMs: 30000 })
  } catch (e) {
    const status = (e as Partial<HttpError>).status
    if (status === 404) return null
    // Quota public dépassé (1 000 requêtes par jour) : 402 ou 429 selon les cas.
    if (status === 402 || status === 429) throw new ModuleError('Mnemonic : quota quotidien dépassé, réessayer demain', 'rate_limited')
    throw serviceError(e, 'Mnemonic')
  }
}

export default defineModule({
  id: 'domain.pdns',
  name: { fr: 'Historique DNS (Mnemonic)', en: 'DNS history (Mnemonic)' },
  description: {
    fr: 'DNS passif public de Mnemonic, sans clé : pour un domaine, les IP sur lesquelles il a pointé depuis des années (10 en entités, avec première et dernière observation ; celles d’un CDN restent en propriété) et ses anciens CNAME, MX et NS ; pour une IP, les noms qui y ont pointé (15 en entités, aucun pour une adresse mutualisée).',
    en: 'Mnemonic public passive DNS, no key: for a domain, the IPs it pointed to over the years (10 as entities, with first and last seen; CDN ones stay as properties) and its former CNAME, MX and NS; for an IP, the names that pointed to it (15 as entities, none for a shared address).'
  },
  category: 'domain',
  inputTypes: ['domain', 'ip'],
  homepage: 'https://docs.mnemonic.no/service-integration-guides/passivedns/docs/public/01-public_api.html',
  async run(input, ctx) {
    const value = normalizeHost(input.label)
    if (input.type === 'ip') {
      if (!isIPv4(value) && !isIPv6(value)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
      return parseIpPdns(value, await lookup(ctx, value), ctx.lang, { asn: input.data.asn, org: input.data.org ?? input.data.isp })
    }
    const domain = value.replace(/^www\./, '')
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    return parseDomainPdns(domain, await lookup(ctx, domain), ctx.lang)
  }
})
