import { defineModule, ModuleError } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, rethrow, toIso, usernameOf, type Lang, type Parsed } from './_lib'

export interface BskyProfile {
  did: string
  handle: string
  displayName?: string
  description?: string
  avatar?: string
  createdAt?: string
  indexedAt?: string
  followersCount?: number
  followsCount?: number
  postsCount?: number
  verification?: { verifiedStatus?: string }
  labels?: Array<{ val?: string }>
}

/** Handle Bluesky : un pseudo sans domaine devient `<pseudo>.bsky.social`. */
export function bskyHandle(username: string): string | null {
  const u = username.replace(/^@/, '').toLowerCase()
  if (/^did:plc:[a-z0-9]+$/.test(u)) return u
  const handle = u.includes('.') ? u : `${u}.bsky.social`
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(handle) ? handle : null
}

export function parseBsky(p: BskyProfile, lang: Lang): Parsed {
  return {
    profile: {
      username: p.handle,
      url: `https://bsky.app/profile/${p.handle}`,
      image: p.avatar,
      data: {
        user_id: p.did,
        display_name: p.displayName,
        bio: p.description,
        followers: p.followersCount,
        following: p.followsCount,
        posts: p.postsCount,
        verified: p.verification?.verifiedStatus === 'valid' || undefined,
        labels: (p.labels ?? []).map((l) => l.val).filter((v): v is string => !!v),
        created_at: toIso(p.createdAt)
      }
    },
    children: linkedEntities({ text: p.description, lang, self: { platform: 'bluesky', username: p.handle } })
  }
}

export default defineModule({
  id: 'social.bluesky',
  name: { fr: 'Profil Bluesky', en: 'Bluesky profile' },
  description: {
    fr: 'Profil Bluesky (API publique AT Protocol) : nom affiché, bio, avatar, DID, abonnés, publications et date de création. Un pseudo seul est cherché en <pseudo>.bsky.social.',
    en: 'Bluesky profile (public AT Protocol API): display name, bio, avatar, DID, followers, posts and creation date. A bare username is looked up as <username>.bsky.social.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('bluesky'),
  homepage: 'https://docs.bsky.app/docs/api/app-bsky-actor-get-profile',
  async run(input, ctx) {
    const handle = bskyHandle(usernameOf(input))
    if (!handle) throw new ModuleError('Handle Bluesky invalide', 'invalid_input')
    let profile: BskyProfile
    try {
      profile = await ctx.fetchJson<BskyProfile>('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile', { query: { actor: handle } })
    } catch (e) {
      const status = httpStatus(e)
      if (status === 400 || status === 404) return notFound()
      rethrow(e, 'Bluesky')
    }
    const parsed = parseBsky(profile, ctx.lang)
    return profileOutput(input, 'bluesky', parsed.profile, parsed.children, profile, ctx.lang)
  }
})
