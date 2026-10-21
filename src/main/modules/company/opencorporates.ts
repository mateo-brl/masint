// Recherche mondiale d'entreprises dans OpenCorporates (registres de 140 juridictions).
// L'API exige un jeton (gratuit pour les usages d'intérêt public, payant sinon).

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { getJson, tr } from '../misc/_util'

const MAX = 8

export interface OcCompany {
  name: string
  company_number: string
  jurisdiction_code: string
  incorporation_date?: string | null
  dissolution_date?: string | null
  company_type?: string | null
  current_status?: string | null
  inactive?: boolean | null
  registered_address_in_full?: string | null
  opencorporates_url?: string
  registry_url?: string | null
  previous_names?: Array<{ company_name: string }> | null
}

export interface OcSearch {
  results?: { companies?: Array<{ company: OcCompany }>; total_count?: number }
}

export function parseOpenCorporates(ctx: Pick<ModuleContext, 'lang'>, d: OcSearch): ModuleOutput {
  const list = (d.results?.companies ?? []).map((c) => c.company).slice(0, MAX)
  const entities: OutEntity[] = list.map((c) => ({
    type: 'company',
    label: c.name,
    data: {
      company_number: c.company_number,
      jurisdiction: c.jurisdiction_code.toUpperCase(),
      legal_form: c.company_type ?? null,
      status: c.current_status ?? (c.inactive ? 'inactive' : null),
      created_at: c.incorporation_date ?? null,
      closed_at: c.dissolution_date ?? null,
      address: c.registered_address_in_full ?? null,
      previous_names: (c.previous_names ?? []).map((p) => p.company_name),
      url: c.opencorporates_url ?? null,
      registry_url: c.registry_url ?? null
    },
    linkLabel: tr(ctx, 'correspondance OpenCorporates', 'OpenCorporates match')
  }))
  return {
    properties: { opencorporates_matches: d.results?.total_count ?? list.length },
    entities,
    raw: list
  }
}

export default defineModule({
  id: 'company.opencorporates',
  name: { fr: 'Registres mondiaux (OpenCorporates)', en: 'Worldwide registries (OpenCorporates)' },
  description: {
    fr: "Cherche la raison sociale dans OpenCorporates : numéro d'immatriculation, juridiction, forme, statut, dates et adresse des sociétés correspondantes.",
    en: 'Searches the company name in OpenCorporates: registration number, jurisdiction, type, status, dates and address of matching companies.'
  },
  category: 'company',
  inputTypes: ['company'],
  keys: [{ id: 'opencorporates', label: 'OpenCorporates API token', url: 'https://opencorporates.com/api_accounts/new' }],
  homepage: 'https://opencorporates.com',
  experimental: true,
  async run(input, ctx) {
    const d = await getJson<OcSearch>(ctx, 'https://api.opencorporates.com/v0.4/companies/search', 'OpenCorporates', {
      query: { q: input.label.trim(), per_page: MAX, api_token: ctx.key('opencorporates') },
      keyed: true
    })
    if (!d?.results?.companies?.length) return {}
    return parseOpenCorporates(ctx, d)
  }
})
