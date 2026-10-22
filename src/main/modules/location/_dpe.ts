// Diagnostics de performance énergétique (DPE) des logements existants, publiés par l'ADEME
// (jeu `dpe03existant`). Recherche par identifiant BAN de l'adresse. Le complément d'adresse
// saisi par le diagnostiqueur contient parfois un nom d'occupant : il n'est jamais repris.

import type { ModuleContext } from '@shared/modules'
import { getJson, num } from '../misc/_util'

export const DPE_API = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines'
export const MAX_DPE = 10

/** Seuls ces champs sont demandés : rien qui puisse désigner un occupant. */
export const DPE_FIELDS = [
  'numero_dpe',
  'date_etablissement_dpe',
  'date_fin_validite_dpe',
  'etiquette_dpe',
  'etiquette_ges',
  'type_batiment',
  'surface_habitable_logement',
  'periode_construction',
  'annee_construction',
  'adresse_ban',
  'identifiant_ban'
]

export interface DpeLine {
  numero_dpe?: string
  date_etablissement_dpe?: string
  date_fin_validite_dpe?: string
  etiquette_dpe?: string
  etiquette_ges?: string
  type_batiment?: string
  surface_habitable_logement?: number | string
  periode_construction?: string
  annee_construction?: number | string
  adresse_ban?: string
  identifiant_ban?: string
}

export interface DpeResponse {
  total?: number
  results?: DpeLine[]
}

export interface Dpe {
  number: string
  date: string | null
  validUntil: string | null
  energyClass: string | null
  ghgClass: string | null
  buildingType: string | null
  area: number | null
  period: string | null
  address: string | null
}

export function parseDpe(r: DpeResponse | null, banId: string): { total: number; dpe: Dpe[] } {
  const dpe = (r?.results ?? [])
    // Le filtre porte déjà sur l'identifiant BAN ; on le revérifie, au cas où.
    .filter((l) => l.numero_dpe && (!l.identifiant_ban || l.identifiant_ban === banId))
    .map((l) => ({
      number: l.numero_dpe!,
      date: l.date_etablissement_dpe ?? null,
      validUntil: l.date_fin_validite_dpe ?? null,
      energyClass: l.etiquette_dpe ?? null,
      ghgClass: l.etiquette_ges ?? null,
      buildingType: l.type_batiment ?? null,
      area: num(l.surface_habitable_logement),
      period: l.periode_construction ?? (l.annee_construction ? String(l.annee_construction) : null),
      address: l.adresse_ban ?? null
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return { total: r?.total ?? dpe.length, dpe }
}

/** Fiche publique d'un DPE sur l'observatoire de l'ADEME. */
export const dpeUrl = (n: string): string => `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${encodeURIComponent(n)}`

/** Résumé d'un DPE pour la liste de la fiche : « 2511E0687948D : C / GES A (2025-02-28, appartement, 46 m²) ». */
export function dpeSummary(d: Dpe, lang: 'fr' | 'en'): string {
  const ges = d.ghgClass ? (lang === 'fr' ? ` / GES ${d.ghgClass}` : ` / GHG ${d.ghgClass}`) : ''
  const detail = [d.date, d.buildingType, d.area ? `${d.area} m²` : null].filter(Boolean).join(', ')
  return `${d.number} : ${d.energyClass ?? '?'}${ges}${detail ? ` (${detail})` : ''}`
}

export async function dpeAt(ctx: ModuleContext, banId: string): Promise<{ total: number; dpe: Dpe[] }> {
  const r = await getJson<DpeResponse>(ctx, DPE_API, 'DPE (ADEME)', {
    query: { identifiant_ban_eq: banId, size: MAX_DPE, sort: '-date_etablissement_dpe', select: DPE_FIELDS.join(',') },
    timeoutMs: 30000
  })
  return parseDpe(r, banId)
}
