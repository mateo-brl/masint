// Wikidata pour une entreprise ou une organisation : description, LEI, SIREN, date de création,
// effectif, secteur, siège (placé sur la carte), site officiel, numéro de TVA, maison mère,
// filiales et comptes en ligne. Recherche par SIREN ou LEI quand la fiche en porte un, sinon
// par le nom. API publique, sans clé ; repli sur SPARQL et Special:EntityData en cas de quota.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { cappedList, compact } from '../domain/_util'
import {
  accountEntities,
  claimsOf,
  descriptionOf,
  distinctLabel,
  findByStatement,
  first,
  getEntities,
  isOrganization,
  itemId,
  labelOf,
  resolveItems,
  sameName,
  searchCandidates,
  values,
  wikidataDate,
  type Resolved,
  type WdEntity
} from '../person/_wikidata'

/** Filiales reliées au graphe ; la liste complète reste dans la fiche. */
const MAX_SUBSIDIARIES = 10

const wdData = (id: string): Record<string, PropValue> => ({ wikidata_id: id, wikidata_url: `https://www.wikidata.org/wiki/${id}` })

/** Éléments cités par la fiche, dont il faut le libellé (et les coordonnées du siège). */
export function organizationReferences(o: WdEntity): { ids: string[]; withCoords: string[] } {
  const ids = ['P749', 'P355', 'P159', 'P452']
    .flatMap((prop) => claimsOf(o, prop).map((c) => itemId(c.mainsnak?.datavalue?.value)))
    .filter((x): x is string => !!x)
  const hq = itemId(first(o, 'P159'))
  return { ids, withCoords: hq ? [hq] : [] }
}

/** Effectif le plus récent déclaré (P1128, valeur préférée d'abord). */
function employees(o: WdEntity): number | null {
  const v = first<{ amount?: string }>(o, 'P1128')
  const n = v?.amount ? Number(v.amount) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Sortie du module. `type` est celui du nœud d'entrée (`company` ou `organization`) : maison
 * mère et filiales prennent le même, pour être enrichies par les mêmes modules.
 */
export function organizationOutput(lang: 'fr' | 'en', o: WdEntity, names: Map<string, Resolved>, type: string, reviewReason?: string, self?: string): ModuleOutput {
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  const own = self ?? labelOf(o, lang)
  const label = (id: string | undefined): string | undefined => (id ? names.get(id)?.label : undefined)
  // Filiale ou maison mère du même nom que l'organisation, ou homonyme d'une autre filiale :
  // identifiant Wikidata dans le libellé, pour garder des nœuds distincts.
  const counts = new Map<string, number>()
  for (const id of values<unknown>(o, 'P355').map(itemId)) {
    const l = label(id)
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1)
  }
  const named = (id: string): string => {
    const l = label(id)!
    return (counts.get(l) ?? 0) > 1 ? `${l} (${id})` : distinctLabel(l, id, own)
  }

  const website = first<string>(o, 'P856')
  if (website) entities.push({ type: 'website', label: website, linkLabel: fr ? 'site officiel' : 'official website' })

  const hqId = itemId(first(o, 'P159'))
  const hq = hqId ? names.get(hqId) : undefined
  if (hq?.label)
    entities.push({
      type: 'city',
      label: hq.label,
      data: hq.lat !== undefined && hq.lon !== undefined ? { lat: hq.lat, lon: hq.lon } : {},
      linkLabel: fr ? 'siège' : 'headquarters'
    })

  const vat = first<string>(o, 'P3608')
  if (vat) entities.push({ type: 'vat', label: vat.replace(/\s+/g, ''), linkLabel: fr ? 'numéro de TVA' : 'VAT number' })

  for (const id of values<unknown>(o, 'P749').map(itemId).slice(0, 3)) {
    const name = label(id)
    if (id && name) entities.push({ type, label: distinctLabel(name, id, own), data: wdData(id), linkLabel: fr ? 'maison mère' : 'parent organization' })
  }

  const subsidiaries = values<unknown>(o, 'P355')
    .map(itemId)
    .filter((id): id is string => !!id && !!label(id))
  for (const id of subsidiaries.slice(0, MAX_SUBSIDIARIES))
    entities.push({ type, label: named(id), data: wdData(id), linkLabel: fr ? 'filiale' : 'subsidiary' })

  entities.push(...accountEntities(o, lang))

  const industries = values<unknown>(o, 'P452')
    .map((v) => label(itemId(v)))
    .filter((x): x is string => !!x)
  const properties = compact({
    ...wdData(o.id),
    description: descriptionOf(o, lang) ?? null,
    lei: first<string>(o, 'P1278') ?? null,
    siren: first<string>(o, 'P1616') ?? null,
    created_at: wikidataDate(first(o, 'P571')),
    employees: employees(o),
    industry: industries.length ? industries.join(', ') : null,
    // Filiales au-delà de celles reliées au graphe : la liste complète dans la fiche.
    ...(subsidiaries.length > MAX_SUBSIDIARIES ? cappedList('subsidiaries', subsidiaries.map(named)) : {})
  })
  return {
    properties,
    entities: reviewReason ? entities.map((e) => ({ ...e, review: true, reviewReason })) : entities,
    raw: { id: o.id }
  }
}

/** Organisation retenue : la première candidate dont la fiche décrit une organisation. */
export function pickOrganization(
  name: string,
  candidates: Array<{ id: string; label?: string; description?: string; organization: boolean }>,
  lang: 'fr' | 'en'
): { id: string; reviewReason?: string } | null {
  const orgs = candidates.filter((c) => c.organization)
  if (!orgs.length) return null
  const chosen = orgs[0]
  const namesakes = orgs.filter((c) => c.label && sameName(c.label, name))
  if (namesakes.length < 2) return { id: chosen.id }
  const what = chosen.description ? `${chosen.description}, ${chosen.id}` : chosen.id
  return {
    id: chosen.id,
    reviewReason:
      lang === 'fr'
        ? `homonyme possible : ${namesakes.length} organisations de ce nom dans Wikidata, retenue : ${what}`
        : `possible namesake: ${namesakes.length} organizations with this name in Wikidata, chosen: ${what}`
  }
}

const str = (v: PropValue | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Identifiant Wikidata exact : déjà connu, sinon retrouvé par le SIREN ou le LEI de la fiche. */
async function exactId(ctx: ModuleContext, data: Record<string, PropValue>): Promise<string | null> {
  const known = str(data.wikidata_id)
  if (known && /^Q\d+$/.test(known)) return known
  const siren = str(data.siren)?.replace(/\s+/g, '')
  const lei = str(data.lei)?.toUpperCase()
  try {
    if (siren && /^\d{9}$/.test(siren)) return (await findByStatement(ctx, 'P1616', siren)) ?? null
    if (lei && /^[A-Z0-9]{20}$/.test(lei)) return (await findByStatement(ctx, 'P1278', lei)) ?? null
  } catch (e) {
    // SPARQL indisponible : la recherche par nom prend le relais.
    ctx.log(`recherche par identifiant impossible : ${e instanceof Error ? e.message : String(e)}`)
  }
  return null
}

export default defineModule({
  id: 'company.wikidata',
  name: { fr: 'Wikidata (organisation)', en: 'Wikidata (organization)' },
  description: {
    fr: 'Cherche l’entreprise ou l’organisation dans Wikidata, par son SIREN ou son LEI s’ils sont connus, sinon par son nom : description, LEI, SIREN, date de création, effectif, secteur, siège (placé sur la carte), site officiel, numéro de TVA, maison mère, filiales et comptes en ligne.',
    en: 'Looks the company or organization up in Wikidata, by its SIREN or LEI when known, otherwise by name: description, LEI, SIREN, founding date, headcount, industry, headquarters (shown on the map), official website, VAT number, parent organization, subsidiaries and online accounts.'
  },
  category: 'company',
  inputTypes: ['company', 'organization'],
  homepage: 'https://www.wikidata.org',
  experimental: true,
  async run(input, ctx) {
    const fr = ctx.lang === 'fr'
    const name = input.label.trim()
    const id = await exactId(ctx, input.data)
    if (!id && name.length < 2) throw new ModuleError(fr ? 'Nom trop court' : 'Name too short', 'invalid_input')

    let org: WdEntity | undefined
    let reviewReason: string | undefined
    let candidates: string[] = []
    if (id) {
      org = (await getEntities(ctx, [id]))[id]
    } else {
      const found = await searchCandidates(ctx, name)
      candidates = found.candidates.map((c) => c.id)
      const pick = pickOrganization(name, found.candidates, ctx.lang)
      if (!pick) return {}
      reviewReason = pick.reviewReason
      org = found.entities[pick.id] ?? (await getEntities(ctx, [pick.id]))[pick.id]
    }
    if (!org || (!id && !isOrganization(org))) return {}

    const refs = organizationReferences(org)
    const names = await resolveItems(ctx, refs.ids, refs.withCoords)
    const out = organizationOutput(ctx.lang, org, names, input.type === 'organization' ? 'organization' : 'company', reviewReason, name)
    return { ...out, raw: { id: org.id, label: labelOf(org, ctx.lang), candidates } }
  }
})
