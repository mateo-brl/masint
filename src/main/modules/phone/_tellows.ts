// Fiche Tellows d'un numéro : score de 1 (fiable) à 9 (dangereux), nombre de recherches et de
// commentaires, types d'appel signalés, noms d'appelant donnés par la communauté. Lecture
// tolérante du texte de la page (français, allemand, anglais, espagnol, italien, néerlandais),
// partagée par le module `phone.tellows` et la recherche assistée (vrai navigateur). Fonctions
// pures, testées hors ligne.
//
// La fiche n'est gardée que si le numéro qu'elle affiche est exactement le numéro cherché.

import { parsePhoneNumberFromString, type CountryCode, type PhoneNumber } from 'libphonenumber-js/max'
import { callerNamePivots, type CallerEntity } from '@shared/callerName'
import type { AssistExtracted, PropValue } from '@shared/types'
import { decodeEntities } from '../web/_html'

/** Sites Tellows par pays (numéros nationaux). */
const SITES: Partial<Record<CountryCode, string>> = {
  FR: 'www.tellows.fr',
  BE: 'www.tellows.be',
  CH: 'www.tellows.ch',
  DE: 'www.tellows.de',
  AT: 'www.tellows.at',
  GB: 'www.tellows.co.uk',
  ES: 'www.tellows.es',
  IT: 'www.tellows.it',
  NL: 'www.tellows.nl'
}

/** Fiche Tellows du numéro (`https://www.tellows.fr/num/0612345678`), si le pays a un site. */
export function tellowsUrl(p: PhoneNumber): string | null {
  const site = p.country ? SITES[p.country] : undefined
  if (!site) return null
  return `https://${site}/num/${p.formatNational().replace(/\D+/g, '')}`
}

/** Page de vérification anti-robot de Cloudflare (« Just a moment... », « Un instant… »). */
export function isCloudflareChallenge(status: number, html: string): boolean {
  if (status !== 403 && status !== 503 && status !== 429) return false
  return /<title>\s*(just a moment|un instant|einen moment|un momento|attention required)|challenge-platform|cf-chl|cf_chl_opt|challenges\.cloudflare\.com/i.test(html)
}

/** Texte de la page, une ligne par bloc (paragraphe, cellule, titre...). */
export function textLines(html: string): string[] {
  const text = html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/?(p|div|li|ul|ol|tr|td|th|table|h\d|section|article|header|footer|dl|dt|dd|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean)
}

const LABELS = {
  score: /(?:score\s+tellows|tellows[\s-]*score|score)/i,
  searches: /(?:nombre de recherches|recherches|suchanfragen|anfragen|number of searches|searches|b[úu]squedas|ricerche|zoekopdrachten)/i,
  comments: /(?:nombre de commentaires|commentaires|[ée]valuations|kommentare|bewertungen|comments|ratings|reviews|comentarios|commenti|reacties|beoordelingen)/i,
  types: /(?:types? d['’]appels?|type d['’]appelant|anrufertypen|anrufertyp|anrufart|caller types?|types? of calls?|call types?|tipos? de llamadas?|tipo di chiamata|tipi di chiamata|type beller|soort beller)/i,
  names: /(?:noms? de l['’]appelant|noms? d['’]appelants?|anrufernamen|anrufername|caller names?|nombres? de la persona que llama|nombre del llamante|nomi? del chiamante|naam van de beller|naam beller)/i
}

/**
 * Valeurs d'un champ « Libellé : valeur » (reste de la ligne, sinon la ligne suivante), dans
 * l'ordre de la page : un même mot peut aussi servir de titre de menu (« Recherches récentes »).
 */
function fields(lines: string[], label: RegExp): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`(?:^|[\\s(|·])${label.source}\\s*:?\\s*(.*)$`, 'i'))
    if (!m) continue
    let value = m[1].trim()
    // Fin de la valeur : le libellé d'un autre champ sur la même ligne.
    for (const other of Object.values(LABELS)) {
      if (other === label) continue
      const at = value.search(new RegExp(`(?:^|\\s)${other.source}\\s*:`, 'i'))
      if (at >= 0) value = value.slice(0, at).trim()
    }
    if (!value && lines[i + 1] && !Object.values(LABELS).some((l) => new RegExp(`^${l.source}\\s*:?`, 'i').test(lines[i + 1]))) value = lines[i + 1]
    if (value) out.push(value)
  }
  return out
}

/** Premier nombre entier parmi les valeurs du champ (« 1 234 », « 1.234 »). */
function integer(values: string[]): number | undefined {
  for (const v of values) {
    const m = v.match(/^\d[\d\s.,'’]*/)
    if (!m) continue
    const n = Number(m[0].replace(/[^\d]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** Première valeur du champ qui n'est pas un simple nombre (liste de types, de noms). */
const text = (values: string[]): string | null => values.find((v) => !/^\d[\d\s.,]*$/.test(v)) ?? null

/** Liste « Démarchage (5x), Arnaque (2) » : libellés sans les comptes. */
function list(value: string | null, max = 10): string[] {
  if (!value) return []
  return Array.from(
    new Set(
      value
        .split(/[,;/|•]/)
        .map((v) => v.replace(/\(\s*\d+\s*x?\s*\)|\b\d+\s*x\b|^\s*\d+\s*x?\s+/gi, '').replace(/\s+/g, ' ').trim())
        .filter((v) => v && v.length <= 80 && !/^(aucun|aucune|keine?|none|n\/a|-)$/i.test(v))
    )
  ).slice(0, max)
}

/** Score de 1 à 9 : image du score, données structurées ou texte. */
function score(html: string, lines: string[]): number | undefined {
  const img = html.match(/score[_\-/]?([1-9])\.(?:png|svg|gif|webp)/i)
  if (img) return Number(img[1])
  const ld = html.match(/"ratingValue"\s*:\s*"?([1-9])(?:\.0)?"?[\s\S]{0,120}?"bestRating"\s*:\s*"?9/i)
  if (ld) return Number(ld[1])
  for (const v of fields(lines, LABELS.score)) {
    const m = v.match(/^([1-9])(?:\s*\/\s*9)?\b/)
    if (m) return Number(m[1])
  }
  return undefined
}

/** Numéros affichés en titre de la fiche (balise `<title>` et premier `<h1>`). */
function shownNumbers(html: string): string[] {
  const parts = [html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '']
  const text = decodeEntities(parts.join(' ').replace(/<[^>]+>/g, ' '))
  return text.match(/\+?\d[\d\s./()-]{5,}\d/g) ?? []
}

export interface TellowsPage {
  score?: number
  searches?: number
  comments?: number
  callTypes: string[]
  callerNames: string[]
}

/**
 * Fiche Tellows lue dans la page, ou `null` si la page n'affiche pas exactement le numéro
 * cherché (autre numéro, page d'accueil, vérification anti-robot).
 */
export function parseTellows(html: string, p: PhoneNumber): TellowsPage | null {
  const same = shownNumbers(html).some((raw) => parsePhoneNumberFromString(raw.trim(), p.country ?? 'FR')?.number === p.number)
  if (!same) return null
  const lines = textLines(html)
  return {
    score: score(html, lines),
    searches: integer(fields(lines, LABELS.searches)),
    comments: integer(fields(lines, LABELS.comments)),
    callTypes: list(text(fields(lines, LABELS.types))),
    callerNames: list(text(fields(lines, LABELS.names)), 15)
  }
}

export interface TellowsOutput {
  properties: Record<string, PropValue>
  /** Noms d'appelant pris pour des personnes ou des pseudos : à vérifier. */
  entities: CallerEntity[]
}

/** Propriétés du numéro et noms d'appelant classés (personnes et pseudos à vérifier). */
export function tellowsOutput(page: TellowsPage, url: string, lang: 'fr' | 'en'): TellowsOutput {
  const callers = callerNamePivots(
    page.callerNames.map((name) => ({ name, source: 'Tellows' })),
    lang
  )
  const properties: Record<string, PropValue> = { tellows_url: url }
  if (page.score !== undefined) properties.tellows_score = page.score
  if (page.searches !== undefined) properties.tellows_searches = page.searches
  if (page.comments !== undefined) properties.tellows_comments = page.comments
  if (page.callTypes.length) properties.tellows_call_types = page.callTypes
  return { properties: { ...properties, ...callers.properties }, entities: callers.entities }
}

/** Fiche lue par la recherche assistée, pour « À vérifier » : propriétés et noms à ajouter. */
export function tellowsExtract(html: string | null, p: PhoneNumber, url: string, lang: 'fr' | 'en'): AssistExtracted {
  const base: AssistExtracted = { state: 'none', names: [], maskedNames: [], usernames: [], maskedEmails: [], maskedPhones: [], photos: [] }
  const page = html ? parseTellows(html, p) : null
  if (!page)
    return {
      ...base,
      state: 'unknown',
      note: lang === 'fr' ? 'La page ne montre pas la fiche de ce numéro.' : 'The page does not show the record of this number.'
    }
  const out = tellowsOutput(page, url, lang)
  return {
    ...base,
    state: 'profile',
    names: out.entities.filter((e) => e.type === 'person').map((e) => e.label),
    usernames: out.entities.filter((e) => e.type === 'username').map((e) => e.label),
    properties: out.properties
  }
}
