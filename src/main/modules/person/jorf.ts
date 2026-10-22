// Mentions nominatives au Journal officiel et dans les bulletins officiels des ministères
// (nominations, décorations, promotions, inscriptions...), via l'API publique JORFSearch.
// Les homonymes sont fréquents : chaque mention est mise de côté dans « À vérifier ».
// Si JORFSearch ne répond pas, la recherche Légifrance est proposée à la main.

import { defineModule, ModuleError, type ModuleContext, type OutEntity, type OutManualCheck } from '@shared/modules'
import { compact, httpStatus } from '../social/_lib'
import { parsePartialDate, type PartialDate } from './frDirigeants'
import { displayName, fold, splitName, type PersonName } from './_name'

const API = 'https://jorfsearch.steinertriples.ch/name/'
const MAX_PROPOSED = 10

export interface JorfEntry {
  source_date?: string
  source_id?: string
  source_name?: string
  type_ordre?: string
  nom?: string
  prenom?: string
  autres_prenoms?: string
  sexe?: string
  grade?: string
  date_naissance?: string
  lieu_naissance?: string
  organisations?: Array<{ nom?: string }>
  [key: string]: unknown
}

/** Distinctions signalées par un drapeau ou un échelon dans l'entrée. */
const DISTINCTIONS: Array<[string, string, string]> = [
  ['legion_honneur', 'Légion d’honneur', 'Legion of Honour'],
  ['ordre_merite', 'Ordre national du Mérite', 'National Order of Merit'],
  ['medaille_militaire', 'Médaille militaire', 'Military Medal'],
  ['medaille_securite_interieure', 'Médaille de la sécurité intérieure', 'Internal Security Medal'],
  ['palmes_academiques', 'Palmes académiques', 'Academic Palms'],
  ['merite_agricole', 'Mérite agricole', 'Agricultural Merit'],
  ['arts_lettres', 'Arts et Lettres', 'Arts and Letters']
]

const frDate = (iso: string): string => iso.split('-').reverse().join('/')

export function sameName(e: JorfEntry, name: PersonName): boolean {
  const norm = (s: string): string => fold(s).replace(/[^a-z]/g, '')
  return norm(e.nom ?? '') === norm(name.lastName) && norm(e.prenom ?? '') === norm(name.firstNames[0] ?? '')
}

/** Date de naissance publiée incompatible avec celle connue : ce n'est pas la personne. */
function otherBirth(e: JorfEntry, birth: PartialDate | null): boolean {
  const b = parsePartialDate(e.date_naissance)
  if (!birth || !b) return false
  return b.year !== birth.year || (!!b.month && !!birth.month && b.month !== birth.month) || (!!b.day && !!birth.day && b.day !== birth.day)
}

export function jorfEntity(e: JorfEntry, birth: PartialDate | null, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const orgs = (e.organisations ?? []).map((o) => o.nom ?? '').filter(Boolean)
  const distinction = DISTINCTIONS.filter(([k]) => e[k] !== undefined && e[k] !== 'false').map(([k, f, en]) => {
    const level = typeof e[k] === 'string' && e[k] !== 'true' ? ` (${e[k]})` : ''
    return (fr ? f : en) + level
  })
  const what = [e.type_ordre, e.grade, distinction[0], orgs[0]].filter(Boolean).join(', ')
  const source = e.source_name ?? 'JO'
  const confirmed = !!birth && !!e.date_naissance && !otherBirth(e, birth)
  return {
    type: 'event',
    label: `${source} ${e.source_date ? frDate(e.source_date) : ''} : ${what || (fr ? 'mention' : 'mention')}`.replace(/\s+:/, ' :').slice(0, 160),
    data: compact({
      date: e.source_date,
      source,
      source_id: e.source_id,
      url: e.source_id && /^JORFTEXT/.test(e.source_id) ? `https://www.legifrance.gouv.fr/jorf/id/${e.source_id}` : undefined,
      order_type: e.type_ordre,
      rank: e.grade,
      distinctions: distinction,
      organizations: orgs,
      other_first_names: e.autres_prenoms,
      birth_date: e.date_naissance,
      birth_place: e.lieu_naissance
    }),
    linkLabel: fr ? 'cité au Journal officiel' : 'named in the Official Journal',
    review: true,
    reviewReason: confirmed
      ? fr
        ? 'nom, prénom et date de naissance identiques'
        : 'same name and birth date'
      : fr
        ? 'homonyme possible : même nom et prénom au Journal officiel'
        : 'possible namesake: same name in the Official Journal'
  }
}

export function legifranceCheck(name: PersonName, lang: 'fr' | 'en', unavailable = false): OutManualCheck {
  const q = `"${displayName(name)}"`
  // La recherche automatique n'a pas pu se faire : l'enquêteur doit le savoir, une absence de
  // mention ne vaut rien tant que la recherche manuelle n'est pas faite.
  const down = unavailable
    ? lang === 'fr'
      ? 'JORFSearch n’a pas répondu, la recherche automatique n’a pas été faite. '
      : 'JORFSearch did not answer, the automatic search was not done. '
    : ''
  return {
    label: 'Légifrance (Journal officiel)',
    url: `https://www.legifrance.gouv.fr/search/jorf?tab_selection=jorf&searchField=ALL&query=${encodeURIComponent(q)}&page=1&init=true`,
    hint:
      down +
      (lang === 'fr'
        ? 'Nominations, décorations, naturalisations et changements de nom publiés au Journal officiel.'
        : 'Appointments, decorations, naturalisations and name changes published in the Official Journal.')
  }
}

/** « Prénom Nom » avec majuscules initiales : la forme attendue par JORFSearch. */
const queryName = (name: PersonName): string => displayName({ firstNames: name.firstNames.slice(0, 1), lastName: name.lastName })

async function search(ctx: ModuleContext, name: PersonName): Promise<JorfEntry[] | null> {
  const url = API + encodeURIComponent(queryName(name))
  try {
    const res = await ctx.fetchJson<unknown>(url, { query: { format: 'JSON' }, timeoutMs: 25000 })
    return Array.isArray(res) ? (res as JorfEntry[]) : null
  } catch (e) {
    if (httpStatus(e) === 429) throw new ModuleError('JORFSearch : trop de requêtes, réessayez plus tard', 'rate_limited')
    // Service indisponible ou réponse illisible : la recherche reste possible à la main.
    ctx.log(`JORFSearch : ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export default defineModule({
  id: 'person.jorf',
  name: { fr: 'Journal officiel (France)', en: 'Official Journal (France)' },
  description: {
    fr: 'Cherche les mentions nominatives au Journal officiel et dans les bulletins officiels (nominations, décorations, promotions, concours) via JORFSearch, sans clé. Chaque mention est mise de côté dans « À vérifier » ; si le service ne répond pas, la recherche Légifrance est proposée à la main.',
    en: 'Finds mentions by name in the French Official Journal and official bulletins (appointments, decorations, promotions, competitive exams) through JORFSearch, no key. Each mention is put aside in "To review"; if the service does not answer, a Légifrance search is offered instead.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://jorfsearch.steinertriples.ch/',
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const entries = await search(ctx, name)
    if (!entries) return { manual: [legifranceCheck(name, ctx.lang, true)] }
    const birth = parsePartialDate(input.data.birth_date)
    const kept = entries.filter((e) => sameName(e, name) && !otherBirth(e, birth)).sort((a, b) => (b.source_date ?? '').localeCompare(a.source_date ?? ''))
    if (!kept.length) return { raw: { total: entries.length, kept: 0 } }
    const raw = { total: entries.length, kept: kept.length, entries: kept.slice(0, 100) }
    if (kept.length > MAX_PROPOSED) {
      return {
        properties: { jorf_mentions_count: kept.length },
        manual: [
          {
            label: 'JORFSearch',
            url: API + encodeURIComponent(queryName(name)),
            hint:
              ctx.lang === 'fr'
                ? `${kept.length} mentions au nom de ${displayName(name)} : trop d’homonymes possibles pour les proposer une à une.`
                : `${kept.length} mentions named ${displayName(name)}: too many possible namesakes to list them one by one.`
          }
        ],
        raw
      }
    }
    return { entities: kept.map((e) => jorfEntity(e, birth, ctx.lang)), properties: { jorf_mentions_count: kept.length }, raw }
  }
})
