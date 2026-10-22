// Services abuse.ch (MalwareBazaar, URLhaus, ThreatFox) : une seule clé Auth-Key gratuite
// (compte abuse.ch), envoyée dans l'en-tête `Auth-Key`.

import { ModuleError, type FetchOptions, type ModuleContext } from '@shared/modules'
import { isoDate, serviceError } from '../misc/_util'

/** Clé commune aux modules abuse.ch : une seule saisie pour l'utilisateur. */
export const ABUSECH_KEY = { id: 'abusech', label: 'abuse.ch Auth-Key', url: 'https://auth.abuse.ch/' }

/** Dates abuse.ch en UTC : `2021-03-26 13:15:07` ou `2019-01-15 07:09:01 UTC`. */
export function abusechDate(s: string | null | undefined): string | null {
  if (!s) return null
  return isoDate(`${s.replace(/\s*UTC$/i, '').trim().replace(' ', 'T')}Z`)
}

/** POST authentifié vers une API abuse.ch ; une clé refusée devient une erreur explicite. */
export async function abusechPost<T>(ctx: ModuleContext, service: string, url: string, body: Pick<FetchOptions, 'json' | 'body'>): Promise<T> {
  const key = ctx.key(ABUSECH_KEY.id)
  if (!key) throw new ModuleError(`Clé API abuse.ch manquante (${service})`, 'auth')
  try {
    return await ctx.fetchJson<T>(url, {
      method: 'POST',
      headers: { 'auth-key': key, accept: 'application/json', ...(body.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...body,
      timeoutMs: 30000
    })
  } catch (e) {
    throw serviceError(e, service, true)
  }
}
