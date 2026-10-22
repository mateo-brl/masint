import { defineModule, ModuleError, type OutEntity } from '@shared/modules'
import { previousNameEntities, spanText, type NameSpan } from './_history'
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

/** Opération du journal d'audit d'un DID (plc.directory). */
export interface PlcEntry {
  createdAt: string
  nullified?: boolean
  operation?: { type?: string; handle?: string; alsoKnownAs?: string[] }
}

/**
 * Handles successifs d'un DID d'après son journal d'audit : chaque opération qui change
 * `alsoKnownAs` (ou `handle` dans l'ancien format de création) ouvre une nouvelle période.
 */
export function plcHandleHistory(log: PlcEntry[]): NameSpan[] {
  const spans: NameSpan[] = []
  for (const e of log) {
    if (e.nullified || !e.operation) continue
    const day = e.createdAt?.slice(0, 10)
    if (e.operation.type === 'plc_tombstone') {
      const last = spans[spans.length - 1]
      if (last && !last.until) last.until = day
      continue
    }
    const aka = e.operation.alsoKnownAs?.find((a) => a.startsWith('at://'))?.slice(5) ?? e.operation.handle
    if (!aka) continue
    const handle = aka.toLowerCase()
    const last = spans[spans.length - 1]
    if (last?.name === handle) continue
    if (last) last.until = day
    spans.push({ name: handle, from: day })
  }
  return spans
}

/** Anciens handles en entités à vérifier ; `pseudo.bsky.social` devient le pseudo `pseudo`. */
export function previousHandles(spans: NameSpan[], current: string, lang: Lang): OutEntity[] {
  return previousNameEntities(spans, {
    current,
    service: 'Bluesky',
    source: 'plc.directory',
    lang,
    label: (s) => s.name.replace(/\.bsky\.social$/, ''),
    data: (s) => ({ handle: s.name })
  })
}

export function parseBsky(p: BskyProfile, lang: Lang, history: NameSpan[] = []): Parsed {
  const previous = history.filter((s) => s.name !== p.handle.toLowerCase())
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
        previous_usernames: [...new Set(previous.map((s) => s.name))],
        username_history: history.length > 1 ? history.map(spanText) : undefined,
        created_at: toIso(p.createdAt)
      }
    },
    children: [
      ...linkedEntities({ text: p.description, lang, self: { platform: 'bluesky', username: p.handle } }),
      ...previousHandles(history, p.handle, lang)
    ]
  }
}

export default defineModule({
  id: 'social.bluesky',
  name: { fr: 'Profil Bluesky', en: 'Bluesky profile' },
  description: {
    fr: 'Profil Bluesky (API publique AT Protocol) : nom affiché, bio, avatar, DID, abonnés, publications, date de création et anciens handles (journal public plc.directory, à vérifier). Un pseudo seul est cherché en <pseudo>.bsky.social.',
    en: 'Bluesky profile (public AT Protocol API): display name, bio, avatar, DID, followers, posts, creation date and previous handles (public plc.directory log, to review). A bare username is looked up as <username>.bsky.social.'
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
    // Journal d'audit du DID : handles successifs (pseudos précédents) avec leurs dates.
    const log = profile.did.startsWith('did:plc:')
      ? await ctx.fetchJson<PlcEntry[]>(`https://plc.directory/${profile.did}/log/audit`).catch(() => [] as PlcEntry[])
      : []
    const history = Array.isArray(log) ? plcHandleHistory(log) : []
    const parsed = parseBsky(profile, ctx.lang, history)
    return profileOutput(input, 'bluesky', parsed.profile, parsed.children, { profile, handles: history }, ctx.lang)
  }
})
