// Sitadel : autorisations d'urbanisme (permis de construire, d'aménager, de démolir,
// déclarations préalables) publiées par le SDES sur l'API DiDo. Seuls les demandeurs
// personnes morales sont nommés : un particulier n'apparaît jamais dans ces fichiers.

import type { ModuleContext, OutEntity } from '@shared/modules'
import { compact, getJson, num } from '../misc/_util'

export const DIDO = 'https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1/datafiles'
export const SITADEL_PAGE = 'https://www.statistiques.developpement-durable.gouv.fr/catalogue?page=dataset&datasetId=6513f0189d7d312c80ec5b5b'

export type SitadelKind = 'housing' | 'premises' | 'development' | 'demolition'

/** Les quatre fichiers du jeu « Liste des permis de construire et autres autorisations d'urbanisme ». */
export const SITADEL_FILES: Record<SitadelKind, { rid: string; number: string; state: string }> = {
  housing: { rid: '8b35affb-55fc-4c1f-915b-7750f974446a', number: 'NUM_DAU', state: 'ETAT_DAU' },
  premises: { rid: 'f8f0700f-806c-40a7-83b1-f21cf507e7c4', number: 'NUM_DAU', state: 'ETAT_DAU' },
  development: { rid: '96883f50-538b-41f9-a059-c6eb97e6a23a', number: 'NUM_PA', state: 'ETAT_PA' },
  demolition: { rid: '1a9a2f0c-56fe-4e69-84a7-fbbda2121f02', number: 'NUM_PD', state: 'ETAT_PD' }
}

export type SitadelRow = Record<string, string | number | boolean | null>

export interface SitadelPage {
  total?: number
  data?: SitadelRow[]
}

export interface Permit {
  kind: SitadelKind
  number: string
  type: string
  date: string | null
  state: number | null
  place: string | null
  commune: string | null
  parcels: string[]
  applicant: string | null
  applicantSiren: string | null
  dwellings: number | null
  floorArea: number | null
  workStart: string | null
  completion: string | null
  department: string | null
}

/**
 * Répare le double encodage de certains libellés (« SAAÃ\u0082Â\u0094NE » pour « SAÔNE »,
 * « 13 Ã\u0080 28 » pour « 13 À 28 ») : l'octet de tête UTF-8 a été relu en Latin-1.
 */
export function fixMojibake(s: string): string {
  return s
    .replace(/AÃ\u0082Â([\u0080-¿])/g, (_m, c: string) => String.fromCharCode(c.charCodeAt(0) + 0x40))
    .replace(/Ã([\u0080-¿])/g, (_m, c: string) => String.fromCharCode(c.charCodeAt(0) + 0x40))
    .replace(/Â([ -¿])/g, '$1')
    .replace(/[\u0080-\u009f]/g, '')
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = fixMojibake(String(v)).replace(/\s+/g, ' ').trim()
  return s || null
}

/**
 * Filtres DiDo d'une parcelle. Sitadel reprend la section telle que le demandeur l'a saisie :
 * `G` ou `0G` pour la section `0G` du cadastre, d'où le filtre `in`. Seule la première des trois
 * parcelles d'une autorisation est filtrable de cette façon.
 */
export function parcelFilters(commune: string, section: string, number: string): Record<string, string> {
  const s = section.toUpperCase()
  const short = s.replace(/^0+(?=[A-Z])/, '')
  return {
    COMM: `eq:${commune}`,
    SEC_CADASTRE1: short !== s || short.length === 1 ? `in:${short},0${short}` : `eq:${s}`,
    NUM_CADASTRE1: `eq:${Number(number)}`
  }
}

/**
 * À Paris, Lyon et Marseille, Sitadel enregistre la commune entière (75056) : l'arrondissement
 * se lit dans le numéro d'autorisation (`075104...`).
 */
export const inDistrict = (p: Permit, insee: string): boolean => !/^\d{3}\d{3}/.test(p.number) || p.number.slice(1, 6) === insee

export function parsePermit(kind: SitadelKind, r: SitadelRow): Permit | null {
  const f = SITADEL_FILES[kind]
  const number = str(r[f.number])
  if (!number) return null
  const parcels = [1, 2, 3]
    .map((i) => {
      const sec = str(r[`SEC_CADASTRE${i}`])
      const n = str(r[`NUM_CADASTRE${i}`])
      return sec && n ? `${sec} ${n}` : null
    })
    .filter((p): p is string => !!p)
  const street = [str(r.ADR_NUM_TER), str(r.ADR_LIBVOIE_TER) ?? str(r.ADR_LIEUDIT_TER)].filter(Boolean).join(' ')
  const town = [str(r.ADR_CODPOST_TER), str(r.ADR_LOCALITE_TER)].filter(Boolean).join(' ')
  const place = [street, town].filter(Boolean).join(', ') || null
  return {
    kind,
    number,
    type: str(r.TYPE_DAU) ?? (kind === 'development' ? 'PA' : kind === 'demolition' ? 'PD' : 'PC'),
    date: str(r.DATE_REELLE_AUTORISATION),
    state: num(r[f.state]),
    place,
    commune: str(r.COMM),
    parcels,
    applicant: str(r.DENOM_DEM),
    applicantSiren: str(r.SIREN_DEM),
    dwellings: num(r.NB_LGT_TOT_CREES),
    floorArea: num(r.SURF_LOC_CREEE) || num(r.SURF_HAB_CREEE),
    workStart: str(r.DATE_REELLE_DOC),
    completion: str(r.DATE_REELLE_DAACT),
    department: str(r.DEP_LIBELLE)
  }
}

const TYPES: Record<string, [string, string]> = {
  PC: ['Permis de construire', 'Building permit'],
  DP: ['Déclaration préalable', 'Prior declaration'],
  PA: ["Permis d'aménager", 'Development permit'],
  PD: ['Permis de démolir', 'Demolition permit']
}

// États Sitadel : 2 autorisé, 4 annulé, 5 chantier ouvert, 6 travaux achevés.
const STATES: Record<number, [string, string]> = {
  2: ['autorisé', 'authorised'],
  4: ['annulé', 'cancelled'],
  5: ['chantier ouvert', 'works started'],
  6: ['travaux achevés', 'works completed']
}

const KIND_LABEL: Record<SitadelKind, [string, string]> = {
  housing: ['logements', 'housing'],
  premises: ['locaux non résidentiels', 'non-residential premises'],
  development: ['aménagement', 'land development'],
  demolition: ['démolition', 'demolition']
}

export function permitTypeLabel(p: Permit, lang: 'fr' | 'en'): string {
  const i = lang === 'fr' ? 0 : 1
  return `${(TYPES[p.type] ?? [p.type, p.type])[i]} (${KIND_LABEL[p.kind][i]})`
}

const frDate = (d: string): string => d.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1')

/** Événement daté d'une autorisation d'urbanisme, sans personne physique. */
export function permitEntity(p: Permit, lang: 'fr' | 'en', extra: Partial<OutEntity> = {}): OutEntity {
  const fr = lang === 'fr'
  const type = permitTypeLabel(p, lang)
  const when = p.date ? (fr ? ` du ${frDate(p.date)}` : ` of ${p.date}`) : ''
  return {
    type: 'event',
    label: `${(TYPES[p.type] ?? [p.type, p.type])[fr ? 0 : 1]} ${p.number}${when}`,
    data: compact({
      date: p.date,
      permit_number: p.number,
      permit_type: type,
      permit_status: p.state !== null && STATES[p.state] ? STATES[p.state][fr ? 0 : 1] : null,
      place: p.place,
      parcels: p.parcels,
      applicant: p.applicant,
      applicant_siren: p.applicantSiren,
      dwellings_created: p.dwellings || null,
      floor_area_created_m2: p.floorArea || null,
      work_start_date: p.workStart,
      completion_date: p.completion,
      source: 'Sitadel (SDES)'
    }),
    linkLabel: fr ? 'autorisation d’urbanisme' : 'planning permission',
    ...extra
  }
}

/** Une page d'un fichier Sitadel, les autorisations les plus récentes d'abord. */
export async function sitadelRows(ctx: ModuleContext, kind: SitadelKind, filters: Record<string, string>, pageSize = 10): Promise<{ total: number; permits: Permit[] }> {
  const page = await getJson<SitadelPage>(ctx, `${DIDO}/${SITADEL_FILES[kind].rid}/rows`, 'Sitadel (DiDo)', {
    query: { pageSize, page: 1, orderBy: '-DATE_REELLE_AUTORISATION', ...filters },
    timeoutMs: 30000
  })
  const permits = (page?.data ?? []).map((r) => parsePermit(kind, r)).filter((p): p is Permit => !!p)
  return { total: page?.total ?? permits.length, permits }
}

/** Les quatre fichiers interrogés en parallèle ; un fichier en échec n'empêche pas les autres. */
export async function sitadelSearch(ctx: ModuleContext, filters: Record<string, string>, pageSize = 10): Promise<{ total: number; permits: Permit[]; errors: string[] }> {
  const kinds = Object.keys(SITADEL_FILES) as SitadelKind[]
  const settled = await Promise.allSettled(kinds.map((k) => sitadelRows(ctx, k, filters, pageSize)))
  let total = 0
  const permits: Permit[] = []
  const errors: string[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      total += s.value.total
      permits.push(...s.value.permits)
    } else errors.push(s.reason instanceof Error ? s.reason.message : String(s.reason))
  }
  // Une autorisation peut figurer dans deux fichiers (logements et locaux) : une seule fois.
  const seen = new Set<string>()
  const unique = permits.filter((p) => !seen.has(p.number) && !!seen.add(p.number))
  unique.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  if (errors.length === kinds.length) throw settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')!.reason
  return { total, permits: unique, errors }
}
