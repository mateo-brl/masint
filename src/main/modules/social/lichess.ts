import { defineModule } from '@shared/modules'
import { localizeCountry } from '../domain/_util'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface LichessUser {
  id: string
  username: string
  title?: string
  createdAt?: number
  seenAt?: number
  disabled?: boolean
  tosViolation?: boolean
  verified?: boolean
  patron?: boolean
  url?: string
  playTime?: { total?: number }
  count?: { all?: number; rated?: number }
  perfs?: Record<string, { rating?: number; games?: number }>
  profile?: {
    bio?: string
    realName?: string
    firstName?: string
    lastName?: string
    location?: string
    flag?: string
    country?: string
    links?: string
    fideRating?: number
  }
  streamer?: Record<string, { channel?: string }>
}

export function parseLichess(u: LichessUser, lang: Lang): Parsed {
  const p = u.profile ?? {}
  const realName = p.realName ?? ([p.firstName, p.lastName].filter(Boolean).join(' ') || undefined)
  const ratings = Object.entries(u.perfs ?? {})
    .filter(([, v]) => v.rating && v.games)
    .map(([k, v]) => `${k} ${v.rating}`)
  const links = (p.links ?? '').split(/\s+/).filter(Boolean)
  const streams = Object.values(u.streamer ?? {}).map((s) => s.channel)
  return {
    profile: {
      username: u.username,
      url: u.url ?? `https://lichess.org/@/${u.username}`,
      data: {
        display_name: realName,
        bio: p.bio,
        location: p.location,
        country: localizeCountry(p.flag ?? p.country, null, lang) ?? undefined,
        title: u.title,
        fide_rating: p.fideRating,
        ratings,
        games: u.count?.all,
        play_time_hours: u.playTime?.total ? Math.round(u.playTime.total / 3600) : undefined,
        created_at: toIso(u.createdAt),
        last_seen: toIso(u.seenAt),
        verified: u.verified || undefined,
        closed: u.disabled || undefined,
        tos_violation: u.tosViolation || undefined
      }
    },
    children: linkedEntities({ text: p.bio, urls: [...links, ...streams], lang, self: { platform: 'lichess', username: u.username } })
  }
}

export default defineModule({
  id: 'social.lichess',
  name: { fr: 'Profil Lichess', en: 'Lichess profile' },
  description: {
    fr: 'Profil Lichess : vrai nom, bio, pays, liens, classements, date de création et dernière connexion.',
    en: 'Lichess profile: real name, bio, country, links, ratings, creation date and last seen.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('lichess'),
  homepage: 'https://lichess.org/api#tag/Users/operation/apiUser',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w-]{2,30}$/)
    let user: LichessUser
    try {
      user = await ctx.fetchJson<LichessUser>(`https://lichess.org/api/user/${encodeURIComponent(username)}`)
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Lichess')
    }
    const parsed = parseLichess(user, ctx.lang)
    return profileOutput(input, 'lichess', parsed.profile, parsed.children, user, ctx.lang)
  }
})
