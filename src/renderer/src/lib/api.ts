import { useEffect } from 'react'
import type { ApiChannel, ApiMap, EventChannel, EventMap } from '@shared/api'

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

export function openExternal(url: string): void {
  void api('app:openExternal', url)
}
