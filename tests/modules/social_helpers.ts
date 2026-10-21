// Contexte de module hors ligne : les requêtes sont servies par des routes locales
// (fixtures enregistrées). Partagé par les tests pseudo, réseaux sociaux et personnes.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FetchOptions, ModuleContext } from '@shared/modules'
import { jsonHelpers } from '../../src/main/engine/http'
import { makeContext } from '../helpers/context'

export const FIXTURES = resolve(__dirname, '../fixtures')

export function fixture(path: string): string {
  return readFileSync(resolve(FIXTURES, path), 'utf8')
}

export function fixtureJson<T = unknown>(path: string): T {
  return JSON.parse(fixture(path)) as T
}

export interface Reply {
  status?: number
  body?: string | object
  headers?: Record<string, string>
}

export type Route = [RegExp, Reply | ((url: string, init: FetchOptions) => Reply)]

export interface FakeContext extends ModuleContext {
  calls: Array<{ url: string; method: string; body?: string; headers: Record<string, string> }>
}

/** Contexte dont `fetch` répond à partir des routes ; toute URL inconnue renvoie 599. */
export function fakeContext(routes: Route[], lang: 'fr' | 'en' = 'fr'): FakeContext {
  const calls: FakeContext['calls'] = []
  const fetchFn = async (url: string, init: FetchOptions = {}): Promise<Response> => {
    const u = new URL(url)
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
    const full = u.toString()
    const headers: Record<string, string> = {}
    new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).forEach((v, k) => (headers[k] = v))
    const body = init.json !== undefined ? JSON.stringify(init.json) : typeof init.body === 'string' ? init.body : undefined
    calls.push({ url: full, method: (init.method ?? 'GET').toUpperCase(), body, headers })
    const route = routes.find(([re]) => re.test(full))
    if (!route) return new Response('no route', { status: 599 })
    const r = typeof route[1] === 'function' ? route[1](full, init) : route[1]
    const text = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    const status = r.status ?? 200
    return new Response(status === 204 || status === 304 ? null : text, { status, headers: r.headers })
  }
  const helpers = jsonHelpers(fetchFn)
  return {
    ...makeContext({ lang }),
    fetch: fetchFn,
    fetchJson: helpers.fetchJson,
    fetchText: helpers.fetchText,
    calls
  }
}
