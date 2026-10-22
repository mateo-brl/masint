// Règles réseau partagées : en-tête navigateur, langue, ouverture des liens d'enquête.

import { describe, expect, it } from 'vitest'
import { acceptLanguage, browserLanguages, buildUserAgent, chromiumLocale, opensInternally, proxyActive } from '@shared/network'
import type { ProxySettings } from '@shared/types'

const proxy = (patch: Partial<ProxySettings>): ProxySettings => ({ mode: 'none', url: '', torPort: 9050, perModule: {}, ...patch })

describe('buildUserAgent', () => {
  it('annonce le vrai système et la version majeure de Chromium', () => {
    expect(buildUserAgent('linux', '152.0.7400.12')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
    )
    expect(buildUserAgent('win32', '152.0.7400.12')).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
    )
    expect(buildUserAgent('darwin', '150.1.2.3')).toContain('(Macintosh; Intel Mac OS X 10_15_7)')
    expect(buildUserAgent('darwin', '150.1.2.3')).toContain('Chrome/150.0.0.0')
  })

  it('reste valable sans version de Chromium connue', () => {
    expect(buildUserAgent('linux', undefined)).toMatch(/^Mozilla\/5\.0 \(X11; Linux x86_64\) .* Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/)
    expect(buildUserAgent('freebsd', '')).toContain('X11; Linux x86_64')
  })

  it('donne la langue des en-têtes', () => {
    expect(acceptLanguage('fr')).toBe('fr-FR,fr;q=0.9,en;q=0.8')
    expect(acceptLanguage('en')).toBe('en-US,en;q=0.9')
    expect(chromiumLocale('fr')).toBe('fr-FR')
  })

  it('donne au navigateur intégré les mêmes langues, sans pondération', () => {
    // Chromium ajoute les `q=` : une liste déjà pondérée produirait « fr;q=0.9;q=0.9 ».
    for (const lang of ['fr', 'en'] as const) {
      expect(browserLanguages(lang)).not.toContain(';')
      expect(browserLanguages(lang)).toBe(acceptLanguage(lang).replace(/;q=[\d.]+/g, ''))
    }
  })
})

describe('Ouverture des liens', () => {
  it('considère un proxy actif seulement avec une adresse, Tor toujours', () => {
    expect(proxyActive(proxy({}))).toBe(false)
    expect(proxyActive(proxy({ mode: 'http', url: '  ' }))).toBe(false)
    expect(proxyActive(proxy({ mode: 'socks5', url: 'socks5://127.0.0.1:1080' }))).toBe(true)
    expect(proxyActive(proxy({ mode: 'tor' }))).toBe(true)
  })

  it('ouvre en interne dès qu’un proxy ou Tor est actif en mode automatique', () => {
    expect(opensInternally({ linkOpening: 'auto', proxy: proxy({}) })).toBe(false)
    expect(opensInternally({ linkOpening: 'auto', proxy: proxy({ mode: 'tor' }) })).toBe(true)
    expect(opensInternally({ linkOpening: 'internal', proxy: proxy({}) })).toBe(true)
    expect(opensInternally({ linkOpening: 'external', proxy: proxy({ mode: 'tor' }) })).toBe(false)
  })
})
