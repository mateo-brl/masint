import { describe, expect, it } from 'vitest'
import wikidata, { isHuman, wikidataDate, type WdEntity } from '../../src/main/modules/person/wikidata'
import { entity, LIVE, runModule } from '../helpers/context'

describe('person.wikidata', () => {
  it('convertit les dates Wikidata', () => {
    expect(wikidataDate({ time: '+1867-11-07T00:00:00Z' })).toBe('1867-11-07')
    expect(wikidataDate({ time: '+1900-00-00T00:00:00Z' })).toBe('1900')
    expect(wikidataDate(undefined)).toBeNull()
  })

  it('reconnaît un être humain', () => {
    const e: WdEntity = { id: 'Q1', claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }] } }
    expect(isHuman(e)).toBe(true)
    expect(isHuman({ id: 'Q2' })).toBe(false)
  })
})

describe.skipIf(!LIVE)('person.wikidata (live)', () => {
  it('trouve Marie Curie', async () => {
    const out = await runModule(wikidata, entity('person', 'Marie Curie'))
    expect(out.properties?.wikidata_id).toBe('Q7186')
    expect(out.properties?.death_date).toBe('1934-07-04')
  })
})
