import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cleanOrg, detectHosting } from '../domain/_hosting'
import { compact, countryName, isIPv4 } from '../domain/_util'
import { abuseContacts, geoLite, optional, prefixOverview, type AbuseContacts, type GeoLite, type PrefixOverview } from './_ripestat'
import { expandIPv6 } from './reverseDns'

export interface CidrFacts {
  version: 'IPv4' | 'IPv6'
  prefix: string
  length: number
  network: string
  first: string
  last: string
  /** Nombre d'adresses (texte pour IPv6, qui dépasse les entiers JavaScript). */
  size: string
}

const toInt = (ip: string): number => ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0)
const toIp = (n: number): string => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.')

/** Forme abrégée d'une IPv6 : la plus longue suite de groupes nuls devient `::`. */
export function compressIPv6(groups: string[]): string {
  let best = -1
  let bestLen = 0
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== '0') {
      i++
      continue
    }
    let j = i
    while (j < groups.length && groups[j] === '0') j++
    if (j - i > bestLen) {
      best = i
      bestLen = j - i
    }
    i = j
  }
  if (bestLen < 2) return groups.join(':')
  return groups.slice(0, best).join(':') + '::' + groups.slice(best + bestLen).join(':')
}

/** Calcule l'étendue d'un bloc CIDR sans énumérer les adresses. */
export function cidrFacts(raw: string): CidrFacts | null {
  const m = raw.trim().match(/^([0-9a-f:.]+)\/(\d{1,3})$/i)
  if (!m) return null
  const len = Number(m[2])
  if (isIPv4(m[1])) {
    if (len > 32) return null
    const block = 2 ** (32 - len)
    const net = Math.floor(toInt(m[1]) / block) * block
    return {
      version: 'IPv4',
      prefix: `${toIp(net)}/${len}`,
      length: len,
      network: toIp(net),
      first: toIp(net),
      last: toIp(net + block - 1),
      size: String(block)
    }
  }
  const full = expandIPv6(m[1])
  if (!full || len > 128) return null
  const value = BigInt('0x' + full.replace(/:/g, ''))
  const hostBits = BigInt(128 - len)
  const mask = ((1n << 128n) - 1n) ^ ((1n << hostBits) - 1n)
  const net = value & mask
  const last = net | ((1n << hostBits) - 1n)
  const fmt = (v: bigint): string => compressIPv6(v.toString(16).padStart(32, '0').match(/.{4}/g)!.map((g) => g.replace(/^0+(?=.)/, '')))
  return {
    version: 'IPv6',
    prefix: `${fmt(net)}/${len}`,
    length: len,
    network: fmt(net),
    first: fmt(net),
    last: fmt(last),
    size: (1n << hostBits).toString()
  }
}

export function buildCidrOutput(
  f: CidrFacts,
  overview: PrefixOverview | null,
  geo: GeoLite | null,
  abuse: AbuseContacts | null,
  lang: 'fr' | 'en'
): ModuleOutput {
  const fr = lang === 'fr'
  const asns = overview?.asns ?? []
  const locations = (geo?.located_resources ?? []).flatMap((r) => r.locations ?? []).sort((a, b) => (b.covered_percentage ?? 0) - (a.covered_percentage ?? 0))
  const top = locations[0]
  const entities: OutEntity[] = []
  for (const a of asns.slice(0, 3))
    entities.push({
      type: 'asn',
      label: `AS${a.asn}`,
      data: { name: cleanOrg(a.holder) },
      linkLabel: fr ? 'annoncé par' : 'announced by'
    })
  const hosting = asns[0] ? detectHosting({ asn: asns[0].asn, org: asns[0].holder }) : null
  if (hosting?.platform)
    entities.push({
      type: 'hosting',
      label: hosting.name,
      platform: hosting.platform,
      data: compact({ asn: `AS${asns[0].asn}`, abuse_email: abuse?.abuse_contacts?.[0] ?? null }) as Record<string, PropValue>,
      linkLabel: fr ? 'opéré par' : 'operated by'
    })
  if (overview?.resource && overview.resource !== f.prefix && overview.is_less_specific)
    entities.push({ type: 'cidr', label: overview.resource, linkLabel: fr ? 'inclus dans' : 'part of' })
  return {
    properties: compact({
      version: f.version,
      network: f.network,
      first_ip: f.first,
      last_ip: f.last,
      size: f.version === 'IPv4' ? Number(f.size) : f.size,
      prefix_length: f.length,
      announced: overview?.announced ?? null,
      announced_prefix: overview?.resource ?? null,
      asn: asns[0] ? `AS${asns[0].asn}` : null,
      org: asns[0] ? cleanOrg(asns[0].holder) : null,
      country: countryName(top?.country, lang),
      city: top?.city || null,
      lat: typeof top?.latitude === 'number' ? top.latitude : null,
      lon: typeof top?.longitude === 'number' ? top.longitude : null,
      geo_coverage: locations.slice(0, 5).map((l) => `${l.country ?? '?'}${l.city ? ' ' + l.city : ''} : ${l.covered_percentage ?? '?'} %`),
      abuse_email: abuse?.abuse_contacts?.[0] ?? null
    }),
    entities,
    raw: { facts: f, overview, abuse, geo: locations.slice(0, 20) }
  }
}

export default defineModule({
  id: 'cidr.info',
  name: { fr: 'Informations sur la plage IP', en: 'IP range information' },
  description: {
    fr: 'Étendue de la plage (première et dernière adresse, taille) calculée localement, ASN qui l’annonce, opérateur, contact abus et géolocalisation dominante (RIPEstat), sans énumérer les adresses.',
    en: 'Range extent (first and last address, size) computed locally, announcing ASN, operator, abuse contact and dominant geolocation (RIPEstat), without enumerating addresses.'
  },
  category: 'ip',
  inputTypes: ['cidr'],
  homepage: 'https://stat.ripe.net',
  async run(input, ctx) {
    const f = cidrFacts(input.label)
    if (!f) throw new ModuleError('Plage CIDR invalide', 'invalid_input')
    const [overview, geo, abuse] = await Promise.all([
      prefixOverview(ctx, f.prefix),
      optional(geoLite(ctx, f.prefix)),
      optional(abuseContacts(ctx, f.prefix))
    ])
    return buildCidrOutput(f, overview, geo, abuse, ctx.lang)
  }
})
