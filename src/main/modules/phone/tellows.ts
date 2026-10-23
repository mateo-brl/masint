// Tellows : fiche publique d'un numéro (score de 1 à 9, recherches, commentaires, types d'appel,
// noms d'appelant donnés par la communauté). Les pages de Tellows sont souvent protégées par
// Cloudflare : sans navigateur, la vérification anti-robot bloque la lecture. Le module le dit
// clairement ; la recherche manuelle « Tellows » de `phone.links`, lancée par la recherche
// assistée (vrai navigateur, fenêtre affichée pour la vérification), lit alors la même fiche.

import { defineModule, ModuleError } from '@shared/modules'
import { httpFailure } from '../email/_lib'
import { parsePhone } from './_phone'
import { isCloudflareChallenge, parseTellows, tellowsOutput, tellowsUrl } from './_tellows'

export default defineModule({
  id: 'phone.tellows',
  name: { fr: 'Fiche Tellows', en: 'Tellows record' },
  description: {
    fr: "Lit la fiche publique Tellows du numéro (France, Belgique, Suisse, Allemagne, Autriche, Royaume-Uni, Espagne, Italie, Pays-Bas) : score de 1 (fiable) à 9 (dangereux), nombre de recherches et de commentaires, types d'appel. Les noms d'appelant cités vont dans « À vérifier » (personne ou pseudo possible) ou restent des étiquettes. La fiche n'est gardée que si elle affiche exactement ce numéro. Souvent bloquée par Cloudflare : la recherche assistée « Tellows » lit alors la fiche dans un vrai navigateur.",
    en: 'Reads the public Tellows record of the number (France, Belgium, Switzerland, Germany, Austria, United Kingdom, Spain, Italy, Netherlands): score from 1 (trusted) to 9 (dangerous), number of searches and comments, call types. Caller names go to "To review" (possible person or username) or stay as labels. The record is kept only if it shows exactly this number. Often blocked by Cloudflare: the "Tellows" assisted search then reads the record in a real browser.'
  },
  category: 'phone',
  inputTypes: ['phone'],
  homepage: 'https://www.tellows.fr',
  // Structure de la page non observée depuis l'environnement de développement (Cloudflare).
  experimental: true,
  accepts: (input) => {
    try {
      return !!tellowsUrl(parsePhone(input))
    } catch {
      return false
    }
  },
  async run(input, ctx) {
    const fr = ctx.lang === 'fr'
    const p = parsePhone(input)
    const url = tellowsUrl(p)
    if (!url) throw new ModuleError(fr ? 'Pays sans site Tellows' : 'No Tellows site for this country', 'invalid_input')
    const res = await ctx.fetch(url, { timeoutMs: 20000, headers: { accept: 'text/html,application/xhtml+xml' } })
    const html = await res.text()
    if (isCloudflareChallenge(res.status, html))
      throw new ModuleError(
        fr
          ? 'Tellows : page protégée par Cloudflare (vérification anti-robot). Lancez la recherche assistée « Tellows » dans « À vérifier » : elle lit la fiche dans un vrai navigateur.'
          : 'Tellows: page protected by Cloudflare (anti-bot check). Run the "Tellows" assisted search in "To review": it reads the record in a real browser.',
        'blocked'
      )
    if (res.status === 404) return {}
    if (!res.ok) throw httpFailure('Tellows', res.status)
    const page = parseTellows(html, p)
    // Page d'un autre numéro ou sans fiche : rien n'est gardé.
    if (!page) return { raw: { url, kept: false } }
    const out = tellowsOutput(page, url, ctx.lang)
    return { properties: out.properties, entities: out.entities, raw: { url, ...page } }
  }
})
