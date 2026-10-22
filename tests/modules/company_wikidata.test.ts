import { describe, expect, it, type TestContext } from 'vitest'
import { ModuleError, type ModuleOutput } from '@shared/modules'
import wikidataOrg, { organizationOutput, pickOrganization } from '../../src/main/modules/company/wikidata'
import { isOrganization, type EntitiesResponse, type Resolved } from '../../src/main/modules/person/_wikidata'
import { entity, LIVE, runModule } from '../helpers/context'
import { fakeContext, fixtureJson, type Route } from './social_helpers'

const danone = (): EntitiesResponse => fixtureJson('company/wikidata_danone_entity.json')
const labels = (): { results: { bindings: Array<Record<string, { value: string }>> } } => fixtureJson('company/wikidata_sparql_labels_danone.json')
const names = (): Map<string, Resolved> =>
  new Map(
    labels().results.bindings.map((b) => {
      const m = b.coord?.value.match(/Point\((\S+) (\S+)\)/)
      return [b.item.value.split('/').pop()!, { label: b.itemLabel.value, ...(m ? { lon: Number(m[1]), lat: Number(m[2]) } : {}) }]
    })
  )

async function liveRun(t: TestContext, run: () => Promise<ModuleOutput>): Promise<ModuleOutput | null> {
  try {
    return await run()
  } catch (e) {
    const status = (e as { status?: number }).status
    if ((e instanceof ModuleError && ['rate_limited', 'unavailable', 'blocked'].includes(e.code)) || /fetch failed/i.test(String((e as Error)?.message)) || (status && status >= 500)) {
      t.skip()
      return null
    }
    throw e
  }
}

describe('company.wikidata', () => {
  it('reconnaît une organisation et construit la fiche', () => {
    const o = danone().entities!.Q329426
    expect(isOrganization(o)).toBe(true)
    const out = organizationOutput('fr', o, names(), 'company')
    expect(out.properties).toMatchObject({ wikidata_id: 'Q329426', lei: '969500KMUQ2B6CBAF162', siren: '552032534', created_at: '1919', employees: 98105 })
    // Plus de 10 filiales : 10 reliées, la liste complète dans la fiche.
    expect(Number(out.properties?.subsidiaries_count)).toBeGreaterThan(10)
    const by = (type: string, link?: string) => out.entities!.filter((e) => e.type === type && (!link || e.linkLabel === link))
    expect(by('company', 'filiale')).toHaveLength(10)
    expect(by('company', 'filiale').every((e) => /^Q\d+$/.test(String(e.data?.wikidata_id)))).toBe(true)
    expect(by('website')[0].label).toBe('https://www.danone.com/')
    expect(by('city', 'siège')[0]).toMatchObject({ label: 'Paris' })
    expect(by('city', 'siège')[0].data?.lat).toBeCloseTo(48.86, 1)
    expect(by('vat')[0].label).toBe('FR27552032534')
    expect(Object.fromEntries(by('account').map((e) => [e.platform, e.data?.url]))).toMatchObject({
      linkedin: 'https://www.linkedin.com/company/danone',
      youtube: 'https://www.youtube.com/channel/UCiMLbvE_0sP98wNLEHHoEdw'
    })
    // Filiales homonymes de l'organisation (Danone France, Danone Maroc...) : nœuds distincts.
    const list = out.properties?.subsidiaries as string[]
    expect(list.filter((l) => /^Danone \(Q\d+\)$/.test(l)).length).toBeGreaterThanOrEqual(2)
    expect(new Set(list).size).toBe(list.length)
    expect(list).not.toContain('Danone')
    // Organisation saisie comme `organization` : maison mère et filiales du même type.
    expect(organizationOutput('en', o, names(), 'organization').entities!.some((e) => e.type === 'organization' && e.linkLabel === 'subsidiary')).toBe(true)
  })

  it('signale les homonymes', () => {
    expect(pickOrganization('Danone', [{ id: 'Q1', label: 'Danone', organization: true }, { id: 'Q2', label: 'Danone Nations Cup', organization: false }], 'fr')).toEqual({ id: 'Q1' })
    const amb = pickOrganization('Danone', [{ id: 'Q1', label: 'Danone', organization: true }, { id: 'Q2', label: 'Danone', organization: true }], 'fr')
    expect(amb?.reviewReason).toMatch(/2 organisations/)
  })

  it('retrouve l’élément par le SIREN de la fiche, sans recherche par nom', async () => {
    const routes: Route[] = [
      [/query\.wikidata\.org\/sparql.*P1616/, { body: { results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q329426' } }] } } }],
      [/www\.wikidata\.org\/w\/api\.php/, { status: 429, body: 'quota' }],
      [/Special:EntityData\/Q329426\.json$/, { body: danone() }],
      [/query\.wikidata\.org\/sparql.*VALUES/, { body: labels() }]
    ]
    const ctx = fakeContext(routes)
    const out = await runModule(wikidataOrg, entity('company', 'DANONE', { data: { siren: '552 032 534' } }), ctx)
    expect(out.properties?.wikidata_id).toBe('Q329426')
    expect(out.entities!.some((e) => e.review)).toBe(false)
    expect(ctx.calls.some((c) => c.url.includes('EntitySearch') || c.url.includes('wbsearchentities'))).toBe(false)
  })

  it('recherche par nom : homonymes en attente de vérification', async () => {
    const routes: Route[] = [
      [/www\.wikidata\.org\/w\/api\.php/, { status: 429, body: 'quota' }],
      [/query\.wikidata\.org\/sparql.*EntitySearch/, { body: fixtureJson('company/wikidata_sparql_search_danone.json') }],
      [/Special:EntityData\/Q329426\.json$/, { body: danone() }],
      [/query\.wikidata\.org\/sparql.*VALUES/, { body: labels() }]
    ]
    const out = await runModule(wikidataOrg, entity('organization', 'Danone'), fakeContext(routes))
    expect(out.properties?.wikidata_id).toBe('Q329426')
    expect(out.entities!.every((e) => e.review && /homonyme possible/.test(e.reviewReason ?? ''))).toBe(true)
  })
})

describe.skipIf(!LIVE)('company.wikidata (live)', () => {
  it('Danone par son SIREN', async (t) => {
    const out = await liveRun(t, () => runModule(wikidataOrg, entity('company', 'DANONE', { data: { siren: '552032534' } })))
    if (!out) return
    expect(out.properties).toMatchObject({ wikidata_id: 'Q329426', lei: '969500KMUQ2B6CBAF162' })
    expect(out.entities?.some((e) => e.linkLabel === 'filiale')).toBe(true)
  })

  it('Danone par son nom', async (t) => {
    const out = await liveRun(t, () => runModule(wikidataOrg, entity('organization', 'Danone')))
    if (!out) return
    expect(out.properties?.wikidata_id).toBe('Q329426')
  })
})
