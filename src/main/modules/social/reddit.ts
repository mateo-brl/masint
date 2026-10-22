import { defineModule, type ModuleContext } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { acceptsPlatform, decodeHtml, extractUrls, httpStatus, linkedEntities, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface RedditAbout {
  kind?: string
  data?: {
    id?: string
    name: string
    created_utc?: number
    link_karma?: number
    comment_karma?: number
    total_karma?: number
    icon_img?: string
    snoovatar_img?: string
    is_employee?: boolean
    is_mod?: boolean
    is_gold?: boolean
    verified?: boolean
    has_verified_email?: boolean
    is_suspended?: boolean
    subreddit?: { title?: string; public_description?: string; over_18?: boolean; display_name_prefixed?: string } | null
  }
}

/** Publication (t3) ou commentaire (t1) d'une liste `submitted.json` / `comments.json`. */
export interface RedditItem {
  subreddit?: string
  created_utc?: number
  url?: string
  domain?: string
  is_self?: boolean
  body?: string
}

export interface RedditListing {
  data?: { children?: Array<{ kind?: string; data?: RedditItem }> }
}

/** Domaines internes à Reddit, sans intérêt comme lien posté. */
const REDDIT_HOSTS = /(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$/i
/** En dessous, l'histogramme des heures ne permet pas d'estimer un fuseau. */
const MIN_ITEMS_FOR_OFFSET = 30

function topCounts(values: string[], n: number, format: (v: string, count: number) => string): string[] {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([v, c]) => format(v, c))
}

/**
 * Décalage horaire probable : la tranche de 6 heures la plus calme est supposée correspondre
 * à la nuit (2 h à 8 h, heure locale). Heuristique, à confirmer par d'autres indices.
 */
export function probableUtcOffset(hours: number[]): string | undefined {
  const total = hours.reduce((a, b) => a + b, 0)
  if (total < MIN_ITEMS_FOR_OFFSET) return undefined
  let best = 0
  let bestSum = Infinity
  for (let h = 0; h < 24; h++) {
    let sum = 0
    for (let k = 0; k < 6; k++) sum += hours[(h + k) % 24]
    if (sum < bestSum) {
      bestSum = sum
      best = h
    }
  }
  let offset = (2 - best + 24) % 24
  if (offset > 12) offset -= 24
  return `UTC${offset >= 0 ? '+' : ''}${offset}`
}

/** Sous-forums les plus fréquentés, heures d'activité (UTC), domaines des liens postés. */
export function redditActivity(items: RedditItem[]): Record<string, PropValue | undefined> {
  const dated = items.filter((i) => typeof i.created_utc === 'number')
  if (!dated.length) return {}
  const hours = new Array<number>(24).fill(0)
  for (const i of dated) hours[new Date(i.created_utc! * 1000).getUTCHours()] += 1
  const domains: string[] = []
  for (const i of items) {
    const urls = [...(i.is_self === false && i.url ? [i.url] : []), ...(i.body ? extractUrls(i.body) : [])]
    for (const u of urls) {
      try {
        const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '')
        if (!REDDIT_HOSTS.test(host)) domains.push(host)
      } catch {
        /* lien invalide ignoré */
      }
    }
  }
  const last = Math.max(...dated.map((i) => i.created_utc!))
  return {
    top_subreddits: topCounts(
      items.map((i) => i.subreddit ?? '').filter(Boolean),
      10,
      (v, c) => `r/${v} (${c})`
    ),
    activity_hours_utc: hours.flatMap((n, h) => (n ? [`${String(h).padStart(2, '0')} h : ${n}`] : [])),
    probable_utc_offset: probableUtcOffset(hours),
    link_domains: topCounts(domains, 10, (v, c) => `${v} (${c})`),
    activity_sample_size: dated.length,
    last_seen: toIso(last)
  }
}

/** Publications et commentaires récents (100 de chaque au plus) ; une liste refusée est ignorée. */
async function recentItems(ctx: ModuleContext, username: string): Promise<RedditItem[]> {
  const lists = await Promise.all(
    ['submitted', 'comments'].map((kind) =>
      ctx
        .fetchJson<RedditListing>(`https://www.reddit.com/user/${encodeURIComponent(username)}/${kind}.json`, { query: { limit: 100, raw_json: 1 } })
        .catch(() => null)
    )
  )
  return lists.flatMap((l) => (l?.data?.children ?? []).map((c) => c.data).filter((d): d is RedditItem => !!d))
}

export function parseReddit(about: RedditAbout, lang: Lang, items: RedditItem[] = []): Parsed | null {
  const d = about.data
  if (!d?.name) return null
  const bio = d.subreddit?.public_description ? decodeHtml(d.subreddit.public_description) : undefined
  const avatar = decodeHtml(d.snoovatar_img || d.icon_img || '').split('?')[0] || undefined
  return {
    profile: {
      username: d.name,
      url: `https://www.reddit.com/user/${d.name}`,
      image: avatar && !/default_avatars|avatar_default/.test(avatar) ? avatar : undefined,
      data: {
        user_id: d.id ? `t2_${d.id}` : undefined,
        display_name: d.subreddit?.title || undefined,
        bio,
        created_at: toIso(d.created_utc),
        link_karma: d.link_karma,
        comment_karma: d.comment_karma,
        total_karma: d.total_karma,
        email_verified: d.has_verified_email,
        moderator: d.is_mod,
        employee: d.is_employee || undefined,
        suspended: d.is_suspended || undefined,
        nsfw: d.subreddit?.over_18 || undefined,
        ...redditActivity(items)
      }
    },
    children: linkedEntities({ text: bio, lang, self: { platform: 'reddit', username: d.name } })
  }
}

export default defineModule({
  id: 'social.reddit',
  name: { fr: 'Profil Reddit', en: 'Reddit profile' },
  description: {
    fr: 'Profil Reddit public (about.json) : date de création, karma, modérateur, email vérifié, bio et avatar, puis activité récente (200 publications et commentaires au plus) : sous-forums les plus fréquentés, heures d’activité en UTC avec fuseau probable, domaines des liens postés. Reddit bloque souvent les adresses IP de centres de données.',
    en: 'Public Reddit profile (about.json): creation date, karma, moderator, verified email, bio and avatar, then recent activity (up to 200 posts and comments): most visited subreddits, activity hours in UTC with likely timezone, domains of posted links. Reddit often blocks datacenter IP addresses.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('reddit'),
  homepage: 'https://www.reddit.com/dev/api#GET_user_{username}_about',
  experimental: true,
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w-]{3,20}$/)
    let about: RedditAbout
    try {
      about = await ctx.fetchJson<RedditAbout>(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`, {
        query: { raw_json: 1 }
      })
    } catch (e) {
      if (httpStatus(e) === 404) return notFound()
      rethrow(e, 'Reddit')
    }
    if (!about.data?.name) return notFound(about)
    const items = await recentItems(ctx, about.data.name)
    const parsed = parseReddit(about, ctx.lang, items)
    if (!parsed) return notFound(about)
    return profileOutput(input, 'reddit', parsed.profile, parsed.children, about, ctx.lang)
  }
})
