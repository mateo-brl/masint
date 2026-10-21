import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { abuseContacts, optional, prefixOverview, rirCountry } from '../ip/_ripestat'
import { cleanOrg, detectDnsProvider, detectHosting } from './_hosting'
import { countryName, normalizeHost } from './_util'

export interface HostingFacts {
  ips: string[]
  cnames: string[]
  nameservers: string[]
  asn?: number | null
  asnHolder?: string | null
  prefix?: string | null
  country?: string | null
  abuseEmail?: string | null
}

export function buildHostingOutput(f: HostingFacts, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const hosting = detectHosting({ asn: f.asn, org: f.asnHolder, hosts: f.cnames, ips: f.ips })
  const dns = detectDnsProvider(f.nameservers)
  if (!hosting && !dns) return {}
  const entities: OutEntity[] = []
  const country = countryName(f.country, lang)
  if (hosting) {
    entities.push({
      type: 'hosting',
      label: hosting.name,
      platform: hosting.platform,
      data: {
        asn: f.asn ? `AS${f.asn}` : undefined,
        country: country ?? undefined,
        abuse_email: f.abuseEmail ?? undefined
      } as Record<string, PropValue>,
      linkLabel: fr ? 'hébergé chez' : 'hosted by'
    })
  }
  if (dns && !(hosting && dns.platform && dns.platform === hosting.platform)) {
    entities.push({
      type: 'hosting',
      label: dns.name,
      platform: dns.platform,
      linkLabel: fr ? 'DNS géré par' : 'DNS hosted by'
    })
  } else if (dns && hosting) {
    entities[0].linkLabel = fr ? 'hébergé chez (et DNS)' : 'hosted by (and DNS)'
  }
  const properties: Record<string, PropValue> = {
    hosting: hosting?.name ?? null,
    hosting_asn: f.asn ? `AS${f.asn}` : null,
    hosting_network: f.asnHolder ? cleanOrg(f.asnHolder) : null,
    hosting_prefix: f.prefix ?? null,
    hosting_country: country,
    dns_provider: dns?.name ?? null
  }
  for (const k of Object.keys(properties)) if (properties[k] === null) delete properties[k]
  return { properties, entities, raw: f }
}

export default defineModule({
  id: 'domain.hosting',
  name: { fr: 'Hébergeur et fournisseur DNS', en: 'Hosting and DNS provider' },
  description: {
    fr: 'Déduit l’hébergeur du site (OVH, Cloudflare, AWS, Vercel...) à partir des CNAME, des IP et de l’ASN (RIPEstat), et le fournisseur DNS à partir des serveurs de noms.',
    en: 'Infers the website host (OVH, Cloudflare, AWS, Vercel...) from CNAMEs, IPs and ASN (RIPEstat), and the DNS provider from the nameservers.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  async run(input, ctx) {
    const domain = normalizeHost(input.label)
    if (!domain.includes('.')) throw new ModuleError('Domaine invalide', 'invalid_input')
    const safe = (p: Promise<string[]>): Promise<string[]> => p.catch(() => [])
    let [ips, cnames, nameservers] = await Promise.all([
      safe(ctx.resolveDns(domain, 'A')),
      safe(ctx.resolveDns(domain, 'CNAME')),
      safe(ctx.resolveDns(domain, 'NS'))
    ])
    // Domaine nu sans A : le site est souvent servi sur www.
    if (!ips.length && !domain.startsWith('www.')) {
      ;[ips, cnames] = await Promise.all([safe(ctx.resolveDns(`www.${domain}`, 'A')), safe(ctx.resolveDns(`www.${domain}`, 'CNAME'))])
    }
    if (!nameservers.length) {
      const parent = domain.split('.').slice(1).join('.')
      if (parent.includes('.')) nameservers = await safe(ctx.resolveDns(parent, 'NS'))
    }
    const facts: HostingFacts = { ips, cnames, nameservers }
    if (ips.length) {
      const [overview, country, abuse] = await Promise.all([
        prefixOverview(ctx, ips[0]),
        optional(rirCountry(ctx, ips[0])),
        optional(abuseContacts(ctx, ips[0]))
      ])
      const asn = overview.asns?.[0]
      facts.asn = asn?.asn ?? null
      facts.asnHolder = asn?.holder ?? null
      facts.prefix = overview.resource ?? null
      facts.country = country?.located_resources?.[0]?.location ?? null
      facts.abuseEmail = abuse?.abuse_contacts?.[0] ?? null
    }
    return buildHostingOutput(facts, ctx.lang)
  }
})
