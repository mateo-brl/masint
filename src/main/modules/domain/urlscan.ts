import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, isDomain, isIPv4, isIPv6, normalizeDomain, normalizeHost, serviceError, uniq } from './_util'

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

export function parseUrlscan(
  target: string,
  results: UrlscanResult[],
  total: number | undefined,
  lang: 'fr' | 'en',
  isIp = false
): ModuleOutput {
  if (!results.length) return {}
  const fr = lang === 'fr'
  const sorted = [...results].sort((a, b) => (b.task?.time ?? '').localeCompare(a.task?.time ?? ''))
  const latest = sorted.find((r) => r.page?.domain?.endsWith(target)) ?? sorted[0]
  const entities: OutEntity[] = []
  if (isIp) {
    const domains = uniq(sorted.map((r) => r.page?.domain).filter((v): v is string => !!v && v !== target))
    for (const d of domains.slice(0, 20)) entities.push({ type: 'domain', label: d, linkLabel: fr ? 'site observé sur l’IP' : 'site seen on IP' })
    return {
      properties: compact({
        urlscan_scans: total ?? results.length,
        urlscan_last_scan_at: latest.task?.time ?? null,
        urlscan_domains: domains.slice(0, 100),
        urlscan_search: `https://urlscan.io/search/#${encodeURIComponent(`page.ip:"${target}"`)}`
      }),
      entities,
      raw: sorted.slice(0, 30).map((r) => ({ task: r.task, page: r.page, result: r.result }))
    }
  }
  if (latest.page?.url) {
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
  const ips = uniq(sorted.map((r) => r.page?.ip).filter((v): v is string => !!v && v !== target))
  for (const ip of ips.slice(0, 10)) entities.push({ type: 'ip', label: ip, linkLabel: fr ? 'IP observée' : 'observed IP' })
  // Sites tiers qui redirigent vers la cible (souvent des pages de phishing ou de spam).
  const referrers = uniq(
    sorted
      .filter((r) => r.task?.domain && r.page?.domain && r.task.domain !== r.page.domain && !r.task.domain.endsWith(target))
      .map((r) => r.task!.domain!)
  )
  for (const d of referrers.slice(0, 10)) entities.push({ type: 'domain', label: d, linkLabel: fr ? 'redirige vers la cible' : 'redirects to target' })

  return {
    properties: compact({
      urlscan_scans: total ?? results.length,
      urlscan_last_scan_at: latest.task?.time ?? null,
      urlscan_title: latest.page?.title ?? null,
      urlscan_server: latest.page?.server ?? null,
      urlscan_asn: latest.page?.asn ?? null,
      urlscan_tls_issuer: latest.page?.tlsIssuer ?? null,
      urlscan_ips: ips.slice(0, 50),
      urlscan_redirecting_domains: referrers.slice(0, 50),
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
    const q = isIp ? `page.ip:"${host}"` : `domain:${host}`
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
    return parseUrlscan(host, res.results ?? [], res.total, ctx.lang, isIp)
  }
})
