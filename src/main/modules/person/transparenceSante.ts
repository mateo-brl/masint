// Transparence Santé (ministère de la Santé, base publique sous licence CC BY-NC-SA) :
// conventions, avantages et rémunérations que les industriels de santé déclarent avoir versés
// aux professionnels de santé. Pour un professionnel identifié par son numéro RPPS, le total et
// les principaux payeurs ; pour un laboratoire, le nombre de bénéficiaires et le montant déclaré,
// sans créer de nœud pour les personnes.

import { isRpps } from '@shared/detect'
import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { companyName, euros, nameStartsWith, sirenOf, withRetry } from '../company/_datagouv'
import { titleCase } from '../company/_fr'
import { compact } from '../social/_lib'
import { knownRpps } from './rpps'
import { fold, splitName, type PersonName } from './_name'

const API = 'https://www.transparence.sante.gouv.fr/api/explore/v2.1/catalog/datasets/declarations/records'
const SERVICE = 'Transparence Santé'
const MAX_PAYERS = 5
const MAX_NAMESAKES = 5

interface OdsResponse<T> {
  total_count?: number
  results?: T[]
}

export interface LinkTotal {
  lien_interet?: string | null
  n?: number | null
  total?: number | null
  last?: string | null
}

export interface Payer {
  raison_sociale?: string | null
  numero_siren?: string | null
  n?: number | null
  total?: number | null
}

export interface Beneficiary {
  beneficiaire_identifiant?: string | null
  beneficiaire_type_code?: string | null
  identite?: string | null
  prenom?: string | null
  profession_libelle?: string | null
  n?: number | null
  total?: number | null
}

/** Texte sûr dans une chaîne ODSQL entre guillemets. */
const odsString = (s: string): string => s.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()

const sum = (xs: Array<number | null | undefined>): number => xs.reduce<number>((s, x) => s + (typeof x === 'number' ? x : 0), 0)

/** Totaux par nature de lien d'intérêt (convention, avantage, rémunération). */
export function totalsProperties(rows: LinkTotal[]): Record<string, PropValue> {
  const by = (k: string): LinkTotal | undefined => rows.find((r) => (r.lien_interet ?? '').toLowerCase() === k)
  const last = rows
    .map((r) => r.last?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort()
    .pop()
  return compact({
    industry_declarations_count: sum(rows.map((r) => r.n)) || undefined,
    industry_payments_total: euros(sum(rows.map((r) => r.total))),
    industry_agreements_count: by('convention')?.n ?? undefined,
    industry_benefits_total: by('avantage') ? euros(by('avantage')!.total) : undefined,
    industry_fees_total: by('remuneration') ? euros(by('remuneration')!.total) : undefined,
    industry_last_date: last
  })
}

/** Principaux payeurs d'un professionnel : entreprises proposées dans « À vérifier ». */
export function payerEntities(payers: Payer[], lang: 'fr' | 'en'): OutEntity[] {
  const fr = lang === 'fr'
  return payers
    .filter((p) => p.raison_sociale)
    .slice(0, MAX_PAYERS)
    .map((p) => {
      const amount = euros(p.total) ?? '?'
      const n = p.n ?? 0
      return {
        type: 'company',
        label: p.raison_sociale!.trim(),
        data: compact({ siren: validSiren(p.numero_siren) ? p.numero_siren : undefined }),
        linkLabel: fr ? `versements déclarés : ${amount} (${n} déclaration${n > 1 ? 's' : ''})` : `declared payments: ${amount} (${n} declaration${n > 1 ? 's' : ''})`,
        review: true,
        reviewReason: fr
          ? `payeur déclaré à Transparence Santé : ${amount} en ${n} déclaration${n > 1 ? 's' : ''} ; ajoutez-le au graphe s'il intéresse l'enquête`
          : `payer declared to Transparence Santé: ${amount} in ${n} declaration${n > 1 ? 's' : ''}; add it to the graph if relevant`
      }
    })
}

/** Le bénéficiaire porte-t-il le nom cherché (nom identique, premier prénom présent) ? */
export function sameBeneficiary(b: Beneficiary, name: PersonName): boolean {
  const norm = (s: string): string => fold(s).replace(/[^a-z]/g, '')
  const first = fold(name.firstNames[0] ?? '').replace(/[^a-z-]/g, '')
  const prenoms = fold(b.prenom ?? '')
    .split(/[\s,]+/)
    .map((p) => p.replace(/[^a-z-]/g, ''))
  return !!first && norm(b.identite ?? '') === norm(name.lastName) && prenoms.includes(first)
}

/** Homonymes trouvés par nom : leur numéro RPPS à vérifier, avec le montant déclaré. */
export function namesakeEntities(list: Beneficiary[], lang: 'fr' | 'en'): OutEntity[] {
  const fr = lang === 'fr'
  return list
    .filter((b) => isRpps((b.beneficiaire_identifiant ?? '').trim()))
    .slice(0, MAX_NAMESAKES)
    .map((b) => {
      const who = `${titleCase(b.prenom ?? '')} ${titleCase(b.identite ?? '')}`.trim()
      const amount = euros(b.total) ?? '?'
      return {
        type: 'id_document',
        label: b.beneficiaire_identifiant!.trim(),
        data: compact({
          kind: 'RPPS',
          number: b.beneficiaire_identifiant!.trim(),
          document_holder: who,
          occupation: b.profession_libelle ?? undefined,
          industry_declarations_count: b.n ?? undefined,
          industry_payments_total: euros(b.total)
        }),
        linkLabel: fr ? 'numéro RPPS' : 'RPPS number',
        review: true,
        reviewReason: fr
          ? `homonyme possible : ${who}${b.profession_libelle ? `, ${b.profession_libelle}` : ''}, ${amount} déclarés par l'industrie en ${b.n ?? 0} déclaration(s) ; vérifiez le numéro RPPS`
          : `possible namesake: ${who}${b.profession_libelle ? `, ${b.profession_libelle}` : ''}, ${amount} declared by industry in ${b.n ?? 0} declaration(s); check the RPPS number`
      }
    })
}

function query<T>(ctx: ModuleContext, q: Record<string, string | number>): Promise<OdsResponse<T>> {
  return withRetry(ctx, () => ctx.fetchJson<OdsResponse<T>>(API, { query: q, timeoutMs: 45000 }), { service: SERVICE, attempts: 4 })
}

const TOTALS = 'lien_interet, count(*) as n, sum(montant) as total, max(date) as last'

const validSiren = (s: string | null | undefined): s is string => /^\d{9}$/.test(s ?? '')

/** Entités déclarantes dont la raison sociale commence par le nom cherché, sans doublon. */
export function declarantsMatching(found: Payer[], name: string): Payer[] {
  const seen = new Set<string>()
  return found.filter((p) => {
    if (!p.raison_sociale || !nameStartsWith(p.raison_sociale, name)) return false
    const key = `${p.raison_sociale}|${p.numero_siren ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Condition ODSQL qui couvre exactement ces entités : SIREN, sinon raison sociale exacte. */
export function declarantsWhere(list: Payer[]): string {
  const parts = list.map((p) => (validSiren(p.numero_siren) ? `numero_siren = "${p.numero_siren}"` : `raison_sociale = "${odsString(p.raison_sociale ?? '')}"`))
  return [...new Set(parts)].join(' or ')
}

async function byRppsNumber(ctx: ModuleContext, rpps: string) {
  const where = `beneficiaire_identifiant = "${rpps}"`
  const [totals, payers] = await Promise.all([
    query<LinkTotal>(ctx, { where, select: TOTALS, group_by: 'lien_interet', limit: 10 }),
    query<Payer>(ctx, {
      where,
      select: 'raison_sociale, numero_siren, count(*) as n, sum(montant) as total',
      group_by: 'raison_sociale, numero_siren',
      order_by: 'total desc',
      limit: MAX_PAYERS
    })
  ])
  return { totals: totals.results ?? [], payers: payers.results ?? [] }
}

const personModule = defineModule({
  id: 'person.transparence_sante',
  name: { fr: 'Liens avec l’industrie (Transparence Santé)', en: 'Industry payments (Transparence Santé)' },
  description: {
    fr: 'Conventions, avantages et rémunérations déclarés par les industriels de santé pour ce professionnel (base publique Transparence Santé) : avec le numéro RPPS, nombre de déclarations, montants par nature et les 5 principaux payeurs (proposés dans « À vérifier ») ; avec le seul nom, les numéros RPPS des homonymes à vérifier.',
    en: 'Agreements, benefits and fees declared by health industry companies for this professional (public Transparence Santé database): with the RPPS number, declaration count, amounts by kind and the 5 main payers (put in "To review"); with a name only, the RPPS numbers of namesakes to review.'
  },
  category: 'person',
  inputTypes: ['person', 'id_document'],
  accepts: (input) => input.type === 'person' || isRpps(input.label.replace(/\s/g, '')),
  homepage: 'https://www.transparence.sante.gouv.fr',
  timeoutMs: 240000,
  async run(input, ctx) {
    const rpps = knownRpps(input.type, input.label, input.data)
    if (rpps) {
      const { totals, payers } = await byRppsNumber(ctx, rpps)
      if (!totals.length) return { raw: { rpps, total: 0 } }
      return { properties: totalsProperties(totals), entities: payerEntities(payers, ctx.lang), raw: { rpps, totals, payers } }
    }
    const name = splitName(input)
    if (!name) throw new ModuleError('Indiquer un prénom et un nom, ou un numéro RPPS', 'invalid_input')
    const res = await query<Beneficiary>(ctx, {
      where: `search(identite, "${odsString(name.lastName)}") and search(prenom, "${odsString(name.firstNames[0])}")`,
      select: 'beneficiaire_identifiant, beneficiaire_type_code, identite, prenom, profession_libelle, count(*) as n, sum(montant) as total',
      group_by: 'beneficiaire_identifiant, beneficiaire_type_code, identite, prenom, profession_libelle',
      order_by: 'n desc',
      limit: 50
    })
    const list = (res.results ?? []).filter((b) => sameBeneficiary(b, name))
    if (!list.length) return { raw: { total: 0 } }
    const ids = new Set(list.map((b) => b.beneficiaire_identifiant ?? `${b.identite}|${b.prenom}`))
    return {
      entities: namesakeEntities(list, ctx.lang),
      properties: { industry_namesakes_count: ids.size },
      raw: { beneficiaries: list.slice(0, 20).map((b) => ({ id: b.beneficiaire_identifiant, type: b.beneficiaire_type_code, profession: b.profession_libelle, n: b.n, total: b.total })) }
    }
  }
})

const companyModule = defineModule({
  id: 'company.transparence_sante',
  name: { fr: 'Versements aux professionnels de santé (Transparence Santé)', en: 'Payments to health professionals (Transparence Santé)' },
  description: {
    fr: 'Pour un industriel de santé, par SIREN (exact) ou par raison sociale : nombre de déclarations, nombre de bénéficiaires et montants déclarés par nature (conventions, avantages, rémunérations) dans la base publique Transparence Santé. Aucun nœud n’est créé pour les bénéficiaires.',
    en: 'For a health industry company, by SIREN (exact) or name: number of declarations, number of beneficiaries and declared amounts by kind (agreements, benefits, fees) from the public Transparence Santé database. No node is created for beneficiaries.'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: 'https://www.transparence.sante.gouv.fr',
  timeoutMs: 240000,
  async run(input, ctx) {
    const siren = sirenOf(input.label, input.data)
    const name = companyName(input.label, input.data)
    if (!siren && (!name || name.length < 3)) throw new ModuleError('SIREN ou raison sociale nécessaire', 'invalid_input')
    let where = `numero_siren = "${siren}"`
    let declarants: string[] = []
    if (!siren) {
      // Par nom : entités déclarantes dont la raison sociale commence par le nom cherché.
      const found = await query<Payer>(ctx, {
        where: `search(raison_sociale, "${odsString(name!)}")`,
        select: 'raison_sociale, numero_siren, count(*) as n',
        group_by: 'raison_sociale, numero_siren',
        order_by: 'n desc',
        limit: 50
      })
      const kept = declarantsMatching(found.results ?? [], name!)
      if (!kept.length) return { raw: { total: 0 } }
      where = declarantsWhere(kept)
      declarants = kept.map((p) => `${p.raison_sociale}${validSiren(p.numero_siren) ? ` (${p.numero_siren})` : ''}`)
    }
    const [totals, people] = await Promise.all([
      query<LinkTotal>(ctx, { where, select: TOTALS, group_by: 'lien_interet', limit: 10 }),
      query<{ beneficiaries?: number | null }>(ctx, { where, select: 'count(distinct id_beneficiaire) as beneficiaries', limit: 1 })
    ])
    const rows = totals.results ?? []
    if (!rows.length) return { raw: { total: 0 } }
    return {
      properties: compact({
        ...totalsProperties(rows),
        industry_beneficiaries_count: people.results?.[0]?.beneficiaries ?? undefined,
        industry_declarant_entities: declarants
      }),
      raw: { where, totals: rows, declarants }
    }
  }
})

export const modules = [personModule, companyModule]
