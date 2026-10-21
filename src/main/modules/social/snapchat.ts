import { defineModule, ModuleError } from '@shared/modules'
import { acceptsPlatform, linkedEntities, metaContent, notFound, profileOutput, requireUsername, scriptJson, toNumber, type Lang, type Parsed } from './_lib'

interface SnapPublicProfile {
  username: string
  title?: string
  bio?: string
  websiteUrl?: string
  profilePictureUrl?: string
  subscriberCount?: string
  address?: string
  badge?: number
  categoryStringId?: string
  subcategoryStringId?: string
  snapcodeImageUrl?: string
}

interface SnapUserInfo {
  username: string
  displayName?: string
  snapcodeImageUrl?: string
  bitmoji3d?: { avatarImage?: { url?: string } } | null
}

interface SnapNext {
  props?: {
    pageProps?: {
      userProfile?: { $case?: string; publicProfileInfo?: SnapPublicProfile; userInfo?: SnapUserInfo } | null
    }
  }
}

/** Profil public (créateur) ou profil simple (nom affiché, Bitmoji) depuis `__NEXT_DATA__`. */
export function parseSnapchat(html: string, lang: Lang): Parsed | null {
  const next = scriptJson<SnapNext>(html, '__NEXT_DATA__')
  const up = next?.props?.pageProps?.userProfile
  if (!up) return null
  if (up.publicProfileInfo) {
    const p = up.publicProfileInfo
    const sub = p.subcategoryStringId?.replace(/^public-profile-subcategory-v\d+-/, '')
    return {
      profile: {
        username: p.username,
        url: `https://www.snapchat.com/@${p.username}`,
        image: p.profilePictureUrl,
        data: {
          display_name: p.title,
          bio: p.bio || undefined,
          location: p.address || undefined,
          website: p.websiteUrl || undefined,
          followers: toNumber(p.subscriberCount),
          profile_type: lang === 'fr' ? 'profil public' : 'public profile',
          category: sub,
          verified: p.badge === 1 || undefined
        }
      },
      children: linkedEntities({ text: p.bio, urls: [p.websiteUrl], lang, self: { platform: 'snapchat', username: p.username } })
    }
  }
  if (up.userInfo) {
    const u = up.userInfo
    return {
      profile: {
        username: u.username,
        url: `https://www.snapchat.com/@${u.username}`,
        image: u.bitmoji3d?.avatarImage?.url ?? metaContent(html, 'og:image'),
        data: { display_name: u.displayName, profile_type: lang === 'fr' ? 'profil personnel' : 'personal profile' }
      },
      children: []
    }
  }
  return null
}

export default defineModule({
  id: 'social.snapchat',
  name: { fr: 'Profil Snapchat', en: 'Snapchat profile' },
  description: {
    fr: 'Profil Snapchat (page snapchat.com/@pseudo) : nom affiché, Bitmoji ou photo et, pour les profils publics, bio, site, localisation et nombre d’abonnés.',
    en: 'Snapchat profile (snapchat.com/@username page): display name, Bitmoji or picture and, for public profiles, bio, website, location and subscriber count.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('snapchat'),
  homepage: 'https://www.snapchat.com',
  async run(input, ctx) {
    const username = requireUsername(input, /^[a-z][\w.-]{1,30}$/i)
    const res = await ctx.fetch(`https://www.snapchat.com/@${encodeURIComponent(username.toLowerCase())}`, { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    if (res.status === 404) return notFound()
    const html = await res.text()
    if (!res.ok) throw new ModuleError(`Snapchat : HTTP ${res.status}`, res.status === 429 ? 'rate_limited' : 'blocked')
    const parsed = parseSnapchat(html, ctx.lang)
    if (!parsed) return notFound()
    return profileOutput(input, 'snapchat', parsed.profile, parsed.children, parsed.profile, ctx.lang)
  }
})
