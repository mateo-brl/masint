// Sous-domaines connus d'après plusieurs sources passives interrogées en parallèle (journaux
// Certificate Transparency, DNS passif, bases de reconnaissance), fusionnées puis vérifiées
// en DNS : seuls les noms qui résolvent encore deviennent des entités.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList, compact, isDomain, normalizeDomain, pool, serviceError, sleep } from './_util'

const MAX_ENTITIES = 50
const MAX_LISTED = 1000
/** Noms vérifiés en DNS au plus, les plus courts d'abord ; les suivants restent « non vérifiés ». */
const MAX_VERIFIED = 500
const DNS_CONCURRENCY = 8
/** Temps laissé aux sources : celles qui n'ont pas répondu sont abandonnées. */
const SOURCES_BUDGET_MS = 70_000
/** Fin de la vérification DNS, comptée depuis le lancement (plafond du module : 180 s). */
const VERIFY_DEADLINE_MS = 150_000
/** CertSpotter anonyme : 10 requêtes par heure, on se limite à deux pages. */
const CERTSPOTTER_PAGES = 2
const THC_PAGES = 3

export interface CrtShRow {
  name_value?: string
  common_name?: string
  not_before?: string
  not_after?: string
  issuer_name?: string
}

export interface CertSpotterIssuance {
  id: string
  dns_names?: string[]
  not_before?: string
  not_after?: string
}

export interface ThcSubdomains {
  matching_records?: number
  domains?: Array<{ domain?: string; last_seen_on?: string }>
  next_page_state?: string | null
}

export interface OtxHostnamePdns {
  count?: number
  passive_dns?: Array<{ hostname?: string; address?: string; record_type?: string }>
}

/** Garde les noms appartenant au domaine, sans joker ni doublon. */
export function cleanSubdomains(domain: string, names: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const raw of names) {
    const n = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    if (!n || n === domain || n.includes('*') || n.includes(' ') || n.includes('@')) continue
    if (n.endsWith('.' + domain) && isDomain(n)) out.add(n)
  }
  return Array.from(out).sort(bySignificance)
}

/** Tri : les noms courts (moins profonds) d'abord, puis par ordre alphabétique. */
function bySignificance(a: string, b: string): number {
  return a.split('.').length - b.split('.').length || a.length - b.length || a.localeCompare(b)
}

export function parseCrtSh(domain: string, rows: CrtShRow[]): string[] {
  return cleanSubdomains(
    domain,
    rows.flatMap((r) => [...(r.name_value ?? '').split('\n'), r.common_name ?? ''])
  )
}

export function parseCertSpotter(domain: string, rows: CertSpotterIssuance[]): string[] {
  return cleanSubdomains(
    domain,
    rows.flatMap((r) => r.dns_names ?? [])
  )
}

/** Réponse texte de HackerTarget : `hôte,ip` par ligne. */
export function parseHackerTarget(domain: string, text: string): { names: string[]; ips: Record<string, string> } {
  if (/^error|api count exceeded|no records found/i.test(text.trim())) return { names: [], ips: {} }
  const ips: Record<string, string> = {}
  const names: string[] = []
  for (const line of text.split('\n')) {
    const [host, ip] = line.trim().split(',')
    if (!host) continue
    names.push(host)
    if (ip) ips[host.toLowerCase()] = ip
  }
  return { names: cleanSubdomains(domain, names), ips }
}

/** API JSON de ip.thc.org (`/api/v1/lookup/subdomains`). */
export function parseThc(domain: string, page: ThcSubdomains): string[] {
  return cleanSubdomains(
    domain,
    (page.domains ?? []).map((d) => d.domain ?? '')
  )
}

/** DNS passif d'OTX par nom d'hôte : les noms observés sous le domaine. */
export function parseOtxHostnames(domain: string, pdns: OtxHostnamePdns | null): string[] {
  return cleanSubdomains(
    domain,
    (pdns?.passive_dns ?? []).map((r) => r.hostname ?? '')
  )
}

/** Anubis renvoie un simple tableau de noms (ou un objet vide quand il ne connaît rien). */
export function parseAnubis(domain: string, json: unknown): string[] {
  return Array.isArray(json) ? cleanSubdomains(domain, json.filter((n): n is string => typeof n === 'string')) : []
}

/** Page HTML de RapidDNS : une cellule `<td>nom</td>` par enregistrement. */
export function parseRapidDns(domain: string, html: string): string[] {
  const cells = Array.from(html.matchAll(/<td[^>]*>\s*([a-z0-9_.*-]+)\s*<\/td>/gi), (m) => m[1])
  return cleanSubdomains(domain, cells)
}

type Loader = (signal: AbortSignal) => Promise<string[]>

async function fromCrtSh(ctx: ModuleContext, domain: string, signal: AbortSignal): Promise<string[]> {
  let last: unknown
  // crt.sh renvoie souvent 502/503 sous charge : une seule nouvelle tentative, délai court.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rows = await ctx.fetchJson<CrtShRow[]>('https://crt.sh/', {
        query: { q: `%.${domain}`, output: 'json' },
        timeoutMs: 25_000,
        signal
      })
      return parseCrtSh(domain, rows)
    } catch (e) {
      last = e
      const status = (e as { status?: number }).status
      if ((status && status < 500) || signal.aborted) break
      if (attempt === 0) await sleep(1500, signal)
    }
  }
  throw serviceError(last, 'crt.sh')
}

async function fromCertSpotter(ctx: ModuleContext, domain: string, signal: AbortSignal): Promise<string[]> {
  const rows: CertSpotterIssuance[] = []
  let after: string | undefined
  for (let page = 0; page < CERTSPOTTER_PAGES; page++) {
    const batch = await ctx.fetchJson<CertSpotterIssuance[]>('https://api.certspotter.com/v1/issuances', {
      query: { domain, include_subdomains: 'true', expand: 'dns_names', after },
      timeoutMs: 30_000,
      signal
    })
    rows.push(...batch)
    if (batch.length < 100) break
    after = batch[batch.length - 1].id
  }
  return parseCertSpotter(domain, rows)
}

async function fromHackerTarget(ctx: ModuleContext, domain: string, signal: AbortSignal): Promise<string[]> {
  const text = await ctx.fetchText('https://api.hackertarget.com/hostsearch/', { query: { q: domain }, timeoutMs: 30_000, signal })
  if (/api count exceeded/i.test(text)) throw new ModuleError('quota quotidien dépassé', 'rate_limited')
  return parseHackerTarget(domain, text).names
}

async function fromThc(ctx: ModuleContext, domain: string, signal: AbortSignal): Promise<string[]> {
  const names: string[] = []
  let pageState: string | undefined
  for (let page = 0; page < THC_PAGES; page++) {
    const res = await ctx.fetchJson<ThcSubdomains>('https://ip.thc.org/api/v1/lookup/subdomains', {
      method: 'POST',
      json: { domain, limit: 200, ...(pageState ? { page_state: pageState } : {}) },
      timeoutMs: 30_000,
      signal
    })
    names.push(...parseThc(domain, res))
    pageState = res.next_page_state ?? undefined
    if (!pageState || (res.domains ?? []).length < 200) break
  }
  return cleanSubdomains(domain, names)
}

async function fromOtx(ctx: ModuleContext, domain: string, signal: AbortSignal): Promise<string[]> {
  // La section « domain » est refusée en anonyme (429) ; la section « hostname » répond.
  const key = ctx.key('otx')
  const pdns = await ctx.fetchJson<OtxHostnamePdns>(`https://otx.alienvault.com/api/v1/indicators/hostname/${domain}/passive_dns`, {
    headers: key ? { 'X-OTX-API-KEY': key } : {},
    timeoutMs: 30_000,
    signal
  })
  return parseOtxHostnames(domain, pdns)
}

async function fromAnubis(ctx: ModuleContext, domain: string, signal: AbortSignal): Promise<string[]> {
  return parseAnubis(domain, await ctx.fetchJson<unknown>(`https://anubisdb.com/anubis/subdomains/${domain}`, { timeoutMs: 30_000, signal }))
}

async function fromRapidDns(ctx: ModuleContext, domain: string, signal: AbortSignal): Promise<string[]> {
  const html = await ctx.fetchText(`https://rapiddns.io/subdomain/${domain}`, { query: { full: 1 }, timeoutMs: 40_000, signal })
  return parseRapidDns(domain, html)
}

export interface SourceReport {
  name: string
  count: number
  error?: string
}

export type DnsCheck = { status: 'live'; a: string[]; cname: string[] } | { status: 'dead' } | { status: 'unchecked' }

/**
 * Vérifie qu'un nom résout encore : enregistrement A, sinon CNAME. Un échec de résolution
 * (réseau, délai) ne permet pas de conclure : le nom reste « non vérifié ».
 */
export async function checkName(ctx: ModuleContext, name: string): Promise<DnsCheck> {
  let failed = false
  try {
    const a = await ctx.resolveDns(name, 'A')
    if (a.length) return { status: 'live', a, cname: [] }
  } catch {
    failed = true
  }
  try {
    const cname = await ctx.resolveDns(name, 'CNAME')
    if (cname.length) return { status: 'live', a: [], cname: cname.map((c) => c.toLowerCase()) }
  } catch {
    failed = true
  }
  return failed ? { status: 'unchecked' } : { status: 'dead' }
}

/** Sortie du module : noms vivants en entités, noms morts et non vérifiés en propriétés. */
export function buildSubdomainOutput(names: string[], checks: Map<string, DnsCheck>, sources: SourceReport[], lang: 'fr' | 'en'): ModuleOutput {
  if (!names.length) return {}
  const live = names.filter((n) => checks.get(n)?.status === 'live')
  const dead = names.filter((n) => checks.get(n)?.status === 'dead')
  const unchecked = names.filter((n) => !checks.has(n) || checks.get(n)?.status === 'unchecked')
  const entities: OutEntity[] = live.slice(0, MAX_ENTITIES).map((n) => {
    const check = checks.get(n) as Extract<DnsCheck, { status: 'live' }>
    return {
      type: 'domain',
      label: n,
      data: compact({ a: check.a.slice(0, 5), cname: check.cname.slice(0, 3) }),
      linkLabel: lang === 'fr' ? 'sous-domaine' : 'subdomain'
    }
  })
  const properties: Record<string, PropValue> = compact({
    subdomain_count: names.length,
    ...cappedList('subdomains', live),
    ...cappedList('subdomains_unresolved', dead),
    ...cappedList('subdomains_unchecked', unchecked),
    subdomain_sources: sources.filter((s) => !s.error).map((s) => `${s.name} : ${s.count}`),
    subdomain_sources_failed: sources.filter((s) => s.error).map((s) => `${s.name} : ${s.error}`)
  })
  return {
    properties,
    entities,
    raw: {
      sources,
      count: names.length,
      live: live.slice(0, MAX_LISTED).map((n) => ({ name: n, ...checks.get(n) })),
      dead: dead.slice(0, MAX_LISTED),
      unchecked: unchecked.slice(0, MAX_LISTED)
    }
  }
}

/** Motif d'échec court d'une source (« quota dépassé », « délai dépassé »...). */
function sourceError(e: unknown, name: string, budgetExceeded: boolean): string {
  const timeout = e instanceof Error && (e.name === 'TimeoutError' || /timeout/i.test(e.message))
  if (timeout || (budgetExceeded && !(e instanceof ModuleError))) return 'délai dépassé'
  const message = serviceError(e, name).message
  return message.startsWith(name) ? message.slice(name.length).replace(/^\s*:?\s*/, '') : message
}

/** Interroge toutes les sources en parallèle ; une source lente ou en panne n'arrête pas les autres. */
async function collect(ctx: ModuleContext, domain: string): Promise<{ names: string[]; sources: SourceReport[] }> {
  const loaders: Array<[string, Loader]> = [
    ['crt.sh', (s) => fromCrtSh(ctx, domain, s)],
    ['Cert Spotter', (s) => fromCertSpotter(ctx, domain, s)],
    ['THC', (s) => fromThc(ctx, domain, s)],
    ['AlienVault OTX', (s) => fromOtx(ctx, domain, s)],
    ['Anubis', (s) => fromAnubis(ctx, domain, s)],
    ['RapidDNS', (s) => fromRapidDns(ctx, domain, s)],
    ['HackerTarget', (s) => fromHackerTarget(ctx, domain, s)]
  ]
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  ctx.signal.addEventListener('abort', stop)
  const timer = setTimeout(stop, SOURCES_BUDGET_MS)
  let done = 0
  // Sources abandonnées faute de temps : leur échec est un délai dépassé, pas une panne.
  const late = new Set<string>()
  const results = await Promise.allSettled(
    loaders.map(async ([name, load]) => {
      try {
        return await load(controller.signal)
      } catch (e) {
        if (controller.signal.aborted) late.add(name)
        throw e
      } finally {
        ctx.progress(++done, loaders.length, name)
      }
    })
  )
  clearTimeout(timer)
  ctx.signal.removeEventListener('abort', stop)
  if (ctx.signal.aborted) throw new ModuleError('Annulé', 'other')
  const all: string[] = []
  const sources: SourceReport[] = loaders.map(([name], i) => {
    const r = results[i]
    if (r.status === 'fulfilled') {
      all.push(...r.value)
      return { name, count: r.value.length }
    }
    const error = sourceError(r.reason, name, late.has(name))
    ctx.log(`${name} en échec : ${r.reason instanceof Error ? r.reason.message : r.reason}`)
    return { name, count: 0, error }
  })
  return { names: cleanSubdomains(domain, all), sources }
}

export default defineModule({
  id: 'domain.subdomains',
  name: { fr: 'Sous-domaines', en: 'Subdomains' },
  description: {
    fr: 'Sous-domaines connus d’après sept sources passives interrogées en parallèle (crt.sh, Cert Spotter, THC, AlienVault OTX, Anubis, RapidDNS, HackerTarget), fusionnés puis vérifiés en DNS. Seuls les noms qui résolvent encore deviennent des entités (50 au plus, les plus courts d’abord) ; les noms morts et les totaux par source restent dans la fiche.',
    en: 'Known subdomains from seven passive sources queried in parallel (crt.sh, Cert Spotter, THC, AlienVault OTX, Anubis, RapidDNS, HackerTarget), merged then checked in DNS. Only names that still resolve become entities (50 at most, shortest first); dead names and per-source totals stay in the record.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  homepage: 'https://crt.sh',
  timeoutMs: 180_000,
  async run(input, ctx) {
    const started = Date.now()
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    const { names, sources } = await collect(ctx, domain)
    // Toutes les sources ont échoué : erreur ; au moins une a répondu sans résultat : résultat vide.
    if (sources.every((s) => s.error)) throw new ModuleError(sources.map((s) => `${s.name} : ${s.error}`).join(' ; '), 'unavailable')
    if (!names.length) return {}

    const toCheck = names.slice(0, MAX_VERIFIED)
    const checks = new Map<string, DnsCheck>()
    let checked = 0
    await pool(toCheck, DNS_CONCURRENCY, async (name) => {
      if (ctx.signal.aborted || Date.now() - started > VERIFY_DEADLINE_MS) return
      checks.set(name, await checkName(ctx, name))
      ctx.progress(++checked, toCheck.length, 'DNS')
    })
    return buildSubdomainOutput(names, checks, sources, ctx.lang)
  }
})
