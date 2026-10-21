import { defineModule, type ModuleContext } from '@shared/modules'
import { acceptsPlatform, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface RobloxUser {
  id: number
  name: string
  displayName?: string
  description?: string
  created?: string
  isBanned?: boolean
  hasVerifiedBadge?: boolean
}

export function parseRoblox(u: RobloxUser, extra: { avatar?: string; followers?: number; friends?: number; previousNames?: string[] }, lang: Lang): Parsed {
  return {
    profile: {
      username: u.name,
      url: `https://www.roblox.com/users/${u.id}/profile`,
      image: extra.avatar,
      data: {
        user_id: String(u.id),
        display_name: u.displayName && u.displayName !== u.name ? u.displayName : undefined,
        bio: u.description || undefined,
        followers: extra.followers,
        friends: extra.friends,
        previous_usernames: extra.previousNames ?? [],
        banned: u.isBanned || undefined,
        verified: u.hasVerifiedBadge || undefined,
        created_at: toIso(u.created)
      }
    },
    children: linkedEntities({ text: u.description, lang, self: { platform: 'roblox', username: u.name } })
  }
}

async function optional<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p
  } catch {
    return undefined
  }
}

async function extras(ctx: ModuleContext, id: number): Promise<{ avatar?: string; followers?: number; friends?: number; previousNames?: string[] }> {
  const [thumb, followers, friends, history] = await Promise.all([
    optional(ctx.fetchJson<{ data?: Array<{ imageUrl?: string; state?: string }> }>('https://thumbnails.roblox.com/v1/users/avatar-headshot', { query: { userIds: id, size: '420x420', format: 'Png', isCircular: 'false' } })),
    optional(ctx.fetchJson<{ count?: number }>(`https://friends.roblox.com/v1/users/${id}/followers/count`)),
    optional(ctx.fetchJson<{ count?: number }>(`https://friends.roblox.com/v1/users/${id}/friends/count`)),
    optional(ctx.fetchJson<{ data?: Array<{ name: string }> }>(`https://users.roblox.com/v1/users/${id}/username-history`, { query: { limit: 50, sortOrder: 'Desc' } }))
  ])
  const t = thumb?.data?.[0]
  return {
    avatar: t?.state === 'Completed' ? t.imageUrl : undefined,
    followers: followers?.count,
    friends: friends?.count,
    previousNames: history?.data?.map((h) => h.name)
  }
}

export default defineModule({
  id: 'social.roblox',
  name: { fr: 'Profil Roblox', en: 'Roblox profile' },
  description: {
    fr: 'Profil Roblox (API publique) : nom affiché, description, date de création, anciens pseudos, abonnés, amis, avatar et bannissement.',
    en: 'Roblox profile (public API): display name, description, creation date, previous usernames, followers, friends, avatar and ban status.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('roblox'),
  homepage: 'https://users.roblox.com/docs',
  async run(input, ctx) {
    const username = requireUsername(input, /^\w{3,20}$/)
    let found: { data?: Array<{ id: number; name: string }> }
    try {
      found = await ctx.fetchJson('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        json: { usernames: [username], excludeBannedUsers: false }
      })
    } catch (e) {
      rethrow(e, 'Roblox')
    }
    const hit = found.data?.[0]
    if (!hit) return notFound()
    let user: RobloxUser
    try {
      user = await ctx.fetchJson<RobloxUser>(`https://users.roblox.com/v1/users/${hit.id}`)
    } catch (e) {
      rethrow(e, 'Roblox')
    }
    const more = await extras(ctx, user.id)
    const parsed = parseRoblox(user, more, ctx.lang)
    return profileOutput(input, 'roblox', parsed.profile, parsed.children, { user, ...more }, ctx.lang)
  }
})
