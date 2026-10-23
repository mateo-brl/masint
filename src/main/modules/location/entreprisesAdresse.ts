// Entreprises domiciliées à une adresse française : établissements SIRENE géolocalisés dans un
// rayon de 30 m (API Recherche d'entreprises, `near_point`). Un grand nombre d'entreprises au
// même point signale un centre de domiciliation : l'adresse ne dit alors rien de l'activité.
// Les entrepreneurs individuels sont des personnes physiques : comptés, jamais nommés, pour ne
// pas transformer une adresse d'habitation en liste de ses occupants.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { nafLabel } from '../company/_fr'
import { compact, getJson, tr } from '../misc/_util'
import { distanceM, type GeoPoint } from './_geo'
import { acceptsFrench, locateFrench, notFrench, pointFrom, sameAddress, type FrenchPlace } from './_france'

const API = 'https://recherche-entreprises.api.gouv.fr/near_point'
/** Rayon de recherche : la parcelle de l'adresse et le trottoir d'en face, pas la rue entière. */
export const RADIUS_M = 30
/** Au-delà de ce nombre d'entreprises dans le rayon, l'adresse est probablement une domiciliation. */
export const DOMICILIATION_THRESHOLD = 50
export const MAX_COMPANIES = 15
/** Établissement géocodé au même point que l'adresse (la BAN sert aux deux) : même adresse. */
const SAME_POINT_M = 8

export interface NearEtablissement {
  siret: string
  adresse?: string | null
  code_postal?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  etat_administratif?: string | null
  est_siege?: boolean
  activite_principale?: string | null
  date_creation?: string | null
  date_fermeture?: string | null
  liste_enseignes?: string[] | null
  nom_commercial?: string | null
}

export interface NearResult {
  siren: string
  nom_complet: string
  nature_juridique?: string | null
  activite_principale?: string | null
  etat_administratif?: string | null
  date_creation?: string | null
  date_fermeture?: string | null
  matching_etablissements?: NearEtablissement[]
}

export interface NearResponse {
  results?: NearResult[]
  total_results?: number
}

export interface NearCompany {
  r: NearResult
  e: NearEtablissement
  distance: number | null
  same: boolean
  open: boolean
}

/** Entrepreneur individuel (catégorie juridique 1000) : une personne physique. */
export const isIndividual = (r: NearResult): boolean => (r.nature_juridique ?? '').startsWith('1')

/** Établissement de chaque entreprise le plus proche du point, la même adresse d'abord. */
export function rankCompanies(res: NearResult[], place: GeoPoint & Partial<Pick<FrenchPlace, 'housenumber' | 'street' | 'postcode'>>): NearCompany[] {
  const out: NearCompany[] = []
  for (const r of res) {
    // Entrepreneur ayant demandé la non-diffusion : ni nom ni adresse publiés.
    if (/non[- ]diffusible/i.test(r.nom_complet)) continue
    if (isIndividual(r)) continue
    let best: NearCompany | null = null
    for (const e of r.matching_etablissements ?? []) {
      const p = pointFrom(e.latitude, e.longitude)
      const distance = p ? distanceM(place, p) : null
      const same = (distance !== null && distance <= SAME_POINT_M) || (!!e.adresse && sameAddress({ housenumber: place.housenumber ?? null, street: place.street ?? null, postcode: place.postcode ?? null }, e.adresse, e.code_postal))
      const c: NearCompany = { r, e, distance, same, open: e.etat_administratif !== 'F' }
      if (!best || score(c) < score(best)) best = c
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => score(a) - score(b))
}

/** Plus petit = plus pertinent : même adresse, ouvert, puis proche. */
function score(c: NearCompany): number {
  return (c.same ? 0 : 10_000) + (c.open ? 0 : 1_000) + (c.distance ?? 999)
}

/** Une entreprise dont le nom évoque la domiciliation, à la même adresse. */
export function domiciliationProvider(list: NearCompany[]): NearCompany | null {
  return list.find((c) => c.same && c.open && /domicili/i.test(`${c.r.nom_complet} ${(c.e.liste_enseignes ?? []).join(' ')} ${c.e.nom_commercial ?? ''}`)) ?? null
}

export function companiesOutput(ctx: Pick<ModuleContext, 'lang'>, place: GeoPoint & Partial<FrenchPlace>, res: NearResponse): ModuleOutput {
  const total = res.total_results ?? res.results?.length ?? 0
  const ranked = rankCompanies(res.results ?? [], place)
  const provider = domiciliationProvider(ranked)
  const entities: OutEntity[] = ranked.slice(0, MAX_COMPANIES).map((c) => {
    const naf = c.e.activite_principale ?? c.r.activite_principale ?? null
    const where = c.same ? tr(ctx, 'établissement à cette adresse (SIRENE)', 'establishment at this address (SIRENE)') : tr(ctx, `établissement à ${c.distance ?? '?'} m de l'adresse`, `establishment ${c.distance ?? '?'} m from the address`)
    return {
      type: 'company',
      label: c.r.nom_complet,
      data: compact({
        siren: c.r.siren,
        siret: c.e.siret,
        address: c.e.adresse ?? null,
        activity: naf ? [naf, nafLabel(naf)].filter(Boolean).join(' ') : null,
        created_at: c.r.date_creation ?? null,
        closed_at: c.r.date_fermeture ?? c.e.date_fermeture ?? null,
        distance_m: c.same ? null : c.distance
      }),
      linkLabel: c.same ? tr(ctx, 'entreprise domiciliée', 'registered company') : tr(ctx, 'entreprise à proximité', 'nearby company'),
      review: true,
      reviewReason: c.open ? where : `${where}, ${tr(ctx, 'fermé', 'closed')}`
    }
  })
  const individuals = (res.results ?? []).filter(isIndividual).length
  return {
    properties: compact({
      domiciled_companies: total,
      // Sur la page lue (25 entreprises au plus) : un ordre de grandeur, pas un total.
      individual_entrepreneurs_seen: individuals || null,
      domiciliation_center: total >= DOMICILIATION_THRESHOLD ? true : null,
      domiciliation_provider: provider ? `${provider.r.nom_complet} (${provider.r.siren})` : null
    }),
    entities,
    raw: { total, radius_m: RADIUS_M, companies: ranked.slice(0, 25).map((c) => ({ siren: c.r.siren, siret: c.e.siret, nom: c.r.nom_complet, adresse: c.e.adresse, distance_m: c.distance, meme_adresse: c.same })) }
  }
}

async function nearPoint(ctx: ModuleContext, p: GeoPoint): Promise<NearResponse | null> {
  const call = (): Promise<NearResponse | null> =>
    getJson<NearResponse>(ctx, API, 'Recherche d’entreprises', {
      query: {
        lat: p.lat,
        long: p.lon,
        radius: RADIUS_M / 1000,
        per_page: 25,
        page: 1,
        minimal: 'true',
        include: 'matching_etablissements',
        limite_matching_etablissements: 5
      },
      timeoutMs: 30000
    })
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
  id: 'location.entreprises_adresse',
  name: { fr: 'Entreprises à une adresse (SIRENE)', en: 'Companies at an address (SIRENE)' },
  description: {
    fr: "Nombre d'entreprises dont un établissement est à moins de 30 m de l'adresse (API Recherche d'entreprises), signal de centre de domiciliation au-delà de 50, et jusqu'à 15 sociétés à vérifier, celles de la même adresse d'abord. Les entrepreneurs individuels sont comptés, jamais nommés.",
    en: 'Number of companies with an establishment within 30 m of the address (French company search API), a registered-office provider signal above 50, and up to 15 companies to review, those at the same address first. Sole traders are counted, never named.'
  },
  category: 'location',
  inputTypes: ['address', 'coordinates'],
  accepts: acceptsFrench,
  homepage: 'https://annuaire-entreprises.data.gouv.fr',
  async run(input, ctx) {
    const place = await locateFrench(input, ctx)
    if (!place) {
      if (notFrench(input)) return {}
      throw new ModuleError(tr(ctx, 'Adresse française non reconnue par la Base Adresse Nationale', 'French address not recognised by the National Address Base'), 'invalid_input')
    }
    const res = await nearPoint(ctx, place)
    if (!res) return {}
    return companiesOutput(ctx, place, res)
  }
})
