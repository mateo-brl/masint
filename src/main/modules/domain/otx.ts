import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { sharedInfrastructure, sharedLabel } from './_hosting'
import { cappedList, compact, isDomain, isIPv4, isIPv6, isoDate, MAX_LIST_ENTITIES, normalizeDomain, normalizeHost, serviceError, uniq } from './_util'

const KEY = { id: 'otx', label: 'AlienVault OTX API key', url: 'https://otx.alienvault.com/api', optional: true }
const BASE = 'https://otx.alienvault.com/api/v1/indicators'

export interface OtxGeneral {
  pulse_info?: {
    count?: number
    pulses?: OtxPulse[]
  }
  validation?: Array<{ source?: string; message?: string; name?: string }>
  false_positive?: unknown[]
}

interface OtxPulse {
  name?: string
  tags?: string[]
  created?: string
  modified?: string
  malware_families?: Array<{ display_name?: string } | string>
  adversary?: string
}

export interface OtxPassiveDns {
  count?: number
  passive_dns?: Array<{ address?: string; hostname?: string; first?: string; last?: string; record_type?: string; asn?: string }>
}

/** OTX classe l'indicateur comme légitime (liste blanche, domaine populaire) ou faux positif. */
export function otxWhitelisted(g: OtxGeneral | null): boolean {
  if (g?.false_positive?.length) return true
  return (g?.validation ?? []).some((v) => /whitelist|allowlist|popular|false positive/i.test(`${v.name ?? ''} ${v.message ?? ''} ${v.source ?? ''}`))
}

const pulseDate = (p: OtxPulse): string => p.modified ?? p.created ?? ''

/** Synthèse des « pulses » (rapports de menace communautaires) citant l'indicateur. */
function pulseProperties(g: OtxGeneral | null): Record<string, PropValue> {
  const pulses = [...(g?.pulse_info?.pulses ?? [])].sort((a, b) => pulseDate(b).localeCompare(pulseDate(a)))
  const whitelisted = otxWhitelisted(g)
  const families = uniq(
    pulses.flatMap((p) => (p.malware_families ?? []).map((m) => (typeof m === 'string' ? m : (m.display_name ?? '')))).filter(Boolean)
  )
  const base = {
    otx_pulses: g?.pulse_info?.count ?? null,
    otx_whitelisted: whitelisted || null,
    otx_validation: uniq((g?.validation ?? []).map((v) => v.message ?? v.source ?? '').filter(Boolean)).slice(0, 5)
  }
  // Indicateur légitime : il est cité dans des listes d'IOC génériques, tags et familles n'ont pas de sens.
  if (whitelisted) return compact({ ...base, otx_pulse_names: uniq(pulses.map((p) => p.name ?? '').filter(Boolean)).slice(0, 5) })
  return compact({
    ...base,
    otx_pulse_names: uniq(pulses.map((p) => p.name ?? '').filter(Boolean)).slice(0, 10),
    otx_last_pulse_at: isoDate(pulses[0] ? pulseDate(pulses[0]) : null),
    otx_tags: uniq(pulses.flatMap((p) => p.tags ?? [])).slice(0, 20),
    otx_malware_families: families.slice(0, 10),
    otx_adversaries: uniq(pulses.map((p) => p.adversary ?? '').filter(Boolean)).slice(0, 5)
  })
}

/**
 * `hint` : ASN / organisation de l'IP déjà connus (propriétés de l'entité), pour reconnaître
 * un CDN dont les plages ne sont pas publiées.
 */
export function parseOtx(
  indicator: string,
  kind: 'domain' | 'ip',
  general: OtxGeneral | null,
  pdns: OtxPassiveDns | null,
  lang: 'fr' | 'en',
  hint: { asn?: unknown; org?: unknown } = {}
): ModuleOutput {
  const fr = lang === 'fr'
  // Les résolutions les plus récentes d'abord : ce sont les plus pertinentes.
  const rows = [...(pdns?.passive_dns ?? [])].sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))
  const values: string[] = []
  const byValue = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const value = (kind === 'domain' ? r.address : r.hostname)?.toLowerCase()
    if (!value || byValue.has(value) || value === indicator) continue
    if (kind === 'domain' && !(isIPv4(value) || isIPv6(value))) continue
    if (kind === 'ip' && !isDomain(value)) continue
    byValue.set(value, r)
    values.push(value)
  }
  // IP de CDN ou résolveur public : les domaines qui y ont pointé n'ont aucun lien entre eux.
  const shared = kind === 'ip' ? sharedInfrastructure(indicator, { asn: hint.asn ?? rows.find((r) => r.asn)?.asn, org: hint.org }) : null
  const entities: OutEntity[] = shared
    ? []
    : values.slice(0, MAX_LIST_ENTITIES).map((value) => {
        const r = byValue.get(value)!
        return {
          type: kind === 'domain' ? 'ip' : 'domain',
          label: value,
          data: compact({ first_seen: isoDate(r.first), last_seen: isoDate(r.last) }) as Record<string, PropValue>,
          linkLabel: fr ? 'DNS passif' : 'passive DNS'
        }
      })
  const properties: Record<string, PropValue> = {
    ...pulseProperties(general),
    ...compact({
      otx_passive_dns_count: pdns?.count ?? null,
      ...cappedList(kind === 'domain' ? 'otx_resolved_ips' : 'otx_hostnames', values),
      shared_infrastructure: shared ? sharedLabel(shared, lang) : null,
      otx_link: `https://otx.alienvault.com/indicator/${kind === 'domain' ? 'domain' : 'ip'}/${indicator}`
    })
  }
  if (!entities.length && !general?.pulse_info?.count && !pdns?.count) return {}
  const pulses = (general?.pulse_info?.pulses ?? []).slice(0, 50).map((p) => ({
    name: p.name,
    created: p.created,
    modified: p.modified,
    tags: p.tags?.slice(0, 10),
    malware_families: p.malware_families?.slice(0, 10),
    adversary: p.adversary
  }))
  return {
    properties,
    entities,
    raw: {
      general: { pulse_info: { count: general?.pulse_info?.count, pulses }, validation: general?.validation },
      passive_dns: rows.slice(0, 200)
    }
  }
}

async function otx<T>(ctx: ModuleContext, path: string): Promise<T | null> {
  const key = ctx.key(KEY.id)
  try {
    return await ctx.fetchJson<T>(`${BASE}/${path}`, { headers: key ? { 'X-OTX-API-KEY': key } : {}, timeoutMs: 40000 })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 404 || status === 400) return null
    if (status === 429 && !key) throw new ModuleError('OTX : accès anonyme limité, ajoutez une clé API', 'rate_limited')
    throw serviceError(e, 'AlienVault OTX', !!key)
  }
}

/** Les deux sections sont indépendantes : une seule réponse suffit (OTX est parfois très lent). */
async function both<A, B>(a: Promise<A | null>, b: Promise<B | null>): Promise<[A | null, B | null]> {
  const [ra, rb] = await Promise.allSettled([a, b])
  if (ra.status === 'rejected' && rb.status === 'rejected') throw ra.reason
  return [ra.status === 'fulfilled' ? ra.value : null, rb.status === 'fulfilled' ? rb.value : null]
}

const otxDomain = defineModule({
  id: 'domain.otx',
  name: { fr: 'AlienVault OTX (domaine)', en: 'AlienVault OTX (domain)' },
  description: {
    fr: 'Rapports de menace communautaires citant le domaine (pulses, malwares, tags) et historique DNS passif (IP sur lesquelles il a pointé). Clé facultative, recommandée.',
    en: 'Community threat reports mentioning the domain (pulses, malware, tags) and passive DNS history (IPs it pointed to). Optional key, recommended.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  keys: [KEY],
  homepage: 'https://otx.alienvault.com',
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    const section = domain.split('.').length > 2 ? 'hostname' : 'domain'
    const [general, pdns] = await both(
      otx<OtxGeneral>(ctx, `${section}/${domain}/general`),
      otx<OtxPassiveDns>(ctx, `${section}/${domain}/passive_dns`)
    )
    return parseOtx(domain, 'domain', general, pdns, ctx.lang)
  }
})

const otxIp = defineModule({
  id: 'ip.otx',
  name: { fr: 'AlienVault OTX (IP)', en: 'AlienVault OTX (IP)' },
  description: {
    fr: 'Rapports de menace communautaires citant l’IP (scanner, Tor, botnet...) et DNS passif : domaines qui ont pointé vers cette adresse (10 plus récents en entités, aucun pour une IP de CDN ou de DNS public). Clé facultative.',
    en: 'Community threat reports mentioning the IP (scanner, Tor, botnet...) and passive DNS: domains that pointed to this address (10 most recent as entities, none for a CDN or public DNS IP). Optional key.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  keys: [KEY],
  homepage: 'https://otx.alienvault.com',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    const family = isIPv4(ip) ? 'IPv4' : isIPv6(ip) ? 'IPv6' : null
    if (!family) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const [general, pdns] = await both(
      otx<OtxGeneral>(ctx, `${family}/${ip}/general`),
      otx<OtxPassiveDns>(ctx, `${family}/${ip}/passive_dns`)
    )
    return parseOtx(ip, 'ip', general, pdns, ctx.lang, { asn: input.data.asn, org: input.data.org ?? input.data.isp })
  }
})

export const modules = [otxDomain, otxIp]
