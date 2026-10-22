// Client HTTP des modules : proxy HTTP(S), SOCKS5 ou Tor, User-Agent, délai,
// et DNS-over-HTTPS pour ne pas faire fuiter les résolutions hors du proxy.

import { createHash } from 'node:crypto'
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { socksDispatcher } from 'fetch-socks'
import { acceptLanguage } from '@shared/network'
import type { FetchOptions, HttpError } from '@shared/modules'
import type { ModuleRoute, ProxySettings, Settings } from '@shared/types'
import { DEFAULT_USER_AGENT } from '../settings'
import { HostLimiter } from './limits'

const dispatchers = new Map<string, Dispatcher>()
const direct = new Agent({ connect: { timeout: 15000 } })

/** Requêtes simultanées par hôte, tous modules confondus. */
export const PER_HOST_LIMIT = 3
/** Résolveurs DNS-over-HTTPS : beaucoup de petites requêtes, des services faits pour. */
const HOST_OVERRIDES: Record<string, number> = { 'cloudflare-dns.com': 8, 'dns.google': 8 }
export const hostLimiter = new HostLimiter(PER_HOST_LIMIT, HOST_OVERRIDES)

function proxyUrl(proxy: ProxySettings): string | null {
  switch (proxy.mode) {
    case 'none':
      return null
    case 'tor':
      return `socks5://127.0.0.1:${proxy.torPort || 9050}`
    default:
      return proxy.url.trim() || null
  }
}

/** Identifiants SOCKS : Tor ouvre des circuits distincts pour chaque couple (IsolateSOCKSAuth). */
export interface SocksAuth {
  userId: string
  password: string
}

/**
 * Identifiants SOCKS envoyés à Tor : `masint-<enquête>`, pour que deux enquêtes ne partagent
 * jamais un circuit (ni donc une IP de sortie). Le sel, changé par « Nouvelle identité Tor »,
 * fait ouvrir de nouveaux circuits.
 */
export function torAuth(investigationId: string | undefined, salt: string): SocksAuth {
  return { userId: investigationId ? `masint-${investigationId}` : 'masint', password: salt || 'masint' }
}

export function getDispatcher(proxy: ProxySettings, route: ModuleRoute = 'default', isolation?: SocksAuth): Dispatcher {
  if (route === 'direct') return direct
  const url = proxyUrl(proxy)
  if (!url) return direct
  // Tor : l'identifiant d'isolement fait partie de la clé, un dispatcher (et ses connexions) par enquête.
  const auth = proxy.mode === 'tor' ? isolation : undefined
  const key = auth ? `${url}#${auth.userId}:${auth.password}` : url
  const cached = dispatchers.get(key)
  if (cached) return cached
  let d: Dispatcher
  if (/^socks/i.test(url)) {
    const u = new URL(url)
    const credentials = auth ?? (u.username ? { userId: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : null)
    d = socksDispatcher({
      type: 5,
      host: u.hostname,
      port: Number(u.port || 1080),
      ...(credentials ?? {})
    }) as unknown as Dispatcher
  } else {
    d = new ProxyAgent({ uri: url })
  }
  dispatchers.set(key, d)
  return d
}

/**
 * Identifiant de la sortie réseau d'un module : `direct`, `tor`, ou `proxy:` suivi d'une
 * empreinte de l'adresse du proxy (jamais l'adresse ni les identifiants eux-mêmes). Les caches
 * qui dépendent de l'adresse IP de sortie (santé des sites de pseudo) en dépendent.
 */
export function egressKey(proxy: ProxySettings, route: ModuleRoute = 'default'): string {
  if (route === 'direct') return 'direct'
  const url = proxyUrl(proxy)
  if (!url) return 'direct'
  if (proxy.mode === 'tor') return 'tor'
  return `proxy:${createHash('sha256').update(url).digest('hex').slice(0, 12)}`
}

export function resetDispatchers(): void {
  for (const d of dispatchers.values()) void d.close().catch(() => undefined)
  dispatchers.clear()
}

export interface HttpClientOptions {
  settings: Settings
  moduleId?: string
  signal?: AbortSignal
  /** Enquête d'origine : sous Tor, chaque enquête a ses propres circuits. */
  investigationId?: string
}

export type FetchFn = (url: string, init?: FetchOptions) => Promise<Response>

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function createFetch({ settings, moduleId, signal, investigationId }: HttpClientOptions): FetchFn {
  const route = moduleId ? (settings.proxy.perModule[moduleId] ?? 'default') : 'default'
  const dispatcher = getDispatcher(settings.proxy, route, torAuth(investigationId, settings.torSalt))
  return async (url, init = {}) => {
    const { timeoutMs, json, query, headers, ...rest } = init
    let target = url
    if (query) {
      const u = new URL(url)
      for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v))
      target = u.toString()
    }
    const h = new Headers(headers as ConstructorParameters<typeof Headers>[0])
    if (!h.has('user-agent')) h.set('user-agent', settings.userAgent || DEFAULT_USER_AGENT)
    if (!h.has('accept-language')) h.set('accept-language', acceptLanguage(settings.lang))
    let body = rest.body
    if (json !== undefined) {
      body = JSON.stringify(json)
      if (!h.has('content-type')) h.set('content-type', 'application/json')
    }
    const cancel = [...(signal ? [signal] : []), ...(rest.signal ? [rest.signal] : [])]
    // Place réservée sur l'hôte jusqu'aux en-têtes de la réponse. L'attente cède à
    // l'annulation ; le délai de la requête ne court qu'une fois la place obtenue.
    const release = await hostLimiter.acquire(hostOf(target), cancel.length ? AbortSignal.any(cancel) : undefined)
    try {
      const timeout = AbortSignal.timeout(timeoutMs ?? settings.timeoutMs)
      const res = await undiciFetch(target, {
        ...(rest as Record<string, unknown>),
        body: body as never,
        headers: h as never,
        signal: AbortSignal.any([timeout, ...cancel]),
        dispatcher
      })
      return res as unknown as Response
    } finally {
      release()
    }
  }
}

export function httpError(status: number, body: string, url: string): HttpError {
  const err = new Error(`HTTP ${status} sur ${new URL(url).host}`) as HttpError
  err.status = status
  err.body = body.slice(0, 2000)
  return err
}

export function jsonHelpers(fetchFn: FetchFn) {
  return {
    async fetchJson<T>(url: string, init?: FetchOptions): Promise<T> {
      const h = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0])
      if (!h.has('accept')) h.set('accept', 'application/json')
      const res = await fetchFn(url, { ...init, headers: h })
      const text = await res.text()
      if (!res.ok) throw httpError(res.status, text, url)
      try {
        return JSON.parse(text) as T
      } catch {
        throw httpError(res.status, `Réponse non JSON : ${text.slice(0, 200)}`, url)
      }
    },
    async fetchText(url: string, init?: FetchOptions): Promise<string> {
      const res = await fetchFn(url, init)
      const text = await res.text()
      if (!res.ok) throw httpError(res.status, text, url)
      return text
    }
  }
}

const DNS_TYPES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 }

/** Résolution DNS-over-HTTPS (Cloudflare, puis Google en secours). */
export function createDohResolver(fetchFn: FetchFn) {
  return async (name: string, type: string): Promise<string[]> => {
    const endpoints = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve']
    let lastError: unknown
    for (const endpoint of endpoints) {
      try {
        const res = await fetchFn(endpoint, {
          query: { name, type },
          headers: { accept: 'application/dns-json' },
          timeoutMs: 10000
        })
        if (!res.ok) throw new Error(`DoH ${res.status}`)
        const json = (await res.json()) as { Status: number; Answer?: Array<{ type: number; data: string }> }
        if (json.Status === 3) return []
        const code = DNS_TYPES[type]
        return (json.Answer ?? [])
          .filter((a) => a.type === code)
          .map((a) => (type === 'TXT' ? a.data.replace(/^"|"$/g, '').replace(/"\s"/g, '') : a.data.replace(/\.$/, '')))
      } catch (e) {
        lastError = e
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Résolution DNS impossible')
  }
}
