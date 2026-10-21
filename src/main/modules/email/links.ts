import { defineModule, type OutEntity } from '@shared/modules'
import { requireEmail } from './_lib'

const q = encodeURIComponent

/** Liens de recherche manuelle pour une adresse (moteurs, Epieos, IntelX...). */
export function emailSearchLinks(email: string): Array<{ engine: string; url: string }> {
  const exact = `"${email}"`
  return [
    { engine: 'Google', url: `https://www.google.com/search?q=${q(exact)}` },
    { engine: 'Bing', url: `https://www.bing.com/search?q=${q(exact)}` },
    { engine: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${q(exact)}` },
    { engine: 'Yandex', url: `https://yandex.com/search/?text=${q(exact)}` },
    { engine: 'Pastebin (Google)', url: `https://www.google.com/search?q=${q(`site:pastebin.com ${exact}`)}` },
    { engine: 'Epieos', url: `https://epieos.com/?q=${q(email)}&t=email` },
    { engine: 'Intelligence X', url: `https://intelx.io/?s=${q(email)}` },
    { engine: 'GitHub', url: `https://github.com/search?q=${q(`author-email:${email}`)}&type=commits` },
    { engine: 'Hunter', url: `https://hunter.io/email-verifier/${q(email)}` }
  ]
}

export default defineModule({
  id: 'email.links',
  name: { fr: 'Liens de recherche (email)', en: 'Search links (email)' },
  description: {
    fr: "Prépare des recherches manuelles sur l'adresse exacte : Google, Bing, DuckDuckGo, Yandex, Pastebin, Epieos, Intelligence X, commits GitHub, Hunter. Aucune requête n'est envoyée.",
    en: 'Prepares manual searches on the exact address: Google, Bing, DuckDuckGo, Yandex, Pastebin, Epieos, Intelligence X, GitHub commits, Hunter. No request is sent.'
  },
  category: 'email',
  inputTypes: ['email'],
  async run(input, ctx) {
    const email = requireEmail(input)
    const entities: OutEntity[] = emailSearchLinks(email).map(({ engine, url }) => ({
      type: 'search_link',
      label: `${engine} : ${email}`,
      data: { url, engine },
      linkLabel: ctx.lang === 'fr' ? 'recherche' : 'search'
    }))
    return { entities }
  }
})
