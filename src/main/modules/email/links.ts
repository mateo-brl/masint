// Recherches à faire à la main sur une adresse email : moteurs qui bloquent les requêtes
// automatiques et services qui exigent un compte. Proposées dans « À vérifier », jamais dans
// le graphe. Les commits GitHub et la validité de la boîte sont vérifiés par d'autres modules.

import { defineModule, type OutManualCheck } from '@shared/modules'
import { requireEmail } from './_lib'

const q = encodeURIComponent

export function emailManualChecks(email: string, lang: 'fr' | 'en' = 'fr'): OutManualCheck[] {
  const fr = lang === 'fr'
  return [
    {
      label: 'Google',
      url: `https://www.google.com/search?q=${q(`"${email}"`)}`,
      hint: fr
        ? 'Pages qui citent l’adresse exacte : annuaires, forums, documents, fuites publiées (Pastebin...).'
        : 'Pages quoting the exact address: directories, forums, documents, published leaks (Pastebin...).'
    },
    {
      label: 'Epieos',
      url: `https://epieos.com/?q=${q(email)}&t=email`,
      hint: fr ? 'Compte Google (nom, photo, avis Maps) et services où l’adresse est inscrite.' : 'Google account (name, picture, Maps reviews) and services the address is registered with.'
    },
    {
      label: 'Intelligence X',
      url: `https://intelx.io/?s=${q(email)}`,
      hint: fr ? 'Fuites de données, pastes et archives qui contiennent l’adresse (compte gratuit requis).' : 'Data leaks, pastes and archives containing the address (free account required).'
    }
  ]
}

export default defineModule({
  id: 'email.links',
  name: { fr: 'Recherches manuelles (email)', en: 'Manual searches (email)' },
  description: {
    fr: "Propose dans « À vérifier » les recherches impossibles à automatiser sur l'adresse exacte : Google, Epieos, Intelligence X. Aucune requête n'est envoyée.",
    en: 'Lists in "To review" the searches on the exact address that cannot be automated: Google, Epieos, Intelligence X. No request is sent.'
  },
  category: 'email',
  inputTypes: ['email'],
  async run(input, ctx) {
    return { manual: emailManualChecks(requireEmail(input), ctx.lang) }
  }
})
