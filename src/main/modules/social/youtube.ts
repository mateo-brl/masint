import { defineModule, ModuleError, type ModuleContext } from '@shared/modules'
import { acceptsPlatform, linkedEntities, notFound, parseCompactNumber, profileOutput, rethrow, toIso, toNumber, usernameOf, type Lang, type Parsed } from './_lib'

// Page de chaîne en anglais (nombres « 21.4M subscribers ») et sans bandeau de consentement européen.
const HEADERS = { 'accept-language': 'en-US,en;q=0.9', cookie: 'SOCS=CAI' }

export interface YtPage {
  channelId?: string
  title?: string
  description?: string
  avatar?: string
  handle?: string
  vanityUrl?: string
  keywords?: string
  subscribers?: number
  videos?: number
  familySafe?: boolean
  aboutToken?: string
  clientVersion?: string
}

export interface YtAbout {
  description?: string
  country?: string
  subscribers?: number
  views?: number
  videos?: number
  joined?: string
  links: Array<{ title?: string; url: string }>
  hasBusinessEmail: boolean
}

/** Données de la page de chaîne (`ytInitialData`). */
export function parseYtPage(html: string): YtPage | null {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/)
  if (!m) return null
  let d: Record<string, unknown>
  try {
    d = JSON.parse(m[1]) as Record<string, unknown>
  } catch {
    return null
  }
  const meta = (d.metadata as { channelMetadataRenderer?: Record<string, unknown> } | undefined)?.channelMetadataRenderer
  if (!meta) return null
  const header = JSON.stringify(d.header ?? {})
  const parts = [...header.matchAll(/"metadataParts":\[(.*?)\]\}/g)].flatMap((x) => [...x[1].matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)].map((y) => JSON.parse(`"${y[1]}"`) as string))
  const handle = parts.find((p) => p.startsWith('@'))
  const subs = parts.find((p) => /subscribers?$/.test(p))
  const vids = parts.find((p) => /videos?$/.test(p))
  const thumbs = (meta.avatar as { thumbnails?: Array<{ url: string }> } | undefined)?.thumbnails ?? []
  return {
    channelId: meta.externalId as string | undefined,
    title: meta.title as string | undefined,
    description: (meta.description as string | undefined) || undefined,
    avatar: thumbs[thumbs.length - 1]?.url,
    handle: handle?.slice(1),
    vanityUrl: meta.vanityChannelUrl as string | undefined,
    keywords: (meta.keywords as string | undefined) || undefined,
    subscribers: parseCompactNumber(subs),
    videos: parseCompactNumber(vids),
    familySafe: meta.isFamilySafe as boolean | undefined,
    aboutToken: header.match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1],
    clientVersion: html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
  }
}

/** Panneau « À propos » renvoyé par l'API interne (aboutChannelViewModel). */
export function parseYtAbout(json: unknown): YtAbout | null {
  const s = JSON.stringify(json)
  const start = s.indexOf('"aboutChannelViewModel":')
  if (start < 0) return null
  // Extraction de l'objet par comptage des accolades.
  let depth = 0
  let end = -1
  const from = s.indexOf('{', start)
  for (let i = from, inStr = false; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      end = i
      break
    }
  }
  if (end < 0) return null
  const a = JSON.parse(s.slice(from, end + 1)) as {
    description?: string
    country?: string
    subscriberCountText?: string
    viewCountText?: string
    videoCountText?: string
    joinedDateText?: { content?: string }
    signInForBusinessEmail?: unknown
    links?: Array<{ channelExternalLinkViewModel?: { title?: { content?: string }; link?: { content?: string } } }>
  }
  const joined = a.joinedDateText?.content?.replace(/^Joined\s+/i, '')
  return {
    description: a.description,
    country: a.country,
    subscribers: parseCompactNumber(a.subscriberCountText),
    views: toNumber(a.viewCountText?.replace(/\s*views?$/i, '')),
    videos: toNumber(a.videoCountText?.replace(/\s*videos?$/i, '')),
    joined: joined ? toIso(`${joined} 12:00 UTC`) : undefined,
    links: (a.links ?? [])
      .map((l) => ({ title: l.channelExternalLinkViewModel?.title?.content, url: l.channelExternalLinkViewModel?.link?.content ?? '' }))
      .filter((l) => !!l.url),
    hasBusinessEmail: !!a.signInForBusinessEmail
  }
}

export function parseYoutube(page: YtPage, about: YtAbout | null, lang: Lang): Parsed {
  const handle = page.handle ?? page.vanityUrl?.split('/@')[1] ?? page.channelId ?? ''
  const description = about?.description ?? page.description
  return {
    profile: {
      username: handle,
      url: page.handle ? `https://www.youtube.com/@${page.handle}` : `https://www.youtube.com/channel/${page.channelId}`,
      image: page.avatar,
      data: {
        user_id: page.channelId,
        display_name: page.title,
        bio: description,
        location: about?.country,
        followers: about?.subscribers ?? page.subscribers,
        videos: about?.videos ?? page.videos,
        views: about?.views,
        keywords: page.keywords,
        business_email_hidden: about?.hasBusinessEmail || undefined,
        created_at: about?.joined
      }
    },
    children: linkedEntities({ text: description, urls: about?.links.map((l) => l.url), lang, self: { platform: 'youtube', username: handle } })
  }
}

async function fetchAbout(ctx: ModuleContext, page: YtPage): Promise<YtAbout | null> {
  if (!page.aboutToken) return null
  try {
    const json = await ctx.fetchJson('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: HEADERS,
      json: {
        context: { client: { clientName: 'WEB', clientVersion: page.clientVersion ?? '2.20250101.00.00', hl: 'en', gl: 'US' } },
        continuation: page.aboutToken
      }
    })
    return parseYtAbout(json)
  } catch {
    return null
  }
}

export default defineModule({
  id: 'social.youtube',
  name: { fr: 'Chaîne YouTube', en: 'YouTube channel' },
  description: {
    fr: 'Chaîne YouTube (@pseudo ou identifiant UC...) : nom, description, pays, date de création, abonnés, vues, vidéos, liens externes et présence d’un email professionnel masqué.',
    en: 'YouTube channel (@handle or UC... ID): name, description, country, creation date, subscribers, views, videos, external links and whether a hidden business email exists.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('youtube'),
  homepage: 'https://www.youtube.com',
  async run(input, ctx) {
    const u = usernameOf(input)
    let path: string
    if (/^UC[\w-]{22}$/.test(u)) path = `channel/${u}`
    else if (/^[\w.-]{3,30}$/.test(u)) path = `@${encodeURIComponent(u)}`
    else throw new ModuleError('Pseudo YouTube invalide', 'invalid_input')
    const res = await ctx.fetch(`https://www.youtube.com/${path}`, { headers: HEADERS, query: { hl: 'en', gl: 'US' } })
    if (res.status === 404) return notFound()
    const html = await res.text()
    if (!res.ok) rethrow(Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }), 'YouTube')
    if (/consent\.youtube\.com/.test(res.url)) throw new ModuleError('YouTube : page de consentement', 'blocked')
    const page = parseYtPage(html)
    if (!page?.channelId) throw new ModuleError('YouTube : page de chaîne illisible', 'other')
    const about = await fetchAbout(ctx, page)
    const parsed = parseYoutube(page, about, ctx.lang)
    return profileOutput(input, 'youtube', parsed.profile, parsed.children, { ...page, aboutToken: undefined, about }, ctx.lang)
  }
})
