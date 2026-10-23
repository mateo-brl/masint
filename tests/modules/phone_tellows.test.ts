// phone.tellows et la lecture de la fiche par la recherche assistée. Fiches fictives : la
// structure réelle de la page n'a pas pu être observée (Cloudflare), le module est expérimental.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { ModuleError } from '@shared/modules'
import tellows from '../../src/main/modules/phone/tellows'
import { phoneManualChecks } from '../../src/main/modules/phone/links'
import { isCloudflareChallenge, parseTellows, tellowsExtract, tellowsOutput, tellowsUrl } from '../../src/main/modules/phone/_tellows'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fx = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/phone', name), 'utf8')
const phone = parsePhoneNumberFromString('+33639981234')!

/** Contexte qui renvoie une page fixe et note les adresses demandées. */
function pageContext(body: string, status = 200) {
  const requested: string[] = []
  const ctx = { ...makeContext(), fetch: async (url: string) => (requested.push(url), new Response(body, { status })) }
  return { ctx, requested }
}

describe('phone.tellows', () => {
  it('adresse de la fiche selon le pays', () => {
    expect(tellowsUrl(phone)).toBe('https://www.tellows.fr/num/0639981234')
    expect(tellowsUrl(parsePhoneNumberFromString('+4930123456789')!)).toBe('https://www.tellows.de/num/030123456789')
    expect(tellowsUrl(parsePhoneNumberFromString('+442079460000')!)).toBe('https://www.tellows.co.uk/num/02079460000')
    expect(tellowsUrl(parsePhoneNumberFromString('+14155552671')!)).toBeNull()
    expect(tellows.accepts!(entity('phone', '+14155552671'))).toBe(false)
    expect(tellows.accepts!(entity('phone', '06 39 98 12 34'))).toBe(true)
  })

  it('lit le score, les recherches, les commentaires, les types d’appel et les noms', () => {
    const page = parseTellows(fx('tellows_fiche.html'), phone)
    expect(page).toEqual({
      score: 7,
      searches: 1234,
      comments: 4,
      callTypes: ['Démarchage téléphonique', 'Arnaque'],
      callerNames: ['Camille Exemple', 'QW778', 'Spam', 'Maman']
    })
  })

  it('noms d’appelant classés : personne et pseudo à vérifier, étiquettes en propriétés', () => {
    const out = tellowsOutput(parseTellows(fx('tellows_fiche.html'), phone)!, 'https://www.tellows.fr/num/0639981234', 'fr')
    expect(out.properties).toMatchObject({
      tellows_score: 7,
      tellows_searches: 1234,
      tellows_comments: 4,
      tellows_call_types: ['Démarchage téléphonique', 'Arnaque'],
      tellows_url: 'https://www.tellows.fr/num/0639981234',
      caller_names: ['Camille Exemple (Tellows)', 'QW778 (Tellows)'],
      caller_tags: ['Spam (Tellows)', 'Maman (Tellows)']
    })
    expect(out.entities).toEqual([
      expect.objectContaining({ type: 'person', label: 'Camille Exemple', review: true, reviewReason: 'nom donné au numéro dans Tellows' }),
      expect.objectContaining({ type: 'username', label: 'QW778', review: true })
    ])
  })

  it('ne garde pas la fiche d’un autre numéro', () => {
    expect(parseTellows(fx('tellows_autre_numero.html'), phone)).toBeNull()
  })

  it('module : fiche lue, entités à vérifier', async () => {
    const { ctx, requested } = pageContext(fx('tellows_fiche.html'))
    const out = await runModule(tellows, entity('phone', '06 39 98 12 34'), ctx)
    expect(requested).toEqual(['https://www.tellows.fr/num/0639981234'])
    expect(out.properties?.tellows_score).toBe(7)
    expect(out.entities?.every((e) => e.review)).toBe(true)
  })

  it('module : fiche d’un autre numéro, rien n’est gardé', async () => {
    const { ctx } = pageContext(fx('tellows_autre_numero.html'))
    const out = await runModule(tellows, entity('phone', '06 39 98 12 34'), ctx)
    expect(out.properties).toBeUndefined()
    expect(out.entities).toBeUndefined()
  })

  it('module : vérification Cloudflare, erreur « blocked » claire', async () => {
    expect(isCloudflareChallenge(403, fx('tellows_cloudflare.html'))).toBe(true)
    expect(isCloudflareChallenge(200, fx('tellows_fiche.html'))).toBe(false)
    const { ctx } = pageContext(fx('tellows_cloudflare.html'), 403)
    const err = await runModule(tellows, entity('phone', '06 39 98 12 34'), ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ModuleError)
    expect((err as ModuleError).code).toBe('blocked')
    expect((err as ModuleError).message).toMatch(/Cloudflare.*recherche assistée « Tellows »/)
  })

  it('la recherche manuelle Tellows reste proposée, lue par la recherche assistée', () => {
    const check = phoneManualChecks(phone, 'fr').find((c) => c.label === 'Tellows')
    expect(check).toMatchObject({ url: 'https://www.tellows.fr/num/0639981234', flow: 'tellows' })
    expect(phoneManualChecks(parsePhoneNumberFromString('+4930123456789')!, 'fr').find((c) => c.label === 'Tellows')?.url).toBe('https://www.tellows.de/num/030123456789')
  })

  it('recherche assistée : fiche lue pour « À vérifier », autre numéro signalé', () => {
    const ex = tellowsExtract(fx('tellows_fiche.html'), phone, 'https://www.tellows.fr/num/0639981234', 'fr')
    expect(ex).toMatchObject({ state: 'profile', names: ['Camille Exemple'], usernames: ['QW778'] })
    expect(ex.properties).toMatchObject({ tellows_score: 7, caller_tags: ['Spam (Tellows)', 'Maman (Tellows)'] })
    const other = tellowsExtract(fx('tellows_autre_numero.html'), phone, 'https://www.tellows.fr/num/0639981234', 'fr')
    expect(other).toMatchObject({ state: 'unknown', names: [], note: 'La page ne montre pas la fiche de ce numéro.' })
    expect(other.properties).toBeUndefined()
  })
})

describe.skipIf(!LIVE)('phone.tellows (live)', () => {
  it('lit la fiche ou signale clairement le blocage Cloudflare', async () => {
    const out = await runModule(tellows, entity('phone', '+33899000000')).catch((e: unknown) => e)
    if (out instanceof ModuleError) expect(out.code).toBe('blocked')
    else expect(out).toBeTruthy()
  })
})
