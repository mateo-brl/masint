// Utilitaires partagés par les modules email et téléphone : erreurs HTTP,
// nouvelle tentative après un 429, session avec cookies et sorties de
// vérification de compte.

import { createHash } from 'node:crypto'
import {
  defineModule,
  ModuleError,
  type FetchOptions,
  type InputEntity,
  type ModuleContext,
  type ModuleOutput,
  type OsintModule,
  type OutEntity
} from '@shared/modules'
import { findPlatformByName, getPlatform } from '@shared/platforms'
import type { I18nText, PropValue } from '@shared/types'

export const tr = (ctx: { lang: 'fr' | 'en' }, fr: string, en: string): string => (ctx.lang === 'fr' ? fr : en)

/**
 * User-Agent d'outil, pour les API qui refusent un User-Agent de navigateur (Firefox Accounts
 * répond 406) ou qui demandent qu'un outil s'identifie.
 */
export const TOOL_USER_AGENT = 'MASINT (https://github.com/mateo-brl/masint)'

export const md5 = (s: string): string => createHash('md5').update(s).digest('hex')
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

const EMAIL_RE = /^[^@\s]+@([a-z0-9-]+\.)+[a-z]{2,63}$/i

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Découpe une adresse ; `null` si la syntaxe est invalide. */
export function splitEmail(raw: string): { email: string; local: string; domain: string } | null {
  const email = normalizeEmail(raw)
  if (!EMAIL_RE.test(email)) return null
  const at = email.lastIndexOf('@')
  return { email, local: email.slice(0, at), domain: email.slice(at + 1) }
}

export function requireEmail(input: InputEntity): string {
  const parts = splitEmail(input.label)
  if (!parts) throw new ModuleError('Adresse email invalide', 'invalid_input')
  return parts.email
}

/** Erreur adaptée à un statut HTTP inattendu. */
export function httpFailure(service: string, status: number): ModuleError {
  if (status === 429) return new ModuleError(`${service} : trop de requêtes, réessayez plus tard`, 'rate_limited')
  if (status === 401) return new ModuleError(`${service} : authentification refusée (clé API ?)`, 'auth')
  if (status === 403) return new ModuleError(`${service} : accès refusé (protection anti-robot ou clé)`, 'blocked')
  if (status >= 500) return new ModuleError(`${service} : service indisponible (HTTP ${status})`, 'unavailable')
  return new ModuleError(`${service} : réponse inattendue (HTTP ${status})`, 'other')
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Annulé'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('Annulé'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Délai demandé par l'en-tête Retry-After (secondes ou date), en millisecondes. */
export function retryAfterMs(value: string | null, fallback: number): number {
  if (!value) return fallback
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? fallback : Math.max(0, date - Date.now())
}

/** fetch avec une nouvelle tentative après un 429 ou un 503 (Retry-After respecté, plafonné). */
export async function fetchRetry(
  ctx: ModuleContext,
  url: string,
  init: FetchOptions = {},
  opts: { retries?: number; maxWaitMs?: number } = {}
): Promise<Response> {
  const retries = opts.retries ?? 1
  const maxWait = opts.maxWaitMs ?? 8000
  for (let attempt = 0; ; attempt++) {
    const res = await ctx.fetch(url, init)
    if ((res.status !== 429 && res.status !== 503) || attempt >= retries) return res
    const wait = retryAfterMs(res.headers.get('retry-after'), 2000 * (attempt + 1))
    if (wait > maxWait) return res
    await res.body?.cancel().catch(() => undefined)
    await sleep(wait, ctx.signal)
  }
}

/** Lit un corps JSON ; lève une ModuleError si ce n'est pas du JSON. */
export async function readJson<T>(res: Response, service: string): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    if (!res.ok) throw httpFailure(service, res.status)
    throw new ModuleError(`${service} : réponse illisible (${text.slice(0, 80).replace(/\s+/g, ' ')})`, 'other')
  }
}

// ---------------------------------------------------------------------------
// Session HTTP avec cookies et redirections suivies à la main

export interface SessionResponse {
  res: Response
  /** URL finale après redirections. */
  url: string
}

export interface SessionRequestInit extends FetchOptions {
  /** Garde la méthode et le corps sur une redirection 301 / 302 / 303 (API qui changent de domaine). */
  keepMethod?: boolean
}

export interface Session {
  request(url: string, init?: SessionRequestInit): Promise<SessionResponse>
  cookie(name: string): string | undefined
}

export function createSession(ctx: ModuleContext, maxRedirects = 8): Session {
  const jar = new Map<string, string>()
  const store = (res: Response): void => {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] }
    const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
    for (const c of list) {
      const pair = c.split(';')[0]
      const i = pair.indexOf('=')
      if (i <= 0) continue
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (!value || /max-age=0\b|expires=thu, 01[ -]jan[ -]1970/i.test(c)) jar.delete(name)
      else jar.set(name, value)
    }
  }
  return {
    cookie: (name) => jar.get(name),
    async request(url, { keepMethod, ...init } = {}) {
      let target = url
      let opts: FetchOptions = init
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const headers = new Headers(opts.headers as ConstructorParameters<typeof Headers>[0])
        if (jar.size) headers.set('cookie', Array.from(jar, ([k, v]) => `${k}=${v}`).join('; '))
        const res = await ctx.fetch(target, { ...opts, headers, redirect: 'manual' })
        store(res)
        const location = res.headers.get('location')
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => undefined)
          target = new URL(location, target).toString()
          const method = (opts.method ?? 'GET').toUpperCase()
          const keepBody = res.status === 307 || res.status === 308 || !!keepMethod
          opts = keepBody ? { ...opts, query: undefined } : { headers: init.headers, timeoutMs: init.timeoutMs }
          if (!keepBody && method !== 'GET') opts.method = 'GET'
          continue
        }
        return { res, url: target }
      }
      throw new ModuleError('Trop de redirections', 'other')
    }
  }
}

// ---------------------------------------------------------------------------
// Sorties

/**
 * Entité compte. Si la plateforme n'existe pas encore dans le catalogue,
 * le nom du service est ajouté au libellé pour éviter les fusions entre services.
 */
export function accountEntity(
  platformId: string,
  service: string,
  label: string,
  extra: Omit<OutEntity, 'type' | 'label' | 'platform'> = {}
): OutEntity {
  const known = !!getPlatform(platformId)
  return {
    type: 'account',
    label: known ? label : `${service} : ${label}`,
    ...(known ? { platform: platformId } : {}),
    ...extra
  }
}

const SERVICE_ALIASES: Record<string, string> = { twitter: 'x', 'x.com': 'x', stackexchange: 'stackoverflow' }

/** Plateforme sociale ou de messagerie à partir d'un nom de service ou d'un domaine. */
export function socialPlatform(...names: Array<string | undefined>): string | undefined {
  for (const n of names) {
    if (!n) continue
    const key = n.toLowerCase()
    if (SERVICE_ALIASES[key]) return SERVICE_ALIASES[key]
    const p = findPlatformByName(key.replace(/\.(com|net|org|io|tv|me|app)$/, ''))
    if (p && (p.category === 'social' || p.category === 'messaging')) return p.id
  }
  return undefined
}

/** Retire les valeurs vides pour garder des fiches lisibles. */
export function compact(data: Record<string, PropValue | undefined>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}

/** Date ISO 8601 (jour) à partir d'une date ou d'un horodatage Unix en secondes. */
export function isoDay(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

export interface CheckResult {
  /**
   * `true` : compte trouvé ; `false` : absent ; `null` : le service ne permet pas de conclure
   * à l'absence (Flickr ne confirme que les comptes existants). Ni « trouvé » ni « absent ».
   */
  found: boolean | null
  /** Libellé du compte (pseudo) ; par défaut l'identifiant vérifié. */
  label?: string
  data?: Record<string, PropValue | undefined>
  image?: string
  /** Propriétés fusionnées dans l'entité d'entrée. */
  properties?: Record<string, PropValue | undefined>
  /** Entités supplémentaires (liées au compte via `from: 'account'`). */
  extra?: OutEntity[]
  raw?: unknown
}

export interface AccountCheckDef {
  id: string
  service: string
  platform: string
  inputTypes?: string[]
  category?: 'email' | 'phone'
  description: I18nText
  name?: I18nText
  homepage?: string
  experimental?: boolean
  /** Uniquement sur demande explicite (sites pour adultes, services sensibles). */
  ondemand?: boolean
  keys?: OsintModule['keys']
  accepts?: OsintModule['accepts']
  timeoutMs?: number
  check(value: string, ctx: ModuleContext, input: InputEntity): Promise<CheckResult>
}

/** Fabrique un module de vérification de compte (entrée email ou téléphone). */
export function accountCheck(def: AccountCheckDef): OsintModule {
  const inputTypes = def.inputTypes ?? ['email']
  return defineModule({
    id: def.id,
    name: def.name ?? { fr: `Compte ${def.service}`, en: `${def.service} account` },
    description: def.description,
    category: def.category ?? (inputTypes[0] === 'phone' ? 'phone' : 'email'),
    inputTypes,
    homepage: def.homepage,
    experimental: def.experimental,
    ondemand: def.ondemand,
    keys: def.keys,
    accepts: def.accepts,
    timeoutMs: def.timeoutMs,
    async run(input, ctx): Promise<ModuleOutput> {
      const value = input.type === 'email' ? requireEmail(input) : input.label.trim()
      const r = await def.check(value, ctx, input)
      if (r.found === null) return { ...(r.properties ? { properties: compact(r.properties) } : {}), raw: r.raw }
      if (!r.found) return { found: false, ...(r.properties ? { properties: compact(r.properties) } : {}), raw: r.raw }
      const entities: OutEntity[] = [
        accountEntity(def.platform, def.service, r.label || value, {
          ref: 'account',
          data: compact(r.data ?? {}),
          image: r.image,
          linkLabel: tr(ctx, `compte ${def.service}`, `${def.service} account`),
          // Inscription vérifiée avec l'adresse elle-même : même identité.
          strength: 'same'
        }),
        ...(r.extra ?? []).map((e) => ({ from: 'account', ...e }))
      ]
      return { found: true, entities, ...(r.properties ? { properties: compact(r.properties) } : {}), raw: r.raw }
    }
  })
}
