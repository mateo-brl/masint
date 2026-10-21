import { defineModule, ModuleError } from '@shared/modules'
import { acceptsPlatform, blockedError, linkedEntities, looksBlocked, notFound, profileOutput, requireUsername, scriptJson, toIso, toNumber, type Lang, type Parsed } from './_lib'

export interface TikTokUserInfo {
  user?: {
    id?: string
    uniqueId: string
    nickname?: string
    signature?: string
    avatarLarger?: string
    createTime?: number
    verified?: boolean
    privateAccount?: boolean
    secUid?: string
    language?: string
    region?: string
    bioLink?: { link?: string } | null
    isOrganization?: number
    nickNameModifyTime?: number
    uniqueIdModifyTime?: number
  }
  stats?: { followerCount?: number; followingCount?: number; heart?: number; videoCount?: number; friendCount?: number }
  statsV2?: Record<string, string>
}

interface Rehydration {
  __DEFAULT_SCOPE__?: { 'webapp.user-detail'?: { statusCode?: number; userInfo?: TikTokUserInfo } }
}

/** Lit le bloc `__UNIVERSAL_DATA_FOR_REHYDRATION__` de la page de profil. */
export function parseTikTokPage(html: string): { status: 'found' | 'not_found' | 'unknown'; info?: TikTokUserInfo; code?: number } {
  const data = scriptJson<Rehydration>(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__')
  const detail = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']
  if (!detail) return { status: 'unknown' }
  // 10222 (ErrBizUserSecret) : compte privé, le profil de base reste fourni.
  if ((detail.statusCode === 0 || detail.statusCode === 10222) && detail.userInfo?.user?.uniqueId)
    return { status: 'found', info: detail.userInfo }
  // 10221 : compte inexistant (vérifié). Les autres codes sont remontés tels quels.
  if (detail.statusCode === 10221) return { status: 'not_found', code: detail.statusCode }
  return { status: 'unknown', code: detail.statusCode }
}

export function parseTikTok(info: TikTokUserInfo, lang: Lang): Parsed {
  const u = info.user!
  const s2 = info.statsV2 ?? {}
  const s = info.stats ?? {}
  const n = (k: keyof NonNullable<TikTokUserInfo['stats']>): number | undefined => toNumber(s2[k]) ?? s[k]
  return {
    profile: {
      username: u.uniqueId,
      url: `https://www.tiktok.com/@${u.uniqueId}`,
      image: u.avatarLarger,
      data: {
        user_id: u.id,
        sec_uid: u.secUid,
        display_name: u.nickname,
        bio: u.signature || undefined,
        followers: n('followerCount'),
        following: n('followingCount'),
        likes: n('heart'),
        videos: n('videoCount'),
        friends: n('friendCount'),
        verified: u.verified || undefined,
        private: u.privateAccount || undefined,
        organization: u.isOrganization ? true : undefined,
        language: u.language,
        region: u.region,
        created_at: toIso(u.createTime),
        nickname_changed_at: toIso(u.nickNameModifyTime),
        username_changed_at: toIso(u.uniqueIdModifyTime)
      }
    },
    children: linkedEntities({ text: u.signature, urls: [u.bioLink?.link], lang, self: { platform: 'tiktok', username: u.uniqueId } })
  }
}

export default defineModule({
  id: 'social.tiktok',
  name: { fr: 'Profil TikTok', en: 'TikTok profile' },
  description: {
    fr: 'Profil TikTok public (page web) : nom, bio, avatar, date de création, abonnés, mentions j’aime, vidéos, compte privé ou vérifié, langue et dates de changement de nom.',
    en: 'Public TikTok profile (web page): name, bio, avatar, creation date, followers, likes, videos, private or verified account, language and name change dates.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('tiktok'),
  homepage: 'https://www.tiktok.com',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w.]{2,24}$/)
    const res = await ctx.fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    const html = await res.text()
    if (res.status === 404) return notFound()
    const page = parseTikTokPage(html)
    if (page.status === 'not_found') return notFound({ statusCode: page.code })
    if (page.status !== 'found' && (res.status === 403 || looksBlocked(html))) throw blockedError('TikTok', res.status)
    if (page.status !== 'found' || !page.info) throw new ModuleError(`TikTok : réponse inattendue (HTTP ${res.status}, code ${page.code ?? '?'})`, 'blocked')
    const parsed = parseTikTok(page.info, ctx.lang)
    return profileOutput(input, 'tiktok', parsed.profile, parsed.children, page.info, ctx.lang)
  }
})
