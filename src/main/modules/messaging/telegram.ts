import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { acceptsPlatform, compact, decodeHtml, htmlToText, linkedEntities, metaContent, toNumber, usernameOf, type Lang } from '../social/_lib'

export type TelegramKind = 'user' | 'bot' | 'channel' | 'group'

export interface TelegramPage {
  title: string
  kind: TelegramKind
  bio?: string
  photo?: string
  verified: boolean
  subscribers?: number
  members?: number
  online?: number
  monthlyUsers?: number
}

/** Page publique t.me/<pseudo>. Renvoie null si le pseudo n'existe pas. */
export function parseTelegram(html: string): TelegramPage | null {
  const titleBlock = html.match(/<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/)
  if (!titleBlock) return null
  const title = decodeHtml(titleBlock[1].replace(/<i class="verified-icon">[\s\S]*?<\/i>/, '').replace(/<[^>]+>/g, '')).trim()
  const extras = [...html.matchAll(/<div class="tgme_page_extra">([\s\S]*?)<\/div>/g)].map((m) => decodeHtml(m[1].replace(/<[^>]+>/g, '')).trim())
  const desc = html.match(/<div class="tgme_page_description[^"]*"[^>]*>([\s\S]*?)<\/div>/)
  const photo = html.match(/<img class="tgme_page_photo_image" src="([^"]+)"/)?.[1] ?? metaContent(html, 'og:image')
  const count = (re: RegExp): number | undefined => {
    for (const e of extras) {
      const m = e.match(re)
      if (m) return toNumber(m[1])
    }
    return undefined
  }
  const subscribers = count(/^([\d\s ,]+)\s+subscribers?/i)
  const members = count(/^([\d\s ,]+)\s+members?/i)
  const monthlyUsers = count(/([\d\s ,]+)\s+monthly users?/i)
  const online = count(/([\d\s ,]+)\s+online/i)
  const isBot = monthlyUsers !== undefined || />\s*Start Bot\s*</.test(html)
  const kind: TelegramKind = isBot ? 'bot' : subscribers !== undefined ? 'channel' : members !== undefined ? 'group' : 'user'
  return {
    title,
    kind,
    bio: desc ? htmlToText(desc[1]) || undefined : undefined,
    photo: photo && !/telegram\.org\/img\//.test(photo) ? photo : undefined,
    verified: /<i class="verified-icon">/.test(titleBlock[0]),
    subscribers,
    members,
    online,
    monthlyUsers
  }
}

const KIND_LABEL: Record<TelegramKind, { fr: string; en: string }> = {
  user: { fr: 'utilisateur', en: 'user' },
  bot: { fr: 'bot', en: 'bot' },
  channel: { fr: 'canal', en: 'channel' },
  group: { fr: 'groupe', en: 'group' }
}

export function telegramOutput(username: string, page: TelegramPage, lang: Lang): { data: Record<string, ReturnType<typeof compact>[string]>; entity: OutEntity; children: OutEntity[] } {
  const url = `https://t.me/${username}`
  const data = compact({
    username,
    url,
    display_name: page.title,
    bio: page.bio,
    account_type: KIND_LABEL[page.kind][lang],
    verified: page.verified || undefined,
    followers: page.subscribers,
    members: page.members ?? page.subscribers,
    online: page.online,
    monthly_users: page.monthlyUsers,
    ...(page.kind === 'channel' ? { preview_url: `https://t.me/s/${username}` } : {})
  })
  const isCommunity = page.kind === 'channel' || page.kind === 'group'
  const entity: OutEntity = {
    ref: 'tg',
    type: isCommunity ? 'group' : 'account',
    label: isCommunity ? page.title || `@${username}` : username,
    platform: 'telegram',
    data,
    image: page.photo,
    linkLabel: lang === 'fr' ? `${KIND_LABEL[page.kind].fr} Telegram` : `Telegram ${KIND_LABEL[page.kind].en}`
  }
  const children = linkedEntities({ text: page.bio, lang, self: { platform: 'telegram', username } }).map((c) => ({ ...c, from: 'tg' }))
  return { data, entity, children }
}

export default defineModule({
  id: 'messaging.telegram',
  name: { fr: 'Telegram (page publique)', en: 'Telegram (public page)' },
  description: {
    fr: 'Lit la page publique t.me/<pseudo> sans compte : existence du pseudo, type (utilisateur, bot, canal, groupe), nom, bio, photo, badge vérifié et nombre d’abonnés ou de membres.',
    en: 'Reads the public t.me/<username> page without an account: whether the username exists, type (user, bot, channel, group), name, bio, picture, verified badge and subscriber or member count.'
  },
  category: 'messaging',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('telegram'),
  homepage: 'https://t.me',
  async run(input, ctx) {
    const username = usernameOf(input)
    if (!/^[a-z][a-z0-9_]{3,31}$/i.test(username)) throw new ModuleError('Pseudo Telegram invalide (5 à 32 caractères, lettres, chiffres, _)', 'invalid_input')
    const html = await ctx.fetchText(`https://t.me/${encodeURIComponent(username)}`, { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    const page = parseTelegram(html)
    if (!page) return { found: false }
    const out = telegramOutput(username, page, ctx.lang)
    if (input.type === 'account') {
      const entities: OutEntity[] = []
      if (page.photo) entities.push({ type: 'account', label: input.label, platform: input.platform ?? 'telegram', image: page.photo })
      entities.push(...out.children.map((c) => ({ ...c, from: undefined })))
      return { found: true, properties: out.data, entities, raw: page }
    }
    return { found: true, entities: [out.entity, ...out.children], raw: page }
  }
})
