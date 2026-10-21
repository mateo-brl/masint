import { defineModule, type OutEntity } from '@shared/modules'
import type { PhoneNumber } from 'libphonenumber-js/max'
import { parsePhone } from './_phone'

const q = encodeURIComponent

/** Écritures courantes du numéro, pour les recherches exactes. */
export function phoneFormats(p: PhoneNumber): string[] {
  const national = p.formatNational()
  const compactNational = national.replace(/[^\d]/g, '')
  const formats = [p.number, p.formatInternational(), national, compactNational]
  // Écriture à points, courante en France (06.12.34.56.78).
  if (/^\d{2}( \d{2}){4}$/.test(national)) formats.push(national.replace(/ /g, '.'))
  return Array.from(new Set(formats))
}

/** Liens de recherche manuelle pour un numéro. */
export function phoneSearchLinks(p: PhoneNumber): Array<{ engine: string; url: string }> {
  const digits = p.number.slice(1)
  const nationalDigits = p.formatNational().replace(/[^\d]/g, '')
  const exact = phoneFormats(p)
    .map((f) => `"${f}"`)
    .join(' OR ')
  const links = [
    { engine: 'Google', url: `https://www.google.com/search?q=${q(exact)}` },
    { engine: 'Bing', url: `https://www.bing.com/search?q=${q(exact)}` },
    { engine: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${q(exact)}` },
    { engine: 'WhatsApp', url: `https://wa.me/${digits}` },
    { engine: 'Telegram', url: `https://t.me/+${digits}` },
    { engine: 'Signal', url: `https://signal.me/#p/+${digits}` },
    { engine: 'Sync.me', url: `https://sync.me/search/?number=${digits}` },
    { engine: 'Epieos', url: `https://epieos.com/?q=${q(p.number)}&t=phone` }
  ]
  if (p.country) {
    links.push({ engine: 'Truecaller', url: `https://www.truecaller.com/search/${p.country.toLowerCase()}/${nationalDigits}` })
  }
  if (p.country === 'FR') {
    links.push(
      { engine: 'PagesJaunes (annuaire inversé)', url: `https://www.pagesjaunes.fr/annuaireinverse/recherche?quoiqui=${nationalDigits}` },
      { engine: 'Tellows', url: `https://www.tellows.fr/num/${nationalDigits}` }
    )
  }
  if (p.country === 'US' || p.country === 'CA') {
    links.push({ engine: 'Spokeo', url: `https://www.spokeo.com/search?q=${q(p.number)}` })
  }
  return links
}

export default defineModule({
  id: 'phone.links',
  name: { fr: 'Liens de recherche (téléphone)', en: 'Search links (phone)' },
  description: {
    fr: "Prépare des recherches manuelles sur le numéro sous ses différentes écritures : Google, Bing, DuckDuckGo, WhatsApp, Telegram, Signal, Sync.me, Epieos, Truecaller, et pour la France PagesJaunes (annuaire inversé) et Tellows. Aucune requête n'est envoyée.",
    en: 'Prepares manual searches on the number in its various spellings: Google, Bing, DuckDuckGo, WhatsApp, Telegram, Signal, Sync.me, Epieos, Truecaller, and for France PagesJaunes (reverse directory) and Tellows. No request is sent.'
  },
  category: 'phone',
  inputTypes: ['phone'],
  async run(input, ctx) {
    const p = parsePhone(input)
    const entities: OutEntity[] = phoneSearchLinks(p).map(({ engine, url }) => ({
      type: 'search_link',
      label: `${engine} : ${p.number}`,
      data: { url, engine },
      linkLabel: ctx.lang === 'fr' ? 'recherche' : 'search'
    }))
    return { entities, properties: { formats: phoneFormats(p) } }
  }
})
