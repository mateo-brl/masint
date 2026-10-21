import { describe, expect, it } from 'vitest'
import discordInvite, { inviteCode, parseInvite, snowflakeDate } from '../../src/main/modules/messaging/discord'
import telegram, { parseTelegram } from '../../src/main/modules/messaging/telegram'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'
import { fakeContext, fixture, fixtureJson, type Route } from './social_helpers'

describe('Telegram', () => {
  it('reconnaît canal, groupe, bot et pseudo libre', () => {
    expect(parseTelegram(fixture('social/telegram_channel.html'))).toMatchObject({ title: 'Telegram News', kind: 'channel', verified: true, subscribers: 9270613 })
    expect(parseTelegram(fixture('social/telegram_channel_durov.html'))).toMatchObject({ title: 'Pavel Durov', kind: 'channel', bio: 'Founder of Telegram.' })
    expect(parseTelegram(fixture('social/telegram_group.html'))).toMatchObject({ kind: 'group', members: 5635, online: 1941 })
    expect(parseTelegram(fixture('social/telegram_bot.html'))).toMatchObject({ title: 'BotFather', kind: 'bot', monthlyUsers: 7391905 })
    expect(parseTelegram(fixture('social/telegram_missing.html'))).toBeNull()
  })

  it('module : groupe Telegram et liens de la description', async () => {
    const routes: Route[] = [
      [/t\.me\/rustlang_ru$/, { body: fixture('social/telegram_group.html') }],
      [/t\.me\/zq8x7v2kq9w1$/, { body: fixture('social/telegram_missing.html') }]
    ]
    const out = await telegram.run(entity('username', 'rustlang_ru'), fakeContext(routes))
    expect(out.found).toBe(true)
    const group = out.entities!.find((e) => e.ref === 'tg')!
    expect(group).toMatchObject({ type: 'group', platform: 'telegram', data: { username: 'rustlang_ru', members: 5635, online: 1941 } })
    expect(group.image).toMatch(/^https:\/\/cdn\d\.telesco\.pe\//)
    expect(out.entities!.filter((e) => e.from === 'tg' && e.platform === 'telegram').map((e) => e.label)).toEqual(expect.arrayContaining(['rust_beginners_ru', 'rust_jobs']))
    expect((await telegram.run(entity('username', 'zq8x7v2kq9w1'), fakeContext(routes))).found).toBe(false)
  })

  it('module : compte d’entrée enrichi', async () => {
    const ctx = fakeContext([[/t\.me\/botfather$/, { body: fixture('social/telegram_bot.html') }]])
    const out = await telegram.run(entity('account', 'botfather', { platform: 'telegram' }), ctx)
    expect(out.properties).toMatchObject({ account_type: 'bot', display_name: 'BotFather', verified: true })
    expect(out.entities?.[0]).toMatchObject({ type: 'account', label: 'botfather', platform: 'telegram' })
  })

  it('refuse un pseudo invalide', async () => {
    await expect(telegram.run(entity('username', 'a-b'), fakeContext([]))).rejects.toThrow()
  })
})

describe('Invitation Discord', () => {
  it('code d’invitation et date des identifiants', () => {
    expect(inviteCode({ label: 'https://discord.gg/H5MNcFW63r', data: {} })).toBe('H5MNcFW63r')
    expect(inviteCode({ label: 'serveur', data: { url: 'https://discord.com/invite/python' } })).toBe('python')
    expect(inviteCode({ label: 'https://example.com', data: {} })).toBeNull()
    expect(snowflakeDate('267624335836053506')).toBe('2017-01-08T12:03:33.883Z')
  })

  it('serveur et créateur de l’invitation', async () => {
    const entities = parseInvite(fixtureJson('social/discord_invite.json'), 'fr')
    expect(entities[0]).toMatchObject({ ref: 'guild', type: 'group', label: 'yt-dlp', platform: 'discord', data: { guild_id: '807245652072857610' } })
    const inviter = entities.find((e) => e.type === 'account')!
    expect(inviter).toMatchObject({ label: 'pukkandan', platform: 'discord', from: 'guild', data: { user_id: '389240817124114434' } })
    expect(inviter.image).toMatch(/cdn\.discordapp\.com\/avatars\/389240817124114434\//)
    expect(inviter.data?.created_at).toMatch(/^2017-/)
  })

  it('module : invitation valide ou expirée', async () => {
    const routes: Route[] = [
      [/invites\/H5MNcFW63r/, { body: fixture('social/discord_invite.json') }],
      [/invites\//, { status: 404, body: '{"message": "Unknown Invite", "code": 10006}' }]
    ]
    expect(discordInvite.accepts!(entity('url', 'https://discord.gg/H5MNcFW63r'))).toBe(true)
    expect(discordInvite.accepts!(entity('url', 'https://example.com/x'))).toBe(false)
    const ok = await discordInvite.run(entity('url', 'https://discord.gg/H5MNcFW63r'), fakeContext(routes))
    expect(ok).toMatchObject({ found: true, properties: { invite_valid: true } })
    const ko = await discordInvite.run(entity('url', 'https://discord.gg/expired1'), fakeContext(routes))
    expect(ko).toMatchObject({ found: false, properties: { invite_valid: false } })
  })
})

describe.skipIf(!LIVE)('live', () => {
  const ctx = makeContext()
  it('Telegram : canal existant et pseudo libre', async () => {
    const out = await runModule(telegram, entity('username', 'telegram'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.[0].data).toMatchObject({ display_name: 'Telegram News' })
    expect((await runModule(telegram, entity('username', 'zq8x7v2kq9w1'), ctx)).found).toBe(false)
  }, 30000)
  it('Discord : invitation publique', async () => {
    const out = await runModule(discordInvite, entity('url', 'https://discord.gg/H5MNcFW63r'), ctx)
    expect(out.found).toBe(true)
    expect(out.entities?.[0].label).toBe('yt-dlp')
    expect((await runModule(discordInvite, entity('url', 'https://discord.gg/zq8x7v2kq9w1'), ctx)).found).toBe(false)
  }, 30000)
})
