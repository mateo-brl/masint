import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, isDomain, isIPv4, isIPv6, isoDate, normalizeDomain, normalizeHost, requireKey, serviceError, uniq } from '../domain/_util'

const KEY = { id: 'shodan', label: 'Shodan API key', url: 'https://account.shodan.io' }

export interface ShodanService {
  port: number
  transport?: string
  product?: string
  version?: string
  timestamp?: string
  data?: string
  cpe23?: string[]
  cpe?: string[]
  _shodan?: { module?: string }
  http?: { title?: string; server?: string }
  ssl?: { cert?: { subject?: { CN?: string }; issuer?: { CN?: string; O?: string } } }
  vulns?: Record<string, { cvss?: number; summary?: string }>
}

export interface ShodanHost {
  ip_str?: string
  ports?: number[]
  hostnames?: string[]
  domains?: string[]
  org?: string
  isp?: string
  asn?: string
  os?: string | null
  country_name?: string
  city?: string
  latitude?: number
  longitude?: number
  tags?: string[]
  vulns?: string[]
  last_update?: string
  data?: ShodanService[]
}

export function parseShodanHost(h: ShodanHost | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!h) return {}
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  const services = [...(h.data ?? [])].sort((a, b) => a.port - b.port)
  for (const s of services.slice(0, 25)) {
    const name = s._shodan?.module ?? s.product ?? s.transport ?? 'tcp'
    entities.push({
      type: 'service',
      label: `${h.ip_str}:${s.port}/${name}`,
      data: compact({
        port: s.port,
        product: [s.product, s.version].filter(Boolean).join(' ') || null,
        banner: s.data ? s.data.slice(0, 1500) : null,
        title: s.http?.title ?? null,
        server: s.http?.server ?? null,
        tls_subject: s.ssl?.cert?.subject?.CN ?? null,
        tls_issuer: s.ssl?.cert?.issuer?.O ?? s.ssl?.cert?.issuer?.CN ?? null,
        last_seen: isoDate(s.timestamp)
      }) as Record<string, PropValue>,
      linkLabel: fr ? 'port ouvert' : 'open port'
    })
  }
  // Détails des CVE (score, résumé) disponibles par service.
  const cveDetails: Record<string, { cvss?: number; summary?: string }> = {}
  for (const s of services) Object.assign(cveDetails, s.vulns ?? {})
  const vulns = uniq([...(h.vulns ?? []), ...Object.keys(cveDetails)]).sort((a, b) => (cveDetails[b]?.cvss ?? 0) - (cveDetails[a]?.cvss ?? 0))
  for (const cve of vulns.slice(0, 20))
    entities.push({
      type: 'cve',
      label: cve.toUpperCase(),
      data: compact({ cvss: cveDetails[cve]?.cvss ?? null, summary: cveDetails[cve]?.summary?.slice(0, 1000) ?? null }) as Record<string, PropValue>,
      linkLabel: fr ? 'vulnérable à' : 'vulnerable to'
    })
  for (const d of uniq([...(h.hostnames ?? []), ...(h.domains ?? [])]).slice(0, 15)) entities.push({ type: 'domain', label: d, linkLabel: 'hostname' })

  return {
    properties: compact({
      ports: (h.ports ?? []).map(String),
      org: h.org ?? null,
      isp: h.isp ?? null,
      asn: h.asn ?? null,
      os: h.os ?? null,
      country: h.country_name ?? null,
      city: h.city ?? null,
      lat: h.latitude ?? null,
      lon: h.longitude ?? null,
      shodan_tags: h.tags ?? [],
      vulns: vulns.slice(0, 200),
      shodan_last_update: isoDate(h.last_update),
      shodan_link: h.ip_str ? `https://www.shodan.io/host/${h.ip_str}` : null
    }),
    entities,
    raw: { ...h, data: services.slice(0, 30).map((s) => ({ ...s, data: s.data?.slice(0, 2000) })) }
  }
}

export interface ShodanDns {
  domain?: string
  tags?: string[]
  subdomains?: string[]
  data?: Array<{ subdomain?: string; type?: string; value?: string; last_seen?: string }>
}

export function parseShodanDns(domain: string, d: ShodanDns | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!d) return {}
  const fr = lang === 'fr'
  const subdomains = uniq((d.subdomains ?? []).filter(Boolean).map((s) => `${s}.${domain}`))
  const ips = uniq((d.data ?? []).filter((r) => r.type === 'A' || r.type === 'AAAA').map((r) => r.value ?? '').filter(Boolean))
  const entities: OutEntity[] = [
    ...subdomains.slice(0, 40).map((s) => ({ type: 'domain', label: s, linkLabel: fr ? 'sous-domaine' : 'subdomain' })),
    ...ips.slice(0, 20).map((ip) => ({ type: 'ip', label: ip, linkLabel: fr ? 'IP (Shodan DNS)' : 'IP (Shodan DNS)' }))
  ]
  if (!entities.length) return {}
  return {
    properties: compact({
      subdomain_count: subdomains.length,
      subdomains: subdomains.slice(0, 1000),
      shodan_dns_tags: d.tags ?? []
    }),
    entities,
    raw: { ...d, data: d.data?.slice(0, 300) }
  }
}

async function shodan<T>(ctx: ModuleContext, path: string): Promise<T | null> {
  const key = requireKey(ctx, KEY.id, 'Shodan')
  try {
    return await ctx.fetchJson<T>(`https://api.shodan.io/${path}`, { query: { key } })
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null
    throw serviceError(e, 'Shodan', true)
  }
}

const shodanHost = defineModule({
  id: 'ip.shodan',
  name: { fr: 'Shodan (hôte)', en: 'Shodan (host)' },
  description: {
    fr: 'Fiche Shodan complète de l’IP : services et bannières par port, produits et versions, vulnérabilités (CVE avec score), noms d’hôtes, système. Ne consomme pas de crédit de recherche.',
    en: 'Full Shodan host record: services and banners per port, products and versions, vulnerabilities (CVE with score), hostnames, OS. Does not use search credits.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  keys: [KEY],
  homepage: 'https://www.shodan.io',
  experimental: true,
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    return parseShodanHost(await shodan<ShodanHost>(ctx, `shodan/host/${ip}`), ctx.lang)
  }
})

const shodanDomain = defineModule({
  id: 'domain.shodan',
  name: { fr: 'Shodan (DNS du domaine)', en: 'Shodan (domain DNS)' },
  description: {
    fr: 'Sous-domaines et enregistrements DNS connus de Shodan pour ce domaine. Consomme 1 crédit de requête.',
    en: 'Subdomains and DNS records known to Shodan for this domain. Uses 1 query credit.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  keys: [KEY],
  ondemand: true,
  homepage: 'https://www.shodan.io',
  experimental: true,
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    return parseShodanDns(domain, await shodan<ShodanDns>(ctx, `dns/domain/${domain}`), ctx.lang)
  }
})

export const modules = [shodanHost, shodanDomain]
