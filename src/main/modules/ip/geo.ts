import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, isIPv4, isIPv6, normalizeHost, serviceError } from '../domain/_util'

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

export interface IpApi {
  status?: string
  message?: string
  country?: string
  countryCode?: string
  regionName?: string
  city?: string
  zip?: string
  lat?: number
  lon?: number
  timezone?: string
  isp?: string
  org?: string
  as?: string
  asname?: string
  reverse?: string
  mobile?: boolean
  proxy?: boolean
  hosting?: boolean
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
    source: 'ipwho.is'
  }
}

export function fromIpApi(d: IpApi, ip: string): Geo | null {
  if (d.status !== 'success') return null
  const asn = d.as?.match(/^AS(\d+)/)?.[1]
  return {
    version: isIPv6(ip) ? 'IPv6' : 'IPv4',
    country: d.country ?? null,
    country_code: d.countryCode ?? null,
    region: d.regionName ?? null,
    city: d.city ?? null,
    postal: d.zip ?? null,
    lat: typeof d.lat === 'number' ? d.lat : null,
    lon: typeof d.lon === 'number' ? d.lon : null,
    timezone: d.timezone ?? null,
    isp: d.isp ?? null,
    org: d.org ?? null,
    asn: asn ? Number(asn) : null,
    asnName: d.as?.replace(/^AS\d+\s*/, '') || d.asname || null,
    source: 'ip-api.com'
  }
}

export function buildGeoOutput(g: Geo | null, flags: IpApi | null, lang: 'fr' | 'en'): ModuleOutput {
  if (!g) return {}
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  if (g.asn)
    entities.push({
      type: 'asn',
      label: `AS${g.asn}`,
      data: compact({ name: g.asnName, country: g.country }) as Record<string, PropValue>,
      linkLabel: fr ? 'réseau' : 'network'
    })
  const properties = compact({
    version: g.version,
    country: g.country,
    country_code: g.country_code,
    region: g.region,
    city: g.city,
    postal_code: g.postal,
    lat: g.lat,
    lon: g.lon,
    timezone: g.timezone,
    isp: g.isp,
    org: g.org,
    asn: g.asn ? `AS${g.asn}` : null,
    reverse: flags?.reverse || null,
    is_mobile: flags?.mobile ?? null,
    is_proxy: flags?.proxy ?? null,
    is_hosting: flags?.hosting ?? null,
    geo_source: g.source
  }) as Record<string, PropValue>
  return { properties, entities, raw: { geo: g, flags } }
}

const IPAPI_FIELDS = 'status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,reverse,mobile,proxy,hosting,query'

async function ipApi(ctx: ModuleContext, ip: string): Promise<IpApi> {
  // ip-api.com n'offre le HTTPS qu'en version payante.
  return ctx.fetchJson<IpApi>(`http://ip-api.com/json/${ip}`, { query: { fields: IPAPI_FIELDS }, timeoutMs: 15000 })
}

export default defineModule({
  id: 'ip.geo',
  name: { fr: 'Géolocalisation IP', en: 'IP geolocation' },
  description: {
    fr: 'Pays, ville, coordonnées, fuseau horaire, FAI et ASN de l’adresse (ipwho.is, repli ip-api.com), avec indicateurs proxy / hébergeur / mobile quand disponibles. Précision indicative : souvent la ville du FAI.',
    en: 'Country, city, coordinates, timezone, ISP and ASN of the address (ipwho.is, falling back to ip-api.com), with proxy / hosting / mobile flags when available. Approximate: often the ISP city.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://ipwho.is',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const flagsP = ipApi(ctx, ip).catch(() => null)
    let geo: Geo | null = null
    let firstError: unknown
    try {
      const d = await ctx.fetchJson<IpWhoIs>(`https://ipwho.is/${ip}`)
      geo = fromIpWhoIs(d)
      // Adresse réservée / privée : réponse « success: false » normale.
      if (!geo && /reserved|private|invalid/i.test(d.message ?? '')) return {}
    } catch (e) {
      firstError = e
    }
    const flags = await flagsP
    if (!geo && flags) geo = fromIpApi(flags, ip)
    if (!geo && firstError) throw serviceError(firstError, 'ipwho.is')
    return buildGeoOutput(geo, flags?.status === 'success' ? flags : null, ctx.lang)
  }
})
