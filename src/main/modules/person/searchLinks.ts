// Recherches à faire à la main sur une personne : moteurs qui bloquent les requêtes
// automatiques, annuaires et réseaux qui exigent un compte. Proposées dans « À vérifier ».
// Le reste est automatisé ailleurs : mandats (person.fr_dirigeants), BODACC (person.bodacc),
// Journal officiel (person.jorf), décès (person.fr_deces), pseudos (person.usernames).

import { defineModule, ModuleError, type OutManualCheck } from '@shared/modules'
import { displayName, splitName } from './_name'

const google = (query: string): string => `https://www.google.com/search?q=${encodeURIComponent(query)}`

/** Profils indexés par Google sur les principaux réseaux, en une seule recherche. */
const SOCIAL_SITES = ['linkedin.com/in', 'facebook.com', 'instagram.com', 'x.com', 'tiktok.com', 'strava.com/athletes']

export function personManualChecks(fullName: string, lang: 'fr' | 'en' = 'fr'): OutManualCheck[] {
  const fr = lang === 'fr'
  const q = encodeURIComponent(fullName)
  const exact = `"${fullName}"`
  return [
    {
      label: 'Google',
      url: google(exact),
      hint: fr
        ? 'Pages qui citent la personne ; ajoutez une ville ou un employeur pour écarter les homonymes.'
        : 'Pages mentioning the person; add a city or employer to rule out namesakes.'
    },
    {
      label: fr ? 'Réseaux sociaux (Google)' : 'Social networks (Google)',
      url: google(`${exact} (${SOCIAL_SITES.map((s) => `site:${s}`).join(' OR ')})`),
      hint: fr ? 'Profils LinkedIn, Facebook, Instagram, X, TikTok et Strava indexés à ce nom.' : 'LinkedIn, Facebook, Instagram, X, TikTok and Strava profiles indexed under this name.'
    },
    {
      label: fr ? 'Documents PDF (Google)' : 'PDF documents (Google)',
      url: google(`${exact} filetype:pdf`),
      hint: fr ? 'CV, comptes rendus de conseil municipal, résultats sportifs, listes de diplômés.' : 'Resumes, council minutes, sports results, graduate lists.'
    },
    {
      label: 'Facebook',
      url: `https://www.facebook.com/search/people/?q=${q}`,
      hint: fr ? 'Profils non indexés par Google : comparez photo, ville et amis (connexion requise).' : 'Profiles Google does not index: compare picture, city and friends (sign-in required).'
    },
    {
      label: 'Pages Blanches',
      url: `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${q}`,
      hint: fr ? 'Adresse et téléphone fixe des abonnés inscrits ; homonymes fréquents.' : 'Address and landline of listed subscribers; namesakes are common.'
    },
    {
      label: 'Copains d’avant',
      url: `https://copainsdavant.linternaute.com/s/?full=&q=${q}&ty=1`,
      hint: fr ? 'Écoles, promotions, villes et employeurs déclarés (compte gratuit requis).' : 'Schools, classes, cities and employers listed (free account required).'
    }
  ]
}

export default defineModule({
  id: 'person.search_links',
  name: { fr: 'Recherches manuelles (personne)', en: 'Manual searches (person)' },
  description: {
    fr: 'Propose dans « À vérifier » les recherches impossibles à automatiser : Google exact, profils sur les réseaux sociaux et documents PDF via Google, Facebook, Pages Blanches, Copains d’avant. Aucune requête n’est envoyée.',
    en: 'Lists in "To review" the searches that cannot be automated: exact Google search, social network profiles and PDF documents via Google, Facebook, French white pages, Copains d’avant. No request is sent.'
  },
  category: 'person',
  inputTypes: ['person'],
  async run(input, ctx) {
    const name = splitName(input)
    const fullName = name ? displayName(name) : input.label.trim()
    if (!fullName) throw new ModuleError('Nom vide', 'invalid_input')
    return { manual: personManualChecks(fullName, ctx.lang) }
  }
})
