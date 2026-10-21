// roso.info : vérification d'un IBAN (page /iban/ : POST /api/gateway/iban/check,
// 1 crédit par vérification).

import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { isValidIban } from '@shared/detect'
import { localizeCountry } from '../domain/_util'
import { creditsOf, redact, ROSO_COMMON, RosoClient } from './_client'
import { asArr, asObj, dropEmpty, pick, str, type Obj } from './_parse'

const PAGE = '/iban/'

export function ibanEntities(r: Obj, lang: 'fr' | 'en'): OutEntity[] {
  const out: OutEntity[] = []
  const bank = pick(r, 'bank', 'bank_name')
  if (bank) {
    out.push({
      ref: 'bank',
      type: 'bank',
      label: bank,
      data: dropEmpty({
        bic: pick(r, 'bic', 'swift') || undefined,
        city: pick(r, 'city', 'bank_city') || undefined,
        branch: [pick(r, 'branch_number'), pick(r, 'branch_name')].filter(Boolean).join(' · ') || undefined,
        source: 'roso.info'
      }),
      linkLabel: lang === 'fr' ? 'banque' : 'bank'
    })
    const address = pick(r, 'address', 'bank_address')
    if (address) out.push({ type: 'address', label: address, from: 'bank', data: { source: 'roso.info' }, linkLabel: lang === 'fr' ? 'adresse de l’agence' : 'branch address' })
  }
  const country = localizeCountry(pick(r, 'country', 'country_name'), pick(r, 'country_code') || str(r.iban).slice(0, 2), lang)
  if (country) out.push({ type: 'country', label: country, linkLabel: lang === 'fr' ? 'pays' : 'country' })
  return out
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.iban',
  name: { fr: 'roso.info : IBAN', en: 'roso.info: IBAN' },
  description: {
    fr: 'Vérification roso.info d’un IBAN : validité, banque, BIC, agence, adresse et services SEPA. 1 crédit roso.info.',
    en: 'roso.info IBAN check: validity, bank, BIC, branch, address and SEPA services. 1 roso.info credit.'
  },
  inputTypes: ['iban'],
  timeoutMs: 120_000,
  async run(input, ctx) {
    const iban = input.label.replace(/\s+/g, '').toUpperCase()
    if (!isValidIban(iban)) throw new ModuleError('IBAN invalide (clé de contrôle)', 'invalid_input')
    const c = new RosoClient(ctx, 'iban')
    await c.checkMaintenance('iban')

    const res = await c.launch('/api/gateway/iban/check', { iban }, { page: PAGE })
    const r = asObj(res.result ?? res)
    if (r.ok === false) throw new ModuleError(`roso.info : ${pick(r, 'detail', 'error') || 'vérification impossible'}`, 'other')
    const sepa = asObj(r.sepa)
    const sepaList = Object.entries(sepa)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
    return {
      properties: dropEmpty({
        valid: typeof r.valid === 'boolean' ? r.valid : undefined,
        bic: pick(r, 'bic', 'swift') || undefined,
        bank: pick(r, 'bank', 'bank_name') || undefined,
        country: localizeCountry(pick(r, 'country', 'country_name'), pick(r, 'country_code') || iban.slice(0, 2), ctx.lang) || undefined,
        branch: [pick(r, 'branch_number'), pick(r, 'branch_name')].filter(Boolean).join(' · ') || undefined,
        sepa: sepaList.length ? sepaList : undefined,
        checks: asArr(r.checks)
          .map((x) => asObj(x))
          .map((x) => `${x.ok ? 'OK' : 'KO'}${str(x.text) ? ` · ${str(x.text)}` : ''}`),
        data_valid_as_of: pick(r, 'data_valid_as_of') || undefined,
        roso_credits_left: creditsOf(res)
      }),
      entities: ibanEntities(r, ctx.lang),
      raw: redact(res, c.key)
    }
  }
})
