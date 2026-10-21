// BIC et nom de la banque via openiban.com (gratuit, sans clé). Le service ne connaît
// les banques que pour l'Allemagne, les Pays-Bas, la Belgique, le Luxembourg, l'Autriche,
// la Suisse et le Liechtenstein.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { getJson, tr } from '../misc/_util'
import { normalizeIban } from './_iban'
import { countryName } from './iban'

const COUNTRIES = ['DE', 'NL', 'BE', 'LU', 'AT', 'CH', 'LI']

export interface OpenIbanResponse {
  valid: boolean
  messages?: string[]
  iban: string
  bankData?: { bankCode?: string; name?: string; zip?: string; city?: string; bic?: string }
  checkResults?: { bankCode?: boolean }
}

export function parseOpenIban(ctx: Pick<ModuleContext, 'lang'>, d: OpenIbanResponse): ModuleOutput {
  const b = d.bankData ?? {}
  const country = countryName(d.iban.slice(0, 2), ctx.lang)
  const properties: ModuleOutput['properties'] = { bank_code_valid: d.checkResults?.bankCode ?? null }
  const entities: OutEntity[] = []
  if (b.name) {
    properties.bank = b.name
    if (b.bic) properties.bic = b.bic
    if (b.bankCode) properties.bank_code = b.bankCode
    entities.push({
      type: 'bank',
      label: b.name,
      data: { bic: b.bic ?? null, city: b.city ?? null, postcode: b.zip ?? null, country, bank_code: b.bankCode ?? null },
      linkLabel: tr(ctx, 'banque', 'bank')
    })
  }
  return { properties, entities, raw: d }
}

export default defineModule({
  id: 'finance.openiban',
  name: { fr: 'Banque et BIC (OpenIBAN)', en: 'Bank and BIC (OpenIBAN)' },
  description: {
    fr: "Nom de la banque, ville et BIC d'un IBAN allemand, néerlandais, belge, luxembourgeois, autrichien, suisse ou liechtensteinois, avec contrôle du code banque.",
    en: 'Bank name, city and BIC of a German, Dutch, Belgian, Luxembourg, Austrian, Swiss or Liechtenstein IBAN, with bank code check.'
  },
  category: 'finance',
  inputTypes: ['iban'],
  homepage: 'https://openiban.com',
  accepts: (input) => COUNTRIES.includes(normalizeIban(input.label).slice(0, 2)),
  async run(input, ctx) {
    const iban = normalizeIban(input.label)
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) throw new ModuleError('IBAN non reconnu', 'invalid_input')
    const d = await getJson<OpenIbanResponse>(ctx, `https://openiban.com/validate/${iban}`, 'OpenIBAN', {
      query: { getBIC: 'true', validateBankCode: 'true' }
    })
    if (!d) return {}
    return parseOpenIban(ctx, d)
  }
})
