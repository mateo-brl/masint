// Registre public des aides de minimis (ministère de l'Économie, data.economie.gouv.fr) : aides
// d'État de faible montant accordées à une entreprise, avec le montant en équivalent subvention
// brute, l'autorité qui l'accorde et la date d'octroi. Recherche exacte par SIREN.

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { euros, sirenOf, withRetry } from './_datagouv'
import { compact } from '../social/_lib'

const API = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/aides_minimis/records'
const SERVICE = 'Aides de minimis (data.economie.gouv.fr)'
const MAX_EVENTS = 15

export interface MinimisRecord {
  index?: number
  regime?: string | null
  nom_beneficiaire?: string | null
  identifiant_beneficiaire?: string | null
  montant_esb?: number | null
  instrument_aide?: string | null
  secteur_aide?: string | null
  commune_beneficiaire?: string | null
  date_octroi?: string | null
  date_declaration?: string | null
  autorite?: string | null
  operateur?: string | null
}

interface OdsResponse<T> {
  total_count?: number
  results?: T[]
}

export interface MinimisTotals {
  n?: number | null
  total?: number | null
  last?: string | null
}

const clean = (v: string | null | undefined): string | undefined => (v && v.trim() && v.trim() !== '-' ? v.trim() : undefined)
const frDate = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/')

/** Condition ODSQL : SIREN seul ou SIRET d'un établissement. */
export const minimisWhere = (siren: string): string => `startswith(identifiant_beneficiaire, "${siren}")`

export function minimisOutput(records: MinimisRecord[], totals: MinimisTotals, lang: 'fr' | 'en') {
  const fr = lang === 'fr'
  const entities: OutEntity[] = records.slice(0, MAX_EVENTS).map((r) => {
    const amount = euros(r.montant_esb)
    const who = clean(r.autorite)
    const when = r.date_octroi ? frDate(r.date_octroi) : undefined
    return {
      type: 'event',
      label: `${fr ? 'Aide de minimis' : 'De minimis aid'} ${r.index ?? ''} : ${[amount, who, when].filter(Boolean).join(', ')}`.replace(/\s+:/, ' :'),
      data: compact({
        date: r.date_octroi ?? undefined,
        amount,
        aid_authority: who,
        aid_operator: clean(r.operateur),
        aid_instrument: clean(r.instrument_aide),
        aid_sector: clean(r.secteur_aide),
        aid_scheme: clean(r.regime),
        aid_declaration_date: r.date_declaration ?? undefined,
        aid_beneficiary: clean(r.nom_beneficiaire),
        source: 'Registre des aides de minimis'
      }),
      linkLabel: fr ? 'aide de minimis reçue' : 'de minimis aid received'
    }
  })
  return {
    entities,
    properties: compact({
      de_minimis_aids_count: totals.n ?? records.length,
      de_minimis_aids_total: euros(totals.total ?? records.reduce((s, r) => s + (r.montant_esb ?? 0), 0)),
      de_minimis_last_date: totals.last?.slice(0, 10) ?? records[0]?.date_octroi ?? undefined
    })
  }
}

export default defineModule({
  id: 'company.aides',
  name: { fr: 'Aides de minimis', en: 'De minimis State aid' },
  description: {
    fr: 'Aides d’État de minimis reçues par l’entreprise, par SIREN, dans le registre public du ministère de l’Économie (data.economie.gouv.fr) : nombre et montant total, puis les 15 aides les plus récentes datées (montant, autorité, instrument).',
    en: 'De minimis State aid received by the company, by SIREN, from the French Economy Ministry public register (data.economie.gouv.fr): count and total amount, then the 15 most recent dated aids (amount, granting authority, instrument).'
  },
  category: 'company',
  inputTypes: ['company'],
  accepts: (input) => !!sirenOf(input.label, input.data),
  homepage: 'https://data.economie.gouv.fr/explore/dataset/aides_minimis/',
  async run(input, ctx) {
    const siren = sirenOf(input.label, input.data)
    if (!siren) throw new ModuleError('SIREN ou SIRET nécessaire', 'invalid_input')
    const where = minimisWhere(siren)
    const call = <T>(query: Record<string, string | number>): Promise<T> =>
      withRetry(ctx, () => ctx.fetchJson<T>(API, { query, timeoutMs: 30000 }), { service: SERVICE, attempts: 4 })
    const [list, agg] = await Promise.all([
      call<OdsResponse<MinimisRecord>>({ where, order_by: 'date_octroi desc', limit: MAX_EVENTS }),
      call<OdsResponse<MinimisTotals>>({ where, select: 'count(*) as n, sum(montant_esb) as total, max(date_octroi) as last', limit: 1 })
    ])
    const records = list.results ?? []
    if (!records.length) return { raw: { total: 0 } }
    const totals = agg.results?.[0] ?? { n: list.total_count }
    return { ...minimisOutput(records, totals, ctx.lang), raw: { totals, records } }
  }
})
