// Néobanques et établissements de paiement : codes interbancaires du registre REGAFI (ACPR)
// et codes banque de la Bundesbank. IBAN de test fictifs (clé RIB et clé IBAN valides).

import { describe, expect, it } from 'vitest'
import { localBank } from '../../src/main/modules/finance/_iban'
import iban from '../../src/main/modules/finance/iban'
import { entity, runModule } from '../helpers/context'

describe('finance.iban : néobanques', () => {
  it.each([
    ['16598', 'Financière des paiements électroniques (Nickel)', 'FPELFR21XXX'],
    ['16798', 'Treezor', 'TRZOFR21XXX'],
    ['16958', 'Qonto', 'QNTOFRP1XXX'],
    ['17328', 'Swan', 'SWNBFR22XXX'],
    ['17418', 'Shine', 'SNNNFR22XXX'],
    ['17598', 'Lydia Solutions (Lydia, Sumeria)', 'LYDIFRP2XXX']
  ])('code %s', (code, name, bic) => {
    expect(localBank('FR', code)).toEqual({ name, bic, city: expect.any(String) })
  })

  it('les banques déjà connues par la liste BCE ne changent pas', () => {
    expect(localBank('FR', '40618')?.name).toBe('Boursorama')
    expect(localBank('FR', '28233')?.name).toBe('REVOLUT BANK UAB')
    expect(localBank('FR', '20433')?.name).toBe('N26 BANK SE')
    expect(localBank('FR', '30004')?.name).toBe('BNP Paribas')
  })

  it('IBAN Nickel et IBAN allemand N26', async () => {
    const nickel = await runModule(iban, entity('iban', 'FR76 1659 8000 0100 0000 0000 170'))
    expect(nickel.properties).toMatchObject({ valid: true, bank_code: '16598', bank: 'Financière des paiements électroniques (Nickel)', bic: 'FPELFR21XXX' })
    expect(nickel.entities?.[0]).toMatchObject({ type: 'bank', label: 'Financière des paiements électroniques (Nickel)' })
    const qonto = await runModule(iban, entity('iban', 'FR7616958000010000000000140'))
    expect(qonto.properties?.bank).toBe('Qonto')
    const n26 = await runModule(iban, entity('iban', 'DE92100110010000000001'))
    expect(n26.properties).toMatchObject({ valid: true, bank_code: '10011001', bank: 'N26 Bank', bic: 'NTSBDEB1XXX' })
  })
})
