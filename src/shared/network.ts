// Règles réseau partagées par le processus principal et l'interface : proxy actif, ouverture
// des liens d'enquête, en-tête navigateur cohérent avec le vrai système.

import type { Lang, ProxySettings, Settings } from './types'

/** Un proxy ou Tor est-il réellement utilisé (mode choisi et adresse renseignée) ? */
export function proxyActive(proxy: ProxySettings): boolean {
  if (proxy.mode === 'tor') return true
  return proxy.mode !== 'none' && !!proxy.url.trim()
}

/**
 * Un lien d'enquête s'ouvre-t-il dans le navigateur d'enquête de MASINT ? En `auto`, oui dès
 * qu'un proxy ou Tor est actif : le navigateur personnel sortirait sans eux, avec les sessions
 * ouvertes de l'enquêteur.
 */
export function opensInternally(s: Pick<Settings, 'linkOpening' | 'proxy'>): boolean {
  if (s.linkOpening === 'internal') return true
  if (s.linkOpening === 'external') return false
  return proxyActive(s.proxy)
}

/** Version de Chromium utilisée quand elle est inconnue (tests hors Electron). */
const FALLBACK_CHROME = '140.0.0.0'

/**
 * En-tête navigateur de Chrome sur le vrai système, avec la version de Chromium embarquée :
 * il reste cohérent avec `navigator.platform` et `navigator.userAgentData` du navigateur
 * intégré. Chrome n'annonce que la version majeure (« 141.0.0.0 »).
 */
export function buildUserAgent(platform: string, chromeVersion: string | undefined = FALLBACK_CHROME): string {
  const major = /^\d+/.exec(chromeVersion ?? '')?.[0] ?? /^\d+/.exec(FALLBACK_CHROME)![0]
  const os =
    platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/** En-tête `Accept-Language` des requêtes des modules. */
export function acceptLanguage(lang: Lang): string {
  return lang === 'en' ? 'en-US,en;q=0.9' : 'fr-FR,fr;q=0.9,en;q=0.8'
}

/**
 * Langues du navigateur intégré (`session.setUserAgent`), sans pondération : Chromium ajoute
 * lui-même les `q=` et produit le même en-tête que `acceptLanguage`. Une liste déjà pondérée
 * donnerait un en-tête invalide (« fr;q=0.9;q=0.9 »).
 */
export function browserLanguages(lang: Lang): string {
  return lang === 'en' ? 'en-US,en' : 'fr-FR,fr,en'
}

/** Langue de Chromium (`--lang`) : `navigator.language` du navigateur intégré. */
export function chromiumLocale(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'fr-FR'
}
