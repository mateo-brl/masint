// Sociétés britanniques via l'API officielle Companies House (clé gratuite) :
// profil, siège, codes SIC et dirigeants.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { getJson, tr } from '../misc/_util'
import { normName, titleCase } from './_fr'

const API = 'https://api.company-information.service.gov.uk'
const MAX_OFFICERS = 25

interface ChAddress {
  premises?: string
  address_line_1?: string
  address_line_2?: string
  locality?: string
  region?: string
  postal_code?: string
  country?: string
}

export interface ChSearch {
  items?: Array<{ title: string; company_number: string; company_status?: string; date_of_creation?: string; address_snippet?: string }>
}

export interface ChProfile {
  company_name: string
  company_number: string
  company_status?: string
  type?: string
  date_of_creation?: string
  date_of_cessation?: string
  sic_codes?: string[]
  registered_office_address?: ChAddress
  has_insolvency_history?: boolean
}

export interface ChOfficers {
  items?: Array<{
    name: string
    officer_role: string
    appointed_on?: string
    resigned_on?: string
    nationality?: string
    occupation?: string
    country_of_residence?: string
    date_of_birth?: { month?: number; year?: number }
  }>
}

/** `SMITH, John Andrew` → `John Andrew Smith`. */
export function officerName(raw: string): string {
  const [last, first] = raw.split(',').map((s) => s.trim())
  return first ? `${titleCase(first)} ${titleCase(last)}` : titleCase(raw)
}

function addressLine(a: ChAddress | undefined): string | null {
  if (!a) return null
  const parts = [a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export function chOutput(ctx: Pick<ModuleContext, 'lang'>, p: ChProfile, officers: ChOfficers | null): ModuleOutput {
  const address = addressLine(p.registered_office_address)
  const role = (r: string): string => r.replace(/-/g, ' ')
  const properties: ModuleOutput['properties'] = {
    name: p.company_name,
    company_number: p.company_number,
    legal_form: p.type ?? null,
    status: p.company_status ?? null,
    created_at: p.date_of_creation ?? null,
    closed_at: p.date_of_cessation ?? null,
    activity: (p.sic_codes ?? []).join(', ') || null,
    address,
    insolvency_history: p.has_insolvency_history ?? null,
    url: `https://find-and-update.company-information.service.gov.uk/company/${p.company_number}`
  }
  const entities: OutEntity[] = []
  if (address) {
    const a = p.registered_office_address!
    entities.push({
      type: 'address',
      label: address,
      data: { street: [a.premises, a.address_line_1].filter(Boolean).join(' ') || null, postcode: a.postal_code ?? null, city: a.locality ?? null, country: a.country ?? null },
      linkLabel: tr(ctx, 'siège', 'registered office')
    })
  }
  for (const o of (officers?.items ?? []).slice(0, MAX_OFFICERS)) {
    const corporate = o.officer_role.startsWith('corporate')
    const dob = o.date_of_birth?.year ? `${o.date_of_birth.year}-${String(o.date_of_birth.month ?? 1).padStart(2, '0')}` : null
    entities.push({
      type: corporate ? 'company' : 'person',
      label: corporate ? o.name : officerName(o.name),
      data: corporate
        ? { appointed_on: o.appointed_on ?? null }
        : {
            birth_date: dob,
            nationality: o.nationality ?? null,
            occupation: o.occupation ?? null,
            country_of_residence: o.country_of_residence ?? null,
            appointed_on: o.appointed_on ?? null,
            resigned_on: o.resigned_on ?? null
          },
      linkLabel: o.resigned_on ? `${role(o.officer_role)} (${tr(ctx, 'ancien', 'former')})` : role(o.officer_role)
    })
  }
  return { properties, entities, raw: { profile: p, officers: officers?.items?.slice(0, MAX_OFFICERS) ?? [] } }
}

export default defineModule({
  id: 'company.companies_house',
  name: { fr: 'Société britannique (Companies House)', en: 'UK company (Companies House)' },
  description: {
    fr: 'Profil officiel d’une société du Royaume-Uni : numéro, statut, forme, dates, codes SIC, siège et dirigeants (actuels et anciens).',
    en: 'Official UK company profile: number, status, type, dates, SIC codes, registered office and officers (current and former).'
  },
  category: 'company',
  inputTypes: ['company'],
  keys: [{ id: 'companies_house', label: 'Companies House API key', url: 'https://developer.company-information.service.gov.uk/' }],
  homepage: 'https://find-and-update.company-information.service.gov.uk',
  experimental: true,
  async run(input, ctx) {
    const auth = { authorization: `Basic ${Buffer.from(`${ctx.key('companies_house') ?? ''}:`).toString('base64')}` }
    const label = input.label.trim()
    let number = typeof input.data.company_number === 'string' ? input.data.company_number : ''
    if (!number && /^([A-Z]{2}\d{6}|\d{8})$/i.test(label)) number = label.toUpperCase()
    if (!number) {
      const s = await getJson<ChSearch>(ctx, `${API}/search/companies`, 'Companies House', {
        query: { q: label, items_per_page: 10 },
        headers: auth,
        keyed: true
      })
      const hit = (s?.items ?? []).find((i) => normName(i.title) === normName(label))
      if (!hit) return {}
      number = hit.company_number
    }
    const profile = await getJson<ChProfile>(ctx, `${API}/company/${encodeURIComponent(number)}`, 'Companies House', { headers: auth, keyed: true })
    if (!profile) return {}
    const officers = await getJson<ChOfficers>(ctx, `${API}/company/${encodeURIComponent(number)}/officers`, 'Companies House', {
      query: { items_per_page: MAX_OFFICERS },
      headers: auth,
      keyed: true
    })
    return chOutput(ctx, profile, officers)
  }
})
