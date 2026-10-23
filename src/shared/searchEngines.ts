// Moteur des recherches assistées. Google bloque vite les recherches enchaînées (Tor, VPN,
// adresse partagée) et masque désormais l'adresse de ses résultats derrière des liens opaques ;
// Startpage sert les mêmes résultats Google, avec des liens directs et, dans la plupart des cas,
// sans captcha. En automatique, Startpage passe d'abord et Google prend le relais s'il bloque.

export type SearchEngine = 'auto' | 'google' | 'startpage'

export const SEARCH_ENGINES: SearchEngine[] = ['auto', 'google', 'startpage']

/** Requête d'une URL de recherche Google, null pour toute autre adresse. */
export function googleQuery(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname) || u.pathname !== '/search') return null
    return u.searchParams.get('q')
  } catch {
    return null
  }
}

/** Moteurs essayés dans l'ordre pour une recherche Google, selon le réglage. */
export function engineOrder(engine: SearchEngine): Array<'google' | 'startpage'> {
  return engine === 'google' ? ['google'] : engine === 'startpage' ? ['startpage'] : ['startpage', 'google']
}

export function startpageUrl(query: string, lang: 'fr' | 'en'): string {
  return `https://www.startpage.com/do/search?query=${encodeURIComponent(query)}&language=${lang === 'fr' ? 'francais' : 'english'}`
}

/** Adresse à ouvrir pour une recherche, selon le moteur choisi (une recherche Google passe par Startpage sauf en « Google seulement »). */
export function searchUrlFor(url: string, engine: SearchEngine, lang: 'fr' | 'en'): string {
  const q = engine !== 'google' ? googleQuery(url) : null
  return q ? startpageUrl(q, lang) : url
}
