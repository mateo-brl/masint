// Module phone.sleeper : première étape de connexion de Sleeper. Fixtures : réponse « absent »
// observée sur la plage de fiction 06 39 98, et format « trouvé » observé sur un compte public
// (valeurs inventées).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FetchOptions } from '@shared/modules'
import sleeper, { interpretSleeper, sleeperAvatar } from '../../src/main/modules/phone/sleeper'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const fx = (name: string): string => readFileSync(resolve(__dirname, '../fixtures/phone', name), 'utf8')
const json = <T = any>(name: string): T => JSON.parse(fx(name)) as T

describe('phone.sleeper', () => {
  it('lit la réponse de la première étape de connexion', () => {
    expect(interpretSleeper(json('sleeper_notfound.json'))).toEqual({ found: false })
    const r = interpretSleeper(json('sleeper_found.json'))
    expect(r.found).toBe(true)
    expect(r.account).toMatchObject({ display_name: 'jdupont_ff', masked_email: 'j********t@gmail.com' })
    // Compte trouvé sans téléphone : l'identifiant ne pouvait pas être ce numéro.
    expect(interpretSleeper({ data: { login_context_by_email_or_phone_or_username: { user_id: '1', has_phone: false } } }).found).toBe(false)
    expect(() => interpretSleeper({ errors: [{ message: 'rate limited' }] })).toThrow(/inattendue/)
    expect(sleeperAvatar('0123456789abcdef0123456789abcdef')).toBe('https://sleepercdn.com/avatars/thumbs/0123456789abcdef0123456789abcdef')
    expect(sleeperAvatar('nfl_nyg')).toBeUndefined()
  })

  it('interroge en E.164 et remonte le compte et l’email masqué (fetch simulé)', async () => {
    const sent: unknown[] = []
    const ctx = {
      ...makeContext(),
      fetch: async (_url: string, init?: FetchOptions) => {
        sent.push(init?.json)
        return new Response(fx('sleeper_found.json'))
      }
    }
    const out = await runModule(sleeper, entity('phone', '06 12 34 56 78'), ctx)
    expect((sent[0] as { variables: Record<string, string> }).variables).toEqual({ email_or_phone_or_username: '+33612345678' })
    expect(out.found).toBe(true)
    const account = out.entities?.[0]
    expect(account).toMatchObject({ type: 'account', label: 'Sleeper : jdupont_ff', image: sleeperAvatar('0123456789abcdef0123456789abcdef') })
    expect(account?.data).toMatchObject({ username: 'jdupont_ff', user_id: '100000000000000001', masked_emails: ['j********t@gmail.com'], masked_phones: ['+33******78'] })
    expect(out.properties).toEqual({ masked_emails: ['j********t@gmail.com (Sleeper)'] })
    expect(sleeper.experimental).toBe(true)
  })

  it('compte absent : found à false, sans entité', async () => {
    const ctx = { ...makeContext(), fetch: async () => new Response(fx('sleeper_notfound.json')) }
    const out = await runModule(sleeper, entity('phone', '+33639981234'), ctx)
    expect(out).toMatchObject({ found: false })
    expect(out.entities).toBeUndefined()
  })
})

describe.skipIf(!LIVE)('phone.sleeper (live)', () => {
  it('numéros non attribués', async () => {
    // La plage de fiction 06 39 98 et un numéro d'exemple courant.
    expect((await runModule(sleeper, entity('phone', '+33639981234'))).found).toBe(false)
    expect((await runModule(sleeper, entity('phone', '+33612345678'))).found).toBe(false)
  })
})
