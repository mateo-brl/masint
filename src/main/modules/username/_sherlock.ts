// Moteur de recherche de pseudo sur des centaines de sites, d'après la base et les
// règles de détection de Sherlock (https://github.com/sherlock-project/sherlock, MIT).
// Types de détection : status_code, message, response_url ; options regexCheck,
// urlProbe, request_method, request_payload, headers, errorCode.

import type { ModuleContext } from '@shared/modules'
import rawData from '../../../../resources/data/sherlock-sites.json'

export interface SherlockSite {
  name: string
  url: string
  urlMain: string
  urlProbe?: string
  errorType: string | string[]
  errorMsg?: string | string[]
  errorCode?: number | number[]
  errorUrl?: string
  regexCheck?: string
  request_method?: string
  request_payload?: unknown
  headers?: Record<string, string>
  isNSFW?: boolean
  username_claimed?: string
}

export type SiteStatus = 'claimed' | 'available' | 'illegal' | 'waf' | 'error'

export interface SiteResult {
  site: string
  url: string
  status: SiteStatus
  httpStatus?: number
  error?: string
}

/**
 * Sites écartés : faux positifs mesurés (pseudo aléatoire inexistant détecté comme présent),
 * détection devenue inopérante, ou résultat qui n'est pas un compte. Voir resources/data/README.md.
 */
export const BLACKLIST: Record<string, string> = {
  // Pas un compte.
  HudsonRock: "recherche dans des journaux d'infostealers, pas un compte (module dédié ailleurs)",
  // Faux positifs systématiques sur 3 pseudos aléatoires inexistants (mesure du 21/10/2026).
  '7Cups': 'faux positif (HTTP 202 pour tout pseudo)',
  'Apple Developer': 'faux positif (HTTP 200 pour tout pseudo)',
  'Apple Discussions': "faux positif (message d'erreur absent)",
  'Archive.org': "faux positif (message d'erreur absent)",
  Blipfoto: 'faux positif (HTTP 200 pour tout pseudo)',
  Championat: 'faux positif (HTTP 200 pour tout pseudo)',
  Clozemaster: "faux positif (message d'erreur absent)",
  Codolio: "faux positif (application monopage)",
  EyeEm: 'faux positif (HTTP 200 pour tout pseudo)',
  'F3.cool': 'faux positif (HTTP 200 pour tout pseudo)',
  GaiaOnline: "faux positif (message d'erreur absent)",
  GeeksforGeeks: "faux positif (message d'erreur absent)",
  Hashnode: 'faux positif (application monopage)',
  Houzz: 'faux positif (HTTP 200 pour tout pseudo)',
  Hubski: "faux positif (message d'erreur absent)",
  Ifunny: 'faux positif (HTTP 200 pour tout pseudo)',
  Instapaper: 'faux positif (HTTP 200 pour tout pseudo)',
  Odysee: 'faux positif (application monopage)',
  Rarible: 'faux positif (API qui répond 200 pour tout pseudo)',
  Realmeye: "faux positif (message d'erreur absent)",
  Reddit: 'faux positif (page de blocage en HTTP 200 ; module social.reddit dédié)',
  Scribd: "faux positif (message d'erreur absent)",
  Shelf: 'faux positif (HTTP 200 pour tout pseudo)',
  SlideShare: "faux positif (message d'erreur absent)",
  Splice: 'faux positif (application monopage)',
  Spotify: 'faux positif (application monopage)',
  Tweakers: 'faux positif (HTTP 200 pour tout pseudo)',
  Velomania: "faux positif (message d'erreur absent)",
  Weblate: 'faux positif (HTTP 200 pour tout pseudo)',
  authorSTREAM: 'faux positif (HTTP 200 pour tout pseudo)',
  mercadolivre: 'faux positif (HTTP 200 pour tout pseudo)',
  opennet: "faux positif (message d'erreur absent)",
  'social.tchncs.de': 'faux positif (application monopage)',
  svidbook: 'faux positif (HTTP 200 pour tout pseudo)',
  threads: 'faux positif (mur de connexion sans le message attendu)',
  // Faux positif intermittent (forum surchargé qui répond 200 sans le message).
  igromania: 'faux positif intermittent'
}

/** Pages de pare-feu applicatif reconnues par Sherlock (faux résultats à ignorer). */
const WAF_MARKERS = [
  '.loading-spinner{visibility:hidden}body.no-js .challenge-running{display:none}body.dark{background-color:#222;color:#d9d9d9}body.dark a{color:#fff}body.dark a:hover{color:#ee730a;text-decoration:underline}body.dark .lds-ring div{border-color:#999 transparent transparent}body.dark .font-red{color:#b20f03}body.dark',
  '<span id="challenge-error-text">',
  'AwsWafIntegration.forceRefreshToken',
  '{return l.onPageView}}),Object.defineProperty(r,"perimeterxIdentifiers",{enumerable:'
]

/**
 * Corrections locales de la base, vérifiées en direct. Twitch sert la balise `content` tantôt
 * entre apostrophes, tantôt entre guillemets : le message d'erreur est réduit à la phrase seule,
 * absente des pages de comptes existants (audit du 22/10/2026).
 */
export const OVERRIDES: Record<string, Partial<SherlockSite>> = {
  Twitch: { errorMsg: 'Twitch is the world&#39;s leading video platform and community for gamers.' }
}

const MAX_BODY = 3 * 1024 * 1024

let cache: SherlockSite[] | null = null

/** Tous les sites de la base (hors métadonnées `$schema`), corrections locales appliquées. */
export function allSites(): SherlockSite[] {
  if (!cache) {
    const data = rawData as unknown as Record<string, Omit<SherlockSite, 'name'> | string>
    cache = Object.entries(data)
      .filter(([name, v]) => !name.startsWith('$') && typeof v === 'object' && v !== null)
      .map(([name, v]) => ({ name, ...(v as Omit<SherlockSite, 'name'>), ...OVERRIDES[name] }))
  }
  return cache
}

/** Sites retenus pour une recherche : sans la liste noire, NSFW ou non. */
export function selectSites(opts: { nsfw: boolean }): SherlockSite[] {
  return allSites().filter((s) => !BLACKLIST[s.name] && !!s.isNSFW === opts.nsfw)
}

/** Remplace `{}` par le pseudo dans une chaîne, un objet ou une liste (comme Sherlock). */
export function interpolate<T>(value: T, username: string): T {
  if (typeof value === 'string') return value.split('{}').join(username) as T
  if (Array.isArray(value)) return value.map((v) => interpolate(v, username)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, username)
    return out as T
  }
  return value
}

const regexCache = new Map<string, RegExp | null>()

/** Compile une expression Python en RegExp JavaScript (`{,n}` devient `{0,n}`). */
export function compileRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!
  let re: RegExp | null
  try {
    re = new RegExp(pattern.replace(/\{,(\d+)\}/g, '{0,$1}'), 'u')
  } catch {
    try {
      re = new RegExp(pattern.replace(/\{,(\d+)\}/g, '{0,$1}'))
    } catch {
      re = null
    }
  }
  regexCache.set(pattern, re)
  return re
}

/** Le pseudo respecte-t-il le format imposé par le site (`regexCheck`, recherche non ancrée comme `re.search`) ? */
export function isLegal(site: SherlockSite, username: string): boolean {
  if (!site.regexCheck) return true
  const re = compileRegex(site.regexCheck)
  return re ? re.test(username) : true
}

/** URL publique du profil sur le site. */
export function profileUrlFor(site: SherlockSite, username: string): string {
  return interpolate(site.url, username.replace(/ /g, '%20'))
}

/** Décision à partir de la réponse, selon les règles de Sherlock. */
export function evaluate(site: SherlockSite, res: { status: number; text: string }): SiteStatus {
  if (res.text && WAF_MARKERS.some((m) => res.text.includes(m))) return 'waf'
  const types = Array.isArray(site.errorType) ? site.errorType : [site.errorType]
  if (types.some((t) => !['message', 'status_code', 'response_url'].includes(t))) return 'error'
  let status: SiteStatus = 'error'
  if (types.includes('message')) {
    const msgs = site.errorMsg === undefined ? [] : Array.isArray(site.errorMsg) ? site.errorMsg : [site.errorMsg]
    if (msgs.some((m) => res.text.includes(m))) status = 'available'
    // Écart volontaire avec Sherlock : une page d'erreur (blocage, quota, panne) n'est pas un compte.
    else status = res.status >= 400 ? 'error' : 'claimed'
  }
  if (types.includes('status_code') && status !== 'available') {
    const codes = site.errorCode === undefined ? null : Array.isArray(site.errorCode) ? site.errorCode : [site.errorCode]
    status = 'claimed'
    if (codes && codes.includes(res.status)) status = 'available'
    // Blocage, quota ou panne : absence non démontrée (Sherlock conclut « disponible », résultat identique).
    else if (res.status === 403 || res.status === 429 || res.status >= 500) status = 'error'
    else if (res.status >= 300 || res.status < 200) status = 'available'
  }
  if (types.includes('response_url') && status !== 'available') {
    status = res.status >= 200 && res.status < 300 ? 'claimed' : 'available'
  }
  return status
}

/**
 * Défi anti-robot signalé par les en-têtes : AWS WAF (`x-amzn-waf-action`, CGTrader répond 202
 * sans corps) et Cloudflare (`cf-mitigated: challenge`). Un tel statut ne dit rien du compte.
 */
export function wafFromHeaders(headers: Headers | undefined): boolean {
  if (!headers) return false
  return headers.has('x-amzn-waf-action') || headers.get('cf-mitigated')?.toLowerCase() === 'challenge'
}

/** Corps de la réponse en UTF-8, tronqué à `max` octets. */
export async function readText(res: Response, max = MAX_BODY): Promise<string> {
  return (await readBytes(res, max)).toString('utf8')
}

/** Corps brut de la réponse, tronqué à `max` octets. */
export async function readBytes(res: Response, max = MAX_BODY): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
      if (size >= max) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  } catch {
    /* corps tronqué : on garde ce qui a été lu */
  }
  return Buffer.concat(chunks)
}

/** Interroge un site pour un pseudo. Ne lève jamais : les erreurs sont rapportées dans le résultat. */
export async function checkSite(site: SherlockSite, username: string, ctx: ModuleContext, timeoutMs = 12000): Promise<SiteResult> {
  const url = profileUrlFor(site, username)
  if (!isLegal(site, username)) return { site: site.name, url, status: 'illegal' }
  const probe = site.urlProbe ? interpolate(site.urlProbe, username) : url
  const types = Array.isArray(site.errorType) ? site.errorType : [site.errorType]
  const method = (site.request_method ?? (types.length === 1 && types[0] === 'status_code' ? 'HEAD' : 'GET')).toUpperCase()
  const headers: Record<string, string> = { accept: '*/*', 'accept-language': 'en-US,en;q=0.9' }
  for (const [k, v] of Object.entries(site.headers ?? {})) headers[k.toLowerCase()] = v
  const payload = site.request_payload === undefined ? undefined : interpolate(site.request_payload, username)
  try {
    const res = await ctx.fetch(probe, {
      method,
      headers,
      redirect: types.includes('response_url') ? 'manual' : 'follow',
      timeoutMs,
      ...(payload !== undefined ? { json: payload } : {})
    })
    const waf = wafFromHeaders(res.headers)
    if (method === 'HEAD' || waf) await res.body?.cancel().catch(() => undefined)
    if (waf) return { site: site.name, url, status: 'waf', httpStatus: res.status }
    const text = method === 'HEAD' ? '' : await readText(res)
    return { site: site.name, url, status: evaluate(site, { status: res.status, text }), httpStatus: res.status }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } }
    const detail = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : (err.cause?.code ?? err.cause?.message ?? err.message)
    return { site: site.name, url, status: 'error', error: String(detail).slice(0, 200) }
  }
}

/**
 * Interroge une liste de sites avec une concurrence limitée. L'avancement (« 410/480 · sites ·
 * 12 trouvés · GitHub ») est signalé à la pastille après chaque site.
 */
export async function scanSites(
  sites: SherlockSite[],
  username: string,
  ctx: ModuleContext,
  opts: { concurrency?: number; timeoutMs?: number } = {}
): Promise<SiteResult[]> {
  const queue = [...sites]
  const results: SiteResult[] = []
  const fr = ctx.lang === 'fr'
  let found = 0
  const detail = (current?: string): string =>
    ['sites', found ? (fr ? `${found} trouvé${found > 1 ? 's' : ''}` : `${found} found`) : '', current ?? ''].filter(Boolean).join(' · ')
  ctx.progress(0, sites.length, detail())
  const worker = async (): Promise<void> => {
    while (queue.length && !ctx.signal.aborted) {
      const site = queue.shift()!
      const result = await checkSite(site, username, ctx, opts.timeoutMs)
      results.push(result)
      if (result.status === 'claimed') found++
      ctx.progress(results.length, sites.length, detail(site.name))
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 16, sites.length) }, worker))
  return results.sort((a, b) => a.site.localeCompare(b.site))
}
