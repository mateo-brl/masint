// Identifiant LEI d'une entreprise et liens de groupe (maison mère directe et ultime, filiales
// directes) d'après la base mondiale GLEIF : API publique, sans clé, données sous licence CC0.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, serviceError, tr } from '../misc/_util'
import { normName } from './_fr'
import { sirenOf } from './_ids'

const API = 'https://api.gleif.org/api/v1'
const MAX_CHILDREN = 25
const MAX_CANDIDATES = 5

export interface GleifAddress {
  addressLines?: string[]
  city?: string | null
  region?: string | null
  country?: string | null
  postalCode?: string | null
}

export interface GleifRecord {
  id: string
  attributes: {
    lei: string
    entity: {
      legalName?: { name?: string }
      otherNames?: Array<{ name?: string; type?: string }>
      legalAddress?: GleifAddress
      headquartersAddress?: GleifAddress
      registeredAs?: string | null
      registeredAt?: { id?: string | null } | null
      jurisdiction?: string | null
      legalForm?: { id?: string | null; other?: string | null } | null
      status?: string | null
      creationDate?: string | null
    }
    registration?: { status?: string | null; initialRegistrationDate?: string | null; lastUpdateDate?: string | null; nextRenewalDate?: string | null }
    bic?: string[] | null
  }
}

interface GleifList {
  data?: GleifRecord[]
  meta?: { pagination?: { total?: number } }
}

interface GleifOne {
  data?: GleifRecord
}

/** Clé de contrôle ISO 17442 (modulo 97, comme l'IBAN). */
export function isLei(s: string): boolean {
  const v = s.trim().toUpperCase()
  if (!/^[A-Z0-9]{18}\d{2}$/.test(v)) return false
  const digits = v.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rest = 0
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97
  return rest === 1
}

const address = (a: GleifAddress | undefined): string | null =>
  a ? [...(a.addressLines ?? []), [a.postalCode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') || null : null

/** Données d'un enregistrement LEI pour une entité `company`. */
export function recordData(r: GleifRecord): Record<string, PropValue> {
  const e = r.attributes.entity
  const reg = (e.registeredAs ?? '').trim()
  const frSiren = e.jurisdiction === 'FR' && /^\d{3} ?\d{3} ?\d{3}$/.test(reg) ? reg.replace(/\s/g, '') : null
  return compact({
    lei: r.attributes.lei,
    siren: frSiren,
    company_number: frSiren ? null : reg || null,
    jurisdiction: e.jurisdiction ?? null,
    lei_status: r.attributes.registration?.status ?? null,
    lei_entity_status: e.status ?? null,
    address: address(e.legalAddress),
    lei_url: `https://search.gleif.org/#/record/${r.attributes.lei}`
  })
}

const nameOf = (r: GleifRecord): string => r.attributes.entity.legalName?.name ?? r.attributes.lei

/** Propriétés de l'entreprise d'entrée. */
export function recordProperties(r: GleifRecord): Record<string, PropValue> {
  const e = r.attributes.entity
  return compact({
    ...recordData(r),
    registered_name: nameOf(r),
    lei_headquarters: address(e.headquartersAddress) !== address(e.legalAddress) ? address(e.headquartersAddress) : null,
    lei_other_names: (e.otherNames ?? []).map((n) => n.name ?? '').filter(Boolean),
    lei_registered_at: r.attributes.registration?.initialRegistrationDate?.slice(0, 10) ?? null,
    bic: r.attributes.bic?.length ? r.attributes.bic.join(', ') : null
  })
}

export interface GroupLinks {
  directParent?: GleifRecord | null
  ultimateParent?: GleifRecord | null
  children: GleifRecord[]
  childrenTotal: number
}

export function gleifOutput(ctx: Pick<ModuleContext, 'lang'>, r: GleifRecord, links: GroupLinks): ModuleOutput {
  const entities: OutEntity[] = []
  const { directParent: dp, ultimateParent: up } = links
  const sameParent = dp && up && dp.attributes.lei === up.attributes.lei
  if (dp && dp.attributes.lei !== r.attributes.lei) {
    entities.push({
      type: 'company',
      label: nameOf(dp),
      data: recordData(dp),
      linkLabel: sameParent ? tr(ctx, 'société mère (directe et ultime)', 'parent company (direct and ultimate)') : tr(ctx, 'société mère (directe)', 'parent company (direct)')
    })
  }
  if (up && !sameParent && up.attributes.lei !== r.attributes.lei) {
    entities.push({ type: 'company', label: nameOf(up), data: recordData(up), linkLabel: tr(ctx, 'société mère (ultime)', 'ultimate parent company') })
  }
  for (const c of links.children.slice(0, MAX_CHILDREN)) {
    entities.push({ type: 'company', label: nameOf(c), data: recordData(c), linkLabel: tr(ctx, 'filiale', 'subsidiary') })
  }
  return {
    properties: compact({
      ...recordProperties(r),
      lei_parent: dp ? nameOf(dp) : null,
      lei_ultimate_parent: up ? nameOf(up) : null,
      lei_children_count: links.childrenTotal || null
    }),
    entities,
    raw: {
      lei: r.attributes.lei,
      directParent: dp?.attributes.lei ?? null,
      ultimateParent: up?.attributes.lei ?? null,
      children: links.children.map((c) => c.attributes.lei),
      childrenTotal: links.childrenTotal
    }
  }
}

/** Recherche par nom : entreprises de même dénomination, à vérifier. */
export function candidatesOutput(ctx: Pick<ModuleContext, 'lang'>, records: GleifRecord[], label: string): ModuleOutput {
  const q = normName(label)
  const exact = (r: GleifRecord): boolean => nameOf(r).toLowerCase() === label.trim().toLowerCase()
  const same = records
    .filter((r) => [nameOf(r), ...(r.attributes.entity.otherNames ?? []).map((n) => n.name ?? '')].some((n) => normName(n) === q))
    // Dénomination identique d'abord, puis entreprises françaises.
    .sort((a, b) => Number(exact(b)) - Number(exact(a)) || Number(b.attributes.entity.jurisdiction === 'FR') - Number(a.attributes.entity.jurisdiction === 'FR'))
  if (!same.length) return {}
  return {
    entities: same.slice(0, MAX_CANDIDATES).map((r) => ({
      type: 'company',
      label: nameOf(r),
      data: recordData(r),
      linkLabel: tr(ctx, 'LEI possible', 'possible LEI'),
      review: true,
      reviewReason: tr(
        ctx,
        `même dénomination dans la base GLEIF (${r.attributes.entity.jurisdiction ?? '?'}, ${r.attributes.entity.registeredAs ?? 'immatriculation inconnue'}) : vérifiez le pays et le numéro d’immatriculation`,
        `same legal name in the GLEIF database (${r.attributes.entity.jurisdiction ?? '?'}, ${r.attributes.entity.registeredAs ?? 'unknown registration'}): check the country and registration number`
      )
    })),
    raw: same.map((r) => ({ lei: r.attributes.lei, name: nameOf(r), jurisdiction: r.attributes.entity.jurisdiction }))
  }
}

async function get<T>(ctx: ModuleContext, path: string, query?: Record<string, string | number>): Promise<T | null> {
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await ctx.fetchJson<T>(`${API}${path}`, { query, timeoutMs: 30000, headers: { accept: 'application/vnd.api+json' } })
    } catch (e) {
      last = e
      const status = (e as { status?: number }).status
      // 404 : pas de maison mère déclarée (exception de déclaration) ou LEI inconnu.
      if (status === 404) return null
      if (status === 429) throw new ModuleError('GLEIF : trop de requêtes, réessayez plus tard', 'rate_limited')
      if ((status && status < 500) || ctx.signal.aborted) break
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw serviceError(last, 'GLEIF')
}

async function bySiren(ctx: ModuleContext, siren: string): Promise<GleifRecord | null> {
  // L'immatriculation est saisie avec ou sans espaces selon l'émetteur du LEI.
  for (const reg of [siren, `${siren.slice(0, 3)} ${siren.slice(3, 6)} ${siren.slice(6)}`]) {
    const res = await get<GleifList>(ctx, '/lei-records', { 'filter[entity.registeredAs]': reg, 'filter[entity.jurisdiction]': 'FR', 'page[size]': 5 })
    const hit = res?.data?.[0]
    if (hit) return hit
  }
  return null
}

export default defineModule({
  id: 'company.gleif',
  name: { fr: 'LEI et liens de groupe (GLEIF)', en: 'LEI and group structure (GLEIF)' },
  description: {
    fr: 'Cherche l’identifiant LEI de l’entreprise dans la base mondiale GLEIF (sans clé, CC0), par son LEI, son SIREN ou à défaut son nom : statut, pays, adresse légale, maison mère directe et ultime, et 25 filiales directes au plus. Une recherche par nom seul propose les correspondances dans « À vérifier ».',
    en: 'Looks the company up in the global GLEIF LEI database (no key, CC0), by its LEI, its SIREN or failing that its name: status, country, legal address, direct and ultimate parent and up to 25 direct subsidiaries. A name-only search puts matches aside in "To review".'
  },
  category: 'company',
  inputTypes: ['company', 'organization'],
  homepage: 'https://search.gleif.org/',
  async run(input, ctx) {
    const leiInput = [input.data.lei, input.label].map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : '')).find(isLei)
    const siren = sirenOf(input)
    let record: GleifRecord | null = null
    if (leiInput) record = (await get<GleifOne>(ctx, `/lei-records/${leiInput}`))?.data ?? null
    else if (siren) record = await bySiren(ctx, siren)
    else {
      const name = input.label.trim()
      if (name.length < 3) return {}
      const res = await get<GleifList>(ctx, '/lei-records', { 'filter[entity.legalName]': name, 'page[size]': 10 })
      return candidatesOutput(ctx, res?.data ?? [], name)
    }
    if (!record) return {}
    const lei = record.attributes.lei
    const [dp, up, children] = await Promise.all([
      get<GleifOne>(ctx, `/lei-records/${lei}/direct-parent`),
      get<GleifOne>(ctx, `/lei-records/${lei}/ultimate-parent`),
      get<GleifList>(ctx, `/lei-records/${lei}/direct-children`, { 'page[size]': MAX_CHILDREN })
    ])
    return gleifOutput(ctx, record, {
      directParent: dp?.data ?? null,
      ultimateParent: up?.data ?? null,
      children: children?.data ?? [],
      childrenTotal: children?.meta?.pagination?.total ?? children?.data?.length ?? 0
    })
  }
})
