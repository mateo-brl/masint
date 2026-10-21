import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { displayName, splitName } from './_name'

export interface SearchLink {
  engine: string
  url: string
}

/** Liens de recherche manuelle pour une personne (aucune requête n'est envoyée). */
export function personSearchLinks(fullName: string, lastName: string, firstName: string): SearchLink[] {
  const q = encodeURIComponent(fullName)
  const exact = encodeURIComponent(`"${fullName}"`)
  const google = (query: string): string => `https://www.google.com/search?q=${encodeURIComponent(query)}`
  return [
    { engine: 'Google', url: `https://www.google.com/search?q=${exact}` },
    { engine: 'Bing', url: `https://www.bing.com/search?q=${exact}` },
    { engine: 'LinkedIn', url: `https://www.linkedin.com/search/results/people/?keywords=${q}` },
    { engine: 'LinkedIn (Google)', url: google(`site:linkedin.com/in "${fullName}"`) },
    { engine: 'Facebook', url: `https://www.facebook.com/search/people/?q=${q}` },
    { engine: 'Instagram (Google)', url: google(`site:instagram.com "${fullName}"`) },
    { engine: 'X', url: `https://x.com/search?q=${exact}&f=user` },
    { engine: 'TikTok', url: `https://www.tiktok.com/search/user?q=${q}` },
    { engine: 'YouTube', url: `https://www.youtube.com/results?search_query=${exact}` },
    { engine: 'Strava', url: `https://www.strava.com/athletes/search?text=${q}` },
    { engine: 'Documents PDF (Google)', url: google(`"${fullName}" filetype:pdf`) },
    { engine: 'Pages Blanches', url: `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${q}` },
    { engine: '118 712 (Google)', url: google(`site:118712.fr "${fullName}"`) },
    { engine: 'Copains d’avant', url: `https://copainsdavant.linternaute.com/s/?full=&q=${q}&ty=1` },
    { engine: 'Annuaire des entreprises', url: `https://annuaire-entreprises.data.gouv.fr/rechercher?terme=${q}` },
    { engine: 'Societe.com', url: `https://www.societe.com/cgi-bin/search?q=${q}` },
    { engine: 'Pappers (dirigeants)', url: `https://www.pappers.fr/recherche-dirigeants?q=${q}` },
    { engine: 'BODACC', url: `https://www.bodacc.fr/pages/annonces-commerciales/?q=${exact}` },
    { engine: 'Journal officiel (Légifrance)', url: `https://www.legifrance.gouv.fr/search?fonds=JORF&query=${exact}` },
    { engine: 'Décès INSEE (matchID)', url: `https://deces.matchid.io/search?q=${encodeURIComponent(`${firstName} ${lastName}`)}` }
  ]
}

export default defineModule({
  id: 'person.search_links',
  name: { fr: 'Liens de recherche manuelle', en: 'Manual search links' },
  description: {
    fr: 'Prépare des liens de recherche à ouvrir soi-même (aucune requête envoyée) : Google exact, LinkedIn, Facebook, X, TikTok, Strava, Pages Blanches, Copains d’avant, Annuaire des entreprises, Societe.com, Pappers, BODACC, Journal officiel, fichier des décès...',
    en: 'Builds search links to open yourself (no request sent): exact Google, LinkedIn, Facebook, X, TikTok, Strava, French white pages, Copains d’avant, company registries, BODACC, Official Journal, death records...'
  },
  category: 'person',
  inputTypes: ['person'],
  async run(input, ctx) {
    const name = splitName(input)
    const fullName = name ? displayName(name) : input.label.trim()
    if (!fullName) throw new ModuleError('Nom vide', 'invalid_input')
    const links = personSearchLinks(fullName, name?.lastName ?? fullName, name?.firstNames.join(' ') ?? '')
    const entities: OutEntity[] = links.map((l) => ({
      type: 'search_link',
      label: `${l.engine} : ${fullName}`,
      data: { url: l.url, engine: l.engine },
      linkLabel: ctx.lang === 'fr' ? 'recherche' : 'search'
    }))
    return { entities }
  }
})
