// Tests live roso.info avec la clé de l'utilisateur. Ignorés sans ROSO_KEY.
//   ROSO_KEY=roso_… npx vitest run tests/modules/rosoLive
// Le test qui consomme un crédit (IBAN) demande en plus ROSO_LIVE_SPEND=1.

import { describe, expect, it } from 'vitest'
import { makeContext, entity } from '../helpers/context'
import { RosoClient } from '../../src/main/modules/roso/_client'
import rosoIban from '../../src/main/modules/roso/iban'

const KEY = process.env.ROSO_KEY

describe.skipIf(!KEY)('roso.info (live)', () => {
  const ctx = (): ReturnType<typeof makeContext> => makeContext({ keys: { roso: KEY ?? '' } })

  it('valide la clé et lit les crédits (gratuit)', async () => {
    const st = await new RosoClient(ctx(), 'auth').status()
    expect(st.success).toBe(true)
    console.log('[roso live] niveau', st.tier, '· crédits', st.credits ?? st.credits_remaining)
  })

  it('lit la maintenance (gratuit)', async () => {
    await new RosoClient(ctx(), 'email').checkMaintenance('email')
  })

  it.skipIf(!process.env.ROSO_LIVE_SPEND)('vérifie un IBAN (1 crédit)', async () => {
    const out = await rosoIban.run(entity('iban', 'FR7630006000011234567890189'), ctx())
    console.log('[roso live] IBAN', JSON.stringify(out.raw).slice(0, 2000))
    expect(out.properties?.valid).toBe(true)
  }, 60000)
})
