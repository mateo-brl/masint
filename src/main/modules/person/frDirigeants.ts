import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import { compact, httpStatus } from '../social/_lib'
import { fold, splitName, type PersonName } from './_name'

const API = 'https://recherche-entreprises.api.gouv.fr/search'
const PER_PAGE = 25
const MAX_PAGES = 3

const LEGAL_FORMS: Record<string, string> = {
  '1000': 'Entrepreneur individuel',
  '5202': 'SNC',
  '5498': 'EURL',
  '5499': 'SARL',
  '5599': 'SA à conseil d’administration',
  '5699': 'SA à directoire',
  '5710': 'SAS',
  '5720': 'SASU',
  '6540': 'SCI',
  '9220': 'Association déclarée'
}

const HEADCOUNT: Record<string, string> = {
  '00': '0 salarié',
  '01': '1 à 2',
  '02': '3 à 5',
  '03': '6 à 9',
  '11': '10 à 19',
  '12': '20 à 49',
  '21': '50 à 99',
  '22': '100 à 199',
  '31': '200 à 249',
  '32': '250 à 499',
  '41': '500 à 999',
  '42': '1 000 à 1 999',
  '51': '2 000 à 4 999',
  '52': '5 000 à 9 999',
  '53': '10 000 et plus'
}

export interface ReDirigeant {
  nom?: string | null
  prenoms?: string | null
  annee_de_naissance?: string | null
  date_de_naissance?: string | null
  qualite?: string | null
  nationalite?: string | null
  type_dirigeant?: string
}

export interface ReResult {
  siren: string
  nom_complet: string
  nature_juridique?: string | null
  activite_principale?: string | null
  date_creation?: string | null
  date_fermeture?: string | null
  etat_administratif?: string | null
  tranche_effectif_salarie?: string | null
  dirigeants?: ReDirigeant[]
  siege?: {
    siret?: string
    adresse?: string
    latitude?: string | null
    longitude?: string | null
    libelle_commune?: string
  } | null
}

export interface ReResponse {
  results: ReResult[]
  total_results: number
  total_pages: number
}

/** Le dirigeant correspond-il au nom cherché (nom contenu, premier prénom présent) ? */
export function matchesPerson(d: ReDirigeant, name: PersonName): boolean {
  if (d.type_dirigeant && d.type_dirigeant !== 'personne physique') return false
  const nom = fold(d.nom ?? '')
  const prenoms = fold(d.prenoms ?? '').split(/[\s,-]+/)
  const last = fold(name.lastName)
  const firstParts = fold(name.firstNames[0] ?? '').split(/[\s-]+/)
  return !!nom && nom.includes(last) && firstParts.every((p) => prenoms.includes(p))
}

const roleLabel = (d: ReDirigeant): string => {
  const birth = d.date_de_naissance?.match(/^(\d{4})-(\d{2})/)
  return [d.qualite || 'Dirigeant', birth ? `né(e) ${birth[2]}/${birth[1]}` : d.annee_de_naissance ? `né(e) ${d.annee_de_naissance}` : null]
    .filter(Boolean)
    .join(' · ')
}

/** Plafond des entreprises rattachées : au-delà, ce sont presque toujours des homonymes. */
const MAX_COMPANIES = 10

export interface PartialDate {
  year: number
  month?: number
  day?: number
}

/** `1867-11-07`, `1867-11`, `1867`, `07/11/1867` ou `11/1867`. */
export function parsePartialDate(v: unknown): PartialDate | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim().replace(/^\+/, '')
  let m = s.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:T|$)/)
  if (m) return { year: Number(m[1]), month: m[2] ? Number(m[2]) || undefined : undefined, day: m[3] ? Number(m[3]) || undefined : undefined }
  m = s.match(/^(?:(\d{1,2})\/)?(\d{1,2})\/(\d{4})$/)
  if (m) return { year: Number(m[3]), month: Number(m[2]) || undefined, day: m[1] ? Number(m[1]) : undefined }
  return null
}

const dateKey = (d: PartialDate): number => d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0)

/** Ce que l'on sait déjà de la personne (propriétés de l'entité d'entrée). */
export interface KnownIdentity {
  birth?: PartialDate | null
  death?: PartialDate | null
}

export type Consistency = 'confirmed' | 'possible' | 'excluded'

/**
 * Cohérence d'un mandat avec l'identité connue. Un mandat est exclu si la date de naissance
 * déclarée diffère, si l'entreprise a été créée après le décès, si le mandat (ou l'entreprise
 * individuelle) est resté ouvert longtemps après le décès, ou si l'entreprise a fermé avant les
 * 16 ans de la personne.
 * Il n'est confirmé que si l'année et le mois de naissance concordent.
 */
export function mandateConsistency(r: ReResult, d: ReDirigeant, id: KnownIdentity, now = new Date()): Consistency {
  const born = parsePartialDate(d.date_de_naissance ?? d.annee_de_naissance)
  const created = parsePartialDate(r.date_creation)
  const closed = parsePartialDate(r.date_fermeture)
  if (id.death) {
    if (born && born.year > id.death.year) return 'excluded'
    if (created && dateKey(created) > dateKey(id.death)) return 'excluded'
    // Entreprise active : le mandat est toujours ouvert (on tolère un an de retard des registres).
    if (r.etat_administratif === 'A' && now.getFullYear() - id.death.year > 1) return 'excluded'
    // Entrepreneur individuel : l'activité est celle de la personne, elle cesse au plus tard au décès.
    if (r.nature_juridique === '1000' && closed && closed.year - id.death.year > 1) return 'excluded'
  }
  if (id.birth) {
    if (born && born.year !== id.birth.year) return 'excluded'
    if (born?.month && id.birth.month && born.month !== id.birth.month) return 'excluded'
    if (closed && closed.year < id.birth.year + 16) return 'excluded'
    if (born?.month && id.birth.month) return 'confirmed'
  }
  return 'possible'
}

/** Pertinence d'une correspondance : premier prénom et nom identiques plutôt que prénom secondaire ou nom composé. */
function relevance(d: ReDirigeant, name: PersonName): number {
  const prenoms = fold(d.prenoms ?? '').split(/[\s,]+/).filter(Boolean)
  const firstExact = prenoms[0] === fold(name.firstNames[0] ?? '')
  const lastExact = fold(d.nom ?? '').replace(/\s*\(.*\)\s*$/, '').trim() === fold(name.lastName)
  return (firstExact ? 2 : 0) + (lastExact ? 1 : 0)
}

export interface MandateCandidate {
  result: ReResult
  matches: ReDirigeant[]
  confirmed: boolean
  score: number
}

/** Entreprises où la personne apparaît, triées par pertinence, sans les mandats incohérents. */
export function selectMandates(
  results: ReResult[],
  name: PersonName,
  id: KnownIdentity = {},
  now = new Date()
): { kept: MandateCandidate[]; excluded: Array<{ result: ReResult; matches: ReDirigeant[] }> } {
  const kept: MandateCandidate[] = []
  const excluded: Array<{ result: ReResult; matches: ReDirigeant[] }> = []
  const seen = new Set<string>()
  for (const r of results) {
    if (seen.has(r.siren)) continue
    seen.add(r.siren)
    const all = (r.dirigeants ?? []).filter((d) => matchesPerson(d, name))
    if (!all.length) continue
    const verdicts = all.map((d) => mandateConsistency(r, d, id, now))
    const matches = all.filter((_, i) => verdicts[i] !== 'excluded')
    if (!matches.length) {
      excluded.push({ result: r, matches: all })
      continue
    }
    kept.push({
      result: r,
      matches,
      // Naissance concordante et prénom d'usage identique (pas un prénom secondaire).
      confirmed: all.some((d, i) => verdicts[i] === 'confirmed' && relevance(d, name) >= 2),
      score: Math.max(...matches.map((d) => relevance(d, name)))
    })
  }
  kept.sort(
    (a, b) =>
      Number(b.confirmed) - Number(a.confirmed) ||
      b.score - a.score ||
      Number(b.result.etat_administratif === 'A') - Number(a.result.etat_administratif === 'A') ||
      (b.result.date_creation ?? '').localeCompare(a.result.date_creation ?? '')
  )
  return { kept, excluded }
}

function companyEntity(c: MandateCandidate, lang: 'fr' | 'en'): OutEntity {
  const r = c.result
  const lat = Number(r.siege?.latitude)
  const lon = Number(r.siege?.longitude)
  const roles = c.matches.map(roleLabel).join(' ; ')
  return {
    type: 'company',
    label: r.nom_complet,
    data: compact({
      siren: r.siren,
      siret: r.siege?.siret,
      legal_form: r.nature_juridique ? (LEGAL_FORMS[r.nature_juridique] ?? `code ${r.nature_juridique}`) : undefined,
      activity: r.activite_principale ?? undefined,
      created_at: r.date_creation ?? undefined,
      closed_at: r.date_fermeture ?? undefined,
      status: r.etat_administratif === 'C' ? 'cessée' : r.etat_administratif === 'A' ? 'active' : undefined,
      address: r.siege?.adresse,
      employees: r.tranche_effectif_salarie ? HEADCOUNT[r.tranche_effectif_salarie] : undefined,
      lat: Number.isFinite(lat) && r.siege?.latitude ? lat : undefined,
      lon: Number.isFinite(lon) && r.siege?.longitude ? lon : undefined,
      url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`
    }),
    linkLabel: roles,
    // Seule une date de naissance concordante permet d'écarter l'homonymie : sinon, à vérifier.
    ...(c.confirmed
      ? {}
      : {
          review: true,
          reviewReason:
            lang === 'fr'
              ? 'homonyme possible : même nom et prénom ; comparez le mois de naissance déclaré ou ajoutez la date de naissance à la fiche'
              : 'possible namesake: same name; compare the declared birth month or add the birth date to the record'
        })
  }
}

/** Entreprises liées à la personne (10 au plus, les plus pertinentes d'abord). */
export function companiesFor(results: ReResult[], name: PersonName, id: KnownIdentity = {}, lang: 'fr' | 'en' = 'fr', now = new Date()): OutEntity[] {
  return selectMandates(results, name, id, now)
    .kept.slice(0, MAX_COMPANIES)
    .map((c) => companyEntity(c, lang))
}

async function page(ctx: ModuleContext, name: PersonName, n: number): Promise<ReResponse> {
  const query = {
    nom_personne: name.lastName,
    prenoms_personne: name.firstNames[0],
    type_personne: 'dirigeant',
    per_page: PER_PAGE,
    page: n
  }
  let last: unknown
  // Le service coupe parfois la connexion : deux nouvelles tentatives espacées.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await ctx.fetchJson<ReResponse>(API, { query, timeoutMs: 25000 })
    } catch (e) {
      last = e
      const status = httpStatus(e)
      if (status === 429) throw new ModuleError('recherche-entreprises : trop de requêtes', 'rate_limited')
      if (status && status < 500) throw e
      if (ctx.signal.aborted) break
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
  throw new ModuleError(`recherche-entreprises injoignable : ${last instanceof Error ? last.message : String(last)}`, 'unavailable')
}

export default defineModule({
  id: 'person.fr_dirigeants',
  name: { fr: 'Mandats de dirigeant (France)', en: 'Company officer roles (France)' },
  description: {
    fr: 'Cherche la personne parmi les dirigeants d’entreprises françaises (API Recherche d’entreprises de l’État, sans clé) : 10 entreprises au plus, avec la fonction et le mois de naissance déclaré. Les mandats incompatibles avec la date de naissance ou de décès connue sont écartés ; sans date de naissance concordante, l’entreprise est mise de côté dans « À vérifier » (homonyme possible).',
    en: 'Looks the person up among French company officers (government Company Search API, no key): up to 10 companies, with the role and declared birth month. Roles inconsistent with the known birth or death date are dropped; without a matching birth date, the company is put aside in "To review" (possible namesake).'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://recherche-entreprises.api.gouv.fr/docs/',
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const first = await page(ctx, name, 1)
    const results = [...first.results]
    for (let n = 2; n <= Math.min(first.total_pages, MAX_PAGES); n++) results.push(...(await page(ctx, name, n)).results)
    const id: KnownIdentity = { birth: parsePartialDate(input.data.birth_date), death: parsePartialDate(input.data.death_date) }
    const { kept, excluded } = selectMandates(results, name, id)
    const entities = kept.slice(0, MAX_COMPANIES).map((c) => companyEntity(c, ctx.lang))
    return {
      entities,
      properties: compact({
        officer_companies_count: kept.length || undefined,
        officer_companies_excluded: excluded.length || undefined
      }),
      raw: {
        query: { nom: name.lastName, prenom: name.firstNames[0] },
        identity: id,
        total_results: first.total_results,
        fetched: results.length,
        kept: kept.map((c) => ({
          siren: c.result.siren,
          name: c.result.nom_complet,
          confirmed: c.confirmed,
          roles: c.matches.map((d) => ({ prenoms: d.prenoms, qualite: d.qualite, naissance: d.date_de_naissance ?? d.annee_de_naissance }))
        })),
        excluded: excluded.map((c) => ({
          siren: c.result.siren,
          name: c.result.nom_complet,
          roles: c.matches.map((d) => ({ prenoms: d.prenoms, qualite: d.qualite, naissance: d.date_de_naissance ?? d.annee_de_naissance }))
        }))
      }
    }
  }
})
