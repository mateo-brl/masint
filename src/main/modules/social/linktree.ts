import { defineModule, ModuleError } from '@shared/modules'
import { acceptsPlatform, linkedEntities, notFound, profileOutput, requireUsername, scriptJson, toIso, type Lang, type Parsed } from './_lib'

interface LinktreeProps {
  account?: {
    id?: number
    username: string
    pageTitle?: string
    description?: string | null
    profilePictureUrl?: string | null
    createdAt?: number
    updatedAt?: number
    country?: string | null
    timezone?: string | null
    tier?: string
    isActive?: boolean
  }
  socialLinks?: Array<{ type?: string; url?: string }>
  links?: Array<{ title?: string; url?: string; type?: string; locked?: unknown }>
  isProfileVerified?: boolean
}

export function parseLinktree(html: string, lang: Lang): Parsed | null {
  const next = scriptJson<{ props?: { pageProps?: LinktreeProps } }>(html, '__NEXT_DATA__')
  const pp = next?.props?.pageProps
  const a = pp?.account
  if (!a?.username) return null
  const links = (pp?.links ?? []).filter((l) => l.url && !l.locked)
  return {
    profile: {
      username: a.username,
      url: `https://linktr.ee/${a.username}`,
      image: a.profilePictureUrl ?? undefined,
      data: {
        user_id: a.id !== undefined ? String(a.id) : undefined,
        display_name: a.pageTitle,
        bio: a.description ?? undefined,
        country: a.country ?? undefined,
        timezone: a.timezone ?? undefined,
        tier: a.tier,
        verified: pp?.isProfileVerified || undefined,
        links: links.map((l) => `${l.title ?? ''} ${l.url}`.trim()).slice(0, 50),
        created_at: toIso(a.createdAt),
        updated_at: toIso(a.updatedAt)
      }
    },
    children: linkedEntities({
      text: a.description ?? undefined,
      urls: [...(pp?.socialLinks ?? []).map((s) => s.url), ...links.slice(0, 30).map((l) => l.url)],
      lang,
      self: { platform: 'linktree', username: a.username }
    })
  }
}

export default defineModule({
  id: 'social.linktree',
  name: { fr: 'Page Linktree', en: 'Linktree page' },
  description: {
    fr: 'Page Linktree : titre, bio, photo, pays, fuseau horaire, date de création, réseaux sociaux et liens publiés (transformés en comptes quand la plateforme est reconnue).',
    en: 'Linktree page: title, bio, picture, country, timezone, creation date, social networks and published links (turned into accounts when the platform is known).'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('linktree'),
  homepage: 'https://linktr.ee',
  async run(input, ctx) {
    const username = requireUsername(input, /^[\w.-]{2,40}$/)
    const res = await ctx.fetch(`https://linktr.ee/${encodeURIComponent(username)}`, { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    if (res.status === 404) return notFound()
    const html = await res.text()
    if (!res.ok) throw new ModuleError(`Linktree : HTTP ${res.status}`, res.status === 429 ? 'rate_limited' : 'blocked')
    const parsed = parseLinktree(html, ctx.lang)
    if (!parsed) return notFound()
    return profileOutput(input, 'linktree', parsed.profile, parsed.children, parsed.profile.data, ctx.lang)
  }
})
