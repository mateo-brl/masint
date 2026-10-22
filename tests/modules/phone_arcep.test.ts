// Module phone.arcep : plan de numérotation de l'Arcep. Les fixtures sont des extraits des
// fichiers ouverts de l'Arcep (opérateurs, tranches), sans aucun numéro de particulier.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import type { FetchOptions } from '@shared/modules'
import arcep, {
  arcepDate,
  arcepNational,
  blockCandidates,
  carrierNode,
  fixEncoding,
  matchRange,
  numberType,
  parseCsv,
  resetArcepCache,
  toOperator,
  toRange,
  type ArcepRange
} from '../../src/main/modules/phone/arcep'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fx = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/phone', name), 'utf8')
const national = (n: string): string | null => arcepNational(parsePhoneNumberFromString(n, 'FR')!)

/** Contexte dont le réseau sert les fixtures : CSV encodés en Windows-1252 comme chez l'Arcep. */
function arcepContext(opts: { csv?: boolean } = {}): { ctx: ReturnType<typeof makeContext>; urls: string[] } {
  const urls: string[] = []
  const ctx = makeContext()
  ctx.fetch = async (url: string) => {
    urls.push(url)
    if (opts.csv === false) return new Response('indisponible', { status: 503 })
    const file = url.endsWith('MAJNUM.csv') ? 'arcep_majnum.csv' : 'arcep_operators.csv'
    return new Response(Buffer.from(fx(file), 'latin1'), { headers: { 'content-type': 'text/csv' } })
  }
  ctx.fetchJson = async <T>(url: string, init?: FetchOptions): Promise<T> => {
    urls.push(url)
    const file = String(init?.query?.CODE_OPERATEUR__exact ?? '') ? 'arcep_tabular_operator.json' : 'arcep_tabular_majnum.json'
    return JSON.parse(fx(file)) as T
  }
  return { ctx, urls }
}

beforeEach(() => resetArcepCache())

describe('phone.arcep (fonctions)', () => {
  it('ramène le numéro au plan national, outre-mer compris', () => {
    expect(national('+33612345678')).toBe('0612345678')
    expect(national('06 12 34 56 78')).toBe('0612345678')
    expect(national('+262692123456')).toBe('0692123456')
    expect(national('+508412345')).toBe('0508412345')
    expect(national('+14155552671')).toBeNull()
    expect(national('+447700900123')).toBeNull()
  })

  it('propose les blocs candidats et choisit la tranche qui contient le numéro', () => {
    expect(blockCandidates('0612345678')).toEqual(['0612', '06123', '061234', '0612345', '06123456', '061234567'])
    const ranges = parseCsv(fx('arcep_majnum.csv'))
      .map(toRange)
      .filter((r): r is ArcepRange => !!r)
    expect(matchRange('0612345678', ranges)?.code).toBe('SFR0')
    expect(matchRange('0151030123', ranges)?.block).toBe('0151030')
    expect(matchRange('0151031123', ranges)).toBeNull()
    // La longueur compte : un numéro long qui commence comme un numéro court n'y correspond pas.
    expect(matchRange('1011', ranges)?.code).toBe('FRMO')
    expect(matchRange('1011000000', ranges)).toBeNull()
  })

  it('lit les dates des CSV et ne garde que les dates sûres de l’API tabulaire', () => {
    expect(arcepDate('08/12/2011')).toBe('2011-12-08')
    expect(arcepDate('2011-01-13')).toBe('2011-01-13')
    expect(arcepDate('2017-01-01')).toBe('2017-01-01')
    // « 08/12/2011 » lu comme le 12 août par l'API tabulaire : date écartée.
    expect(arcepDate('2011-08-12')).toBeUndefined()
    expect(arcepDate('')).toBeUndefined()
  })

  it('corrige les accents mal décodés et lit la fiche opérateur', () => {
    expect(fixEncoding('Alliance Trčs Haut Débit')).toBe('Alliance Très Haut Débit')
    expect(fixEncoding('Aričge, systčmes, Dami Drôme Ardčche')).toBe('Ariège, systèmes, Dami Drôme Ardèche')
    const ops = parseCsv(fx('arcep_operators.csv')).map(toOperator)
    expect(ops.find((o) => o?.code === 'SFR0')).toEqual({
      code: 'SFR0',
      name: 'Société française du radiotéléphone',
      siren: '343059564',
      siret: '34305956400959',
      rcs: 'Paris',
      address: 'ALTICE CAMPUS 16 RUE GENERAL ALAIN DE BOISSIEU 75015 PARIS',
      declared: '2011-10-28'
    })
    expect(ops.find((o) => o?.code === 'AXTD')?.name).toBe('Alliance Très Haut Débit')
    expect(ops.find((o) => o?.code === 'SPMT')?.rcs).toBeUndefined()
  })

  it('donne le type de numéro', () => {
    expect(numberType('0612345678', 'fr')).toBe('Mobile')
    expect(numberType('0142928100', 'fr')).toBe('Fixe (géographique)')
    expect(numberType('0800840800', 'fr')).toBe('Numéro gratuit (080)')
    expect(numberType('0970000000', 'en')).toBe('Non-geographic landline (box, VoIP)')
    expect(numberType('07000040123456', 'fr')).toBe('Mobile (machine à machine)')
  })

  it("reprend le nœud opérateur de phone.info quand c'est le même opérateur", () => {
    // Libellés de libphonenumber, repris tels quels par phone.info.
    expect(carrierNode('SFR0', 'Société française du radiotéléphone', 'SFR')).toEqual({ label: 'SFR', platform: 'sfr' })
    expect(carrierNode('FRTE', 'Orange', 'Orange France')).toEqual({ label: 'Orange France', platform: 'orange' })
    expect(carrierNode('PRIX', 'Prixtel', 'Prixtel')).toEqual({ label: 'Prixtel', platform: 'prixtel' })
    expect(carrierNode('EITF', 'Euro-Information Telecom', 'Euroinformation Telecom')).toEqual({ label: 'Euroinformation Telecom', platform: undefined })
    // Pas d'opérateur libphonenumber (ligne fixe) : marque connue, sinon raison sociale.
    expect(carrierNode('SFR0', 'Société française du radiotéléphone', null)).toEqual({ label: 'SFR', platform: 'sfr' })
    expect(carrierNode('SPCV', 'Spacinov', null)).toEqual({ label: 'Spacinov', platform: undefined })
    // Opérateurs différents : deux nœuds distincts.
    expect(carrierNode('SPCV', 'Spacinov', 'Orange France')).toEqual({ label: 'Spacinov', platform: undefined })
  })
})

describe('phone.arcep (module)', () => {
  it('accepte les numéros du plan français seulement', () => {
    expect(arcep.accepts!(entity('phone', '+33612345678'))).toBe(true)
    expect(arcep.accepts!(entity('phone', '+262692123456'))).toBe(true)
    expect(arcep.accepts!(entity('phone', '+14155552671'))).toBe(false)
    expect(arcep.accepts!(entity('phone', '+33 6 12 34 56 *8'))).toBe(false)
    expect(arcep.ondemand).toBeFalsy()
    expect(arcep.keys).toBeUndefined()
  })

  it('renseigne le numéro et le nœud opérateur depuis les CSV, téléchargés une seule fois', async () => {
    const { ctx, urls } = arcepContext()
    const out = await runModule(arcep, entity('phone', '+33612345678'), ctx)
    expect(out.properties).toEqual({
      arcep_attributed: true,
      arcep_block: '0612',
      arcep_range: '0612000000 à 0612999999',
      arcep_operator: 'Société française du radiotéléphone',
      arcep_operator_code: 'SFR0',
      arcep_territory: 'Métropole',
      arcep_attribution_date: '2011-12-08',
      arcep_number_type: 'Mobile'
    })
    const carrier = out.entities?.find((e) => e.type === 'carrier')
    expect(carrier).toMatchObject({ label: 'SFR', platform: 'sfr', linkLabel: "opérateur d'attribution (ARCEP)" })
    expect(carrier?.data).toMatchObject({ siret: '34305956400959', siren: '343059564', registered_address: expect.stringContaining('75015 PARIS'), arcep_code: 'SFR0' })
    expect(out.found).toBeUndefined()

    // Deuxième numéro : rien n'est retéléchargé.
    const reunion = await runModule(arcep, entity('phone', '+262692001234'), ctx)
    expect(reunion.properties).toMatchObject({ arcep_territory: 'La Réunion', arcep_operator: 'Orange', arcep_block: '069200' })
    const spm = await runModule(arcep, entity('phone', '+508412345'), ctx)
    expect(spm.properties).toMatchObject({ arcep_territory: 'Saint Pierre et Miquelon', arcep_operator_code: 'SPMT' })
    expect(urls.filter((u) => u.endsWith('.csv'))).toHaveLength(2)
  })

  it('signale un numéro hors de toute tranche attribuée', async () => {
    const { ctx } = arcepContext()
    const out = await runModule(arcep, entity('phone', '+33639981234'), ctx)
    expect(out.properties).toEqual({ arcep_attributed: false, arcep_number_type: 'Mobile' })
    expect(out.entities).toBeUndefined()
  })

  it("se replie sur l'API tabulaire de data.gouv.fr si l'Arcep ne répond pas", async () => {
    const { ctx, urls } = arcepContext({ csv: false })
    const out = await runModule(arcep, entity('phone', '06 12 34 56 78'), ctx)
    expect(out.properties).toMatchObject({ arcep_operator: 'Société française du radiotéléphone', arcep_block: '0612' })
    // Date inversée par l'API tabulaire : écartée plutôt que fausse.
    expect(out.properties?.arcep_attribution_date).toBeUndefined()
    expect(out.entities?.[0].data).toMatchObject({ arcep_declaration_date: '2011-10-28', siret: '34305956400959' })
    expect(urls.some((u) => u.includes('tabular-api.data.gouv.fr'))).toBe(true)
  })
})

describe.skipIf(!LIVE)('phone.arcep (live)', () => {
  // Numéros publics : standard de l'Élysée, Sida Info Service, et la plage 06 39 98 réservée à la fiction.
  it('standard de la présidence (fixe, Orange)', async () => {
    resetArcepCache()
    const out = await runModule(arcep, entity('phone', '+33142928100'))
    expect(out.properties).toMatchObject({ arcep_attributed: true, arcep_block: '0142', arcep_operator_code: 'FRTE', arcep_number_type: 'Fixe (géographique)' })
    expect(out.entities?.[0]).toMatchObject({ type: 'carrier', label: 'Orange', platform: 'orange' })
    expect(out.entities?.[0].data?.siret).toMatch(/^380129866\d{5}$/)
  }, 120_000)

  it('numéro vert et numéro de fiction', async () => {
    const vert = await runModule(arcep, entity('phone', '0 800 840 800'))
    expect(vert.properties).toMatchObject({ arcep_attributed: true, arcep_number_type: 'Numéro gratuit (080)' })
    const fiction = await runModule(arcep, entity('phone', '+33639981234'))
    expect(fiction.properties?.arcep_attributed).toBe(false)
  }, 120_000)
})
