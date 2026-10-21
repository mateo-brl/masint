import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, isIPv4, isIPv6, isoDate, localizeCountry, normalizeHost, requireKey, serviceError, uniq } from '../domain/_util'

const KEY = { id: 'abuseipdb', label: 'AbuseIPDB API key', url: 'https://www.abuseipdb.com/account/api' }

// Catégories officielles AbuseIPDB (https://www.abuseipdb.com/categories).
const CATEGORIES: Record<number, string> = {
  1: 'DNS Compromise',
  2: 'DNS Poisoning',
  3: 'Fraud Orders',
  4: 'DDoS Attack',
  5: 'FTP Brute-Force',
  6: 'Ping of Death',
  7: 'Phishing',
  8: 'Fraud VoIP',
  9: 'Open Proxy',
  10: 'Web Spam',
  11: 'Email Spam',
  12: 'Blog Spam',
  13: 'VPN IP',
  14: 'Port Scan',
  15: 'Hacking',
  16: 'SQL Injection',
  17: 'Spoofing',
  18: 'Brute-Force',
  19: 'Bad Web Bot',
  20: 'Exploited Host',
  21: 'Web App Attack',
  22: 'SSH',
  23: 'IoT Targeted'
}

export interface AbuseIpDbCheck {
  ipAddress?: string
  isPublic?: boolean
  isWhitelisted?: boolean | null
  abuseConfidenceScore?: number
  countryCode?: string
  countryName?: string
  usageType?: string
  isp?: string
  domain?: string
  hostnames?: string[]
  isTor?: boolean
  totalReports?: number
  numDistinctUsers?: number
  lastReportedAt?: string | null
  reports?: Array<{ reportedAt?: string; comment?: string; categories?: number[]; reporterCountryCode?: string }>
}

export function parseAbuseIpDb(d: AbuseIpDbCheck | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!d?.ipAddress) return {}
  const fr = lang === 'fr'
  const categories = uniq((d.reports ?? []).flatMap((r) => r.categories ?? [])).map((c) => CATEGORIES[c] ?? String(c))
  const entities: OutEntity[] = []
  if (d.domain && d.domain !== d.ipAddress) entities.push({ type: 'domain', label: d.domain, linkLabel: fr ? 'domaine du FAI' : 'ISP domain' })
  for (const h of (d.hostnames ?? []).slice(0, 5)) entities.push({ type: 'domain', label: h, linkLabel: 'hostname' })
  return {
    properties: compact({
      abuse_score: d.abuseConfidenceScore ?? null,
      abuse_reports: d.totalReports ?? 0,
      abuse_reporters: d.numDistinctUsers ?? null,
      abuse_last_reported_at: isoDate(d.lastReportedAt),
      abuse_categories: categories,
      abuse_recent_comments: (d.reports ?? [])
        .map((r) => r.comment?.trim())
        .filter((c): c is string => !!c)
        .slice(0, 10)
        .map((c) => c.slice(0, 300)),
      usage_type: d.usageType ?? null,
      isp: d.isp ?? null,
      country: localizeCountry(d.countryName, d.countryCode, lang),
      tor_exit: d.isTor ?? null,
      is_whitelisted: d.isWhitelisted ?? null,
      abuseipdb_link: `https://www.abuseipdb.com/check/${d.ipAddress}`
    }),
    entities,
    raw: { ...d, reports: d.reports?.slice(0, 20) }
  }
}

export default defineModule({
  id: 'ip.abuseipdb',
  name: { fr: 'AbuseIPDB', en: 'AbuseIPDB' },
  description: {
    fr: 'Score de confiance d’abus, nombre de signalements sur 90 jours, catégories (scan, brute-force, spam, phishing...), type d’usage (FAI, datacenter, VPN) et commentaires récents.',
    en: 'Abuse confidence score, number of reports over 90 days, categories (scan, brute-force, spam, phishing...), usage type (ISP, datacenter, VPN) and recent comments.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  keys: [KEY],
  homepage: 'https://www.abuseipdb.com',
  experimental: true,
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const key = requireKey(ctx, KEY.id, 'AbuseIPDB')
    let res: { data?: AbuseIpDbCheck }
    try {
      res = await ctx.fetchJson('https://api.abuseipdb.com/api/v2/check', {
        query: { ipAddress: ip, maxAgeInDays: 90, verbose: '' },
        headers: { Key: key }
      })
    } catch (e) {
      throw serviceError(e, 'AbuseIPDB', true)
    }
    return parseAbuseIpDb(res.data ?? null, ctx.lang)
  }
})
