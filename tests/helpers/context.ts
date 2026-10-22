// Contexte de module utilisable hors Electron, pour les tests.
// Les tests « live » interrogent les vrais services : lancer avec LIVE=1 npm test.

import type { InputEntity, ModuleContext, ModuleOutput, OsintModule } from '@shared/modules'
import type { PropValue, Settings } from '@shared/types'
import { createDohResolver, createFetch, jsonHelpers } from '../../src/main/engine/http'
import { DEFAULT_SETTINGS } from '../../src/main/settings'

export const LIVE = !!process.env.LIVE

export function makeContext(opts: { keys?: Record<string, string>; settings?: Partial<Settings>; lang?: 'fr' | 'en' } = {}): ModuleContext {
  // Dans un environnement qui impose un proxy sortant (CI, bac à sable), on le reprend.
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy
  const proxy = envProxy ? { ...DEFAULT_SETTINGS.proxy, mode: 'http' as const, url: envProxy } : DEFAULT_SETTINGS.proxy
  const settings: Settings = { ...DEFAULT_SETTINGS, proxy, ...opts.settings, lang: opts.lang ?? 'fr' }
  const signal = new AbortController().signal
  const fetchFn = createFetch({ settings, signal })
  const helpers = jsonHelpers(fetchFn)
  const resolve = createDohResolver(fetchFn)
  return {
    fetch: fetchFn,
    fetchJson: helpers.fetchJson,
    fetchText: helpers.fetchText,
    resolveDns: (name, type) => resolve(name, type),
    key: (id) => opts.keys?.[id] ?? process.env[`MASINT_KEY_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`],
    attachment: async () => null,
    signal,
    userAgent: settings.userAgent,
    lang: settings.lang,
    log: () => undefined,
    progress: () => undefined
  }
}

export function entity(type: string, label: string, extra: Partial<InputEntity> = {}): InputEntity {
  return { id: 'test', type, label, platform: null, data: {} as Record<string, PropValue>, imageId: null, ...extra }
}

export async function runModule(m: OsintModule, input: InputEntity, ctx = makeContext()): Promise<ModuleOutput> {
  return m.run(input, ctx)
}
