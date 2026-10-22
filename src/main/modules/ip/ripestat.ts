import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cleanOrg, detectHosting, sharedInfrastructure, sharedLabel } from '../domain/_hosting'
import { compact, countryName, isIPv4, isIPv6, isoDate, normalizeHost, uniq } from '../domain/_util'
import { cymruOrigin, type CymruOrigin } from './_cymru'
import {
  abuseContacts,
  optional,
  prefixOverview,
  ripeOrgName,
  rirCountry,
  rpkiValidation,
  whois,
  type AbuseContacts,
  type PrefixOverview,
  type RirCountry,
  type RpkiValidation,
  type Whois
} from './_ripestat'

/** Bloc d'adresses tel que déclaré au registre (objet `inetnum` du RIPE, `NetRange` de l'ARIN...). */
export interface Netblock {
  range: string | null
  netname: string | null
  /** Identifiant d'organisation du registre (`ORG-OS3-RIPE`), à résoudre en nom. */
  orgHandle: string | null
  /** Nom de l'organisation quand le registre le donne directement (ARIN, LACNIC). */
  orgName: string | null
  mntBy: string[]
  country: string | null
  status: string | null
  created: string | null
  descr: string[]
}

/** Lit la réponse `whois` de RIPEstat, quel que soit le registre (champs RIPE, ARIN ou LACNIC). */
export function parseWhois(w: Whois | null): Netblock | null {
  const records = (w?.records ?? []).map((r) => {
    const m = new Map<string, string[]>()
    for (const { key, value } of r) {
      const k = key.toLowerCase()
      const v = (value ?? '').trim()
      if (v) m.set(k, [...(m.get(k) ?? []), v])
    }
    return m
  })
  const net = records.find((r) => r.has('inetnum') || r.has('inet6num') || r.has('netrange') || r.has('cidr'))
  if (!net) return null
  const first = (k: string): string | null => net.get(k)?.[0] ?? null
  const anywhere = (k: string): string | null => records.find((r) => r.has(k))?.get(k)?.[0] ?? null
  // ARIN : « Google LLC (GOGL) ».
  const arinOrg = first('organization')?.replace(/\s*\([A-Z0-9-]+\)$/, '') ?? null
  return {
    range: first('inetnum') ?? first('inet6num') ?? first('cidr') ?? first('netrange'),
    netname: first('netname'),
    orgHandle: first('org'),
    orgName: arinOrg ?? anywhere('orgname') ?? first('owner'),
    mntBy: uniq(net.get('mnt-by') ?? []),
    country: first('country') ?? anywhere('country'),
    status: first('status') ?? first('nettype'),
    created: first('created') ?? first('regdate'),
    descr: (net.get('descr') ?? []).slice(0, 5)
  }
}

export interface NetworkExtras {
  netblock?: Netblock | null
  /** Nom de l'organisation résolu depuis son identifiant (base RIPE). */
  orgName?: string | null
  rpki?: RpkiValidation | null
  origin?: CymruOrigin | null
}

const sameName = (a: string, b: string): boolean => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')

export function buildIpNetworkOutput(
  ip: string,
  overview: PrefixOverview,
  country: RirCountry | null,
  abuse: AbuseContacts | null,
  lang: 'fr' | 'en',
  extras: NetworkExtras = {}
): ModuleOutput {
  const fr = lang === 'fr'
  const asns = overview.asns ?? []
  const prefix = overview.announced ? overview.resource : null
  const net = extras.netblock ?? null
  if (!asns.length && !prefix && !net) return {}
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
  // Résolveur DNS public ou CDN : adresse partagée par des milliers de sites sans lien entre eux.
  const shared = sharedInfrastructure(ip, { asn: main?.asn, org: main?.holder })

  // Titulaire du bloc au registre : une organisation à part entière, sauf s'il s'agit d'un hébergeur
  // ou d'un CDN connu (déjà représenté par le nœud hébergeur).
  const orgName = extras.orgName ?? net?.orgName ?? null
  const holder = orgName ? cleanOrg(orgName) : null
  const orgIsHost = !!orgName && (!!detectHosting({ org: orgName })?.platform || !!sharedInfrastructure(ip, { org: orgName }))
  const orgEntity = holder && !orgIsHost && !shared
  if (hosting && !(orgEntity && !hosting.platform && sameName(hosting.name, holder!)))
    entities.push({
      type: 'hosting',
      label: hosting.name,
      platform: hosting.platform,
      data: compact({ asn: main ? `AS${main.asn}` : null, country: cname, abuse_email: abuseEmail }) as Record<string, PropValue>,
      linkLabel: fr ? 'opéré par' : 'operated by'
    })
  if (orgEntity)
    entities.push({
      type: 'organization',
      label: holder!,
      data: compact({
        country: countryName(net?.country, lang),
        kind: fr ? 'Titulaire de bloc IP' : 'IP block holder'
      }) as Record<string, PropValue>,
      linkLabel: fr ? 'bloc attribué à' : 'block assigned to'
    })

  const rpki = extras.rpki?.status ?? null
  const origin = extras.origin ?? null
  return {
    properties: compact({
      asn: main ? `AS${main.asn}` : null,
      org: main ? cleanOrg(main.holder) : null,
      prefix,
      rir: abuse?.authoritative_rir?.toUpperCase() ?? null,
      registered_country: cname,
      abuse_email: abuseEmail,
      shared_infrastructure: shared && shared.kind !== 'reserved' ? sharedLabel(shared, lang) : null,
      netblock: net?.range ?? null,
      netname: net?.netname ?? null,
      netblock_org: holder ?? net?.orgHandle ?? null,
      mnt_by: net?.mntBy ?? [],
      netblock_country: countryName(net?.country, lang) ?? net?.country ?? null,
      netblock_status: net?.status ?? null,
      netblock_created_at: isoDate(net?.created),
      netblock_descr: net?.descr ?? [],
      allocation_date: origin?.allocated ?? null,
      rpki_status: rpki
    }),
    entities,
    raw: { overview, country, abuse, netblock: net, rpki: extras.rpki ?? null, origin }
  }
}

export default defineModule({
  id: 'ip.ripestat',
  name: { fr: 'ASN, préfixe et titulaire (RIPEstat)', en: 'ASN, prefix and holder (RIPEstat)' },
  description: {
    fr: 'Système autonome (ASN) qui annonce l’IP, préfixe réseau et validité RPKI de l’annonce, registre régional, contact abus, hébergeur reconnu (OVH, AWS, Cloudflare...), et fiche WHOIS du bloc (nom du réseau, titulaire, mainteneurs, pays) avec sa date d’allocation (Team Cymru). Un titulaire qui n’est pas un hébergeur connu devient une organisation. Données gratuites.',
    en: 'Autonomous system (ASN) announcing the IP, network prefix and RPKI validity of the announcement, regional registry, abuse contact, recognised host (OVH, AWS, Cloudflare...), and the block WHOIS record (network name, holder, maintainers, country) with its allocation date (Team Cymru). A holder that is not a known host becomes an organisation. Free data.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://stat.ripe.net',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const [overview, country, abuse, who, origin] = await Promise.all([
      prefixOverview(ctx, ip),
      optional(rirCountry(ctx, ip)),
      optional(abuseContacts(ctx, ip)),
      optional(whois(ctx, ip)),
      cymruOrigin(ctx, ip)
    ])
    const netblock = parseWhois(who)
    const asn = overview.asns?.[0]?.asn
    const prefix = overview.announced ? overview.resource : null
    const [orgName, rpki] = await Promise.all([
      netblock?.orgHandle && !netblock.orgName ? optional(ripeOrgName(ctx, netblock.orgHandle)) : Promise.resolve(null),
      asn && prefix ? optional(rpkiValidation(ctx, asn, prefix)) : Promise.resolve(null)
    ])
    return buildIpNetworkOutput(ip, overview, country, abuse, ctx.lang, { netblock, orgName, rpki, origin })
  }
})
