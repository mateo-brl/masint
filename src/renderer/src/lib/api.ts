import { useEffect } from 'react'
import type { ApiChannel, ApiMap, EventChannel, EventMap } from '@shared/api'
import type { LinkContext } from '@shared/types'

/** Appel typé vers le processus principal. */
export function api<C extends ApiChannel>(channel: C, ...args: Parameters<ApiMap[C]>): Promise<Awaited<ReturnType<ApiMap[C]>>> {
  return window.masint.invoke(channel, ...args) as Promise<Awaited<ReturnType<ApiMap[C]>>>
}

export function onEvent<E extends EventChannel>(event: E, listener: (payload: EventMap[E]) => void): () => void {
  return window.masint.on(event, listener)
}

export function useEvent<E extends EventChannel>(event: E, listener: (payload: EventMap[E]) => void): void {
  useEffect(() => onEvent(event, listener), [event, listener])
}

/**
 * Navigateur personnel de l'enquêteur, hors proxy et Tor, avec ses sessions ouvertes : réservé
 * à la documentation, à GitHub et aux pages d'inscription aux clés d'API. Un lien d'enquête
 * passe par `openLink`.
 */
export function openExternal(url: string): void {
  void api('app:openExternal', url)
}

/**
 * Lien d'enquête (profil, résultat, recherche) : navigateur d'enquête de MASINT (proxy ou Tor,
 * session isolée) ou navigateur personnel, selon le réglage « Ouverture des liens ». Avec le
 * contexte (enquête, nœud d'origine), le navigateur d'enquête propose de capturer la page.
 */
export function openLink(url: string, ctx?: LinkContext): void {
  void api('app:openLink', url, ctx)
}
