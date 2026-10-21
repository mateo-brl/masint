import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cleanOrg, detectHosting } from '../domain/_hosting'
import { compact, countryName, isIPv4, isIPv6, normalizeHost } from '../domain/_util'
import { abuseContacts, optional, prefixOverview, rirCountry, type AbuseContacts, type PrefixOverview, type RirCountry } from './_ripestat'

export function buildIpNetworkOutput(
  ip: string,
  overview: PrefixOverview,
  country: RirCountry | null,
  abuse: AbuseContacts | null,
  lang: 'fr' | 'en'
): ModuleOutput {
  const fr = lang === 'fr'
  const asns = overview.asns ?? []
  const prefix = overview.announced ? overview.resource : null
  if (!asns.length && !prefix) return {}
  const cc = country?.located_resources?.[0]?.location ?? null
  const cname = countryName(cc, lang)
  const abuseEmail = abuse?.abuse_contacts?.[0] ?? null
  const main = asns[0]
  const entities: OutEntity[] = []
  for (const a of asns.slice(0, 3))
    entities.push({
      ref: `as${a.asn}`,
      type: 'asn',
      label: `AS${a.asn}`,
      data: compact({ name: cleanOrg(a.holder), registry: abuse?.authoritative_rir?.toUpperCase() ?? null }) as Record<string, PropValue>,
      linkLabel: fr ? 'annoncée par' : 'announced by'
    })
  if (prefix) entities.push({ type: 'cidr', label: prefix, linkLabel: fr ? 'appartient à' : 'belongs to' })
  const hosting = detectHosting({ asn: main?.asn, org: main?.holder, ips: [ip] })
  if (hosting)
    entities.push({
      type: 'hosting',
      label: hosting.name,
      platform: hosting.platform,
      data: compact({ asn: main ? `AS${main.asn}` : null, country: cname, abuse_email: abuseEmail }) as Record<string, PropValue>,
      linkLabel: fr ? 'opéré par' : 'operated by'
    })
  return {
    properties: compact({
      asn: main ? `AS${main.asn}` : null,
      org: main ? cleanOrg(main.holder) : null,
      prefix,
      rir: abuse?.authoritative_rir?.toUpperCase() ?? null,
      registered_country: cname,
      abuse_email: abuseEmail
    }),
    entities,
    raw: { overview, country, abuse }
  }
}

export default defineModule({
  id: 'ip.ripestat',
  name: { fr: 'ASN, préfixe et contact abus (RIPEstat)', en: 'ASN, prefix and abuse contact (RIPEstat)' },
  description: {
    fr: 'Système autonome (ASN) qui annonce l’IP, préfixe réseau, registre régional, pays d’enregistrement, contact abus et hébergeur reconnu (OVH, AWS, Cloudflare...). Données RIPEstat gratuites.',
    en: 'Autonomous system (ASN) announcing the IP, network prefix, regional registry, registration country, abuse contact and recognised host (OVH, AWS, Cloudflare...). Free RIPEstat data.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://stat.ripe.net',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const [overview, country, abuse] = await Promise.all([
      prefixOverview(ctx, ip),
      optional(rirCountry(ctx, ip)),
      optional(abuseContacts(ctx, ip))
    ])
    return buildIpNetworkOutput(ip, overview, country, abuse, ctx.lang)
  }
})
