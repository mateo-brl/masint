import { defineModule, ModuleError } from '@shared/modules'
import { acceptsPlatform, notFound, profileOutput, requireUsername, scriptJson, type Parsed } from './_lib'

interface StravaAthlete {
  id: string
  firstName?: string
  lastName?: string
  profileImageUrl?: string
  hasDefaultProfileImage?: boolean
  profileVisibilitySetting?: string
  badge?: { badgeType?: string }
  location?: { city?: string; state?: string; country?: string }
}

export function parseStrava(html: string, requested: string): Parsed | null {
  const next = scriptJson<{ props?: { pageProps?: { athlete?: StravaAthlete } } }>(html, '__NEXT_DATA__')
  const a = next?.props?.pageProps?.athlete
  if (!a?.id) return null
  const loc = a.location ?? {}
  const vanity = /^\d+$/.test(requested) ? undefined : requested
  return {
    profile: {
      username: vanity ?? a.id,
      url: `https://www.strava.com/athletes/${vanity ?? a.id}`,
      image: a.hasDefaultProfileImage ? undefined : a.profileImageUrl,
      data: {
        user_id: a.id,
        display_name: [a.firstName, a.lastName].filter(Boolean).join(' ') || undefined,
        first_name: a.firstName,
        last_name: a.lastName,
        location: [loc.city, loc.state, loc.country].filter(Boolean).join(', ') || undefined,
        country: loc.country,
        subscription: a.badge?.badgeType,
        visibility: a.profileVisibilitySetting
      }
    },
    children: []
  }
}

export default defineModule({
  id: 'social.strava',
  name: { fr: 'Athlète Strava', en: 'Strava athlete' },
  description: {
    fr: 'Profil d’athlète Strava (pseudo personnalisé ou identifiant numérique) : prénom, nom, photo, localisation et type d’abonnement.',
    en: 'Strava athlete profile (custom name or numeric ID): first name, last name, picture, location and subscription type.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('strava'),
  homepage: 'https://www.strava.com',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w-]{2,40}$/)
    const res = await ctx.fetch(`https://www.strava.com/athletes/${encodeURIComponent(username)}`, { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    if (res.status === 404) return notFound()
    const html = await res.text()
    if (!res.ok) throw new ModuleError(`Strava : HTTP ${res.status}`, res.status === 429 ? 'rate_limited' : 'blocked')
    const parsed = parseStrava(html, username)
    if (!parsed) throw new ModuleError('Strava : page de profil illisible', 'other')
    return profileOutput(input, 'strava', parsed.profile, parsed.children, parsed.profile.data, ctx.lang)
  }
})
