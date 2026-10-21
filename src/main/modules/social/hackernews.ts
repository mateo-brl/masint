import { defineModule } from '@shared/modules'
import { acceptsPlatform, htmlToText, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface HnUser {
  id: string
  created?: number
  karma?: number
  about?: string
  submitted?: number[]
}

export function parseHn(u: HnUser, lang: Lang): Parsed {
  const about = u.about ? htmlToText(u.about) : undefined
  return {
    profile: {
      username: u.id,
      url: `https://news.ycombinator.com/user?id=${u.id}`,
      data: { bio: about, karma: u.karma, created_at: toIso(u.created), submissions: u.submitted?.length }
    },
    children: linkedEntities({ text: about, lang, self: { platform: 'hackernews', username: u.id } })
  }
}

export default defineModule({
  id: 'social.hackernews',
  name: { fr: 'Profil Hacker News', en: 'Hacker News profile' },
  description: {
    fr: 'Profil Hacker News (API officielle) : date de création, karma, nombre de contributions et texte « about » avec ses emails et liens.',
    en: 'Hacker News profile (official API): creation date, karma, number of submissions and "about" text with its emails and links.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('hackernews'),
  homepage: 'https://github.com/HackerNews/API',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w-]{2,15}$/)
    let user: HnUser | null
    try {
      user = await ctx.fetchJson<HnUser | null>(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`)
    } catch (e) {
      rethrow(e, 'Hacker News')
    }
    if (!user) return notFound()
    const parsed = parseHn(user, ctx.lang)
    return profileOutput(input, 'hackernews', parsed.profile, parsed.children, { ...user, submitted: user.submitted?.length }, ctx.lang)
  }
})
