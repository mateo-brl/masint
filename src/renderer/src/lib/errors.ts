import i18n from './i18n'

/** Message lisible pour toute valeur levée (Error, Event du navigateur, objet, texte). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (typeof Event !== 'undefined' && e instanceof Event) {
    const target = e.target as { src?: string; href?: string } | null
    const url = target?.src ?? target?.href
    return i18n.t('errors.resource', { url: url ? ` (${url.slice(0, 120)})` : '' })
  }
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string') return msg
    try {
      return JSON.stringify(e).slice(0, 300)
    } catch {
      /* objet non sérialisable */
    }
  }
  return i18n.t('errors.unknown')
}
