import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cleanOrg, detectHosting, parseAsn } from '../domain/_hosting'
import { compact, countryName } from '../domain/_util'
import {
  abuseContacts,
  announcedPrefixes,
  asOverview,
  optional,
  rirCountry,
  type AbuseContacts,
  type AnnouncedPrefixes,
  type AsOverview,
  type RirCountry
} from './_ripestat'

const MAX_PREFIX_ENTITIES = 30
const MAX_PREFIX_LISTED = 500

/** Tri des préfixes : IPv4 d'abord, puis les plus larges. */
function byImportance(a: string, b: string): number {
  const v6a = a.includes(':')
  const v6b = b.includes(':')
  if (v6a !== v6b) return v6a ? 1 : -1
  return Number(a.split('/')[1]) - Number(b.split('/')[1]) || a.localeCompare(b, 'en', { numeric: true })
}

export function buildAsnOutput(
  asn: number,
  overview: AsOverview,
  prefixes: AnnouncedPrefixes | null,
  country: RirCountry | null,
  abuse: AbuseContacts | null,
  lang: 'fr' | 'en'
): ModuleOutput {
  const fr = lang === 'fr'
  if (!overview.holder) return {}
  const list = Array.from(new Set((prefixes?.prefixes ?? []).map((p) => p.prefix))).sort(byImportance)
  const v4 = list.filter((p) => !p.includes(':'))
  const v6 = list.filter((p) => p.includes(':'))
  const ipv4Count = v4.reduce((sum, p) => sum + 2 ** (32 - Number(p.split('/')[1])), 0)
  const cc = country?.located_resources?.[0]?.location ?? null
  const cname = countryName(cc, lang)
  const holder = cleanOrg(overview.holder)
  const abuseEmail = abuse?.abuse_contacts?.[0] ?? null

  const entities: OutEntity[] = []
  const hosting = detectHosting({ asn, org: overview.holder })
  if (hosting?.platform)
    entities.push({
      type: 'hosting',
      label: hosting.name,
      platform: hosting.platform,
      data: compact({ asn: `AS${asn}`, country: cname, abuse_email: abuseEmail }) as Record<string, PropValue>,
      linkLabel: fr ? 'opéré par' : 'operated by'
    })
  else
    entities.push({
      type: 'organization',
      label: holder,
      data: compact({ country: cname, kind: fr ? 'Opérateur réseau' : 'Network operator' }) as Record<string, PropValue>,
      linkLabel: fr ? 'détenu par' : 'held by'
    })
  for (const p of list.slice(0, MAX_PREFIX_ENTITIES)) entities.push({ type: 'cidr', label: p, linkLabel: fr ? 'annonce' : 'announces' })

  return {
    properties: compact({
      name: holder,
      country: cname,
      registry: abuse?.authoritative_rir?.toUpperCase() ?? overview.block?.desc ?? null,
      announced: overview.announced ?? null,
      abuse_email: abuseEmail,
      prefixes_v4: v4.length,
      prefixes_v6: v6.length,
      ipv4_addresses: ipv4Count || null,
      prefixes: list.slice(0, MAX_PREFIX_LISTED),
      bgp_link: `https://bgp.he.net/AS${asn}`
    }),
    entities,
    raw: { overview, country, abuse, prefixes: list.slice(0, 2000) }
  }
}

export default defineModule({
  id: 'asn.info',
  name: { fr: 'Informations ASN (RIPEstat)', en: 'ASN information (RIPEstat)' },
  description: {
    fr: 'Nom du détenteur, pays, registre, contact abus et préfixes IP annoncés par le système autonome (30 premiers en entités, liste complète en propriétés). Hébergeur reconnu quand c’est le cas.',
    en: 'Holder name, country, registry, abuse contact and IP prefixes announced by the autonomous system (first 30 as entities, full list in properties). Recognised host when applicable.'
  },
  category: 'ip',
  inputTypes: ['asn'],
  homepage: 'https://stat.ripe.net',
  async run(input, ctx) {
    const asn = parseAsn(input.label)
    if (!asn) throw new ModuleError('Numéro d’AS invalide', 'invalid_input')
    const resource = `AS${asn}`
    const [overview, prefixes, country, abuse] = await Promise.all([
      asOverview(ctx, resource),
      optional(announcedPrefixes(ctx, resource)),
      optional(rirCountry(ctx, resource)),
      optional(abuseContacts(ctx, resource))
    ])
    return buildAsnOutput(asn, overview, prefixes, country, abuse, ctx.lang)
  }
})
