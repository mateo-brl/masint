import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { cappedList, compact, isDomain, MAX_LIST_PROPERTY, normalizeDomain, requireKey, serviceError, uniq } from './_util'

const KEY = { id: 'securitytrails', label: 'SecurityTrails API key', url: 'https://securitytrails.com/app/account/credentials' }
const BASE = 'https://api.securitytrails.com/v1'

export interface StDomain {
  hostname?: string
  alexa_rank?: number | null
  subdomain_count?: number
  current_dns?: {
    a?: { first_seen?: string; values?: Array<{ ip?: string; ip_organization?: string }> }
    aaaa?: { first_seen?: string; values?: Array<{ ipv6?: string; ipv6_organization?: string }> }
    mx?: { values?: Array<{ hostname?: string; priority?: number }> }
    ns?: { values?: Array<{ nameserver?: string; nameserver_organization?: string }> }
    txt?: { values?: Array<{ value?: string }> }
    soa?: { values?: Array<{ email?: string }> }
  }
}

export interface StSubdomains {
  subdomains?: string[]
  subdomain_count?: number
}

export interface StHistory {
  records?: Array<{
    first_seen?: string
    last_seen?: string
    organizations?: string[]
    values?: Array<{ ip?: string; ip_count?: number }>
  }>
}

export function parseSecurityTrails(
  domain: string,
  d: StDomain | null,
  subs: StSubdomains | null,
  history: StHistory | null,
  lang: 'fr' | 'en'
): ModuleOutput {
  if (!d && !subs && !history) return {}
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  const currentIps = (d?.current_dns?.a?.values ?? []).map((v) => v.ip).filter((v): v is string => !!v)
  for (const ip of currentIps.slice(0, 10)) entities.push({ type: 'ip', label: ip, linkLabel: 'A' })

  // Anciennes IP : utiles pour retrouver un serveur d'origine caché derrière un CDN.
  const past: string[] = []
  for (const rec of history?.records ?? []) {
    for (const v of rec.values ?? []) {
      if (!v.ip || currentIps.includes(v.ip) || past.includes(v.ip)) continue
      past.push(v.ip)
      if (past.length <= 20)
        entities.push({
          type: 'ip',
          label: v.ip,
          data: { first_seen: rec.first_seen ?? undefined, last_seen: rec.last_seen ?? undefined, org: rec.organizations?.[0] } as Record<
            string,
            string
          >,
          linkLabel: fr ? 'ancienne IP' : 'past IP'
        })
    }
  }
  const subdomains = uniq((subs?.subdomains ?? []).map((s) => `${s}.${domain}`))
  for (const s of subdomains.slice(0, 30)) entities.push({ type: 'domain', label: s, linkLabel: fr ? 'sous-domaine' : 'subdomain' })

  return {
    properties: compact({
      a: currentIps,
      st_a_first_seen: d?.current_dns?.a?.first_seen ?? null,
      ...cappedList('st_past_ips', past),
      subdomain_count: subs?.subdomain_count ?? d?.subdomain_count ?? null,
      subdomains: subdomains.slice(0, MAX_LIST_PROPERTY),
      st_ip_organizations: uniq((d?.current_dns?.a?.values ?? []).map((v) => v.ip_organization ?? '').filter(Boolean)),
      soa_email: d?.current_dns?.soa?.values?.[0]?.email ?? null
    }),
    entities,
    raw: { domain: d, subdomain_count: subs?.subdomain_count, subdomains: subdomains.slice(0, 1000), history: history?.records?.slice(0, 50) }
  }
}

async function st<T>(ctx: ModuleContext, path: string, key: string): Promise<T | null> {
  try {
    return await ctx.fetchJson<T>(`${BASE}/${path}`, { headers: { APIKEY: key } })
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null
    throw serviceError(e, 'SecurityTrails', true)
  }
}

export default defineModule({
  id: 'domain.securitytrails',
  name: { fr: 'SecurityTrails', en: 'SecurityTrails' },
  description: {
    fr: 'DNS actuel, sous-domaines et historique des adresses IP du domaine (anciens hébergements, serveur d’origine derrière un CDN). Consomme 3 crédits par lancement.',
    en: 'Current DNS, subdomains and IP address history of the domain (past hosting, origin server behind a CDN). Uses 3 credits per run.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  keys: [KEY],
  ondemand: true,
  experimental: true,
  homepage: 'https://securitytrails.com',
  async run(input, ctx) {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    const key = requireKey(ctx, KEY.id, 'SecurityTrails')
    const d = await st<StDomain>(ctx, `domain/${domain}`, key)
    const [subs, history] = await Promise.all([
      st<StSubdomains>(ctx, `domain/${domain}/subdomains?children_only=false&include_inactive=false`, key),
      st<StHistory>(ctx, `history/${domain}/dns/a`, key)
    ])
    return parseSecurityTrails(domain, d, subs, history, ctx.lang)
  }
})
