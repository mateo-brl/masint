import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeIban, localBank } from '../../src/main/modules/finance/_iban'
import iban from '../../src/main/modules/finance/iban'
import openiban, { parseOpenIban } from '../../src/main/modules/finance/openiban'
import { entity, LIVE, runModule } from '../helpers/context'

const json = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/finance', name), 'utf8'))

describe('finance.iban (hors ligne)', () => {
  it('découpe un IBAN français et identifie la banque', async () => {
    const out = await runModule(iban, entity('iban', 'FR14 2004 1010 0505 0001 3M02 606'))
    expect(out.properties).toMatchObject({
      valid: true,
      country: 'France',
      country_code: 'FR',
      bank_code: '20041',
      branch_code: '01005',
      bank: 'La Banque Postale',
      bic: 'PSSTFRPPXXX',
      sepa: true,
      iban_formatted: 'FR14 2004 1010 0505 0001 3M02 606'
    })
    expect(out.entities?.[0]).toMatchObject({ type: 'bank', label: 'La Banque Postale' })
  })

  it('reconnaît les banques espagnoles et monégasques', () => {
    const es = analyzeIban('ES9121000418450200051332')
    expect(es.bankCode).toBe('2100')
    expect(localBank('ES', es.bankCode)?.name).toBe('Caixabank, S.A.')
    expect(localBank('FR', '30004')?.name).toBe('BNP Paribas')
    expect(localBank('MC', '30003')?.bic).toBe('SOGEFRPPXXX')
  })

  it('signale une clé ou une longueur incorrecte', async () => {
    const bad = await runModule(iban, entity('iban', 'FR1420041010050500013M02607'))
    expect(bad.properties?.valid).toBe(false)
    expect(bad.entities).toHaveLength(0)
    expect(analyzeIban('DE8937040044053201300').lengthOk).toBe(false)
  })

  it('OpenIBAN : banque allemande', () => {
    const out = parseOpenIban({ lang: 'fr' }, json('openiban_de.json'))
    expect(out.properties).toMatchObject({ bank: 'Commerzbank', bic: 'COBADEFFXXX', bank_code_valid: true })
    expect(out.entities?.[0]).toMatchObject({ type: 'bank', label: 'Commerzbank' })
    expect(out.entities?.[0].data?.city).toBe('Köln')
    expect(openiban.accepts!(entity('iban', 'DE89370400440532013000'))).toBe(true)
    expect(openiban.accepts!(entity('iban', 'FR1420041010050500013M02606'))).toBe(false)
  })
})

describe.skipIf(!LIVE)('finance : services réels', () => {
  it('openiban.com', async () => {
    const out = await runModule(openiban, entity('iban', 'NL91ABNA0417164300'))
    expect(out.properties?.bic).toBe('ABNANL2A')
  })
})
