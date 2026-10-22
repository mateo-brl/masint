// roso.info : scan d'une adresse IP (page /ip/ : start, lookup IPinfo + MaxMind,
// puis 13 sources CTI via /api/ip-preprod/lookup/<source>).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { findPlatformByName } from '@shared/platforms'
import { sharedInfrastructure, sharedLabel } from '../domain/_hosting'
import { cappedList, localizeCountry, MAX_LIST_ENTITIES } from '../domain/_util'
import { creditsOf, redact, ROSO_COMMON, RosoClient, scanProgress, toRosoError, type Json } from './_client'
import { asArr, asObj, dropEmpty, isDomain, isIp, pick, pickNum, str } from './_parse'

const PAGE = '/ip/'
export const IP_SOURCES = [
  'bgp',
  'virustotal',
  'abuseipdb',
  'criminalip',
  'greynoise',
  'abusech',
  'otx',
  'urlscan',
  'intelx',
  'hudsonrock',
  'pulsedive',
  'rapiddns',
  'iknow'
]

/** Champs `{label, value}` d'une source CTI convertis en objet simple. */
export function sourceFields(d: Json): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const f of asArr(d.fields).slice(0, 40)) {
    const o = asObj(f)
    const label = str(o.label)
    const v = o.value
    if (!label || v === null || v === undefined || v === '') continue
    out[label] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v).slice(0, 300)
  }
  return out
}

function geoProps(d: Json, lang: 'fr' | 'en'): Record<string, PropValue | undefined> {
  const mm = asObj(d.maxmind)
  const cls = asObj(d.classification)
  const flags = Object.entries(cls)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
  if (d.is_anonymous === true) flags.push('anonymous')
  if (d.is_mobile === true) flags.push('mobile')
  if (d.is_satellite === true) flags.push('satellite')
  return {
    country: localizeCountry(pick(d, 'country') || pick(mm, 'country'), pick(d, 'country_code') || pick(mm, 'country_code', 'countryCode'), lang) || undefined,
    city: pick(d, 'city') || pick(mm, 'city') || undefined,
    region: pick(d, 'region') || pick(mm, 'subdivision') || undefined,
    postcode: pick(d, 'postal') || pick(mm, 'postal') || undefined,
    timezone: pick(d, 'timezone') || undefined,
    isp: pick(mm, 'isp') || pick(d, 'as_name', 'org') || undefined,
    org: pick(d, 'company_name') || pick(mm, 'organization') || pick(d, 'as_name') || undefined,
    asn: pick(d, 'asn') || (pick(mm, 'asn') ? `AS${pick(mm, 'asn')}` : undefined),
    reverse: pick(d, 'hostname') || undefined,
    network: pick(mm, 'network') || pick(d, 'as_route') || undefined,
    connection_type: pick(mm, 'connectionType') || undefined,
    vpn_service: pick(d, 'vpn_service') || undefined,
    flags: flags.length ? flags : undefined,
    lat: pickNum(d, 'lat', 'latitude') ?? pickNum(mm, 'latitude'),
    lon: pickNum(d, 'lng', 'lon', 'longitude') ?? pickNum(mm, 'longitude'),
    accuracy_km: pickNum(mm, 'accuracyRadius')
  }
}

function geoEntities(d: Json, lang: 'fr' | 'en'): OutEntity[] {
  const out: OutEntity[] = []
  const asn = pick(d, 'asn')
  if (asn) {
    out.push({
      type: 'asn',
      label: /^AS/i.test(asn) ? asn.toUpperCase() : `AS${asn}`,
      data: dropEmpty({ name: pick(d, 'as_name') || undefined, country: pick(d, 'country_code') || undefined }),
      linkLabel: 'ASN'
    })
  }
  const country = localizeCountry(pick(d, 'country'), pick(d, 'country_code'), lang)
  if (country) out.push({ type: 'country', label: country, data: dropEmpty({ code: pick(d, 'country_code') || undefined }), linkLabel: lang === 'fr' ? 'pays' : 'country' })
  const asName = pick(d, 'as_name')
  const hosting = asName ? findPlatformByName(asName, 'hosting') : undefined
  if (hosting) out.push({ type: 'hosting', label: hosting.name, platform: hosting.id, data: dropEmpty({ asn: asn || undefined }), linkLabel: lang === 'fr' ? 'hébergeur' : 'hosting' })
  const company = pick(d, 'company_name')
  if (company && company !== asName)
    out.push({ type: 'organization', label: company, data: dropEmpty({ website: pick(d, 'company_domain') || undefined, kind: pick(d, 'company_type') || undefined }), linkLabel: lang === 'fr' ? 'organisation' : 'organization' })
  const host = pick(d, 'hostname').toLowerCase()
  if (host && isDomain(host)) out.push({ type: 'domain', label: host, linkLabel: 'PTR' })
  return out
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.ip',
  name: { fr: 'roso.info : adresse IP', en: 'roso.info: IP address' },
  description: {
    fr: "Scan roso.info d'une IP : géolocalisation IPinfo + MaxMind, ASN, VPN / Tor, et 13 sources CTI (VirusTotal, AbuseIPDB, GreyNoise, OTX, Hudson Rock...). Consomme des crédits roso.info.",
    en: 'roso.info IP scan: IPinfo + MaxMind geolocation, ASN, VPN / Tor, and 13 CTI sources (VirusTotal, AbuseIPDB, GreyNoise, OTX, Hudson Rock...). Consumes roso.info credits.'
  },
  inputTypes: ['ip'],
  timeoutMs: 240_000,
  async run(input, ctx) {
    const ip = input.label.trim()
    if (!isIp(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    const c = new RosoClient(ctx, 'ip')
    await c.checkMaintenance('ip')

    const start = await c.launch('/api/gateway/ip/start', { ip }, { page: PAGE })

    // Géolocalisation et 13 sources en parallèle : la pastille avance à chaque réponse.
    const progress = scanProgress(ctx, IP_SOURCES.length + 1, { fr: 'sources', en: 'sources' })
    const geoReq = c
      .get('/api/gateway/ip/lookup', { query: { ip }, timeoutMs: 60000, throwOnError: false, page: PAGE })
      .catch(() => null)
      .finally(() => progress.tick(ctx.lang === 'fr' ? 'géolocalisation' : 'geolocation'))
    const sourceReqs = IP_SOURCES.map((id) =>
      c
        .get(`/api/ip-preprod/lookup/${id}`, { query: { ip }, timeoutMs: 60000, retries: 1, throwOnError: false, page: PAGE })
        .then((r) => ({ id, r }))
        .catch((e: unknown) => ({ id, r: null, error: e instanceof Error ? e.message : String(e) }))
        .finally(() => progress.tick(id))
    )
    const [geoRes, ...sources] = await Promise.all([geoReq, ...sourceReqs])
    if (geoRes?.status === 401) throw toRosoError(401, geoRes.data, 'ip', ctx.lang)

    const geo = geoRes?.ok && geoRes.data.success !== false ? geoRes.data : null
    const entities: OutEntity[] = geo ? geoEntities(geo, ctx.lang) : []
    const properties: Record<string, PropValue | undefined> = geo ? geoProps(geo, ctx.lang) : {}
    const passiveNames: string[] = []

    const okSources: string[] = []
    const rawSources: Record<string, unknown> = {}
    for (const s of sources) {
      const d = s.r?.data
      rawSources[s.id] = d ?? { status: 'error', error: 'error' in s ? s.error : 'no response' }
      if (!s.r?.ok || !d || str(d.status) !== 'ok') continue
      okSources.push(s.id)
      const fields = sourceFields(d)
      if (Object.keys(fields).length) properties[`roso_${s.id}`] = fields
      // DNS passif : noms d'hôte pointant vers cette IP.
      if (s.id === 'otx' || s.id === 'rapiddns') {
        for (const rec of asArr(d.records)) {
          const name = str(asObj(rec).title).toLowerCase()
          if (isDomain(name) && !passiveNames.includes(name)) passiveNames.push(name)
        }
      }
    }
    // IP de CDN ou résolveur public : les domaines vus dessus n'ont pas de lien avec la cible.
    const shared = sharedInfrastructure(ip, { asn: properties.asn ?? input.data.asn, org: properties.org ?? input.data.org })
    if (!shared)
      for (const name of passiveNames.slice(0, MAX_LIST_ENTITIES))
        entities.push({ type: 'domain', label: name, linkLabel: ctx.lang === 'fr' ? 'DNS passif' : 'passive DNS' })
    Object.assign(properties, cappedList('passive_dns_hostnames', passiveNames))
    if (shared) properties.shared_infrastructure = sharedLabel(shared, ctx.lang)

    return {
      properties: dropEmpty({
        ...properties,
        roso_credits_left: creditsOf(start),
        roso_sources: okSources
      }),
      entities,
      raw: redact({ start, geo: geoRes?.data ?? null, sources: rawSources }, c.key)
    }
  }
})
