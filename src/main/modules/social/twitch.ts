import { defineModule } from '@shared/modules'
import { acceptsPlatform, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

/** Client-ID public du site web de Twitch (utilisé sans compte par le lecteur web). */
const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

const QUERY = `query($login: String!) { user(login: $login) {
  id login displayName description createdAt updatedAt profileImageURL(width: 300)
  followers { totalCount } roles { isPartner isAffiliate isStaff }
  lastBroadcast { startedAt title } stream { createdAt }
  channel { socialMedias { name title url } }
} }`

export interface TwitchUser {
  id: string
  login: string
  displayName?: string
  description?: string | null
  createdAt?: string
  updatedAt?: string
  profileImageURL?: string
  followers?: { totalCount?: number }
  roles?: { isPartner?: boolean | null; isAffiliate?: boolean | null; isStaff?: boolean | null }
  lastBroadcast?: { startedAt?: string | null; title?: string | null } | null
  stream?: { createdAt?: string } | null
  channel?: { socialMedias?: Array<{ name?: string; title?: string; url?: string }> | null } | null
}

export function parseTwitch(u: TwitchUser, lang: Lang): Parsed {
  const role = u.roles?.isPartner ? 'partner' : u.roles?.isAffiliate ? 'affiliate' : undefined
  return {
    profile: {
      username: u.login,
      url: `https://www.twitch.tv/${u.login}`,
      image: u.profileImageURL && !/user-default-pictures/.test(u.profileImageURL) ? u.profileImageURL : undefined,
      data: {
        user_id: u.id,
        display_name: u.displayName,
        bio: u.description ?? undefined,
        followers: u.followers?.totalCount,
        role,
        staff: u.roles?.isStaff || undefined,
        live: u.stream ? true : undefined,
        last_broadcast_title: u.lastBroadcast?.title ?? undefined,
        created_at: toIso(u.createdAt),
        updated_at: toIso(u.updatedAt),
        last_seen: toIso(u.stream?.createdAt ?? u.lastBroadcast?.startedAt ?? undefined)
      }
    },
    children: linkedEntities({
      text: u.description ?? undefined,
      urls: (u.channel?.socialMedias ?? []).map((s) => s.url),
      lang,
      self: { platform: 'twitch', username: u.login }
    })
  }
}

export default defineModule({
  id: 'social.twitch',
  name: { fr: 'Chaîne Twitch', en: 'Twitch channel' },
  description: {
    fr: 'Chaîne Twitch (API GraphQL publique du site) : nom, bio, date de création, abonnés, statut partenaire, dernière diffusion et réseaux sociaux affichés sur la chaîne.',
    en: 'Twitch channel (public GraphQL API of the website): name, bio, creation date, followers, partner status, last broadcast and social links shown on the channel.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('twitch'),
  homepage: 'https://www.twitch.tv',
  async run(input, ctx) {
    const login = requireUsername(input, /^\w{1,25}$/).toLowerCase()
    let res: { data?: { user: TwitchUser | null }; errors?: Array<{ message: string }> }
    try {
      res = await ctx.fetchJson('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'client-id': WEB_CLIENT_ID },
        json: { query: QUERY, variables: { login } }
      })
    } catch (e) {
      rethrow(e, 'Twitch')
    }
    if (res.errors?.length && !res.data?.user) throw new Error(`Twitch : ${res.errors[0].message}`)
    const user = res.data?.user
    if (!user) return notFound()
    const parsed = parseTwitch(user, ctx.lang)
    return profileOutput(input, 'twitch', parsed.profile, parsed.children, user, ctx.lang)
  }
})
