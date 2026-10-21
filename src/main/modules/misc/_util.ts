// Utilitaires communs aux modules crypto, finance, entreprises, lieux, images et forensic.

import { ModuleError, type FetchOptions, type HttpError, type ModuleContext } from '@shared/modules'

/** Texte selon la langue de l'interface. */
export function tr(ctx: Pick<ModuleContext, 'lang'>, fr: string, en: string): string {
  return ctx.lang === 'fr' ? fr : en
}

/** Convertit un horodatage (secondes, millisecondes ou texte) en date ISO 8601. */
export function isoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '' || v === 0) return null
  let d: Date
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v)
  else d = new Date(String(v).trim().replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Traduit une erreur réseau ou HTTP en `ModuleError` explicite. */
export function serviceError(e: unknown, service: string, keyed = false): ModuleError {
  if (e instanceof ModuleError) return e
  const status = (e as Partial<HttpError>)?.status
  if (status === 401 || (keyed && status === 403)) return new ModuleError(`${service} : clé API refusée ou absente`, 'auth')
  if (status === 403) return new ModuleError(`${service} : accès bloqué (HTTP 403)`, 'blocked')
  if (status === 429) return new ModuleError(`${service} : quota dépassé, réessayer plus tard`, 'rate_limited')
  if (status && status >= 500) return new ModuleError(`${service} indisponible (HTTP ${status})`, 'unavailable')
  if (status) return new ModuleError(`${service} : réponse inattendue (HTTP ${status})`, 'other')
  const msg = e instanceof Error ? e.message : String(e)
  return new ModuleError(`${service} injoignable : ${msg}`, 'unavailable')
}

/** Requête JSON : renvoie `null` sur 404 (résultat vide), lève une `ModuleError` sinon. */
export async function getJson<T>(
  ctx: ModuleContext,
  url: string,
  service: string,
  init: FetchOptions & { keyed?: boolean; notFoundStatus?: number[] } = {}
): Promise<T | null> {
  const { keyed, notFoundStatus = [404], ...rest } = init
  try {
    return await ctx.fetchJson<T>(url, rest)
  } catch (e) {
    const status = (e as Partial<HttpError>)?.status
    if (status && notFoundStatus.includes(status)) return null
    throw serviceError(e, service, keyed)
  }
}

/** Montant entier (satoshis, wei...) converti en unités, sans perte pour les entiers exacts. */
export function formatUnits(raw: string | number | bigint, decimals: number): string {
  if (typeof raw === 'number' && !Number.isSafeInteger(raw)) {
    // Valeur déjà arrondie par JSON.parse : on se contente de 4 décimales.
    return trimZeros((raw / 10 ** decimals).toFixed(Math.min(decimals, 4)))
  }
  let v = BigInt(raw)
  const neg = v < 0n
  if (neg) v = -v
  const base = 10n ** BigInt(decimals)
  const int = v / base
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + int.toString() + (frac ? '.' + frac : '')
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Montant lisible avec son symbole : `0.5 BTC`. */
export function coin(raw: string | number | bigint, decimals: number, symbol: string): string {
  return `${formatUnits(raw, decimals)} ${symbol}`
}

/** Retire les balises HTML et décode les entités courantes. */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}

export function uniq<T>(list: Iterable<T>): T[] {
  return Array.from(new Set(list))
}

/** Valeur numérique finie ou `null`. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Retire les valeurs vides (null, chaîne vide, liste vide) d'un objet de propriétés. */
export function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out as T
}
