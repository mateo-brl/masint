// Entreprises finlandaises : système d'information YTJ de l'office des brevets et des
// enregistrements (PRH), données ouvertes CC BY 4.0, sans clé. Identité, noms successifs,
// adresse, activité, forme juridique et situation (liquidation, faillite). Pas de dirigeants.

import { defineModule, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { getJson, tr } from '../misc/_util'
import { acceptsCountry, candidatesOutput, euOutput, exactMatch, finnishBusinessId, numberFrom } from './_eu'

const API = 'https://avoindata.prh.fi/opendata-ytj-api/v3/companies'

interface Described {
  type?: string
  registrationDate?: string
  endDate?: string | null
  descriptions?: Array<{ languageCode: string; description: string }>
}

export interface PrhCompany {
  businessId: { value: string; registrationDate?: string }
  euId?: { value?: string }
  names?: Array<{ name: string; type: string; registrationDate?: string; endDate?: string | null }>
  mainBusinessLine?: Described
  website?: { url?: string }
  companyForms?: Described[]
  companySituations?: Described[]
  registeredEntries?: Array<Described & { register?: string }>
  addresses?: Array<{
    type: number
    street?: string
    buildingNumber?: string
    entrance?: string
    postCode?: string
    postOfficeBox?: string
    postOffices?: Array<{ city: string; languageCode: string }>
    endDate?: string | null
  }>
  tradeRegisterStatus?: string
  registrationDate?: string
  endDate?: string | null
}

export interface PrhResponse {
  totalResults?: number
  companies?: PrhCompany[]
}

/** Description en anglais (code 3), à défaut en finnois (code 1). */
function described(d: Described | undefined): string | null {
  const list = d?.descriptions ?? []
  return (list.find((x) => x.languageCode === '3') ?? list.find((x) => x.languageCode === '1'))?.description ?? null
}

const current = <T extends { endDate?: string | null }>(list: T[] | undefined): T[] => (list ?? []).filter((x) => !x.endDate)

/** Raison sociale en vigueur (type 1 sans date de fin). */
export const prhName = (c: PrhCompany): string | null => current(c.names).find((n) => n.type === '1')?.name ?? null

// Statut au registre du commerce (code REK_KDI de PRH).
const TRADE_STATUS: Record<string, [string, string]> = {
  '0': ['non inscrite', 'unregistered'],
  '1': ['inscrite', 'registered'],
  '2': ['radiée', 'removed from the register'],
  '3': ['en création, non inscrite', 'start-up, not registered'],
  '4': ['cessée', 'ceased']
}

function addressOf(c: PrhCompany): { label: string; street: string | null; postcode: string | null; city: string | null } | null {
  const list = current(c.addresses)
  // Adresse de visite (1), à défaut adresse postale (2).
  const a = list.find((x) => x.type === 1) ?? list.find((x) => x.type === 2)
  if (!a) return null
  const city = (a.postOffices?.find((p) => p.languageCode === '1') ?? a.postOffices?.[0])?.city ?? null
  const street = [a.street, a.buildingNumber, a.entrance].filter(Boolean).join(' ') || (a.postOfficeBox ? `PL ${a.postOfficeBox}` : null)
  const label = [street, [a.postCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return label ? { label, street, postcode: a.postCode ?? null, city } : null
}

export function prhOutput(ctx: Pick<ModuleContext, 'lang'>, c: PrhCompany): ModuleOutput {
  const id = c.businessId.value
  const names = c.names ?? []
  const form = current(c.companyForms)[0]
  const vat = (c.registeredEntries ?? []).some((e) => e.register === '6' && e.type === '80' && !e.endDate)
  const situations = current(c.companySituations).map(described).filter((s): s is string => !!s)
  const trade = c.tradeRegisterStatus ? TRADE_STATUS[c.tradeRegisterStatus]?.[ctx.lang === 'fr' ? 0 : 1] : null
  return euOutput(ctx, {
    country: 'FI',
    name: prhName(c) ?? names[0]?.name ?? id,
    number: id,
    properties: {
      euid: c.euId?.value ?? null,
      legal_form: described(form),
      status: [trade, ...situations].filter(Boolean).join(', ') || null,
      registration_date: c.registrationDate ?? null,
      closed_at: c.endDate ?? null,
      activity: c.mainBusinessLine ? [c.mainBusinessLine.type, described(c.mainBusinessLine)].filter(Boolean).join(' ') : null,
      previous_names: names
        .filter((n) => n.type === '1' && n.endDate)
        .map((n) => `${n.name} (${tr(ctx, "jusqu'en", 'until')} ${n.endDate!.slice(0, 4)})`),
      other_names: current(names)
        .filter((n) => n.type !== '1')
        .map((n) => n.name),
      vat: vat ? `FI${id.replace('-', '')}` : null,
      registry_url: `https://tietopalvelu.ytj.fi/yritys/${id}`
    },
    address: addressOf(c),
    website: c.website?.url ?? null,
    raw: c
  })
}

export default defineModule({
  id: 'company.prh',
  name: { fr: 'Entreprise finlandaise (PRH / YTJ)', en: 'Finnish company (PRH / YTJ)' },
  description: {
    fr: "Registre finlandais des entreprises (PRH, données ouvertes CC BY 4.0) : Y-tunnus, EUID, forme, statut et procédures en cours, date d'immatriculation, noms successifs et auxiliaires, adresse, activité et site web. Par numéro ou par nom.",
    en: 'Finnish trade register (PRH, CC BY 4.0 open data): business ID, EUID, form, status and ongoing proceedings, registration date, former and auxiliary names, address, activity and website. By number or by name.'
  },
  category: 'company',
  inputTypes: ['company'],
  homepage: 'https://tietopalvelu.ytj.fi',
  accepts: (input) => acceptsCountry(input, 'FI', finnishBusinessId),
  async run(input, ctx) {
    const id = numberFrom(input, finnishBusinessId)
    if (id) {
      const r = await getJson<PrhResponse>(ctx, API, 'PRH', { query: { businessId: id } })
      const c = r?.companies?.find((x) => x.businessId.value === id)
      return c ? prhOutput(ctx, c) : {}
    }
    const name = input.label.trim()
    if (name.length < 2) return {}
    const r = await getJson<PrhResponse>(ctx, API, 'PRH', { query: { name }, timeoutMs: 45000 })
    const list = r?.companies ?? []
    const hit = exactMatch(list, name, (c) => current(c.names).map((n) => n.name))
    if (hit) return prhOutput(ctx, hit)
    return candidatesOutput(
      ctx,
      'FI',
      list
        .filter((c) => prhName(c) && c.tradeRegisterStatus !== '4' && c.tradeRegisterStatus !== '2')
        .map((c) => ({ name: prhName(c)!, number: c.businessId.value, address: addressOf(c)?.label ?? null, created: c.registrationDate ?? null })),
      tr(ctx, 'finlandais', 'Finnish')
    )
  }
})
