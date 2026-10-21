import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { sharedInfrastructure, sharedLabel } from './_hosting'
import { cappedList, compact, isDomain, isIPv4, isIPv6, MAX_LIST_ENTITIES, normalizeDomain, normalizeHost, serviceError, uniq } from './_util'

const KEY = { id: 'urlscan', label: 'URLScan API key', url: 'https://urlscan.io/user/profile/', optional: true }

export interface UrlscanResult {
  task?: { time?: string; url?: string; domain?: string; uuid?: string; visibility?: string }
  page?: {
    url?: string
    domain?: string
    ip?: string
    asn?: string
    asnname?: string
    country?: string
    server?: string
    title?: string
    status?: string
    tlsIssuer?: string
    apexDomain?: string
    redirected?: string
  }
  screenshot?: string
  result?: string
  _id?: string
}

/** Le nom appartient-il à la cible (domaine lui-même ou sous-domaine) ? */
const onTarget = (host: string | undefined, target: string): boolean => !!host && (host === target || host.endsWith(`.${target}`))

export function parseUrlscan(
  target: string,
  results: UrlscanResult[],
  total: number | undefined,
  lang: 'fr' | 'en',
  isIp = false,
  hint: { asn?: unknown; org?: unknown } = {}
): ModuleOutput {
  if (!results.length) return {}
  const fr = lang === 'fr'
  const sorted = [...results].sort((a, b) => (b.task?.time ?? '').localeCompare(a.task?.time ?? ''))
  const entities: OutEntity[] = []
  if (isIp) {
    const latest = sorted[0]
    const domains = uniq(sorted.map((r) => r.page?.domain?.toLowerCase()).filter((v): v is string => !!v && v !== target && isDomain(v)))
    // IP de CDN : les sites qui y sont servis n'ont pas de lien entre eux, ils restent en propriété.
    const shared = sharedInfrastructure(target, { asn: hint.asn ?? latest.page?.asn, org: hint.org ?? latest.page?.asnname })
    if (!shared)
      for (const d of domains.slice(0, MAX_LIST_ENTITIES)) entities.push({ type: 'domain', label: d, linkLabel: fr ? 'site observé sur l’IP' : 'site seen on IP' })
    return {
      properties: compact({
        urlscan_scans: total ?? results.length,
        urlscan_last_scan_at: latest.task?.time ?? null,
        ...cappedList('urlscan_domains', domains),
        shared_infrastructure: shared ? sharedLabel(shared, lang) : null,
        urlscan_search: `https://urlscan.io/search/#${encodeURIComponent(`page.ip:"${target}"`)}`
      }),
      entities,
      raw: sorted.slice(0, 30).map((r) => ({ task: r.task, page: r.page, result: r.result }))
    }
  }
  // La recherche `domain:` remonte aussi les pages tierces qui ont simplement chargé une
  // ressource de la cible : seules les pages servies par la cible renseignent sur elle.
  const own = sorted.filter((r) => onTarget(r.page?.domain?.toLowerCase(), target))
  const latest = own[0] ?? sorted[0]
  if (own.length && latest.page?.url) {
    entities.push({
      type: 'url',
      label: latest.page.url,
      data: compact({
        title: latest.page.title ?? null,
        status_code: latest.page.status ? Number(latest.page.status) : null,
        scanned_at: latest.task?.time ?? null,
        urlscan_report: latest._id ? `https://urlscan.io/result/${latest._id}/` : null
      }) as Record<string, PropValue>,
      image: latest.screenshot,
      linkLabel: fr ? 'dernière capture urlscan' : 'latest urlscan capture'
    })
  }
  const ips = uniq(own.map((r) => r.page?.ip).filter((v): v is string => !!v && v !== target))
  for (const ip of ips.slice(0, MAX_LIST_ENTITIES)) {
    const shared = sharedInfrastructure(ip)
    entities.push({
      type: 'ip',
      label: ip,
      data: shared ? { shared_infrastructure: sharedLabel(shared, lang) } : undefined,
      linkLabel: fr ? 'IP observée' : 'observed IP'
    })
  }
  // Sites tiers qui redirigent vers la cible (souvent des pages de phishing ou de spam).
  const referrers = uniq(
    own
      .map((r) => r.task?.domain?.toLowerCase())
      .filter((d): d is string => !!d && !onTarget(d, target) && isDomain(d))
  )
  for (const d of referrers.slice(0, MAX_LIST_ENTITIES))
    entities.push({ type: 'domain', label: d, linkLabel: fr ? 'redirige vers la cible' : 'redirects to target' })
  const page = own.length ? latest.page : undefined

  return {
    properties: compact({
      urlscan_scans: total ?? results.length,
      urlscan_last_scan_at: own[0]?.task?.time ?? null,
      urlscan_title: page?.title ?? null,
      urlscan_server: page?.server ?? null,
      urlscan_asn: page?.asn ?? null,
      urlscan_tls_issuer: page?.tlsIssuer ?? null,
      ...cappedList('urlscan_ips', ips),
      ...cappedList('urlscan_redirecting_domains', referrers),
      urlscan_search: `https://urlscan.io/search/#${encodeURIComponent(`page.domain:${target}`)}`
    }),
    entities,
    raw: sorted.slice(0, 30).map((r) => ({ task: r.task, page: r.page, result: r.result }))
  }
}

export default defineModule({
  id: 'domain.urlscan',
  name: { fr: 'URLScan.io', en: 'URLScan.io' },
  description: {
    fr: 'Analyses publiques urlscan.io visant ce domaine ou cette IP : dernière capture d’écran, IP et ASN observés, serveur, émetteur TLS, sites tiers qui redirigent vers la cible. Clé facultative (quota plus élevé).',
    en: 'Public urlscan.io scans of this domain or IP: latest screenshot, observed IPs and ASN, server, TLS issuer, third-party sites redirecting to the target. Optional key (higher quota).'
  },
  category: 'domain',
  inputTypes: ['domain', 'ip'],
  keys: [KEY],
  homepage: 'https://urlscan.io',
  async run(input, ctx) {
    const host = input.type === 'ip' ? normalizeHost(input.label) : normalizeDomain(input.label)
    const isIp = isIPv4(host) || isIPv6(host)
    if (!isIp && !isDomain(host)) throw new ModuleError('Domaine ou IP invalide', 'invalid_input')
    // `domain:` couvrirait aussi les pages tierces qui chargent une ressource de la cible.
    const q = isIp ? `page.ip:"${host}"` : `page.domain:${host} OR page.apexDomain:${host}`
    const key = ctx.key(KEY.id)
    let res: { results?: UrlscanResult[]; total?: number }
    try {
      res = await ctx.fetchJson('https://urlscan.io/api/v1/search/', {
        query: { q, size: 100 },
        headers: key ? { 'API-Key': key } : {}
      })
    } catch (e) {
      throw serviceError(e, 'urlscan.io', !!key)
    }
    return parseUrlscan(host, res.results ?? [], res.total, ctx.lang, isIp, { asn: input.data.asn, org: input.data.org ?? input.data.isp })
  }
})
