// Analyse d'un IBAN : validation locale, pays, codes banque et guichet, et banque
// (France, Monaco, Espagne) via la table embarquée issue de la liste BCE. Hors ligne.
// Pour l'Allemagne, le Benelux, l'Autriche, la Suisse et le Liechtenstein, voir `finance.openiban`.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, tr } from '../misc/_util'
import { analyzeIban, localBank } from './_iban'

export function countryName(code: string, lang: 'fr' | 'en'): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export function ibanOutput(ctx: Pick<ModuleContext, 'lang'>, raw: string): ModuleOutput {
  const info = analyzeIban(raw)
  if (!/^[A-Z]{2}\d{2}/.test(info.iban)) throw new ModuleError('IBAN non reconnu', 'invalid_input')
  const country = countryName(info.country, ctx.lang)
  const bank = info.valid ? localBank(info.country, info.bankCode) : null
  const properties: ModuleOutput['properties'] = {
    valid: info.valid,
    iban_formatted: info.formatted,
    country,
    country_code: info.country,
    bank_code: info.bankCode,
    branch_code: info.branchCode,
    sepa: info.sepa
  }
  if (info.lengthOk === false) properties.invalid_reason = tr(ctx, 'longueur incorrecte pour ce pays', 'wrong length for this country')
  else if (!info.valid) properties.invalid_reason = tr(ctx, 'clé de contrôle incorrecte', 'wrong check digits')
  const entities: OutEntity[] = []
  if (bank) {
    properties.bank = bank.name
    if (bank.bic) properties.bic = bank.bic
    entities.push({
      type: 'bank',
      label: bank.name,
      data: { bic: bank.bic, city: bank.city, country, bank_code: info.bankCode },
      linkLabel: tr(ctx, 'banque', 'bank')
    })
  }
  return { properties: compact(properties!), entities, raw: info }
}

export default defineModule({
  id: 'finance.iban',
  name: { fr: "Analyse de l'IBAN", en: 'IBAN analysis' },
  description: {
    fr: "Vérifie la clé et la longueur de l'IBAN, extrait le pays, le code banque et le code guichet, et identifie la banque pour la France, Monaco et l'Espagne (liste officielle BCE embarquée, néobanques et établissements de paiement du registre REGAFI) ainsi que les néobanques allemandes (N26, Revolut, Qonto). Hors ligne.",
    en: 'Checks the IBAN check digits and length, extracts country, bank and branch codes, and identifies the bank for France, Monaco and Spain (embedded official ECB list, neobanks and payment institutions from the REGAFI register) and German neobanks (N26, Revolut, Qonto). Offline.'
  },
  category: 'finance',
  inputTypes: ['iban'],
  async run(input, ctx) {
    return ibanOutput(ctx, input.label)
  }
})
