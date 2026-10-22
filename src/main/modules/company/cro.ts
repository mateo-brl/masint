// Entreprises irlandaises : registre des sociétés (Companies Registration Office), données
// ouvertes CC BY 4.0 sur le portail CKAN du CRO, sans clé. Identité, statut, forme, dates
// d'immatriculation, de dernière déclaration annuelle et de derniers comptes, adresse.
// Les dirigeants ne font pas partie des données ouvertes.

import { defineModule, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { getJson, tr } from '../misc/_util'
import { acceptsCountry, candidatesOutput, countryHint, euOutput, exactMatch, irishCroNumber, numberFrom } from './_eu'

const API = 'https://opendata.cro.ie/api/3/action/datastore_search'
/** Ressource « Companies » du jeu de données du CRO. */
const RESOURCE = '3fef41bc-b8f4-4b10-8434-ce51c29b1bba'

export interface CroRecord {
  company_num: number | string
  company_name: string
  company_status?: string | null
  company_type?: string | null
  company_reg_date?: string | null
  comp_dissolved_date?: string | null
  company_status_date?: string | null
  last_ar_date?: string | null
  last_accounts_date?: string | null
  company_name_eff_date?: string | null
  company_address_1?: string | null
  company_address_2?: string | null
  company_address_3?: string | null
  company_address_4?: string | null
  eircode?: string | null
  nace_v2_code?: string | null
  princ_object_code?: string | null
}

export interface CroResponse {
  success?: boolean
  result?: { total?: number; records?: CroRecord[] }
}

const day = (v: string | null | undefined): string | null => (v ? v.slice(0, 10) : null)
const clean = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim().replace(/\s+/g, ' ') : null)

function addressOf(r: CroRecord): { label: string; street: string | null; postcode: string | null; city: string | null } | null {
  const lines = [r.company_address_1, r.company_address_2, r.company_address_3, r.company_address_4].map(clean).filter((l): l is string => !!l)
  if (!lines.length) return null
  const eircode = clean(r.eircode)
  return { label: [...lines, eircode].filter(Boolean).join(', '), street: lines[0], postcode: eircode, city: lines.length > 1 ? lines[lines.length - 1] : null }
}

export function croOutput(ctx: Pick<ModuleContext, 'lang'>, r: CroRecord): ModuleOutput {
  const number = String(r.company_num)
  return euOutput(ctx, {
    country: 'IE',
    name: clean(r.company_name) ?? number,
    number,
    properties: {
      legal_form: clean(r.company_type),
      status: clean(r.company_status),
      created_at: day(r.company_reg_date),
      registration_date: day(r.company_reg_date),
      closed_at: day(r.comp_dissolved_date),
      activity: clean(r.nace_v2_code) ?? clean(r.princ_object_code),
      last_annual_return_date: day(r.last_ar_date),
      last_accounts_date: day(r.last_accounts_date),
      name_since: day(r.company_name_eff_date)
    },
    address: addressOf(r),
    raw: r
  })
}

async function search(ctx: ModuleContext, query: Record<string, string | number>): Promise<CroRecord[]> {
  const r = await getJson<CroResponse>(ctx, API, 'CRO', { query: { resource_id: RESOURCE, limit: 20, ...query }, timeoutMs: 30000 })
  return r?.result?.records ?? []
}

export default defineModule({
  id: 'company.cro',
  name: { fr: 'Entreprise irlandaise (CRO)', en: 'Irish company (CRO)' },
  description: {
    fr: "Registre irlandais des sociétés (Companies Registration Office, données ouvertes CC BY 4.0) : numéro, statut, forme, date d'immatriculation, dissolution, dernière déclaration annuelle, derniers comptes et adresse. Par numéro (préfixé CRO ou IE) ou par nom.",
    en: 'Irish companies register (Companies Registration Office, CC BY 4.0 open data): number, status, type, registration and dissolution dates, last annual return, last accounts and address. By number (prefixed CRO or IE) or by name.'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: 'https://opendata.cro.ie',
  accepts: (input) => acceptsCountry(input, 'IE', (s) => irishCroNumber(s, countryHint(input.data) === 'IE')),
  async run(input, ctx) {
    const hinted = countryHint(input.data) === 'IE'
    const number = numberFrom(input, (s) => irishCroNumber(s, hinted))
    if (number) {
      const list = await search(ctx, { filters: JSON.stringify({ company_num: Number(number) }) })
      return list[0] ? croOutput(ctx, list[0]) : {}
    }
    const name = input.label.trim()
    if (name.length < 3) return {}
    const list = await search(ctx, { q: name })
    const hit = exactMatch(list, name, (r) => [r.company_name])
    if (hit) return croOutput(ctx, hit)
    return candidatesOutput(
      ctx,
      'IE',
      list
        .filter((r) => !/dissolved|struck off|liquidated/i.test(r.company_status ?? ''))
        .map((r) => ({ name: clean(r.company_name) ?? String(r.company_num), number: String(r.company_num), address: addressOf(r)?.label ?? null, status: clean(r.company_status), created: day(r.company_reg_date) })),
      tr(ctx, 'irlandais', 'Irish')
    )
  }
})
