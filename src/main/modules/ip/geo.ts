import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, isIPv4, isIPv6, localizeCountry, normalizeHost, serviceError } from '../domain/_util'

export interface IpWhoIs {
  ip?: string
  success?: boolean
  message?: string
  type?: string
  continent?: string
  country?: string
  country_code?: string
  region?: string
  city?: string
  postal?: string
  latitude?: number
  longitude?: number
  connection?: { asn?: number; org?: string; isp?: string; domain?: string }
  timezone?: { id?: string }
}

/**
 * Réponse de ipinfo.io sans jeton (HTTPS gratuit). `org` réunit l'ASN et son nom
 * (`AS15169 Google LLC`), `loc` les coordonnées (`37.4056,-122.0775`), `bogon` marque une
 * adresse privée ou réservée.
 */
export interface IpInfo {
  ip?: string
  hostname?: string
  city?: string
  region?: string
  country?: string
  loc?: string
  org?: string
  postal?: string
  timezone?: string
  anycast?: boolean
  bogon?: boolean
}

interface Geo {
  version: string | null
  country: string | null
  country_code: string | null
  region: string | null
  city: string | null
  postal: string | null
  lat: number | null
  lon: number | null
  timezone: string | null
  isp: string | null
  org: string | null
  asn: number | null
  asnName: string | null
  /** Nom d'hôte (PTR) quand le service le donne. */
  reverse: string | null
  /** Adresse anycast : servie depuis plusieurs lieux, la position n'a pas de sens. */
  anycast: boolean | null
  source: string
}

export function fromIpWhoIs(d: IpWhoIs): Geo | null {
  if (!d.success) return null
  return {
    version: d.type ?? null,
    country: d.country ?? null,
    country_code: d.country_code ?? null,
    region: d.region ?? null,
    city: d.city ?? null,
    postal: d.postal ?? null,
    lat: typeof d.latitude === 'number' ? d.latitude : null,
    lon: typeof d.longitude === 'number' ? d.longitude : null,
    timezone: d.timezone?.id ?? null,
    isp: d.connection?.isp ?? null,
    org: d.connection?.org ?? null,
    asn: d.connection?.asn ?? null,
    asnName: d.connection?.org ?? null,
    reverse: null,
    anycast: null,
    source: 'ipwho.is'
  }
}

export function fromIpInfo(d: IpInfo, ip: string): Geo | null {
  if (!d.ip || d.bogon) return null
  const [lat, lon] = (d.loc ?? '').split(',').map((v) => (v.trim() ? Number(v) : NaN))
  const as = d.org?.match(/^AS(\d+)\s*(.*)$/)
  const orgName = (as ? as[2] : d.org)?.trim() || null
  return {
    version: isIPv6(ip) ? 'IPv6' : 'IPv4',
    country: null,
    country_code: d.country ?? null,
    region: d.region || null,
    city: d.city || null,
    postal: d.postal || null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    timezone: d.timezone ?? null,
    isp: null,
    org: orgName,
    asn: as ? Number(as[1]) : null,
    asnName: orgName,
    reverse: d.hostname || null,
    anycast: d.anycast ?? null,
    source: 'ipinfo.io'
  }
}

export function buildGeoOutput(g: Geo | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!g) return {}
  const fr = lang === 'fr'
  // ipwho.is renvoie le nom du pays en anglais, ipinfo.io seulement le code : on part du code ISO.
  const country = localizeCountry(g.country, g.country_code, lang)
  const entities: OutEntity[] = []
  if (g.asn)
    entities.push({
      type: 'asn',
      label: `AS${g.asn}`,
      data: compact({ name: g.asnName, country }) as Record<string, PropValue>,
      linkLabel: fr ? 'réseau' : 'network'
    })
  const properties = compact({
    version: g.version,
    country,
    country_code: g.country_code,
    region: g.region,
    city: g.city,
    postcode: g.postal,
    lat: g.lat,
    lon: g.lon,
    timezone: g.timezone,
    isp: g.isp,
    org: g.org,
    asn: g.asn ? `AS${g.asn}` : null,
    reverse: g.reverse,
    anycast: g.anycast || null,
    geo_source: g.source
  }) as Record<string, PropValue>
  return { properties, entities, raw: { geo: g } }
}

// ip-api.com n'est plus interrogé : son offre gratuite n'existe qu'en HTTP clair, et derrière Tor
// le nœud de sortie (comme tout intermédiaire) verrait l'adresse visée. Ses indicateurs proxy,
// hébergeur et mobile sont couverts autrement : hébergeur reconnu par ip.ripestat, nœud Tor par
// ip.tor, type d'usage par AbuseIPDB, listes de réputation par ip.blocklists.

/** Repli quand ipwho.is ne répond pas ou refuse (quota mensuel). */
async function ipInfo(ctx: ModuleContext, ip: string): Promise<IpInfo> {
  return ctx.fetchJson<IpInfo>(`https://ipinfo.io/${ip}/json`, { headers: { accept: 'application/json' }, timeoutMs: 15000 })
}

export default defineModule({
  id: 'ip.geo',
  name: { fr: 'Géolocalisation IP', en: 'IP geolocation' },
  description: {
    fr: 'Pays, ville, coordonnées, fuseau horaire, FAI et ASN de l’adresse (ipwho.is, repli ipinfo.io, tous deux en HTTPS). Précision indicative : souvent la ville du FAI.',
    en: 'Country, city, coordinates, timezone, ISP and ASN of the address (ipwho.is, falling back to ipinfo.io, both over HTTPS). Approximate: often the ISP city.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://ipwho.is',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    let geo: Geo | null = null
    try {
      const d = await ctx.fetchJson<IpWhoIs>(`https://ipwho.is/${ip}`)
      geo = fromIpWhoIs(d)
      // Adresse réservée / privée : réponse « success: false » normale.
      if (!geo && /reserved|private|invalid/i.test(d.message ?? '')) return {}
      if (!geo) ctx.log(`ipwho.is : ${d.message ?? 'réponse sans résultat'}`)
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.log(`ipwho.is en échec : ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!geo) {
      let d: IpInfo
      try {
        d = await ipInfo(ctx, ip)
      } catch (e) {
        throw serviceError(e, 'ipinfo.io (repli de ipwho.is)')
      }
      if (d.bogon) return {}
      geo = fromIpInfo(d, ip)
    }
    return buildGeoOutput(geo, ctx.lang)
  }
})
