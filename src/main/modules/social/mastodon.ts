import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { acceptsPlatform, compact, htmlToText, httpStatus, linkedEntities, toIso, usernameOf, type Lang } from './_lib'

/** Grandes instances interrogées pour un pseudo sans instance. */
export const INSTANCES = [
  'mastodon.social',
  'mastodon.online',
  'mstdn.social',
  'mas.to',
  'mastodon.world',
  'infosec.exchange',
  'fosstodon.org',
  'hachyderm.io',
  'piaille.fr',
  'framapiaf.org',
  'mamot.fr',
  'mastodon.xyz'
]

export interface MastodonAccount {
  id: string
  username: string
  acct: string
  display_name?: string
  note?: string
  url?: string
  avatar?: string
  avatar_static?: string
  created_at?: string
  last_status_at?: string | null
  followers_count?: number
  following_count?: number
  statuses_count?: number
  bot?: boolean
  locked?: boolean
  group?: boolean
  fields?: Array<{ name: string; value: string; verified_at?: string | null }>
}

/** `user@instance` → [user, instance] ; `user` seul → [user, null]. */
export function splitAcct(raw: string): [string, string | null] {
  const s = raw.replace(/^@/, '').trim()
  const at = s.indexOf('@')
  return at > 0 ? [s.slice(0, at), s.slice(at + 1).toLowerCase()] : [s, null]
}

export function parseMastodon(acc: MastodonAccount, instance: string, lang: Lang): { data: Record<string, PropValue>; image?: string; children: OutEntity[] } {
  const bio = acc.note ? htmlToText(acc.note) : undefined
  const fieldUrls: string[] = []
  const fieldText: string[] = []
  for (const f of acc.fields ?? []) {
    const href = f.value.match(/href="([^"]+)"/)
    if (href) fieldUrls.push(href[1])
    else fieldText.push(`${f.name}: ${htmlToText(f.value)}`)
  }
  const avatar = acc.avatar_static ?? acc.avatar
  return {
    data: compact({
      username: acc.username,
      url: acc.url,
      user_id: acc.id,
      instance,
      display_name: acc.display_name || undefined,
      bio,
      profile_fields: (acc.fields ?? []).map((f) => `${f.name}: ${htmlToText(f.value)}${f.verified_at ? ' ✓' : ''}`),
      followers: acc.followers_count,
      following: acc.following_count,
      posts: acc.statuses_count,
      bot: acc.bot || undefined,
      locked: acc.locked || undefined,
      created_at: toIso(acc.created_at),
      last_seen: toIso(acc.last_status_at ?? undefined)
    }),
    image: avatar && !/missing\.png$/.test(avatar) ? avatar : undefined,
    children: linkedEntities({
      text: [bio, ...fieldText].filter(Boolean).join('\n'),
      urls: fieldUrls,
      lang,
      self: { platform: 'mastodon', username: `${acc.username}@${instance}` }
    })
  }
}

async function lookup(ctx: ModuleContext, instance: string, user: string): Promise<MastodonAccount | null> {
  try {
    const acc = await ctx.fetchJson<MastodonAccount>(`https://${instance}/api/v1/accounts/lookup`, { query: { acct: user }, timeoutMs: 12000 })
    // L'instance peut renvoyer un compte distant connu : on ne garde que les comptes locaux.
    return acc.acct.includes('@') ? null : acc
  } catch (e) {
    const status = httpStatus(e)
    if (status === 404 || status === 410) return null
    throw e
  }
}

export default defineModule({
  id: 'social.mastodon',
  name: { fr: 'Comptes Mastodon', en: 'Mastodon accounts' },
  description: {
    fr: 'Cherche le pseudo sur une douzaine de grandes instances Mastodon (dont piaille.fr, framapiaf.org, mamot.fr) ou sur l’instance indiquée (pseudo@instance) : nom, bio, champs du profil vérifiés, abonnés, dates.',
    en: 'Looks the username up on a dozen large Mastodon instances (including piaille.fr, framapiaf.org, mamot.fr) or on the given instance (user@instance): name, bio, verified profile fields, followers, dates.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('mastodon'),
  homepage: 'https://docs.joinmastodon.org/methods/accounts/#lookup',
  async run(input, ctx) {
    const [user, given] = splitAcct(usernameOf(input))
    if (!/^[a-z0-9_]{1,30}$/i.test(user)) throw new ModuleError('Pseudo Mastodon invalide', 'invalid_input')
    if (given && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(given)) throw new ModuleError('Instance Mastodon invalide', 'invalid_input')
    const instances = given ? [given] : INSTANCES
    const results = await Promise.all(
      instances.map(async (instance) => {
        try {
          return { instance, acc: await lookup(ctx, instance, user) }
        } catch (e) {
          return { instance, error: e instanceof Error ? e.message : String(e) }
        }
      })
    )
    const found = results.filter((r): r is { instance: string; acc: MastodonAccount } => !!r.acc)
    const errors = results.filter((r) => 'error' in r)
    if (!found.length && errors.length === instances.length) throw new ModuleError(`Mastodon : aucune instance joignable (${errors.length})`, 'unavailable')
    const raw = { checked: instances, errors, accounts: found.map((f) => ({ instance: f.instance, ...f.acc })) }
    if (!found.length) return { found: false, raw }

    const entities: OutEntity[] = []
    let properties: Record<string, PropValue> | undefined
    found.forEach(({ instance, acc }, i) => {
      const parsed = parseMastodon(acc, instance, ctx.lang)
      const label = `${acc.username}@${instance}`
      if (input.type === 'account') {
        properties = parsed.data
        if (parsed.image) entities.push({ type: 'account', label: input.label, platform: input.platform ?? 'mastodon', image: parsed.image })
        entities.push(...parsed.children)
        return
      }
      const ref = `acc${i}`
      entities.push({
        ref,
        type: 'account',
        label,
        platform: 'mastodon',
        data: parsed.data,
        image: parsed.image,
        linkLabel: ctx.lang === 'fr' ? `compte Mastodon (${instance})` : `Mastodon account (${instance})`
      })
      entities.push(...parsed.children.map((c) => ({ ...c, from: ref })))
    })
    return { found: true, entities, properties, raw }
  }
})
