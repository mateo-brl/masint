// Client partagé de l'API interne de roso.info. Les routes, en-têtes et codes
// d'erreur viennent de la lecture du code client public du site (docs/roso.md).
// Toutes les requêtes passent par ctx.fetch (proxy / Tor respectés).

import { ModuleError, type ModuleContext } from '@shared/modules'
import type { KeyRequirement } from '@shared/types'

export const ROSO_BASE = 'https://roso.info'
export const ROSO_KEY_ID = 'roso'

export const ROSO_KEYS: KeyRequirement[] = [
  { id: ROSO_KEY_ID, label: 'roso.info API key (roso_…)', url: 'https://roso.info/account.html' }
]

/** Champs communs à tous les modules roso.info : à la demande uniquement (crédits). */
export const ROSO_COMMON = {
  category: 'roso' as const,
  keys: ROSO_KEYS,
  ondemand: true,
  experimental: true,
  homepage: ROSO_BASE
}

export type Json = Record<string, unknown>

export interface RosoRequest {
  method?: 'GET' | 'POST'
  json?: unknown
  query?: Record<string, string | number | undefined>
  headers?: Record<string, string>
  /** En-tête `X-Session-Id` (sessions email). */
  sessionId?: string
  timeoutMs?: number
  /** Réessais sur erreur réseau ou 5xx passager. Toujours 0 pour un appel qui débite des crédits. */
  retries?: number
  /** Statuts renvoyés tels quels au lieu de lever une erreur (ex. 404 = module indisponible). */
  accept?: number[]
  /** `false` : ne lève jamais d'erreur HTTP, l'appelant classe lui-même la réponse. */
  throwOnError?: boolean
  /** Page du site imitée dans l'en-tête Referer (`/email/`, `/username/`...). */
  page?: string
}

export interface RosoResponse {
  status: number
  ok: boolean
  data: Json
  text: string
}

const RETRYABLE = new Set([500, 502, 503, 504, 520, 521, 522, 523, 524])
const COOLDOWN_CODES = new Set(['free_cooldown', 'free_global_busy', 'free_global_rate'])

type Lang = 'fr' | 'en'
const t = (lang: Lang, fr: string, en: string): string => (lang === 'fr' ? fr : en)

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

export function parseJson(text: string): Json {
  try {
    const v = JSON.parse(text) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : { value: v }
  } catch {
    return {}
  }
}

export function captchaError(lang: Lang = 'fr'): ModuleError {
  return new ModuleError(
    t(
      lang,
      'roso.info exige un captcha (niveau gratuit) : MASINT ne peut pas le résoudre. Utilisez une clé Patreon / Boosted, ou lancez la recherche depuis le site.',
      'roso.info requires a captcha (free tier): MASINT cannot solve it. Use a Patreon / Boosted key, or run the search on the website.'
    ),
    'blocked'
  )
}

/** Traduit une réponse d'erreur de roso.info en ModuleError. */
export function toRosoError(status: number, body: Json, what: string, lang: Lang = 'fr'): ModuleError {
  const code = s(body.code)
  const msg = s(body.error) || s(body.message)
  const detail = msg ? ` (${msg})` : ''
  if (body.captcha === true || /captcha/i.test(code)) return captchaError(lang)
  if (code === 'key_expired' || code === 'key_revoked')
    return new ModuleError(t(lang, `Clé API roso.info expirée ou révoquée${detail}`, `roso.info API key expired or revoked${detail}`), 'auth')
  if (status === 401 || code === 'api_key_required' || code === 'invalid_key')
    return new ModuleError(
      t(lang, 'Clé API roso.info invalide : vérifiez la clé roso_… dans le coffre.', 'Invalid roso.info API key: check the roso_… key in the vault.'),
      'auth'
    )
  if (code === 'phone_session_required')
    return new ModuleError(t(lang, `roso.info : session téléphone refusée${detail}`, `roso.info: phone session refused${detail}`), 'other')
  if (status === 403 || code === 'module_forbidden')
    return new ModuleError(
      t(lang, `roso.info : module « ${what} » non autorisé pour cette clé${detail}`, `roso.info: module "${what}" not allowed for this key${detail}`),
      'auth'
    )
  if (status === 429) {
    if (COOLDOWN_CODES.has(code))
      return new ModuleError(t(lang, `roso.info : délai d'attente en cours${detail}`, `roso.info: cooldown in progress${detail}`), 'rate_limited')
    return new ModuleError(
      t(lang, `Crédits roso.info épuisés ou quota atteint${detail}`, `roso.info credits exhausted or quota reached${detail}`),
      'rate_limited'
    )
  }
  if (body.maintenance === true || status === 503)
    return new ModuleError(t(lang, `roso.info en maintenance${detail}`, `roso.info under maintenance${detail}`), 'unavailable')
  if (status >= 500)
    return new ModuleError(t(lang, `roso.info indisponible (HTTP ${status})`, `roso.info unavailable (HTTP ${status})`), 'unavailable')
  return new ModuleError(`roso.info : ${msg || `HTTP ${status}`}`, status === 400 ? 'invalid_input' : 'other')
}

/** Erreurs qui doivent interrompre tout le scan (clé refusée, crédits, captcha). */
export function isFatal(err: unknown): boolean {
  return err instanceof ModuleError && (err.code === 'auth' || err.code === 'rate_limited' || err.code === 'blocked')
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const timer = setTimeout(done, ms)
    function done(): void {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    function onAbort(): void {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Exécute `fn` sur chaque élément avec une concurrence bornée. Une erreur levée par `fn`
 * arrête la distribution des éléments restants puis est relancée.
 */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  signal: AbortSignal,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let failure: unknown = null
  const worker = async (): Promise<void> => {
    while (failure === null && !signal.aborted) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch (e) {
        if (failure === null) failure = e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker))
  if (failure !== null) throw failure
  if (signal.aborted) throw signal.reason ?? new Error('aborted')
  return results
}

export class RosoClient {
  readonly key: string
  readonly lang: Lang

  constructor(
    readonly ctx: ModuleContext,
    readonly module: string
  ) {
    this.lang = ctx.lang
    const key = ctx.key(ROSO_KEY_ID)?.trim()
    if (!key)
      throw new ModuleError(
        t(ctx.lang, 'Clé API roso.info manquante (coffre : roso).', 'Missing roso.info API key (vault: roso).'),
        'auth'
      )
    this.key = key
  }

  url(path: string): string {
    return /^https?:\/\//i.test(path) ? path : ROSO_BASE + (path.startsWith('/') ? '' : '/') + path
  }

  async request(path: string, opts: RosoRequest = {}): Promise<RosoResponse> {
    const url = this.url(path)
    const retries = opts.retries ?? 2
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-api-key': this.key,
      origin: ROSO_BASE,
      referer: ROSO_BASE + (opts.page ?? '/'),
      ...(opts.sessionId ? { 'x-session-id': opts.sessionId } : {}),
      ...opts.headers
    }
    for (let attempt = 0; ; attempt++) {
      if (this.ctx.signal.aborted) throw this.ctx.signal.reason ?? new Error('aborted')
      let res: Response
      try {
        res = await this.ctx.fetch(url, {
          method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'),
          headers,
          json: opts.json,
          query: opts.query,
          timeoutMs: opts.timeoutMs
        })
      } catch (e) {
        const name = e instanceof Error ? e.name : ''
        const timeout = name === 'TimeoutError' || name === 'AbortError'
        if (this.ctx.signal.aborted) throw e
        if (!timeout && attempt < retries) {
          await sleep(600 * (attempt + 1), this.ctx.signal)
          continue
        }
        const msg = timeout ? t(this.lang, 'délai dépassé', 'timed out') : e instanceof Error ? e.message : String(e)
        throw new ModuleError(`roso.info : ${msg}`, 'unavailable')
      }
      const text = await res.text().catch(() => '')
      const data = parseJson(text)
      if (RETRYABLE.has(res.status) && data.maintenance !== true && attempt < retries) {
        await sleep(800 * (attempt + 1), this.ctx.signal)
        continue
      }
      const accepted = res.ok || (opts.accept ?? []).includes(res.status)
      if (!accepted && opts.throwOnError !== false) throw toRosoError(res.status, data, this.module, this.lang)
      if (accepted && data.success === false && data.captcha === true && opts.throwOnError !== false) throw captchaError(this.lang)
      return { status: res.status, ok: res.ok, data, text }
    }
  }

  post(path: string, json: unknown, opts: RosoRequest = {}): Promise<RosoResponse> {
    return this.request(path, { ...opts, method: 'POST', json })
  }

  get(path: string, opts: RosoRequest = {}): Promise<RosoResponse> {
    return this.request(path, { ...opts, method: 'GET' })
  }

  /**
   * Démarre une recherche (`/api/gateway/<module>/start`, `/search`, `/check`...). Cet appel
   * débite les crédits : jamais réessayé, et une réponse `success: false` lève une erreur.
   */
  async launch(path: string, json: unknown, opts: RosoRequest = {}): Promise<Json> {
    const res = await this.request(path, { ...opts, method: 'POST', json, retries: 0, throwOnError: false })
    if (!res.ok || res.data.success === false) throw toRosoError(res.ok ? 400 : res.status, res.data, this.module, this.lang)
    return res.data
  }

  /** État de maintenance global et du module (routes publiques, sans crédit). */
  async checkMaintenance(module = this.module): Promise<void> {
    const check = async (m: string): Promise<void> => {
      const res = await this.request('/api/maintenance/status', {
        query: { module: m },
        retries: 1,
        timeoutMs: 15000,
        throwOnError: false
      }).catch(() => null)
      if (res?.data.maintenance === true) {
        const msg = s(res.data.message)
        throw new ModuleError(t(this.lang, `roso.info en maintenance${msg ? ` : ${msg}` : ''}`, `roso.info under maintenance${msg ? `: ${msg}` : ''}`), 'unavailable')
      }
    }
    await Promise.all([check('global'), check(module)])
  }

  /** `GET /api/auth/status` : validité de la clé, crédits, niveau. Ne consomme pas de crédit. */
  async status(): Promise<Json> {
    const res = await this.get('/api/auth/status', { query: { api_key: this.key }, retries: 1, throwOnError: false })
    if (!res.ok || res.data.success !== true) throw toRosoError(res.ok ? 401 : res.status, res.data, 'auth', this.lang)
    return res.data
  }
}

/** Retire la clé API d'une réponse avant de l'archiver dans `raw`. */
export function redact<T>(value: T, key: string): T {
  if (!key || value === undefined) return value
  try {
    return JSON.parse(JSON.stringify(value).split(key).join('roso_***')) as T
  } catch {
    return value
  }
}

/** Crédits restants tels que renvoyés par les différentes routes (`credits` ou `credits_remaining`). */
export function creditsOf(data: Json): number | undefined {
  for (const k of ['credits', 'credits_remaining', 'creditsLeft', 'remaining']) {
    const v = data[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}
