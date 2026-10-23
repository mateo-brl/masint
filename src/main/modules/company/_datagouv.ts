// API tabulaire de data.gouv.fr : filtres sur les colonnes d'un fichier CSV publié
// (`colonne__exact=`, `__contains=`, `__in=`, `__greater=`, `__less=`), pagination, et
// résolution du fichier à jour d'un jeu de données, dont l'identifiant de ressource change
// à chaque mise à jour. Les serveurs de l'État coupent parfois la connexion ou répondent
// « pool de connexions saturé » : chaque appel est retenté.

import { ModuleError, type ModuleContext } from '@shared/modules'
import { httpStatus } from '../social/_lib'
import { normName } from './_fr'

export const TABULAR_API = 'https://tabular-api.data.gouv.fr/api/resources'
export const DATASETS_API = 'https://www.data.gouv.fr/api/1/datasets'

/** Opérateurs de filtre de l'API tabulaire (`contains` ignore la casse, pas les accents). */
export type TabularOp = 'exact' | 'differs' | 'contains' | 'in' | 'less' | 'greater' | 'strictly_less' | 'strictly_greater'

export interface TabularFilter {
  column: string
  op: TabularOp
  value: string | number | boolean | Array<string | number>
}

export interface TabularPage<T> {
  data: T[]
  meta: { page: number; page_size: number; total: number }
  links?: { next?: string | null }
}

export interface RetryOptions {
  /** Nom du service affiché dans les erreurs. */
  service: string
  /** Nombre total de tentatives (4 par défaut). */
  attempts?: number
  /** Pause de base entre deux tentatives, multipliée par le rang de la tentative. */
  delayMs?: number
}

/** Erreur passagère : coupure réseau, délai dépassé, serveur saturé ou en panne. */
export function isTransient(e: unknown): boolean {
  if (e instanceof ModuleError) return e.code === 'unavailable'
  const status = httpStatus(e)
  if (status === undefined) return true
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function pause(ctx: Pick<ModuleContext, 'signal'>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ctx.signal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    ctx.signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })
}

/**
 * Exécute `call` en le retentant sur les erreurs passagères. Une erreur définitive (400, 404)
 * est relancée telle quelle ; après la dernière tentative, une `ModuleError` explicite est levée.
 */
export async function withRetry<T>(ctx: Pick<ModuleContext, 'signal'>, call: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const attempts = opts.attempts ?? 4
  const delay = opts.delayMs ?? 1500
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await call()
    } catch (e) {
      last = e
      if (!isTransient(e) || ctx.signal.aborted) break
      if (i < attempts - 1) await pause(ctx, delay * (i + 1))
    }
  }
  if (last instanceof ModuleError) throw last
  const status = httpStatus(last)
  if (status === 429) throw new ModuleError(`${opts.service} : trop de requêtes, réessayer plus tard`, 'rate_limited')
  if (status === 403) throw new ModuleError(`${opts.service} : accès bloqué (HTTP 403)`, 'blocked')
  if (status && status < 500 && status !== 408) throw last
  const detail = status ? `HTTP ${status}` : last instanceof Error ? last.message : String(last)
  throw new ModuleError(`${opts.service} injoignable après ${attempts} tentatives : ${detail}`, 'unavailable')
}

/** Paramètres d'URL d'une requête tabulaire. */
export function tabularQuery(
  filters: TabularFilter[],
  opts: { page?: number; pageSize?: number; sort?: { column: string; desc?: boolean } } = {}
): Record<string, string> {
  const q: Record<string, string> = {}
  for (const f of filters) {
    const v = Array.isArray(f.value) ? f.value.map(String).join(',') : String(f.value)
    q[`${f.column}__${f.op}`] = v
  }
  if (opts.sort) q[`${opts.sort.column}__sort`] = opts.sort.desc ? 'desc' : 'asc'
  q.page = String(opts.page ?? 1)
  q.page_size = String(opts.pageSize ?? 50)
  return q
}

export interface TabularOptions extends RetryOptions {
  page?: number
  pageSize?: number
  sort?: { column: string; desc?: boolean }
  /** Délai d'une requête : les filtres sur les gros fichiers sont lents (40 s pour la DECP). */
  timeoutMs?: number
}

/** Une page de résultats filtrés d'une ressource. */
export async function tabularPage<T>(ctx: ModuleContext, resourceId: string, filters: TabularFilter[], opts: TabularOptions): Promise<TabularPage<T>> {
  const query = tabularQuery(filters, opts)
  return withRetry(
    ctx,
    async () => {
      const res = await ctx.fetchJson<TabularPage<T>>(`${TABULAR_API}/${resourceId}/data/`, { query, timeoutMs: opts.timeoutMs ?? 30000 })
      if (!Array.isArray(res?.data)) throw new ModuleError(`${opts.service} : réponse inattendue de l'API tabulaire`, 'unavailable')
      return res
    },
    opts
  )
}

/** Toutes les lignes filtrées, page après page, dans la limite de `maxRows`. */
export async function tabularAll<T>(
  ctx: ModuleContext,
  resourceId: string,
  filters: TabularFilter[],
  opts: TabularOptions & { maxRows: number; onPage?: (fetched: number, total: number) => void }
): Promise<{ rows: T[]; total: number; complete: boolean }> {
  const pageSize = opts.pageSize ?? 50
  const rows: T[] = []
  let total = 0
  for (let page = 1; ; page++) {
    const res = await tabularPage<T>(ctx, resourceId, filters, { ...opts, page, pageSize })
    total = res.meta?.total ?? res.data.length
    rows.push(...res.data)
    opts.onPage?.(rows.length, total)
    if (!res.data.length || rows.length >= total || rows.length >= opts.maxRows || !res.links?.next) break
  }
  return { rows: rows.slice(0, opts.maxRows), total, complete: rows.length >= total }
}

export interface DgResource {
  id: string
  title: string
  format?: string | null
  type?: string
  last_modified?: string
  url?: string
  extras?: Record<string, unknown>
}

interface DgDataset {
  id: string
  slug?: string
  resources?: DgResource[]
}

/** Une ressource est interrogeable par l'API tabulaire quand son analyse est terminée. */
export function isTabular(r: DgResource): boolean {
  const x = r.extras ?? {}
  return !!(x['analysis:parsing:finished_at'] || x['analysis:parsing:parsing_table'])
}

/** Fichiers principaux d'un jeu de données, du plus récent au plus ancien. */
export function mainResources(resources: DgResource[], match?: (r: DgResource) => boolean): DgResource[] {
  return resources
    .filter((r) => (r.type ?? 'main') === 'main' && isTabular(r) && (!match || match(r)))
    .sort((a, b) => (b.last_modified ?? '').localeCompare(a.last_modified ?? ''))
}

// Cache des jeux de données : les fichiers changent au plus une fois par jour.
const CACHE_TTL_MS = 6 * 3600 * 1000
const cache = new Map<string, { at: number; value: Promise<DgResource[]> }>()

/** Vide le cache des jeux de données (tests). */
export function clearDatasetCache(): void {
  cache.clear()
}

/** Liste des fichiers d'un jeu de données (identifiant ou slug), mise en cache six heures. */
export function datasetResources(ctx: ModuleContext, dataset: string, opts: RetryOptions = { service: 'data.gouv.fr' }): Promise<DgResource[]> {
  const hit = cache.get(dataset)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = withRetry(
    ctx,
    async () => {
      const d = await ctx.fetchJson<DgDataset>(`${DATASETS_API}/${encodeURIComponent(dataset)}/`, { timeoutMs: 30000 })
      return d.resources ?? []
    },
    opts
  )
  cache.set(dataset, { at: Date.now(), value })
  // Un échec ne reste pas en cache : la prochaine exécution retente.
  value.catch(() => cache.delete(dataset))
  return value
}

/**
 * Identifiant du fichier le plus récent qui correspond à `match`. Si le jeu de données est
 * injoignable, on se rabat sur l'identifiant connu (`fallback`) plutôt que d'échouer.
 */
export async function latestResourceId(
  ctx: ModuleContext,
  dataset: string,
  match: (r: DgResource) => boolean,
  fallback: string
): Promise<string> {
  try {
    return mainResources(await datasetResources(ctx, dataset), match)[0]?.id ?? fallback
  } catch (e) {
    ctx.log(`jeu de données ${dataset} injoignable, ressource connue utilisée : ${e instanceof Error ? e.message : String(e)}`)
    return fallback
  }
}

/**
 * Applique `fn` à chaque élément, `limit` à la fois : l'API tabulaire sature quand on lui envoie
 * une douzaine de requêtes simultanées. Les échecs sont renvoyés à leur place, sans interrompre
 * les autres appels.
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const out: Array<PromiseSettledResult<R>> = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (reason) {
        out[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Variantes d'un nom pour un filtre `__in` : majuscules telles que saisies, puis sans accents. */
export function upperVariants(s: string): string[] {
  const upper = s.trim().replace(/\s+/g, ' ').toUpperCase()
  const plain = upper.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return upper === plain ? [upper] : [upper, plain]
}

/** Montant lisible en euros : `1 234 567 €`. */
export function euros(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  const rounded = Math.round(n * 100) / 100
  return `${rounded.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`
}

/** SIREN tiré d'un SIREN ou d'un SIRET, dans les propriétés ou le libellé d'une entreprise. */
export function sirenOf(label: string, data: Record<string, unknown>): string | null {
  for (const v of [data.siren, data.siret, label]) {
    if (typeof v !== 'string' && typeof v !== 'number') continue
    const d = String(v).replace(/[\s.]/g, '')
    if (/^\d{9}$/.test(d) || /^\d{14}$/.test(d)) return d.slice(0, 9)
  }
  return null
}

/** SIRET connu d'une entreprise (propriété ou libellé à 14 chiffres). */
export function siretOf(label: string, data: Record<string, unknown>): string | null {
  for (const v of [data.siret, label]) {
    if (typeof v !== 'string' && typeof v !== 'number') continue
    const d = String(v).replace(/[\s.]/g, '')
    if (/^\d{14}$/.test(d)) return d
  }
  return null
}

/**
 * La raison sociale commence-t-elle par le nom cherché (« Sanofi » pour « SANOFI PASTEUR ») ?
 * Évite les correspondances au milieu d'un nom (« Cabinet Orange » pour Orange).
 */
export function nameStartsWith(candidate: string, query: string): boolean {
  const q = normName(query)
  const n = normName(candidate)
  return !!q && (n === q || n.startsWith(`${q} `))
}

/** Raison sociale exploitable pour une recherche par nom (pas un simple numéro). */
export function companyName(label: string, data: Record<string, unknown>): string | null {
  const fromData = typeof data.name === 'string' ? data.name.trim() : ''
  if (fromData.length >= 2) return fromData
  const l = label.trim()
  return l.length >= 2 && !/^[\d\s.]+$/.test(l) ? l : null
}
