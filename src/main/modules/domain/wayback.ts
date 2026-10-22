import { defineModule, ModuleError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { compact, normalizeDomain, serviceError } from './_util'

const CDX = 'https://web.archive.org/cdx/search/cdx'

/** `19970126045828` → `1997-01-26T04:58:28.000Z` */
export function waybackDate(ts: string | undefined): string | null {
  const m = ts?.match(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/)
  if (!m) return null
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export interface Capture {
  timestamp: string
  original: string
  status?: string
}

/** Réponse CDX en JSON : première ligne = en-têtes. */
export function parseCdx(rows: string[][]): Capture[] {
  if (!Array.isArray(rows) || rows.length < 2) return []
  const [header, ...data] = rows
  const ti = header.indexOf('timestamp')
  const oi = header.indexOf('original')
  const si = header.indexOf('statuscode')
  return data.map((r) => ({ timestamp: r[ti], original: oi >= 0 ? r[oi] : '', status: si >= 0 ? r[si] : undefined }))
}

/** Réponse du service « sparkline » : nombre de captures par mois pour chaque année. */
export interface Sparkline {
  years?: Record<string, number[]>
  first_ts?: string
  last_ts?: string
}

export interface Availability {
  archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string; status?: string } }
}

export interface WaybackSummary {
  first?: Capture | null
  last?: Capture | null
  captures?: number | null
  years?: string[]
}

export function summarizeSparkline(s: Sparkline): WaybackSummary {
  const years = Object.entries(s.years ?? {})
    .filter(([, months]) => months.some((n) => n > 0))
    .map(([y]) => y)
    .sort()
  const captures = Object.values(s.years ?? {}).reduce((sum, months) => sum + months.reduce((a, b) => a + b, 0), 0)
  return {
    first: s.first_ts ? { timestamp: s.first_ts, original: '' } : null,
    last: s.last_ts ? { timestamp: s.last_ts, original: '' } : null,
    captures: years.length ? captures : null,
    years
  }
}

const snapshotUrl = (c: Capture, target: string): string => `https://web.archive.org/web/${c.timestamp}/${c.original || target}`

/**
 * Les archives sont des propriétés du domaine (dates, liens, nombre de captures) : des nœuds
 * `web.archive.org` encombreraient le graphe sans rien apprendre de plus sur la cible.
 */
export function buildWaybackOutput(target: string, w: WaybackSummary): ModuleOutput {
  if (!w.first && !w.last) return {}
  const properties = compact({
    wayback_first_seen: waybackDate(w.first?.timestamp),
    wayback_first_url: w.first ? snapshotUrl(w.first, target) : null,
    wayback_last_seen: waybackDate(w.last?.timestamp),
    wayback_last_url: w.last && w.last.timestamp !== w.first?.timestamp ? snapshotUrl(w.last, target) : null,
    wayback_captures: w.captures ?? null,
    wayback_years: w.years ?? [],
    wayback_url: `https://web.archive.org/web/*/${target}*`
  })
  return { properties, raw: w }
}

async function cdxOne(ctx: ModuleContext, target: string, limit: number): Promise<Capture | null> {
  const rows = await ctx.fetchJson<string[][]>(CDX, {
    query: { url: target, output: 'json', fl: 'timestamp,original,statuscode', limit, ...(limit < 0 ? { fastLatest: 'true' } : {}) },
    timeoutMs: 30000
  })
  return parseCdx(rows)[0] ?? null
}

async function fromCdx(ctx: ModuleContext, target: string): Promise<WaybackSummary> {
  const [first, last, spark] = await Promise.all([
    cdxOne(ctx, target, 1),
    cdxOne(ctx, target, -1),
    ctx
      .fetchJson<Sparkline>('https://web.archive.org/__wb/sparkline', {
        query: { output: 'json', url: target, collection: 'web' },
        timeoutMs: 20000
      })
      .then(summarizeSparkline)
      .catch(() => null)
  ])
  return { first, last, captures: spark?.captures ?? null, years: spark?.years }
}

/** Repli : API « available » d'archive.org (capture la plus proche d'une date). */
async function fromAvailability(ctx: ModuleContext, target: string): Promise<WaybackSummary> {
  const closest = async (timestamp?: string): Promise<Capture | null> => {
    const res = await ctx.fetchJson<Availability>('https://archive.org/wayback/available', { query: { url: target, timestamp } })
    const c = res.archived_snapshots?.closest
    if (!c?.available || !c.timestamp) return null
    const original = c.url?.replace(/^https?:\/\/web\.archive\.org\/web\/\d+\//, '') ?? ''
    return { timestamp: c.timestamp, original, status: c.status }
  }
  const [first, last] = await Promise.all([closest('19960101'), closest()])
  return { first, last }
}

export default defineModule({
  id: 'domain.wayback',
  name: { fr: 'Historique Wayback Machine', en: 'Wayback Machine history' },
  description: {
    fr: 'Première et dernière capture d’Internet Archive, nombre de captures et années archivées. Liens directs vers les archives.',
    en: 'First and last Internet Archive captures, number of captures and archived years. Direct links to the snapshots.'
  },
  category: 'domain',
  inputTypes: ['domain', 'url', 'website'],
  homepage: 'https://web.archive.org',
  experimental: true,
  timeoutMs: 90000,
  async run(input, ctx) {
    const target = input.type === 'domain' ? normalizeDomain(input.label) : input.label.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
    if (!target) throw new ModuleError('Cible vide', 'invalid_input')
    let summary: WaybackSummary
    try {
      summary = await fromCdx(ctx, target)
    } catch (e) {
      if (ctx.signal.aborted) throw e
      ctx.log(`CDX en échec, repli sur l'API available : ${e instanceof Error ? e.message : e}`)
      try {
        summary = await fromAvailability(ctx, target)
      } catch (e2) {
        throw serviceError(e2, 'Wayback Machine')
      }
    }
    return buildWaybackOutput(target, summary)
  }
})
