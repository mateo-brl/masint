// Entreprises françaises via l'API Recherche d'entreprises (data.gouv.fr, gratuite, sans clé) :
// identité, siège géolocalisé, dirigeants, activité, effectif, chiffre d'affaires.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, getJson, num, tr } from '../misc/_util'
import { frenchVat, headcountLabel, legalFormLabel, nafLabel, normName, titleCase } from './_fr'
import { complementProperties, establishmentEntities, type ReComplements, type ReEtablissement } from './_complements'

const API = 'https://recherche-entreprises.api.gouv.fr/search'
const MAX_DIRIGEANTS = 25
const MAX_CANDIDATES = 5

export interface ReDirigeant {
  type_dirigeant: string
  nom?: string
  prenoms?: string
  date_de_naissance?: string
  nationalite?: string | null
  qualite?: string | null
  siren?: string
  denomination?: string
}

export interface ReSiege {
  siret: string
  adresse?: string
  numero_voie?: string | null
  indice_repetition?: string | null
  type_voie?: string | null
  libelle_voie?: string | null
  complement_adresse?: string | null
  code_postal?: string | null
  libelle_commune?: string | null
  libelle_pays_etranger?: string | null
  latitude?: string | null
  longitude?: string | null
  date_creation?: string | null
}

export interface ReResult {
  siren: string
  nom_complet: string
  nom_raison_sociale?: string | null
  sigle?: string | null
  nature_juridique?: string | null
  activite_principale?: string | null
  categorie_entreprise?: string | null
  date_creation?: string | null
  date_fermeture?: string | null
  etat_administratif?: string
  tranche_effectif_salarie?: string | null
  annee_tranche_effectif_salarie?: string | null
  nombre_etablissements?: number
  nombre_etablissements_ouverts?: number
  siege?: ReSiege
  dirigeants?: ReDirigeant[]
  finances?: Record<string, { ca?: number | null; resultat_net?: number | null }> | null
  complements?: ReComplements | null
  /** Établissements qui correspondent à la recherche (10 au plus), siège compris. */
  matching_etablissements?: ReEtablissement[] | null
}

export interface ReResponse {
  results: ReResult[]
  total_results: number
}

/** Requête à envoyer : SIREN, SIRET ou raison sociale. */
export function searchQuery(label: string, data: Record<string, unknown>): { q: string; siren: string | null } {
  const fromData = typeof data.siren === 'string' ? data.siren.replace(/\D/g, '') : ''
  if (/^\d{9}$/.test(fromData)) return { q: fromData, siren: fromData }
  const digits = label.replace(/[\s.]/g, '')
  if (/^\d{14}$/.test(digits)) return { q: digits.slice(0, 9), siren: digits.slice(0, 9) }
  if (/^\d{9}$/.test(digits)) return { q: digits, siren: digits }
  return { q: label.trim(), siren: null }
}

/** Résultat correspondant à la saisie, ou `null` si la recherche n'est pas concluante. */
export function pickResult(results: ReResult[], label: string, siren: string | null): ReResult | null {
  if (siren) return results.find((r) => r.siren === siren) ?? null
  const q = normName(label)
  if (!q) return null
  return results.find((r) => [r.nom_complet, r.nom_raison_sociale, r.sigle].some((n) => n && normName(n) === q)) ?? null
}

function streetOf(s: ReSiege): string | null {
  const parts = [s.numero_voie, s.indice_repetition, s.type_voie, s.libelle_voie].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

export function companyOutput(ctx: Pick<ModuleContext, 'lang'>, r: ReResult): ModuleOutput {
  const s = r.siege
  const years = Object.keys(r.finances ?? {}).sort()
  const lastYear = years[years.length - 1]
  const fin = lastYear ? r.finances![lastYear] : null
  const activity = r.activite_principale
    ? [r.activite_principale, nafLabel(r.activite_principale)].filter(Boolean).join(' ')
    : null
  const closed = r.etat_administratif === 'C'

  const properties: ModuleOutput['properties'] = {
    name: r.nom_complet,
    siren: r.siren,
    siret: s?.siret ?? null,
    vat: frenchVat(r.siren),
    legal_form: legalFormLabel(r.nature_juridique),
    activity,
    created_at: r.date_creation ?? null,
    closed_at: r.date_fermeture ?? null,
    status: closed ? tr(ctx, 'cessée', 'closed') : tr(ctx, 'active', 'active'),
    address: s?.adresse ?? null,
    employees: headcountLabel(r.tranche_effectif_salarie, r.annee_tranche_effectif_salarie),
    size_category: r.categorie_entreprise ?? null,
    establishments: r.nombre_etablissements ?? null,
    open_establishments: r.nombre_etablissements_ouverts ?? null,
    revenue: fin?.ca != null ? `${fin.ca.toLocaleString('fr-FR')} € (${lastYear})` : null,
    net_income: fin?.resultat_net != null ? `${fin.resultat_net.toLocaleString('fr-FR')} € (${lastYear})` : null,
    rna: r.complements?.identifiant_association ?? null,
    url: `https://annuaire-entreprises.data.gouv.fr/entreprise/${r.siren}`,
    // Labels, indicateurs, conventions collectives et élus d'une collectivité.
    ...complementProperties(ctx, r.complements)
  }

  const entities: OutEntity[] = []
  if (s?.adresse) {
    const lat = num(s.latitude)
    const lon = num(s.longitude)
    entities.push({
      type: 'address',
      label: s.adresse,
      data: {
        street: streetOf(s),
        postcode: s.code_postal ?? null,
        city: s.libelle_commune ?? null,
        country: s.libelle_pays_etranger ?? 'France',
        lat,
        lon
      },
      linkLabel: tr(ctx, 'siège', 'head office')
    })
  }
  entities.push({ type: 'vat', label: frenchVat(r.siren), linkLabel: tr(ctx, 'TVA intracommunautaire', 'EU VAT number') })
  entities.push(...establishmentEntities(ctx, r.matching_etablissements, s?.siret))

  for (const d of (r.dirigeants ?? []).slice(0, MAX_DIRIGEANTS)) {
    const role = d.qualite ? d.qualite : tr(ctx, 'dirigeant', 'officer')
    if (d.type_dirigeant === 'personne morale') {
      if (!d.denomination) continue
      entities.push({
        type: 'company',
        label: d.denomination,
        data: { siren: d.siren ?? null },
        linkLabel: role
      })
      continue
    }
    if (!d.nom) continue
    const first = d.prenoms ? titleCase(d.prenoms.split(/\s+/)[0]) : ''
    const last = titleCase(d.nom)
    entities.push({
      type: 'person',
      label: [first, last].filter(Boolean).join(' '),
      data: {
        first_name: d.prenoms ? titleCase(d.prenoms) : null,
        last_name: last,
        birth_date: d.date_de_naissance ?? null,
        nationality: d.nationalite ?? null,
        occupation: d.qualite ?? null
      },
      linkLabel: role
    })
  }

  const { dirigeants, ...rest } = r
  return { properties: compact(properties!), entities, raw: { ...rest, dirigeants: (dirigeants ?? []).slice(0, MAX_DIRIGEANTS) } }
}

/** Saisie ambiguë : les meilleurs candidats sont ajoutés comme entreprises distinctes. */
export function candidatesOutput(ctx: Pick<ModuleContext, 'lang'>, results: ReResult[]): ModuleOutput {
  const entities: OutEntity[] = results.slice(0, MAX_CANDIDATES).map((r) => ({
    type: 'company',
    label: r.nom_complet,
    data: {
      siren: r.siren,
      address: r.siege?.adresse ?? null,
      activity: r.activite_principale ? `${r.activite_principale} ${nafLabel(r.activite_principale) ?? ''}`.trim() : null,
      created_at: r.date_creation ?? null,
      closed_at: r.date_fermeture ?? null
    },
    linkLabel: tr(ctx, 'correspondance possible', 'possible match'),
    // Saisie ambiguë : l'enquêteur choisit la bonne entreprise dans « À vérifier ».
    review: true,
    reviewReason: tr(ctx, 'saisie ambiguë : plusieurs entreprises correspondent à ce nom', 'ambiguous input: several companies match this name')
  }))
  return { entities, raw: results.slice(0, MAX_CANDIDATES).map((r) => ({ siren: r.siren, nom: r.nom_complet })) }
}

async function search(ctx: ModuleContext, q: string): Promise<ReResponse | null> {
  const call = (): Promise<ReResponse | null> =>
    getJson<ReResponse>(ctx, API, 'Recherche d’entreprises', { query: { q, per_page: 10, page: 1 }, timeoutMs: 30000 })
  try {
    return await call()
  } catch (e) {
    // Service parfois instable : une seconde tentative après une courte pause.
    if (!(e instanceof ModuleError) || e.code !== 'unavailable') throw e
    await new Promise((r) => setTimeout(r, 1500))
    return call()
  }
}

export default defineModule({
  id: 'company.fr_registry',
  name: { fr: 'Entreprise française (annuaire officiel)', en: 'French company (official registry)' },
  description: {
    fr: "SIREN, SIRET du siège, adresse géolocalisée, forme juridique, activité NAF, dates de création et de cessation, effectif, chiffre d'affaires et dirigeants, via l'API Recherche d'entreprises de l'État. Si le nom est ambigu, propose les entreprises candidates.",
    en: 'SIREN, head office SIRET, geolocated address, legal form, NAF activity, creation and closure dates, headcount, revenue and officers, from the French government company search API. Ambiguous names return candidate companies.'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: 'https://annuaire-entreprises.data.gouv.fr',
  async run(input, ctx) {
    const { q, siren } = searchQuery(input.label, input.data)
    if (q.length < 3) return {}
    const res = await search(ctx, q)
    const results = res?.results ?? []
    if (!results.length) return {}
    const hit = pickResult(results, input.label, siren)
    if (hit) return companyOutput(ctx, await withEstablishments(ctx, hit))
    return siren ? {} : candidatesOutput(ctx, results)
  }
})

/**
 * Une recherche par SIREN ne renvoie pas d'établissement : pour une entreprise qui en a
 * plusieurs, une seconde recherche par raison sociale les fournit (10 au plus).
 */
export async function withEstablishments(ctx: ModuleContext, hit: ReResult): Promise<ReResult> {
  if (hit.matching_etablissements?.some((e) => !e.est_siege) || (hit.nombre_etablissements ?? 0) < 2) return hit
  try {
    const res = await search(ctx, hit.nom_complet)
    const same = res?.results.find((r) => r.siren === hit.siren)
    return same?.matching_etablissements?.length ? { ...hit, matching_etablissements: same.matching_etablissements } : hit
  } catch {
    // Complément facultatif : la fiche reste valable sans les établissements.
    return hit
  }
}
