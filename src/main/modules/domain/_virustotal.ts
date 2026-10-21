// Accès commun à l'API VirusTotal v3 (domaines, IP, URL).

import type { KeyRequirement, PropValue } from '@shared/types'
import type { ModuleContext } from '@shared/modules'
import { compact, getJsonOrNull, isoDate, requireKey, uniq } from './_util'

export const VT_KEY: KeyRequirement = {
  id: 'virustotal',
  label: 'VirusTotal API key',
  url: 'https://www.virustotal.com/gui/my-apikey'
}

export interface VtAttributes {
  last_analysis_stats?: { harmless?: number; malicious?: number; suspicious?: number; undetected?: number; timeout?: number }
  last_analysis_results?: Record<string, { category?: string; result?: string; engine_name?: string }>
  last_analysis_date?: number
  reputation?: number
  categories?: Record<string, string>
  tags?: string[]
  total_votes?: { harmless?: number; malicious?: number }
  registrar?: string
  creation_date?: number
  last_dns_records?: Array<{ type: string; value: string }>
  whois?: string
  as_owner?: string
  asn?: number
  country?: string
  network?: string
  regional_internet_registry?: string
  title?: string
  url?: string
  last_final_url?: string
  last_http_response_code?: number
  first_submission_date?: number
  times_submitted?: number
}

export async function vtGet(ctx: ModuleContext, path: string): Promise<VtAttributes | null> {
  const key = requireKey(ctx, VT_KEY.id, 'VirusTotal')
  const res = await getJsonOrNull<{ data?: { attributes?: VtAttributes } }>(
    ctx,
    `https://www.virustotal.com/api/v3/${path}`,
    'VirusTotal',
    { headers: { 'x-apikey': key } },
    true
  )
  return res?.data?.attributes ?? null
}

/** Propriétés communes : détections, réputation, catégories. */
export function vtProperties(a: VtAttributes, link: string): Record<string, PropValue> {
  const stats = a.last_analysis_stats ?? {}
  const flagged = Object.values(a.last_analysis_results ?? {})
    .filter((r) => r.category === 'malicious' || r.category === 'suspicious')
    .map((r) => `${r.engine_name ?? '?'}: ${r.result ?? r.category}`)
  return compact({
    vt_malicious: stats.malicious ?? 0,
    vt_suspicious: stats.suspicious ?? 0,
    vt_harmless: stats.harmless ?? 0,
    vt_undetected: stats.undetected ?? 0,
    vt_detections: flagged.slice(0, 30),
    vt_reputation: a.reputation ?? null,
    vt_categories: uniq(Object.values(a.categories ?? {})),
    vt_tags: a.tags ?? [],
    vt_votes_malicious: a.total_votes?.malicious ?? null,
    vt_last_analysis_at: a.last_analysis_date ? isoDate(a.last_analysis_date) : null,
    vt_link: link
  })
}
