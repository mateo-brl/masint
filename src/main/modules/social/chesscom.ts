import { defineModule } from '@shared/modules'
import { localizeCountry } from '../domain/_util'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface ChessComPlayer {
  player_id: number
  username: string
  url?: string
  name?: string
  title?: string
  avatar?: string
  followers?: number
  country?: string
  location?: string
  joined?: number
  last_online?: number
  status?: string
  is_streamer?: boolean
  twitch_url?: string
  verified?: boolean
  league?: string
  streaming_platforms?: Array<{ type?: string; channel_url?: string }>
}

export function parseChessCom(p: ChessComPlayer, lang: Lang): Parsed {
  const username = p.url?.split('/').pop() || p.username
  return {
    profile: {
      username,
      url: p.url,
      image: p.avatar,
      data: {
        user_id: String(p.player_id),
        display_name: p.name,
        location: p.location,
        country: localizeCountry(null, p.country?.split('/').pop(), lang) ?? undefined,
        title: p.title,
        followers: p.followers,
        membership: p.status,
        league: p.league,
        verified: p.verified || undefined,
        created_at: toIso(p.joined),
        last_seen: toIso(p.last_online)
      }
    },
    children: linkedEntities({
      urls: [p.twitch_url, ...(p.streaming_platforms ?? []).map((s) => s.channel_url)],
      lang,
      self: { platform: 'chesscom', username }
    })
  }
}

export default defineModule({
  id: 'social.chesscom',
  name: { fr: 'Profil Chess.com', en: 'Chess.com profile' },
  description: {
    fr: 'Profil Chess.com (API publique) : nom, pays, localisation, titre, abonnés, date d’inscription, dernière connexion et chaînes de diffusion.',
    en: 'Chess.com profile (public API): name, country, location, title, followers, join date, last online and streaming channels.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('chesscom'),
  homepage: 'https://www.chess.com/news/view/published-data-api',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w-]{3,25}$/)
    let player: ChessComPlayer
    try {
      player = await ctx.fetchJson<ChessComPlayer>(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`)
    } catch (e) {
      if (httpStatus(e) === 404 || httpStatus(e) === 410) return notFound()
      rethrow(e, 'Chess.com')
    }
    const parsed = parseChessCom(player, ctx.lang)
    return profileOutput(input, 'chesscom', parsed.profile, parsed.children, player, ctx.lang)
  }
})
