import { defineModule } from '@shared/modules'
import { acceptsPlatform, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface DuoUser {
  id: number
  username: string
  name?: string
  bio?: string
  location?: string
  picture?: string
  creationDate?: number
  streak?: number
  totalXp?: number
  hasPlus?: boolean
  learningLanguage?: string
  fromLanguage?: string
  profileCountry?: string | null
  emailVerified?: boolean
  hasFacebookId?: boolean
  hasGoogleId?: boolean
  hasAppleId?: boolean
  hasPhoneNumber?: boolean
  courses?: Array<{ title?: string; learningLanguage?: string; xp?: number }>
}

export function parseDuolingo(u: DuoUser, lang: Lang): Parsed {
  const picture = u.picture ? (u.picture.startsWith('//') ? 'https:' + u.picture : u.picture) : undefined
  const linked = [u.hasFacebookId && 'Facebook', u.hasGoogleId && 'Google', u.hasAppleId && 'Apple'].filter((x): x is string => !!x)
  return {
    profile: {
      username: u.username,
      url: `https://www.duolingo.com/profile/${u.username}`,
      // Les avatars générés (render/bg) n'apportent rien.
      image: picture && !/defaults|\/render\//.test(picture) ? `${picture}/xlarge` : undefined,
      data: {
        user_id: String(u.id),
        display_name: u.name,
        bio: u.bio || undefined,
        location: u.location || undefined,
        country: u.profileCountry ?? undefined,
        streak: u.streak,
        total_xp: u.totalXp,
        plus: u.hasPlus,
        courses: (u.courses ?? []).map((c) => `${c.title ?? c.learningLanguage} (${c.xp ?? 0} XP)`),
        email_verified: u.emailVerified,
        has_phone: u.hasPhoneNumber,
        linked_logins: linked,
        created_at: toIso(u.creationDate)
      }
    },
    children: linkedEntities({ text: u.bio, lang, self: { platform: 'duolingo', username: u.username } })
  }
}

export default defineModule({
  id: 'social.duolingo',
  name: { fr: 'Profil Duolingo', en: 'Duolingo profile' },
  description: {
    fr: 'Profil Duolingo : nom, localisation, date d’inscription, langues apprises, série, XP et indices de comptes liés (Facebook, Google, Apple, téléphone, email vérifié).',
    en: 'Duolingo profile: name, location, join date, languages learned, streak, XP and hints of linked logins (Facebook, Google, Apple, phone, verified email).'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('duolingo'),
  homepage: 'https://www.duolingo.com',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w.-]{1,40}$/)
    let res: { users?: DuoUser[] }
    try {
      res = await ctx.fetchJson('https://www.duolingo.com/2017-06-30/users', { query: { username } })
    } catch (e) {
      rethrow(e, 'Duolingo')
    }
    const user = res.users?.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? res.users?.[0]
    if (!user) return notFound()
    const parsed = parseDuolingo(user, ctx.lang)
    const { courses, ...raw } = user
    return profileOutput(input, 'duolingo', parsed.profile, parsed.children, { ...raw, courses: courses?.length }, ctx.lang)
  }
})
