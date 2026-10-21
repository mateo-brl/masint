// Statut HLR en temps réel (ligne active, portabilité, itinérance, opérateur actuel)
// via deux fournisseurs payants à crédits. Formats tirés des exemples officiels.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, fetchRetry, httpFailure, isoDay, readJson, tr } from '../email/_lib'
import { carrierPlatform, toE164 } from './_phone'

interface Network {
  name?: string
  country?: string
  mccmnc?: string
}

export interface HlrSummary {
  e164: string
  /** `active` : ligne attribuée chez l'opérateur ; `inactive` : numéro inexistant ou résilié. */
  state: 'active' | 'inactive' | 'unknown'
  status: string
  ported?: boolean
  roaming?: boolean
  mccmnc?: string
  imsi?: string
  checkedAt?: string
  lineType?: string
  current?: Network
  original?: Network
  roamingNetwork?: Network
}

/** `2020-08-07 19:16:17.676+0300` ou `2022-09-08T10:04:27Z` vers ISO 8601. */
export function hlrTimestamp(v?: string | null): string | undefined {
  if (!v) return undefined
  const s = v.trim().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? isoDay(v) : d.toISOString()
}

function carrierEntity(n: Network, linkLabel: string, ref?: string): OutEntity | null {
  if (!n.name) return null
  return {
    ...(ref ? { ref } : {}),
    type: 'carrier',
    label: n.name,
    platform: carrierPlatform(n.name),
    data: compact({ country: n.country, mccmnc: n.mccmnc }),
    linkLabel
  }
}

export function hlrOutput(h: HlrSummary, lang: 'fr' | 'en', raw: unknown): ModuleOutput {
  const entities: OutEntity[] = []
  if (h.state !== 'unknown') {
    entities.push({
      ref: 'hlr',
      type: 'hlr',
      label: `HLR ${h.e164}`,
      platform: h.state === 'active' ? 'hlr_active' : 'hlr_inactive',
      data: compact({
        status: h.status,
        ported: h.ported,
        roaming: h.roaming,
        mccmnc: h.mccmnc,
        imsi: h.imsi,
        checked_at: h.checkedAt
      }),
      linkLabel: tr({ lang }, 'statut HLR', 'HLR status')
    })
  }
  const current = h.current?.name ? h.current : h.original
  const cur = current && carrierEntity(current, tr({ lang }, 'opérateur actuel', 'current carrier'))
  if (cur) entities.push(cur)
  if (h.ported && h.original?.name && h.original.name !== current?.name) {
    const orig = carrierEntity(h.original, tr({ lang }, "opérateur d'origine", 'original carrier'))
    if (orig) entities.push(orig)
  }
  if (h.roaming && h.roamingNetwork?.name) {
    const roam = carrierEntity(h.roamingNetwork, tr({ lang }, 'réseau visité', 'visited network'))
    if (roam) entities.push(roam)
  }
  return {
    properties: compact({
      hlr_status: h.status,
      ported: h.ported,
      roaming: h.roaming,
      mccmnc: h.mccmnc,
      current_carrier: current?.name,
      roaming_network: h.roaming ? h.roamingNetwork?.name : undefined,
      hlr_checked_at: h.checkedAt
    }),
    entities,
    raw
  }
}

// ---------------------------------------------------------------------------
// hlr-lookups.com

export interface HlrLookupsResponse {
  msisdn?: string
  connectivity_status?: string
  mccmnc?: string | null
  imsi?: string | null
  original_network_name?: string | null
  original_country_name?: string | null
  is_ported?: boolean | null
  ported_network_name?: string | null
  ported_country_name?: string | null
  is_roaming?: boolean | null
  roaming_network_name?: string | null
  roaming_country_name?: string | null
  timestamp?: string
  processing_status?: string
  error_code?: number | null
  error_description?: string | null
  data_source?: string
}

const STATUS_HLRL: Record<string, HlrSummary['state']> = {
  CONNECTED: 'active',
  ABSENT: 'active',
  INVALID_MSISDN: 'inactive',
  UNDETERMINED: 'unknown'
}

export function parseHlrLookups(json: HlrLookupsResponse, e164: string): HlrSummary {
  if (json.processing_status && json.processing_status !== 'COMPLETED')
    throw new ModuleError(`HLR Lookups : ${json.error_description ?? json.processing_status}`, 'other')
  const status = json.connectivity_status ?? 'UNDETERMINED'
  const ported = json.is_ported ?? undefined
  return {
    e164: json.msisdn || e164,
    state: STATUS_HLRL[status] ?? 'unknown',
    status: status.toLowerCase(),
    ported,
    roaming: json.is_roaming ?? undefined,
    mccmnc: json.mccmnc ?? undefined,
    imsi: json.imsi && !/^\*+$/.test(json.imsi) ? json.imsi : undefined,
    checkedAt: hlrTimestamp(json.timestamp),
    original: { name: json.original_network_name ?? undefined, country: json.original_country_name ?? undefined },
    current: ported
      ? { name: json.ported_network_name ?? undefined, country: json.ported_country_name ?? undefined, mccmnc: json.mccmnc ?? undefined }
      : { name: json.original_network_name ?? undefined, country: json.original_country_name ?? undefined, mccmnc: json.mccmnc ?? undefined },
    roamingNetwork: { name: json.roaming_network_name ?? undefined, country: json.roaming_country_name ?? undefined }
  }
}

const hlrLookups = defineModule({
  id: 'phone.hlr_lookups',
  name: { fr: 'Statut HLR (HLR Lookups)', en: 'HLR status (HLR Lookups)' },
  description: {
    fr: "Interroge en temps réel le registre de l'opérateur via hlr-lookups.com : ligne active ou non, opérateur actuel, portabilité, itinérance, MCC/MNC. Payant à l'unité, lancé à la demande.",
    en: "Queries the carrier's register in real time through hlr-lookups.com: line active or not, current carrier, ported, roaming, MCC/MNC. Paid per lookup, run on demand."
  },
  category: 'phone',
  inputTypes: ['phone'],
  keys: [
    { id: 'hlr-lookups', label: 'HLR Lookups API key', url: 'https://www.hlr-lookups.com/en/api-settings' },
    { id: 'hlr-lookups-secret', label: 'HLR Lookups API secret', url: 'https://www.hlr-lookups.com/en/api-settings' }
  ],
  homepage: 'https://www.hlr-lookups.com',
  ondemand: true,
  experimental: true,
  timeoutMs: 60000,
  async run(input, ctx) {
    const e164 = toE164(input)
    const key = ctx.key('hlr-lookups')
    const secret = ctx.key('hlr-lookups-secret')
    if (!key || !secret) throw new ModuleError('Clé et secret HLR Lookups requis', 'auth')
    const res = await fetchRetry(ctx, 'https://www.hlr-lookups.com/api/v2/hlr-lookup', {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, accept: 'application/json' },
      json: { msisdn: e164 },
      timeoutMs: 45000
    })
    if (res.status === 401 || res.status === 403) throw new ModuleError('HLR Lookups : authentification refusée', 'auth')
    if (res.status === 402) throw new ModuleError('HLR Lookups : crédit insuffisant', 'auth')
    if (!res.ok) throw httpFailure('HLR Lookups', res.status)
    const json = await readJson<HlrLookupsResponse>(res, 'HLR Lookups')
    return hlrOutput(parseHlrLookups(json, e164), ctx.lang, json)
  }
})

// ---------------------------------------------------------------------------
// hlrlookup.com

interface HlrlNetwork {
  name?: string
  mccmnc?: string
  country_name?: string
}

export interface HlrlookupResult {
  error?: string
  live_status?: string
  original_network_details?: HlrlNetwork
  current_network_details?: HlrlNetwork
  is_ported?: string
  is_roaming?: string
  timestamp?: string
  telephone_number_type?: string
  detected_telephone_number?: string
}

const STATUS_HLRC: Record<string, HlrSummary['state']> = {
  LIVE: 'active',
  ABSENT_SUBSCRIBER: 'active',
  DEAD: 'inactive',
  NO_COVERAGE: 'unknown',
  INCONCLUSIVE: 'unknown',
  NOT_AVAILABLE_NETWORK_ONLY: 'unknown'
}

const yesNo = (v?: string): boolean | undefined => (v === 'YES' ? true : v === 'NO' ? false : undefined)
const net = (n?: HlrlNetwork): Network => ({ name: n?.name || undefined, country: n?.country_name, mccmnc: n?.mccmnc })

export function parseHlrlookup(json: { body?: { results?: HlrlookupResult[] }; results?: HlrlookupResult[] }, e164: string): HlrSummary {
  const r = (json.body?.results ?? json.results ?? [])[0]
  if (!r) throw new ModuleError('HLR Lookup : réponse vide', 'other')
  if (r.error && r.error !== 'NONE') throw new ModuleError(`HLR Lookup : ${r.error}`, r.error.includes('CREDIT') ? 'auth' : 'other')
  const status = r.live_status ?? 'INCONCLUSIVE'
  const current = net(r.current_network_details)
  return {
    e164,
    state: STATUS_HLRC[status] ?? 'unknown',
    status: status.toLowerCase(),
    ported: yesNo(r.is_ported),
    roaming: yesNo(r.is_roaming),
    mccmnc: current.mccmnc,
    checkedAt: hlrTimestamp(r.timestamp),
    lineType: r.telephone_number_type,
    current,
    original: net(r.original_network_details)
  }
}

const hlrlookup = defineModule({
  id: 'phone.hlrlookup',
  name: { fr: 'Statut HLR (HLR Lookup)', en: 'HLR status (HLR Lookup)' },
  description: {
    fr: "Interroge en temps réel le registre de l'opérateur via hlrlookup.com : ligne active ou résiliée, opérateur actuel et d'origine, portabilité. Payant à l'unité, lancé à la demande.",
    en: "Queries the carrier's register in real time through hlrlookup.com: line live or dead, current and original carrier, ported. Paid per lookup, run on demand."
  },
  category: 'phone',
  inputTypes: ['phone'],
  keys: [
    { id: 'hlrlookup', label: 'HLR Lookup API key', url: 'https://www.hlrlookup.com/' },
    { id: 'hlrlookup-secret', label: 'HLR Lookup API secret', url: 'https://www.hlrlookup.com/' }
  ],
  homepage: 'https://www.hlrlookup.com',
  ondemand: true,
  experimental: true,
  timeoutMs: 60000,
  async run(input, ctx: ModuleContext) {
    const e164 = toE164(input)
    const key = ctx.key('hlrlookup')
    const secret = ctx.key('hlrlookup-secret')
    if (!key || !secret) throw new ModuleError('Clé et secret HLR Lookup requis', 'auth')
    const res = await fetchRetry(ctx, 'https://api.hlrlookup.com/apiv2/hlr', {
      method: 'POST',
      headers: { accept: 'application/json' },
      json: { api_key: key, api_secret: secret, requests: [{ telephone_number: e164.slice(1) }] },
      timeoutMs: 45000
    })
    if (res.status === 401) throw new ModuleError('HLR Lookup : clé ou secret refusé', 'auth')
    if (!res.ok) throw httpFailure('HLR Lookup', res.status)
    const json = await readJson<{ body?: { results?: HlrlookupResult[] }; results?: HlrlookupResult[] }>(res, 'HLR Lookup')
    const summary = parseHlrlookup(json, e164)
    const out = hlrOutput(summary, ctx.lang, json)
    if (summary.lineType) out.properties = { ...out.properties, line_type_hlr: summary.lineType.toLowerCase() }
    return out
  }
})

export const modules = [hlrLookups, hlrlookup]
