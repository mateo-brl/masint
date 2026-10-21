// Contexte de module simulé pour les tests hors ligne des modules roso.info :
// chaque requête est routée vers une réponse construite d'après le code client du site.

import type { FetchOptions, ModuleContext } from '@shared/modules'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const TEST_KEY = 'roso_testkey_0123456789abcdef'

export interface Call {
  method: string
  url: URL
  body: unknown
  headers: Record<string, string>
}

export interface Reply {
  status?: number
  body?: unknown
}

export type Route = [method: string, pattern: string | RegExp, reply: Reply | ((call: Call) => Reply)]

export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, name), 'utf8')) as T
}

export function mockContext(routes: Route[], opts: { key?: string | null; lang?: 'fr' | 'en' } = {}): { ctx: ModuleContext; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn = async (url: string, init: FetchOptions = {}): Promise<Response> => {
    const u = new URL(url)
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
    const headers: Record<string, string> = {}
    new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).forEach((v, k) => (headers[k] = v))
    const call: Call = { method: (init.method ?? 'GET').toUpperCase(), url: u, body: init.json, headers }
    calls.push(call)
    const route = routes.find(
      ([m, p]) => (m === '*' || m === call.method) && (typeof p === 'string' ? u.pathname === p : p.test(u.pathname + u.search))
    )
    const reply = route ? (typeof route[2] === 'function' ? route[2](call) : route[2]) : { status: 404, body: { success: false, error: 'not_found' } }
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {})
    return new Response(text, { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  const ctx: ModuleContext = {
    fetch: fetchFn,
    fetchJson: async <T>(url: string, init?: FetchOptions) => (await (await fetchFn(url, init)).json()) as T,
    fetchText: async (url, init) => (await fetchFn(url, init)).text(),
    resolveDns: async () => [],
    key: (id) => (id === 'roso' ? (opts.key === undefined ? TEST_KEY : (opts.key ?? undefined)) : undefined),
    attachment: async () => null,
    signal: new AbortController().signal,
    userAgent: 'masint-test',
    lang: opts.lang ?? 'fr',
    log: () => undefined
  }
  return { ctx, calls }
}

/** Route de maintenance publique : jamais en maintenance. */
export const NO_MAINTENANCE: Route = ['GET', '/api/maintenance/status', { body: { success: true, maintenance: false } }]
