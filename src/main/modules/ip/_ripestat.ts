// Client minimal de l'API publique RIPEstat (gratuite, sans clé).

import type { ModuleContext } from '@shared/modules'
import { serviceError } from '../domain/_util'

const BASE = 'https://stat.ripe.net/data'

interface RipeResponse<T> {
  status?: string
  data: T
}

export async function ripe<T>(ctx: ModuleContext, call: string, resource: string, extra: Record<string, string> = {}): Promise<T> {
  try {
    const res = await ctx.fetchJson<RipeResponse<T>>(`${BASE}/${call}/data.json`, {
      query: { resource, sourceapp: 'masint', ...extra },
      timeoutMs: 30000
    })
    return res.data
  } catch (e) {
    throw serviceError(e, 'RIPEstat')
  }
}

export interface PrefixOverview {
  resource?: string
  announced?: boolean
  is_less_specific?: boolean
  asns?: Array<{ asn: number; holder: string }>
  block?: { resource?: string; desc?: string; name?: string }
}

export interface AsOverview {
  resource?: string
  holder?: string
  announced?: boolean
  block?: { resource?: string; desc?: string; name?: string }
}

export interface AnnouncedPrefixes {
  prefixes?: Array<{ prefix: string }>
}

export interface AbuseContacts {
  abuse_contacts?: string[]
  authoritative_rir?: string
}

export interface RirCountry {
  located_resources?: Array<{ resource: string; location: string }>
}

export interface GeoLite {
  located_resources?: Array<{
    resource: string
    locations?: Array<{ country?: string; city?: string; latitude?: number; longitude?: number; covered_percentage?: number }>
  }>
}

export interface WhoisRecord {
  key: string
  value: string
}

export interface Whois {
  records?: WhoisRecord[][]
  irr_records?: WhoisRecord[][]
  /** Registres consultés (`ripe`, `arin`...). */
  authorities?: string[]
}

export interface RpkiValidation {
  /** `valid`, `invalid`, `invalid_asn`, `invalid_length` ou `unknown` (aucun ROA). */
  status?: string
  validating_roas?: Array<{ origin?: string; prefix?: string; validity?: string; max_length?: number }>
}

export const prefixOverview = (ctx: ModuleContext, r: string): Promise<PrefixOverview> => ripe(ctx, 'prefix-overview', r)
export const asOverview = (ctx: ModuleContext, r: string): Promise<AsOverview> => ripe(ctx, 'as-overview', r)
export const announcedPrefixes = (ctx: ModuleContext, r: string): Promise<AnnouncedPrefixes> => ripe(ctx, 'announced-prefixes', r)
export const abuseContacts = (ctx: ModuleContext, r: string): Promise<AbuseContacts> => ripe(ctx, 'abuse-contact-finder', r)
export const rirCountry = (ctx: ModuleContext, r: string): Promise<RirCountry> => ripe(ctx, 'rir-stats-country', r)
export const geoLite = (ctx: ModuleContext, r: string): Promise<GeoLite> => ripe(ctx, 'maxmind-geo-lite', r)
export const whois = (ctx: ModuleContext, r: string): Promise<Whois> => ripe(ctx, 'whois', r)
/** Validité RPKI de l'annonce `prefix` par l'AS `asn`. */
export const rpkiValidation = (ctx: ModuleContext, asn: number, prefix: string): Promise<RpkiValidation> =>
  ripe(ctx, 'rpki-validation', `AS${asn}`, { prefix })

/**
 * Nom d'une organisation de la base RIPE (`ORG-OS3-RIPE` → `OVH SAS`). Réponse filtrée : la base ne
 * renvoie ni courriel ni contact personnel.
 */
export async function ripeOrgName(ctx: ModuleContext, handle: string): Promise<string | null> {
  if (!/^ORG-[A-Z0-9-]+-RIPE$/i.test(handle)) return null
  try {
    const res = await ctx.fetchJson<{ objects?: { object?: Array<{ attributes?: { attribute?: Array<{ name: string; value: string }> } }> } }>(
      `https://rest.db.ripe.net/ripe/organisation/${encodeURIComponent(handle)}.json`,
      { headers: { accept: 'application/json' }, timeoutMs: 20000 }
    )
    const attrs = res.objects?.object?.[0]?.attributes?.attribute ?? []
    return attrs.find((a) => a.name === 'org-name')?.value?.trim() || null
  } catch (e) {
    throw serviceError(e, 'Base RIPE')
  }
}

/** Variante qui ne fait jamais échouer le module (donnée complémentaire). */
export async function optional<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch {
    return null
  }
}
