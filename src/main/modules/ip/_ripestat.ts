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

export const prefixOverview = (ctx: ModuleContext, r: string): Promise<PrefixOverview> => ripe(ctx, 'prefix-overview', r)
export const asOverview = (ctx: ModuleContext, r: string): Promise<AsOverview> => ripe(ctx, 'as-overview', r)
export const announcedPrefixes = (ctx: ModuleContext, r: string): Promise<AnnouncedPrefixes> => ripe(ctx, 'announced-prefixes', r)
export const abuseContacts = (ctx: ModuleContext, r: string): Promise<AbuseContacts> => ripe(ctx, 'abuse-contact-finder', r)
export const rirCountry = (ctx: ModuleContext, r: string): Promise<RirCountry> => ripe(ctx, 'rir-stats-country', r)
export const geoLite = (ctx: ModuleContext, r: string): Promise<GeoLite> => ripe(ctx, 'maxmind-geo-lite', r)

/** Variante qui ne fait jamais échouer le module (donnée complémentaire). */
export async function optional<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch {
    return null
  }
}
