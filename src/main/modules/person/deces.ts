// Fichier des personnes décédées en France depuis 1970 (INSEE), interrogé via l'API publique de
// matchID. Les homonymes sont fréquents : chaque décès au même nom est mis de côté dans
// « À vérifier », avec les dates et lieux de naissance et de décès pour comparer.

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import { compact, httpStatus } from '../social/_lib'
import { parsePartialDate, type PartialDate } from './frDirigeants'
import { displayName, fold, splitName, type PersonName } from './_name'

const API = 'https://deces.matchid.io/deces/api/v1/search'
/** Au-delà, la liste n'aide pas : il faut préciser la date de naissance. */
const MAX_PROPOSED = 10

interface MatchIdLocation {
  city?: string | string[]
  departmentCode?: string
  country?: string
  countryCode?: string
  latitude?: number
  longitude?: number
}

export interface MatchIdPerson {
  id: string
  name: { first?: string[] | string; last?: string }
  sex?: string
  birth?: { date?: string; location?: MatchIdLocation }
  death?: { date?: string; age?: number; location?: MatchIdLocation }
}

export interface MatchIdResponse {
  response?: { total?: number; persons?: MatchIdPerson[] }
}

/** `19321129` vers `1932-11-29` ; les parties inconnues (`00`) sont retirées. */
export function inseeDate(raw: string | undefined): string | undefined {
  const m = raw?.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!m || m[1] === '0000') return undefined
  if (m[2] === '00') return m[1]
  if (m[3] === '00') return `${m[1]}-${m[2]}`
  return `${m[1]}-${m[2]}-${m[3]}`
}

const frDate = (iso: string): string => iso.split('-').reverse().join('/')

function placeLabel(loc: MatchIdLocation | undefined): string | undefined {
  if (!loc) return undefined
  const cities = Array.isArray(loc.city) ? loc.city : loc.city ? [loc.city] : []
  const city = cities[cities.length - 1]
  if (!city) return loc.country
  if (loc.countryCode && loc.countryCode !== 'FRA') return loc.country ? `${city}, ${loc.country}` : city
  return loc.departmentCode ? `${city} (${loc.departmentCode})` : city
}

const firstNames = (p: MatchIdPerson): string[] => (Array.isArray(p.name.first) ? p.name.first : p.name.first ? [p.name.first] : [])

/** Même nom de famille et premier prénom présent parmi les prénoms déclarés. */
export function sameName(p: MatchIdPerson, name: PersonName): boolean {
  const norm = (s: string): string => fold(s).replace(/[^a-z]/g, '')
  const first = norm(name.firstNames[0] ?? '')
  return !!first && norm(p.name.last ?? '') === norm(name.lastName) && firstNames(p).some((f) => norm(f) === first)
}

/** La date de naissance déclarée concorde-t-elle avec celle connue (au jour, au mois ou à l'année près) ? */
export function sameBirth(p: MatchIdPerson, birth: PartialDate | null): boolean {
  const b = parsePartialDate(inseeDate(p.birth?.date))
  if (!birth || !b || b.year !== birth.year) return false
  if (birth.month && b.month && birth.month !== b.month) return false
  if (birth.day && b.day && birth.day !== b.day) return false
  return true
}

export function deathEntity(p: MatchIdPerson, birth: PartialDate | null, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const death = inseeDate(p.death?.date)
  const who = `${firstNames(p).join(' ')} ${p.name.last ?? ''}`.trim()
  const lat = p.death?.location?.latitude
  const lon = p.death?.location?.longitude
  const confirmed = sameBirth(p, birth)
  return {
    type: 'event',
    label: fr ? `Décès de ${who}${death ? ` (${frDate(death)})` : ''}` : `Death of ${who}${death ? ` (${death})` : ''}`,
    data: compact({
      date: death,
      place: placeLabel(p.death?.location),
      birth_date: inseeDate(p.birth?.date),
      birth_place: placeLabel(p.birth?.location),
      age: p.death?.age,
      gender: p.sex === 'M' ? (fr ? 'homme' : 'male') : p.sex === 'F' ? (fr ? 'femme' : 'female') : undefined,
      lat: typeof lat === 'number' && typeof lon === 'number' ? lat : undefined,
      lon: typeof lat === 'number' && typeof lon === 'number' ? lon : undefined,
      source: 'INSEE (matchID)',
      url: `https://deces.matchid.io/id/${p.id}`
    }),
    linkLabel: fr ? 'décès au même nom' : 'death record, same name',
    review: true,
    reviewReason: confirmed
      ? fr
        ? 'nom, prénom et date de naissance identiques'
        : 'same name and birth date'
      : fr
        ? 'homonyme possible : même nom et prénom, comparez la date et le lieu de naissance'
        : 'possible namesake: same name, compare birth date and place'
  }
}

async function search(ctx: ModuleContext, name: PersonName, birth: PartialDate | null): Promise<MatchIdResponse> {
  const birthDate = birth?.day && birth.month ? `${String(birth.day).padStart(2, '0')}/${String(birth.month).padStart(2, '0')}/${birth.year}` : birth ? String(birth.year) : undefined
  try {
    return await ctx.fetchJson<MatchIdResponse>(API, {
      query: { firstName: name.firstNames[0], lastName: name.lastName, birthDate, fuzzy: 'false', size: 50 },
      timeoutMs: 25000
    })
  } catch (e) {
    const status = httpStatus(e)
    if (status === 429) throw new ModuleError('matchID : trop de requêtes, réessayez plus tard', 'rate_limited')
    throw new ModuleError(`matchID injoignable : ${e instanceof Error ? e.message : String(e)}`, 'unavailable')
  }
}

export default defineModule({
  id: 'person.fr_deces',
  name: { fr: 'Décès en France (INSEE)', en: 'Deaths in France (INSEE)' },
  description: {
    fr: 'Cherche la personne dans le fichier des décès de l’INSEE depuis 1970 (API publique matchID, sans clé). Chaque décès au même nom et prénom est mis de côté dans « À vérifier » avec les dates et lieux de naissance et de décès. La date de naissance, si elle est connue, affine la recherche.',
    en: 'Looks the person up in the INSEE death register since 1970 (public matchID API, no key). Each death record with the same name is put aside in "To review" with birth and death dates and places. A known birth date narrows the search.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://deces.matchid.io/',
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const birth = parsePartialDate(input.data.birth_date)
    const res = await search(ctx, name, birth)
    const returned = res.response?.persons ?? []
    const persons = returned.filter((p) => sameName(p, name))
    // Liste complète : on compte ce qui correspond vraiment ; liste tronquée : le total annoncé.
    const total = (res.response?.total ?? 0) > returned.length ? (res.response?.total ?? 0) : persons.length
    if (!persons.length) return { raw: { total: 0 } }
    const raw = { total, persons: persons.slice(0, 50) }
    if (total > MAX_PROPOSED) {
      // Trop d'homonymes pour les proposer un à un : la recherche reste consultable.
      const q = `${name.firstNames.join(' ')} ${name.lastName}`
      return {
        properties: { death_records_count: total },
        manual: [
          {
            label: 'matchID',
            url: `https://deces.matchid.io/search?q=${encodeURIComponent(q)}`,
            hint:
              ctx.lang === 'fr'
                ? `${total} décès au nom de ${displayName(name)} : ajoutez la date de naissance à la fiche pour trier, ou comparez sur la page.`
                : `${total} death records named ${displayName(name)}: add the birth date to narrow them down, or compare on the page.`
          }
        ],
        raw
      }
    }
    return { entities: persons.map((p) => deathEntity(p, birth, ctx.lang)), properties: { death_records_count: total }, raw }
  }
})
