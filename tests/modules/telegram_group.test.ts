import { describe, expect, it } from 'vitest'
import telegram, { groupUsername, parsePreview } from '../../src/main/modules/messaging/telegram'
import { entity, LIVE, runModule } from '../helpers/context'
import { fakeContext, fixture, type Route } from './social_helpers'

describe('messaging.telegram : canaux et groupes', () => {
  it('lit la date du dernier message de l’aperçu t.me/s/', () => {
    expect(parsePreview(fixture('social/telegram_preview_durov.html'))).toEqual({ lastPostAt: '2026-10-11T14:52:40.000Z', posts: 3 })
    expect(parsePreview('<html></html>')).toEqual({ lastPostAt: undefined, posts: 0 })
  })

  it('retrouve le pseudo d’un canal ou d’un groupe venu d’un autre module', () => {
    expect(groupUsername({ label: 'Telegram News', platform: 'telegram', data: { username: 'telegram' } })).toBe('telegram')
    expect(groupUsername({ label: 'Canal', platform: null, data: { url: 'https://t.me/s/durov' } })).toBe('durov')
    expect(groupUsername({ label: 'https://t.me/rustlang_ru', platform: null, data: {} })).toBe('rustlang_ru')
    // Serveur Discord, groupe sans lien t.me, lien d'invitation privé : rien à lire.
    expect(groupUsername({ label: 'Serveur', platform: 'discord', data: { url: 'https://discord.gg/abc' } })).toBeNull()
    expect(groupUsername({ label: 'Groupe', platform: null, data: { url: 'https://t.me/+AbCdEf123' } })).toBeNull()
    expect(telegram.accepts!(entity('group', 'Pavel Durov', { platform: 'telegram', data: { username: 'durov' } }))).toBe(true)
    expect(telegram.accepts!(entity('group', 'Club de lecture'))).toBe(false)
  })

  it('canal déjà dans le graphe : propriétés, photo et date du dernier message sur le même nœud', async () => {
    const routes: Route[] = [
      [/t\.me\/durov$/, { body: fixture('social/telegram_channel_durov.html') }],
      [/t\.me\/s\/durov$/, { body: fixture('social/telegram_preview_durov.html') }]
    ]
    const input = entity('group', 'Pavel Durov', { platform: 'telegram', data: { username: 'durov' } })
    const out = await telegram.run(input, fakeContext(routes))
    expect(out.found).toBe(true)
    expect(out.properties).toMatchObject({ username: 'durov', bio: 'Founder of Telegram.', last_post_at: '2026-10-11T14:52:40.000Z', preview_url: 'https://t.me/s/durov' })
    const self = out.entities?.find((e) => e.type === 'group')
    if (self) expect(self).toMatchObject({ label: 'Pavel Durov', platform: 'telegram' })
  })

  it('aperçu indisponible : le reste de la fiche est conservé', async () => {
    const routes: Route[] = [
      [/t\.me\/durov$/, { body: fixture('social/telegram_channel_durov.html') }],
      [/t\.me\/s\/durov$/, { status: 502, body: 'Bad Gateway' }]
    ]
    const out = await telegram.run(entity('username', 'durov'), fakeContext(routes))
    expect(out.entities?.[0]).toMatchObject({ type: 'group', platform: 'telegram' })
    expect(out.entities?.[0].data?.last_post_at).toBeUndefined()
  })
})

describe.skipIf(!LIVE)('messaging.telegram : canal (live)', () => {
  it('canal public durov : dernier message', async () => {
    const out = await runModule(telegram, entity('group', 'Pavel Durov', { platform: 'telegram', data: { username: 'durov' } }))
    expect(out.found).toBe(true)
    expect(String(out.properties?.last_post_at)).toMatch(/^20\d\d-/)
  })
})
