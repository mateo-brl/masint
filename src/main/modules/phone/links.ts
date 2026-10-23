// Vérifications d'un numéro : signalements publics (doisjerepondre.fr, numéros français) en
// propriétés du nœud, et recherches à faire à la main dans les services sans API ou qui
// exigent un compte (Truecaller, Sync.me, WhatsApp...), proposées dans « À vérifier ».

import { defineModule, type ModuleContext, type ModuleOutput, type OutManualCheck } from '@shared/modules'
import type { PropValue } from '@shared/types'
import type { PhoneNumber } from 'libphonenumber-js/max'
import { facebookIdentifyCheck } from '../../flows/facebook'
import { decodeEntities } from '../web/_html'
import { parsePhone } from './_phone'

const q = encodeURIComponent
const t = (lang: 'fr' | 'en', fr: string, en: string): string => (lang === 'fr' ? fr : en)

/** Écritures courantes du numéro, pour les recherches exactes. */
export function phoneFormats(p: PhoneNumber): string[] {
  const national = p.formatNational()
  const compactNational = national.replace(/[^\d]/g, '')
  const formats = [p.number, p.formatInternational(), national, compactNational]
  // Écriture à points, courante en France (06.12.34.56.78).
  if (/^\d{2}( \d{2}){4}$/.test(national)) formats.push(national.replace(/ /g, '.'))
  return Array.from(new Set(formats))
}

/**
 * Recherches que MASINT ne peut pas faire seul. Les moteurs de recherche (Google, Bing,
 * DuckDuckGo) bloquent les requêtes automatiques : une seule recherche Google regroupe toutes
 * les écritures du numéro.
 */
export function phoneManualChecks(p: PhoneNumber, lang: 'fr' | 'en' = 'fr'): OutManualCheck[] {
  const digits = p.number.slice(1)
  const nationalDigits = p.formatNational().replace(/[^\d]/g, '')
  const exact = phoneFormats(p)
    .map((f) => `"${f}"`)
    .join(' OR ')
  const checks: OutManualCheck[] = [
    {
      label: 'Google',
      url: `https://www.google.com/search?q=${q(exact)}`,
      hint: t(lang, 'Pages qui citent le numéro sous l’une de ses écritures : annonces, sites d’entreprise, signalements.', 'Pages quoting the number in any of its spellings: ads, business sites, reports.')
    },
    {
      label: 'WhatsApp',
      url: `https://wa.me/${digits}`,
      hint: t(lang, 'Depuis un téléphone d’enquête : photo de profil, statut, compte professionnel.', 'From an investigation phone: profile picture, status, business account.')
    },
    facebookIdentifyCheck(lang),
    {
      label: 'Telegram',
      url: `https://t.me/+${digits}`,
      hint: t(lang, 'Nom et photo affichés si le compte accepte d’être trouvé par son numéro.', 'Name and picture shown if the account can be found by its number.')
    }
  ]
  if (p.country) {
    checks.push({
      label: 'Truecaller',
      url: `https://www.truecaller.com/search/${p.country.toLowerCase()}/${nationalDigits}`,
      hint: t(lang, 'Nom donné au numéro par les utilisateurs (connexion requise).', 'Name given to the number by users (sign-in required).')
    })
  }
  checks.push(
    {
      label: 'Sync.me',
      url: `https://sync.me/search/?number=${digits}`,
      hint: t(lang, 'Nom enregistré dans les carnets d’adresses partagés, parfois une photo.', 'Name saved in shared address books, sometimes a picture.')
    },
    {
      label: 'Epieos',
      url: `https://epieos.com/?q=${q(p.number)}&t=phone`,
      hint: t(lang, 'Comptes en ligne rattachés au numéro (compte Epieos requis).', 'Online accounts tied to the number (Epieos account required).')
    }
  )
  if (p.country === 'FR') {
    checks.push(
      {
        label: 'PagesJaunes (annuaire inversé)',
        url: `https://www.pagesjaunes.fr/annuaireinverse/recherche?quoiqui=${nationalDigits}`,
        hint: t(lang, 'Titulaire et adresse si la ligne est inscrite à l’annuaire.', 'Subscriber and address if the line is listed.')
      },
      {
        label: 'Tellows',
        url: `https://www.tellows.fr/num/${nationalDigits}`,
        hint: t(lang, 'Score de 1 (fiable) à 9 (dangereux), commentaires et type d’appel.', 'Score from 1 (trusted) to 9 (dangerous), comments and call type.')
      }
    )
  }
  if (p.country === 'US' || p.country === 'CA') {
    checks.push({
      label: 'Spokeo',
      url: `https://www.spokeo.com/search?q=${q(p.number)}`,
      hint: t(lang, 'Titulaire probable et ville (détails payants).', 'Likely owner and city (details are paid).')
    })
  }
  return checks
}

export interface CallerReports {
  /** Avis dominant : `positive`, `negative`, `neutral` (ou `unknown`). */
  rating: string
  /** Nombre total d'évaluations. */
  reports: number
  ratings: Array<{ label: string; count: number }>
  categories: Array<{ label: string; count: number }>
  comments: Array<{ date?: string; category?: string; text: string }>
}

const clean = (s: string): string => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Liste « 4x positive », « 5x Entreprise » d'un bloc de la fiche. */
function counts(html: string, block: string): Array<{ label: string; count: number }> {
  const m = html.match(new RegExp(`<div class="${block}">[\\s\\S]*?<ul>([\\s\\S]*?)</ul>`))
  if (!m) return []
  return Array.from(m[1].matchAll(/<li[^>]*>\s*(\d+)\s*x\s*([^<]+)<\/li>/g)).map((x) => ({ label: clean(x[2]), count: Number(x[1]) }))
}

/** Fiche doisjerepondre.fr d'un numéro : `null` quand personne ne l'a signalé. */
export function parseCallerReports(html: string): CallerReports | null {
  const ratings = counts(html, 'ratings')
  const reports = ratings.reduce((n, r) => n + r.count, 0)
  if (!reports) return null
  const rating = html.match(/<div class="mainInfoHeader">[\s\S]*?<div class="score (\w+)"/)?.[1] ?? 'unknown'
  const comments: CallerReports['comments'] = []
  for (const block of html.split('<div class="review" data-reviewid=').slice(1)) {
    const text = clean(block.match(/<span class="review_comment"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '')
    if (!text) continue
    const date = block.match(/itemprop="datePublished" datetime="(\d{4}-\d{2}-\d{2})/)?.[1]
    const category = clean(block.match(/<span itemprop='name'>([\s\S]*?)<\/span>/)?.[1] ?? '') || undefined
    comments.push({ date, category, text: text.slice(0, 300) })
  }
  return { rating, reports, ratings, categories: counts(html, 'categories'), comments }
}

const RATING_FR: Record<string, string> = { positive: 'positive', negative: 'négative', neutral: 'neutre', unknown: 'inconnue' }

export function callerProperties(r: CallerReports, url: string, lang: 'fr' | 'en'): Record<string, PropValue> {
  return {
    caller_rating: lang === 'fr' ? (RATING_FR[r.rating] ?? r.rating) : r.rating,
    caller_reports: r.reports,
    ...(r.categories.length ? { caller_categories: r.categories.map((c) => `${c.label} (${c.count})`) } : {}),
    ...(r.comments.length
      ? { caller_comments: r.comments.slice(0, 5).map((c) => [c.date, c.category, c.text].filter(Boolean).join(' · ')) }
      : {}),
    caller_reports_url: url
  }
}

async function callerReports(p: PhoneNumber, ctx: ModuleContext): Promise<{ url: string; reports: CallerReports | null }> {
  const url = `https://www.doisjerepondre.fr/numero-de-telephone/${p.formatNational().replace(/[^\d]/g, '')}`
  const res = await ctx.fetch(url, { timeoutMs: 20000 })
  const html = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return { url, reports: parseCallerReports(html) }
}

export default defineModule({
  id: 'phone.links',
  name: { fr: 'Signalements et recherches manuelles (téléphone)', en: 'Reports and manual searches (phone)' },
  description: {
    fr: "Lit les signalements publics du numéro (doisjerepondre.fr, numéros français) : avis dominant, nombre d'évaluations, type d'appel et derniers commentaires, seulement s'il a été signalé. Propose dans « À vérifier » les recherches impossibles à automatiser : Google (toutes les écritures), WhatsApp, Facebook (retrouver le compte, lu par la recherche assistée sans envoi de code), Telegram, Truecaller, Sync.me, Epieos, et pour la France PagesJaunes et Tellows.",
    en: 'Reads public reports about the number (doisjerepondre.fr, French numbers): overall rating, number of reviews, call type and latest comments, only when it has been reported. Lists in "To review" the searches that cannot be automated: Google (all spellings), WhatsApp, Facebook (find the account, read by the assisted search without sending any code), Telegram, Truecaller, Sync.me, Epieos, and for France PagesJaunes and Tellows.'
  },
  category: 'phone',
  inputTypes: ['phone'],
  homepage: 'https://www.doisjerepondre.fr/',
  async run(input, ctx) {
    const p = parsePhone(input)
    const out: ModuleOutput = { properties: { formats: phoneFormats(p) }, manual: phoneManualChecks(p, ctx.lang) }
    if (p.country !== 'FR') return out
    try {
      const { url, reports } = await callerReports(p, ctx)
      if (reports) {
        out.properties = { ...out.properties, ...callerProperties(reports, url, ctx.lang) }
        out.raw = reports
      }
    } catch (e) {
      // Service injoignable : la fiche reste consultable à la main.
      ctx.log(`doisjerepondre.fr : ${e instanceof Error ? e.message : String(e)}`)
      out.manual!.push({
        label: 'Dois-je répondre ?',
        url: `https://www.doisjerepondre.fr/numero-de-telephone/${p.formatNational().replace(/[^\d]/g, '')}`,
        hint: t(ctx.lang, 'Signalements et commentaires des personnes appelées.', 'Reports and comments from people who were called.')
      })
    }
    return out
  }
})
