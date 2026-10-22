// Annuaire des avocats de France (Conseil national des barreaux, data.gouv.fr, Licence Ouverte) :
// barreau, cabinet (raison sociale et SIREN), adresse, spécialités, date de serment et langues.
// Usage d'enquête uniquement, pas de prospection. L'annuaire ne publie aucune date de naissance :
// un avocat trouvé par son nom est toujours un homonyme possible, mis de côté dans « À vérifier ».

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { normName, titleCase } from '../company/_fr'
import { companyName, latestResourceId, nameStartsWith, sirenOf, tabularAll, tabularPage, upperVariants } from '../company/_datagouv'
import { compact } from '../social/_lib'
import { fold, splitName, type PersonName } from './_name'

const DATASET = 'annuaire-des-avocats-de-france'
const RESOURCE = 'b9ff8dd7-0ea9-4dad-82fc-421f21a969ff'
const SERVICE = 'Annuaire des avocats (CNB)'
/** Homonymes proposés pour une personne. */
const MAX_NAMESAKES = 10
/** Avocats proposés pour un cabinet, à la demande. */
const MAX_LAWYERS = 25
/** Lignes lues pour un cabinet : au-delà, seul le total est exact. */
const MAX_ROWS = 1000

export interface AvocatRow {
  NomBarreau?: string | null
  avNom?: string | null
  avPrenom?: string | null
  cbRaisonSociale?: string | null
  cbSiretSiren?: string | null
  cbAdresse1?: string | null
  cbAdresse2?: string | null
  cbCp?: string | null
  cbVille?: string | null
  spLibelle1?: string | null
  spLibelle2?: string | null
  spLibelle3?: string | null
  acDateSerment?: string | null
  avLang?: string | null
}

const clean = (v: string | null | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined)
const frDate = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/')

export function specialties(r: AvocatRow): string[] {
  return [r.spLibelle1, r.spLibelle2, r.spLibelle3].map(clean).filter((s): s is string => !!s)
}

export function languages(r: AvocatRow): string[] {
  return (clean(r.avLang) ?? '')
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function firmAddress(r: AvocatRow): string | undefined {
  const city = [clean(r.cbCp), clean(r.cbVille)].filter(Boolean).join(' ')
  return [clean(r.cbAdresse1), clean(r.cbAdresse2), city].filter(Boolean).join(', ') || undefined
}

/** SIREN (9 chiffres) ou SIRET (14) du cabinet. */
export function firmId(r: AvocatRow): { siren?: string; siret?: string } {
  const d = (r.cbSiretSiren ?? '').replace(/\D/g, '')
  if (d.length === 14) return { siren: d.slice(0, 9), siret: d }
  if (d.length === 9) return { siren: d }
  return {}
}

/** Même nom et premier prénom présent parmi les prénoms déclarés (« Didier G. » convient à Didier). */
export function sameLawyer(r: AvocatRow, name: PersonName): boolean {
  const norm = (s: string): string => fold(s).replace(/[^a-z]/g, '')
  const first = fold(name.firstNames[0] ?? '').replace(/[^a-z-]/g, '')
  const prenoms = fold(r.avPrenom ?? '')
    .split(/[\s,]+/)
    .map((p) => p.replace(/[^a-z-]/g, ''))
  return !!first && norm(r.avNom ?? '') === norm(name.lastName) && prenoms.includes(first)
}

const bar = (r: AvocatRow): string | undefined => (clean(r.NomBarreau) ? titleCase(r.NomBarreau!.trim()) : undefined)

/** Une personne trouvée par son nom : cabinet (ou barreau) à vérifier pour chaque homonyme. */
export function namesakeEntities(rows: AvocatRow[], lang: 'fr' | 'en'): OutEntity[] {
  const fr = lang === 'fr'
  return rows.slice(0, MAX_NAMESAKES).map((r) => {
    const who = `${titleCase(clean(r.avPrenom) ?? '')} ${titleCase(clean(r.avNom) ?? '')}`.trim()
    const details = [
      bar(r) ? (fr ? `avocat au barreau de ${bar(r)}` : `lawyer at the ${bar(r)} bar`) : fr ? 'avocat' : 'lawyer',
      r.acDateSerment ? (fr ? `serment le ${frDate(r.acDateSerment)}` : `sworn in ${r.acDateSerment.slice(0, 10)}`) : undefined,
      specialties(r).length ? `${fr ? 'spécialités' : 'specialties'} : ${specialties(r).join(', ')}` : undefined
    ]
      .filter(Boolean)
      .join(', ')
    const reviewReason = fr
      ? `homonyme possible : ${who}, ${details} ; l'annuaire ne publie pas la date de naissance`
      : `possible namesake: ${who}, ${details}; the directory does not publish birth dates`
    const linkLabel = bar(r) ? (fr ? `avocat, barreau de ${bar(r)}` : `lawyer, ${bar(r)} bar`) : fr ? 'avocat' : 'lawyer'
    const firm = clean(r.cbRaisonSociale)
    if (firm) {
      return {
        type: 'company',
        label: firm,
        data: compact({ ...firmId(r), address: firmAddress(r), activity: fr ? "Cabinet d'avocats" : 'Law firm', lawyer_bar: bar(r) }),
        linkLabel,
        review: true,
        reviewReason
      }
    }
    return {
      type: 'organization',
      label: fr ? `Barreau de ${bar(r) ?? '?'}` : `${bar(r) ?? '?'} bar`,
      data: { kind: fr ? 'barreau' : 'bar association', country: 'France' },
      linkLabel,
      review: true,
      reviewReason
    }
  })
}

export interface Firm {
  key: string
  name: string
  siren?: string
  rows: AvocatRow[]
}

/** Regroupe les avocats par cabinet (SIREN, sinon raison sociale). */
export function groupFirms(rows: AvocatRow[]): Firm[] {
  const byKey = new Map<string, Firm>()
  for (const r of rows) {
    const { siren } = firmId(r)
    const name = clean(r.cbRaisonSociale) ?? '?'
    const key = siren ?? normName(name)
    const f = byKey.get(key) ?? { key, name, siren, rows: [] }
    f.rows.push(r)
    byKey.set(key, f)
  }
  return [...byKey.values()].sort((a, b) => b.rows.length - a.rows.length)
}

/** Barreaux d'un cabinet, du plus représenté au moins représenté : « Paris (105) ». */
export function barCounts(rows: AvocatRow[]): string[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const b = bar(r)
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} (${n})`)
}

/** Avocat d'un cabinet, proposé à la demande dans « À vérifier ». */
export function lawyerEntity(r: AvocatRow, firm: string, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const first = titleCase(clean(r.avPrenom) ?? '')
  const last = titleCase(clean(r.avNom) ?? '')
  return {
    type: 'person',
    label: `${first} ${last}`.trim(),
    data: compact({
      first_name: first,
      last_name: last,
      occupation: fr ? 'Avocat' : 'Lawyer',
      lawyer_bar: bar(r),
      oath_date: r.acDateSerment?.slice(0, 10),
      legal_specialties: specialties(r),
      lawyer_languages: languages(r)
    }),
    linkLabel: fr ? 'avocat du cabinet' : 'firm lawyer',
    review: true,
    reviewReason: fr
      ? `avocat rattaché à ${firm} dans l'annuaire du CNB : vérifiez qu'il s'agit de la personne qui vous intéresse avant de l'ajouter`
      : `lawyer listed under ${firm} in the CNB directory: check it is the person of interest before adding`
  }
}

async function resource(ctx: ModuleContext): Promise<string> {
  return latestResourceId(ctx, DATASET, (r) => /annuaire-avoca/i.test(r.title), RESOURCE)
}

export interface FirmLookup {
  bySiren: boolean
  total: number
  firms: Firm[]
  complete: boolean
}

/** Avocats d'un cabinet, par SIREN (exact) ou par raison sociale (qui commence par le nom). */
export async function lookupFirm(ctx: ModuleContext, label: string, data: Record<string, unknown>): Promise<FirmLookup | null> {
  const siren = sirenOf(label, data)
  const name = companyName(label, data)
  if (!siren && (!name || name.length < 3)) return null
  const id = await resource(ctx)
  const filter = siren
    ? { column: 'cbSiretSiren', op: 'contains' as const, value: siren }
    : { column: 'cbRaisonSociale', op: 'contains' as const, value: name!.toUpperCase() }
  const res = await tabularAll<AvocatRow>(ctx, id, [filter], { service: SERVICE, pageSize: 200, maxRows: MAX_ROWS, timeoutMs: 40000 })
  if (siren) {
    const rows = res.rows.filter((r) => firmId(r).siren === siren)
    return { bySiren: true, total: res.complete ? rows.length : res.total, firms: groupFirms(rows), complete: res.complete }
  }
  // Par nom : seuls les cabinets dont la raison sociale commence par le nom cherché (« Gide
  // Loyrette Nouel » pour « GIDE LOYRETTE NOUEL AARPI »), pas « Cabinet Orange » pour Orange.
  const firms = groupFirms(res.rows).filter((f) => nameStartsWith(f.name, name!))
  return { bySiren: false, total: firms.reduce((s, f) => s + f.rows.length, 0), firms, complete: res.complete }
}

/** Cabinet retenu pour une recherche par nom : raison sociale identique, ou cabinet unique. */
export function pickFirm(firms: Firm[], name: string): Firm | null {
  if (firms.length === 1) return firms[0]
  const q = normName(name)
  const same = firms.filter((f) => normName(f.name) === q)
  return same.length === 1 ? same[0] : null
}

function firmProperties(f: Firm | null, look: FirmLookup): Record<string, PropValue> {
  const rows = f ? f.rows : look.firms.flatMap((x) => x.rows)
  return compact({
    lawyers_count: f && !look.bySiren ? f.rows.length : look.total,
    lawyer_bars: barCounts(rows),
    lawyer_specialties: [...new Set(rows.flatMap(specialties))].slice(0, 15)
  })
}

const personModule = defineModule({
  id: 'person.avocats',
  name: { fr: 'Avocat (annuaire du CNB)', en: 'Lawyer (French bar directory)' },
  description: {
    fr: 'Cherche la personne dans l’annuaire des avocats de France publié par le Conseil national des barreaux (data.gouv.fr) : barreau, cabinet avec son SIREN, spécialités et date de serment. L’annuaire ne publie pas la date de naissance : chaque avocat au même nom est proposé dans « À vérifier ». Usage d’enquête, pas de prospection.',
    en: 'Looks the person up in the directory of French lawyers published by the national bar council (data.gouv.fr): bar, firm with its SIREN, specialties and swearing-in date. Birth dates are not published: each lawyer with the same name is put in "To review". For investigation, not prospecting.'
  },
  category: 'person',
  inputTypes: ['person'],
  homepage: 'https://www.data.gouv.fr/fr/datasets/annuaire-des-avocats-de-france/',
  timeoutMs: 240000,
  async run(input, ctx) {
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer au moins un prénom et un nom', 'invalid_input')
    const res = await tabularPage<AvocatRow>(
      ctx,
      await resource(ctx),
      [
        { column: 'avNom', op: 'in', value: upperVariants(name.lastName) },
        { column: 'avPrenom', op: 'contains', value: name.firstNames[0] }
      ],
      { service: SERVICE, pageSize: 50, timeoutMs: 40000 }
    )
    const rows = res.data.filter((r) => sameLawyer(r, name))
    if (!rows.length) return { raw: { total: 0 } }
    return {
      entities: namesakeEntities(rows, ctx.lang),
      properties: { lawyer_namesakes_count: rows.length },
      raw: { total: rows.length, rows: rows.slice(0, MAX_NAMESAKES) }
    }
  }
})

const firmModule = defineModule({
  id: 'company.avocats',
  name: { fr: "Cabinet d'avocats (annuaire du CNB)", en: 'Law firm (French bar directory)' },
  description: {
    fr: 'Nombre d’avocats d’un cabinet, barreaux et spécialités, d’après l’annuaire des avocats de France (CNB, data.gouv.fr). Recherche par SIREN ou SIRET (exacte) ou par le début de la raison sociale ; si plusieurs cabinets commencent par ce nom, ils sont proposés dans « À vérifier ».',
    en: 'Number of lawyers in a firm, bars and specialties, from the French lawyers directory (CNB, data.gouv.fr). Lookup by SIREN or SIRET (exact) or by the start of the firm name; several firms starting with that name are put in "To review".'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: 'https://www.data.gouv.fr/fr/datasets/annuaire-des-avocats-de-france/',
  timeoutMs: 240000,
  async run(input, ctx) {
    const look = await lookupFirm(ctx, input.label, input.data)
    if (!look || !look.firms.length) return {}
    const name = companyName(input.label, input.data) ?? input.label
    const firm = look.bySiren ? null : pickFirm(look.firms, name)
    if (look.bySiren || firm) return { properties: firmProperties(firm, look), raw: { total: look.total, firms: look.firms.map((f) => ({ name: f.name, siren: f.siren, lawyers: f.rows.length })) } }
    const fr = ctx.lang === 'fr'
    // Plusieurs cabinets au nom proche : l'enquêteur choisit le bon.
    const entities: OutEntity[] = look.firms.slice(0, MAX_NAMESAKES).map((f) => ({
      type: 'company',
      label: f.name,
      data: compact({ siren: f.siren, address: firmAddress(f.rows[0]), activity: fr ? "Cabinet d'avocats" : 'Law firm', lawyers_count: f.rows.length }),
      linkLabel: fr ? 'cabinet au nom proche' : 'firm with a similar name',
      review: true,
      reviewReason: fr
        ? `raison sociale proche dans l'annuaire des avocats : ${f.rows.length} avocat(s), ${barCounts(f.rows).join(', ')}`
        : `similar firm name in the lawyers directory: ${f.rows.length} lawyer(s), ${barCounts(f.rows).join(', ')}`
    }))
    return { entities, raw: { total: look.total, firms: look.firms.map((f) => ({ name: f.name, siren: f.siren, lawyers: f.rows.length })) } }
  }
})

const listModule = defineModule({
  id: 'company.avocats_liste',
  name: { fr: "Avocats d'un cabinet (liste)", en: 'Lawyers of a firm (list)' },
  description: {
    fr: 'Liste les avocats rattachés au cabinet dans l’annuaire du CNB (25 au plus), chacun proposé dans « À vérifier » avec son barreau, sa date de serment et ses spécialités. À lancer à la demande, pour l’enquête uniquement.',
    en: 'Lists the lawyers attached to the firm in the CNB directory (up to 25), each put in "To review" with bar, swearing-in date and specialties. On demand, for investigation only.'
  },
  category: 'company',
  inputTypes: ['company'],
  ondemand: true,
  homepage: 'https://www.data.gouv.fr/fr/datasets/annuaire-des-avocats-de-france/',
  timeoutMs: 240000,
  async run(input, ctx) {
    const look = await lookupFirm(ctx, input.label, input.data)
    if (!look || !look.firms.length) return {}
    const name = companyName(input.label, input.data) ?? input.label
    const firm = look.bySiren ? { key: '', name: look.firms[0].name, rows: look.firms.flatMap((f) => f.rows) } : pickFirm(look.firms, name)
    if (!firm) throw new ModuleError('Plusieurs cabinets portent ce nom : précisez le SIREN', 'invalid_input')
    const rows = [...firm.rows].sort((a, b) => (a.avNom ?? '').localeCompare(b.avNom ?? ''))
    return {
      properties: compact({ lawyers_count: look.bySiren ? look.total : firm.rows.length }),
      entities: rows.slice(0, MAX_LAWYERS).map((r) => lawyerEntity(r, firm.name, ctx.lang)),
      raw: { total: look.total, listed: Math.min(rows.length, MAX_LAWYERS) }
    }
  }
})

export const modules = [personModule, firmModule, listModule]
