// Historique des pseudos et identifiants stables : X (memory.lol), Bluesky (plc.directory),
// Steam (noms affichés) et Twitch (identifiant numérique).

import { describe, expect, it } from 'vitest'
import { ModuleError } from '@shared/modules'
import { previousNameEntities, spanText } from '../../src/main/modules/social/_history'
import bluesky, { plcHandleHistory, type PlcEntry } from '../../src/main/modules/social/bluesky'
import steam, { steamAliasDate, steamAliasSpans } from '../../src/main/modules/social/steam'
import twitch, { QUERY_BY_ID } from '../../src/main/modules/social/twitch'
import xhistory, { memoryAccounts, memoryLolOutput, memorySpans } from '../../src/main/modules/social/xhistory'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson, type Route } from './social_helpers'

const json = (path: string): { body: string; headers: Record<string, string> } => ({ body: fixture(`social/${path}`), headers: { 'content-type': 'application/json' } })

describe('aide commune', () => {
  it('période lisible et entités à vérifier', () => {
    expect(spanText({ name: 'a', from: '2020-01-01', until: '2021-02-03' })).toBe('a (2020-01-01 / 2021-02-03)')
    expect(spanText({ name: 'a' })).toBe('a')
    const out = previousNameEntities(
      [
        { name: 'Actuel', from: '2021-01-01' },
        { name: 'ancien', from: '2019-01-01', until: '2021-01-01' }
      ],
      { current: 'actuel', service: 'X', source: 'memory.lol', lang: 'fr' }
    )
    expect(out).toEqual([
      {
        type: 'username',
        label: 'ancien',
        data: { first_seen: '2019-01-01', last_seen: '2021-01-01', source: 'memory.lol' },
        linkLabel: 'ancien pseudo',
        strength: 'same',
        review: true,
        reviewReason: "ancien pseudo X (memory.lol), utilisé jusqu'au 2021-01-01"
      }
    ])
  })
})

describe('social.x_history (memory.lol)', () => {
  it('jack : identifiant 12, un seul pseudo, aucune entité', () => {
    const accounts = memoryAccounts(fixtureJson('social/memorylol_jack.json'))
    expect(memorySpans(accounts[0])).toEqual([{ name: 'jack', from: '2011-09-28', until: '2026-07-15' }])
    const out = memoryLolOutput(accounts, 'jack', 'fr')
    expect(out.properties).toEqual({ x_user_ids: ['12'], username_history: ['jack (2011-09-28 / 2026-07-15)'] })
    expect(out.entities).toEqual([])
  })

  it('compte renommé : anciens pseudos à vérifier, pseudo plus récent signalé comme tel', () => {
    const accounts = memoryAccounts(fixtureJson('social/memorylol_renamed.json'))
    const out = memoryLolOutput(accounts, 'exemple_ancien', 'fr')
    expect(out.properties?.previous_usernames).toEqual(['exemple_actuel', 'exemple_bref', 'exemple_inconnu'])
    const reasons = Object.fromEntries((out.entities ?? []).map((e) => [e.label, e.reviewReason]))
    expect(reasons.exemple_actuel).toBe("pseudo X plus récent (memory.lol), vu jusqu'au 2026-07-15")
    expect(reasons.exemple_bref).toBe("ancien pseudo X (memory.lol), utilisé jusqu'au 2014-03-01")
    expect(reasons.exemple_inconnu).toBe('ancien pseudo X (memory.lol)')
    expect(out.entities?.every((e) => e.type === 'username' && e.review)).toBe(true)
  })

  it('pseudo porté par deux comptes : l’identifiant figure dans la raison', () => {
    const out = memoryLolOutput(memoryAccounts(fixtureJson('social/memorylol_shared.json')), 'pseudo_partage', 'fr')
    expect(out.properties?.x_user_ids).toEqual(['111', '222'])
    // `premier_compte` succède à `pseudo_partage` sur le compte 111 : plus récent que lui.
    expect(out.entities?.map((e) => [e.label, e.reviewReason])).toEqual([
      ['premier_compte', "pseudo X plus récent du compte n° 111 (memory.lol), vu jusqu'au 2020-01-01"]
    ])
  })

  it('module : recherche par identifiant stable pour un compte connu, par pseudo sinon', async () => {
    const ctx = fakeContext([
      [/memory\.lol\/v1\/tw\/id\/12$/, { body: fixtureJson<{ accounts: unknown[] }>('social/memorylol_jack.json').accounts[0] as object }],
      [/memory\.lol\/v1\/tw\/zq8xk2vmw93pq7$/, { body: { accounts: [] } }]
    ])
    const out = await runModule(xhistory, entity('account', 'jack', { platform: 'x', data: { user_id: '12' } }), ctx)
    expect(out.properties?.x_user_ids).toEqual(['12'])
    expect(await runModule(xhistory, entity('username', 'zq8xk2vmw93pq7'), ctx)).toEqual({ raw: { accounts: [] } })
  })
})

describe('Bluesky : handles successifs (plc.directory)', () => {
  const log = fixtureJson<PlcEntry[]>('social/plc_audit_jay.json')

  it('jay.bsky.social (2022-11-17) puis jay.bsky.team (2023-04-12)', () => {
    expect(plcHandleHistory(log)).toEqual([
      { name: 'jay.bsky.social', from: '2022-11-17', until: '2023-04-12' },
      { name: 'jay.bsky.team', from: '2023-04-12' }
    ])
  })

  it('opérations annulées ignorées, tombstone qui clôt la période', () => {
    const spans = plcHandleHistory([
      { createdAt: '2024-01-01T00:00:00Z', operation: { type: 'create', handle: 'a.example.com' } },
      { createdAt: '2024-02-01T00:00:00Z', nullified: true, operation: { type: 'plc_operation', alsoKnownAs: ['at://b.example.com'] } },
      { createdAt: '2024-03-01T00:00:00Z', operation: { type: 'plc_tombstone' } }
    ])
    expect(spans).toEqual([{ name: 'a.example.com', from: '2024-01-01', until: '2024-03-01' }])
  })

  it('module : ancien handle proposé comme pseudo à vérifier', async () => {
    const routes: Route[] = [
      [/actor=jay\.bsky\.team/, json('bsky_profile.json')],
      [/plc\.directory\/did:plc:oky5czdrnfjpqslsw2a5iclo\/log\/audit/, json('plc_audit_jay.json')]
    ]
    const out = await bluesky.run(entity('username', 'jay.bsky.team'), fakeContext(routes))
    const account = out.entities!.find((e) => e.ref === 'account')!
    expect(account.data).toMatchObject({ previous_usernames: ['jay.bsky.social'], username_history: ['jay.bsky.social (2022-11-17 / 2023-04-12)', 'jay.bsky.team (2023-04-12 / …)'] })
    const old = out.entities!.find((e) => e.type === 'username')!
    expect(old).toMatchObject({ label: 'jay', review: true, data: { handle: 'jay.bsky.social', last_seen: '2023-04-12' } })
    expect(old.reviewReason).toBe("ancien pseudo Bluesky (plc.directory), utilisé jusqu'au 2023-04-12")
  })
})

describe('Steam : noms affichés précédents', () => {
  it('dates de l’historique (année en cours omise par Steam)', () => {
    expect(steamAliasDate('Aug 18, 2024 @ 1:23am')).toBe('2024-08-18')
    expect(steamAliasDate('Mar 3 @ 9:22pm', new Date('2026-10-22T00:00:00Z'))).toBe('2026-03-03')
    expect(steamAliasDate('hier')).toBeUndefined()
  })

  it('s1mple : plastic, plasticity, intenzz avec leurs dates', () => {
    const spans = steamAliasSpans(fixtureJson('social/steam_aliases_s1mple.json'))
    expect(spans.slice(0, 4).map((s) => [s.name, s.from, s.until])).toEqual([
      ['plastic', '2024-08-18', undefined],
      ['plastic (music)', '2024-08-17', '2024-08-18'],
      ['plasticity', '2022-02-22', '2024-08-17'],
      ['intenzz', '2022-02-16', '2022-02-22']
    ])
  })

  it('module : nom courant exclu, anciens noms à vérifier', async () => {
    const aliases = [
      { newname: 'Robin', timechanged: 'May 7, 2019 @ 11:04pm' },
      { newname: 'ancien_nom', timechanged: 'Mar 3, 2011 @ 9:22pm' }
    ]
    const routes: Route[] = [
      [/profiles\/76561197960435530\/ajaxaliases/, { body: aliases }],
      [/id\/robinwalker/, { body: fixture('social/steam_profile.xml') }]
    ]
    const out = await steam.run(entity('username', 'robinwalker'), fakeContext(routes))
    const account = out.entities!.find((e) => e.ref === 'account')!
    expect(account.data?.previous_usernames).toEqual(['ancien_nom'])
    const old = out.entities!.filter((e) => e.type === 'username')
    expect(old).toEqual([expect.objectContaining({ label: 'ancien_nom', review: true, reviewReason: expect.stringMatching(/utilisé jusqu'au 2019-05-07/) })])
  })
})

describe('Twitch : identifiant stable', () => {
  it('un compte connu est relu par son identifiant, même renommé', async () => {
    const ctx = fakeContext([[/gql\.twitch\.tv/, json('twitch_ninja_gql.json')]])
    const out = await twitch.run(entity('account', 'ancien_login', { platform: 'twitch', data: { user_id: '19571641' } }), ctx)
    const body = JSON.parse(ctx.calls[0].body!)
    expect(body).toEqual({ query: QUERY_BY_ID, variables: { id: '19571641' } })
    expect(body.query).toMatch(/lookupType: ALL/)
    expect(out.properties).toMatchObject({ username: 'ninja', user_id: '19571641', previous_usernames: ['ancien_login'] })
    expect(out.entities?.find((e) => e.type === 'username')).toMatchObject({ label: 'ninja', linkLabel: 'pseudo actuel (même identifiant Twitch)' })
  })
})

describe.skipIf(!LIVE)('historiques (live)', () => {
  const ctx = makeContext()
  it('memory.lol : jack a l’identifiant 12 ; un pseudo aléatoire ne renvoie rien', async () => {
    const out = await runModule(xhistory, entity('username', 'jack'), ctx)
    expect(out.properties?.x_user_ids).toEqual(['12'])
    expect((await runModule(xhistory, entity('username', `zq${Date.now().toString(36)}x`), ctx)).properties).toBeUndefined()
  })
  it('plc.directory : jay.bsky.social puis jay.bsky.team', async () => {
    const out = await runModule(bluesky, entity('username', 'jay.bsky.team'), ctx)
    expect(out.entities?.some((e) => e.type === 'username' && e.label === 'jay')).toBe(true)
  })
  it('Steam : anciens noms de s1mple', async (t) => {
    try {
      const out = await runModule(steam, entity('username', 's1mple'), ctx)
      const labels = out.entities?.filter((e) => e.type === 'username').map((e) => e.label) ?? []
      expect(labels).toEqual(expect.arrayContaining(['plasticity', 'intenzz']))
    } catch (e) {
      if (e instanceof ModuleError && e.code === 'blocked') t.skip(e.message)
      throw e
    }
  })
  it('Twitch : l’identifiant 19571641 donne ninja', async () => {
    const out = await runModule(twitch, entity('account', 'ninja', { platform: 'twitch', data: { user_id: '19571641' } }), ctx)
    expect(out.properties?.username).toBe('ninja')
  })
})
