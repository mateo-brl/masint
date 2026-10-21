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

export function companiesFor(results: ReResult[], name: PersonName): OutEntity[] {
  const out: OutEntity[] = []
  for (const r of results) {
    const matches = (r.dirigeants ?? []).filter((d) => matchesPerson(d, name))
    if (!matches.length) continue
    const lat = Number(r.siege?.latitude)
    const lon = Number(r.siege?.longitude)
    out.push({
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
      linkLabel: matches.map(roleLabel).join(' ; ')
    })
  }
  return out
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
    fr: 'Cherche la personne parmi les dirigeants d’entreprises françaises (API Recherche d’entreprises de l’État, sans clé) : entreprises liées avec la fonction et le mois de naissance déclaré pour départager les homonymes.',
    en: 'Looks the person up among French company officers (government Company Search API, no key): linked companies with the role and declared birth month to tell namesakes apart.'
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
    const entities = companiesFor(results, name)
    return {
      entities,
      raw: {
        query: { nom: name.lastName, prenom: name.firstNames[0] },
        total_results: first.total_results,
        fetched: results.length,
        matched: entities.length,
        birth_dates: [...new Set(results.flatMap((r) => (r.dirigeants ?? []).filter((d) => matchesPerson(d, name)).map((d) => d.date_de_naissance ?? d.annee_de_naissance ?? '?')))]
      }
    }
  }
})
