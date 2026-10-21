import { defineModule, type OutEntity } from '@shared/modules'
import { acceptsPlatform, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface HfOverview {
  _id?: string
  user: string
  fullname?: string
  avatarUrl?: string
  details?: string
  isPro?: boolean
  type?: string
  createdAt?: string
  numFollowers?: number
  numFollowing?: number
  numModels?: number
  numDatasets?: number
  numSpaces?: number
  numPapers?: number
  orgs?: Array<{ name: string; fullname?: string }>
}

export function parseHf(u: HfOverview, lang: Lang): Parsed {
  const orgs: OutEntity[] = (u.orgs ?? []).slice(0, 20).map((o) => ({
    type: 'organization',
    label: o.fullname || o.name,
    data: { website: `https://huggingface.co/${o.name}` },
    linkLabel: lang === 'fr' ? 'membre (Hugging Face)' : 'member (Hugging Face)'
  }))
  const avatar = u.avatarUrl?.startsWith('/') ? `https://huggingface.co${u.avatarUrl}` : u.avatarUrl
  return {
    profile: {
      username: u.user,
      url: `https://huggingface.co/${u.user}`,
      image: avatar,
      data: {
        user_id: u._id,
        display_name: u.fullname,
        bio: u.details || undefined,
        followers: u.numFollowers,
        following: u.numFollowing,
        models: u.numModels,
        datasets: u.numDatasets,
        spaces: u.numSpaces,
        papers: u.numPapers,
        pro: u.isPro || undefined,
        created_at: toIso(u.createdAt)
      }
    },
    children: [...orgs, ...linkedEntities({ text: u.details, lang, self: { platform: 'huggingface', username: u.user } })]
  }
}

export default defineModule({
  id: 'social.huggingface',
  name: { fr: 'Profil Hugging Face', en: 'Hugging Face profile' },
  description: {
    fr: 'Profil Hugging Face : nom, bio, date de création, abonnés, modèles, jeux de données, espaces et organisations dont le compte est membre.',
    en: 'Hugging Face profile: name, bio, creation date, followers, models, datasets, spaces and organizations the account belongs to.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('huggingface'),
  homepage: 'https://huggingface.co',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w.-]{1,96}$/)
    let user: HfOverview
    try {
      user = await ctx.fetchJson<HfOverview>(`https://huggingface.co/api/users/${encodeURIComponent(username)}/overview`)
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Hugging Face')
    }
    const parsed = parseHf(user, ctx.lang)
    return profileOutput(input, 'huggingface', parsed.profile, parsed.children, user, ctx.lang)
  }
})
