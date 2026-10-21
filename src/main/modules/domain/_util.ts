// Utilitaires partagés des modules domaine, IP et web.

import { ModuleError, type HttpError, type ModuleContext } from '@shared/modules'
import type { PropValue } from '@shared/types'

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

export function isIPv4(s: string): boolean {
  return IPV4.test(s)
}

export function isIPv6(s: string): boolean {
  return s.includes(':') && /^[0-9a-f:.]+$/i.test(s) && s.split(':').length > 2
}

/** Nom d'hôte nu : sans schéma, chemin, port ni point final, en minuscules. */
export function normalizeHost(raw: string): string {
  let s = raw.trim().toLowerCase()
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  s = s.split(/[/?#]/)[0]
  s = s.replace(/^[^@]*@/, '')
  const bracketed = s.match(/^\[([0-9a-f:.]+)\](?::\d+)?$/)
  if (bracketed) return bracketed[1]
  // Un seul « : » : c'est un port, pas une adresse IPv6.
  if (s.split(':').length === 2) s = s.replace(/:\d+$/, '')
  return s.replace(/\.$/, '').replace(/^\*\./, '')
}

/** Domaine saisi par l'enquêteur, sans `www.`. */
export function normalizeDomain(raw: string): string {
  return normalizeHost(raw).replace(/^www\./, '')
}

export function isDomain(s: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i.test(s)
}

/** Le domaine puis ses parents (`a.b.example.com` → `a.b.example.com`, `b.example.com`, `example.com`). */
export function domainAndParents(domain: string): string[] {
  const labels = domain.split('.')
  const out: string[] = []
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'))
  return out
}

/** URL complète à partir d'une saisie (ajoute `https://` si besoin). */
export function toUrl(raw: string): string {
  const s = raw.trim()
  if (/^https?:\/\//i.test(s)) return s
  return 'https://' + s.replace(/^\/+/, '')
}

export function uniq<T>(list: Iterable<T>): T[] {
  return Array.from(new Set(list))
}

/** Convertit un horodatage (secondes, millisecondes ou texte) en date ISO 8601. */
export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  let d: Date
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v)
  else d = new Date(String(v).replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Traduit une erreur réseau ou HTTP en `ModuleError` explicite. */
export function serviceError(e: unknown, service: string, keyed = false): ModuleError {
  if (e instanceof ModuleError) return e
  const status = (e as Partial<HttpError>)?.status
  if (status === 401 || (keyed && status === 403)) return new ModuleError(`${service} : clé API refusée`, 'auth')
  if (status === 403) return new ModuleError(`${service} : accès bloqué (HTTP 403)`, 'blocked')
  if (status === 429) return new ModuleError(`${service} : quota dépassé, réessayer plus tard`, 'rate_limited')
  if (status && status >= 500) return new ModuleError(`${service} indisponible (HTTP ${status})`, 'unavailable')
  if (status) return new ModuleError(`${service} : réponse inattendue (HTTP ${status})`, 'other')
  const msg = e instanceof Error ? e.message : String(e)
  return new ModuleError(`${service} injoignable : ${msg}`, 'unavailable')
}

/** GET JSON qui renvoie `null` sur 404 (résultat vide) et lève une `ModuleError` sinon. */
export async function getJsonOrNull<T>(
  ctx: ModuleContext,
  url: string,
  service: string,
  init: Parameters<ModuleContext['fetchJson']>[1] = {},
  keyed = false
): Promise<T | null> {
  try {
    return await ctx.fetchJson<T>(url, init)
  } catch (e) {
    if ((e as Partial<HttpError>)?.status === 404) return null
    throw serviceError(e, service, keyed)
  }
}

export function requireKey(ctx: ModuleContext, id: string, service: string): string {
  const key = ctx.key(id)
  if (!key) throw new ModuleError(`Clé API ${service} manquante`, 'auth')
  return key
}

/** Libellé bilingue court. */
export function tr(ctx: ModuleContext, fr: string, en: string): string {
  return ctx.lang === 'fr' ? fr : en
}

/** Petite pause interruptible (réessais). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Annulé'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('Annulé'))
    })
  })
}

/** Exécute des tâches avec un nombre maximal en parallèle. */
export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const worker = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return out
}

/** Nom de pays (selon la langue) à partir d'un code ISO à deux lettres. */
export function countryName(code: string | null | undefined, lang: 'fr' | 'en'): string | null {
  if (!code || !/^[a-z]{2}$/i.test(code)) return null
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

/** Retire les propriétés vides (null, chaîne vide, liste vide). */
export function compact(props: Record<string, PropValue | undefined>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue
    out[k] = v
  }
  return out
}
