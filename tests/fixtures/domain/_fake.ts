// Contexte de module hors ligne : les réponses sont servies depuis les fixtures
// enregistrées (tests/fixtures/<famille>/), par préfixe d'URL. Partagé par les tests domaine, IP et web.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ModuleContext } from '@shared/modules'
import { httpError } from '../../../src/main/engine/http'

export function fixture(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
}

export function fixtureJson<T = unknown>(path: string): T {
  return JSON.parse(fixture(path)) as T
}

export function fixtureBytes(path: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)))
}

export interface Route {
  status?: number
  body: string | Buffer | object
  headers?: Record<string, string>
  url?: string
}

/** `routes` : préfixe d'URL (requête comprise) → réponse. `dns` : `nom|TYPE` → valeurs. */
export function fakeContext(opts: {
  routes?: Record<string, Route | object | string>
  dns?: Record<string, string[]>
  keys?: Record<string, string>
  lang?: 'fr' | 'en'
}): ModuleContext & { requests: string[] } {
  const requests: string[] = []
  const find = (url: string): Route | null => {
    const entries = Object.entries(opts.routes ?? {}).sort((a, b) => b[0].length - a[0].length)
    for (const [prefix, r] of entries) {
      if (!url.startsWith(prefix)) continue
      if (typeof r === 'string' || !('body' in (r as object))) return { body: r as string | object }
      return r as Route
    }
    return null
  }
  const doFetch = async (url: string, init: { query?: Record<string, string | number | undefined> } = {}): Promise<Response> => {
    const u = new URL(url)
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
    const full = u.toString()
    requests.push(full)
    const r = find(full)
    if (!r) return new Response('not found', { status: 404 })
    const body = typeof r.body === 'string' || Buffer.isBuffer(r.body) ? r.body : JSON.stringify(r.body)
    const res = new Response(body as ConstructorParameters<typeof Response>[0], { status: r.status ?? 200, headers: r.headers ?? {} })
    Object.defineProperty(res, 'url', { value: r.url ?? full })
    return res
  }
  return {
    requests,
    fetch: doFetch as ModuleContext['fetch'],
    async fetchJson<T>(url: string, init?: Parameters<ModuleContext['fetchJson']>[1]): Promise<T> {
      const res = await doFetch(url, init as never)
      const text = await res.text()
      if (!res.ok) throw httpError(res.status, text, url)
      return JSON.parse(text) as T
    },
    async fetchText(url: string, init?: Parameters<ModuleContext['fetchText']>[1]): Promise<string> {
      const res = await doFetch(url, init as never)
      const text = await res.text()
      if (!res.ok) throw httpError(res.status, text, url)
      return text
    },
    async resolveDns(name, type) {
      return opts.dns?.[`${name}|${type}`] ?? []
    },
    key: (id) => opts.keys?.[id],
    attachment: async () => null,
    signal: new AbortController().signal,
    userAgent: 'test',
    lang: opts.lang ?? 'fr',
    log: () => undefined
  }
}
