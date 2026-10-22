// Client HTTP des modules : proxy HTTP(S), SOCKS5 ou Tor, User-Agent, délai,
// et DNS-over-HTTPS pour ne pas faire fuiter les résolutions hors du proxy.

import { createHash } from 'node:crypto'
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { socksDispatcher } from 'fetch-socks'
import type { FetchOptions, HttpError } from '@shared/modules'
import type { ModuleRoute, ProxySettings, Settings } from '@shared/types'

const dispatchers = new Map<string, Dispatcher>()
const direct = new Agent({ connect: { timeout: 15000 } })

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

export function getDispatcher(proxy: ProxySettings, route: ModuleRoute = 'default'): Dispatcher {
  if (route === 'direct') return direct
  const url = proxyUrl(proxy)
  if (!url) return direct
  const cached = dispatchers.get(url)
  if (cached) return cached
  let d: Dispatcher
  if (/^socks/i.test(url)) {
    const u = new URL(url)
    d = socksDispatcher({
      type: 5,
      host: u.hostname,
      port: Number(u.port || 1080),
      ...(u.username ? { userId: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : {})
    }) as unknown as Dispatcher
  } else {
    d = new ProxyAgent({ uri: url })
  }
  dispatchers.set(url, d)
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
}

export type FetchFn = (url: string, init?: FetchOptions) => Promise<Response>

export function createFetch({ settings, moduleId, signal }: HttpClientOptions): FetchFn {
  const route = moduleId ? (settings.proxy.perModule[moduleId] ?? 'default') : 'default'
  const dispatcher = getDispatcher(settings.proxy, route)
  return async (url, init = {}) => {
    const { timeoutMs, json, query, headers, ...rest } = init
    let target = url
    if (query) {
      const u = new URL(url)
      for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v))
      target = u.toString()
    }
    const h = new Headers(headers as ConstructorParameters<typeof Headers>[0])
    if (!h.has('user-agent')) h.set('user-agent', settings.userAgent)
    if (!h.has('accept-language')) h.set('accept-language', settings.lang === 'fr' ? 'fr-FR,fr;q=0.9,en;q=0.8' : 'en-US,en;q=0.9')
    let body = rest.body
    if (json !== undefined) {
      body = JSON.stringify(json)
      if (!h.has('content-type')) h.set('content-type', 'application/json')
    }
    const timeout = AbortSignal.timeout(timeoutMs ?? settings.timeoutMs)
    const signals = [timeout, ...(signal ? [signal] : []), ...(rest.signal ? [rest.signal] : [])]
    const res = await undiciFetch(target, {
      ...(rest as Record<string, unknown>),
      body: body as never,
      headers: h as never,
      signal: AbortSignal.any(signals),
      dispatcher
    })
    return res as unknown as Response
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
