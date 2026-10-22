// Threads : page publique threads.com/@pseudo, lisible sans compte. Le pseudo Threads
// est celui du compte Instagram : c'est la seule couverture d'Instagram sans connexion.
// Sans l'en-tête `Sec-Fetch-Mode: navigate`, la page revient sans balises Open Graph.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { acceptsPlatform, linkedEntities, metaContent, notFound, parseCompactNumber, profileOutput, requireUsername, type Lang, type Parsed } from './_lib'

/** Compte officiel, toujours public : sert de témoin quand un pseudo renvoie vers la connexion. */
const CONTROL = 'threads'

const HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-fetch-site': 'none'
}

/**
 * Balises Open Graph de la page de profil :
 * - og:title « NASA (@nasa) • Threads, Say more » ;
 * - og:description « 12.8M Followers • 149 Threads • bio. See the latest conversations with @nasa. » ;
 * - og:image : avatar.
 */
export function parseThreads(html: string, lang: Lang): Parsed | null {
  const title = metaContent(html, 'og:title')
  const m = title?.match(/^(.*?)\s*\(@([\w.]+)\)/) ?? title?.match(/^()@([\w.]+)/)
  if (!m) return null
  const username = m[2]
  const parts = (metaContent(html, 'og:description') ?? '').split(/\s*•\s*/)
  const followers = parts.find((p) => /followers?$/i.test(p))
  const threads = parts.find((p) => /threads?$/i.test(p))
  const bio = parts
    .filter((p) => p !== followers && p !== threads)
    .join(' • ')
    .replace(/\.?\s*See the latest conversations with @[\w.]+\.?\s*$/i, '')
    .trim()
  const id = html.match(/"is_self_profile":false,"user_id":"(\d+)"/)?.[1]
  return {
    profile: {
      username,
      url: `https://www.threads.com/@${username}`,
      image: metaContent(html, 'og:image') || undefined,
      data: {
        user_id: id,
        display_name: m[1].trim() || undefined,
        bio: bio || undefined,
        followers: parseCompactNumber(followers),
        posts: parseCompactNumber(threads)
      }
    },
    children: linkedEntities({ text: bio, lang, self: { platform: 'threads', username } })
  }
}

/** Page de profil ; `null` quand Threads renvoie vers la page de connexion (pseudo inconnu). */
async function fetchProfile(ctx: ModuleContext, username: string): Promise<string | null> {
  const res = await ctx.fetch(`https://www.threads.com/@${encodeURIComponent(username)}`, { headers: HEADERS, redirect: 'manual' })
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined)
    if (/\/login/.test(res.headers.get('location') ?? '')) return null
    throw new ModuleError(`Threads : redirection inattendue (HTTP ${res.status})`, 'other')
  }
  if (res.status === 404) return null
  if (res.status === 429) throw new ModuleError('Threads : trop de requêtes, réessayer plus tard', 'rate_limited')
  if (!res.ok) throw new ModuleError(`Threads : réponse inattendue (HTTP ${res.status})`, res.status >= 500 ? 'unavailable' : 'blocked')
  return res.text()
}

export default defineModule({
  id: 'social.threads',
  name: { fr: 'Profil Threads (et Instagram)', en: 'Threads (and Instagram) profile' },
  description: {
    fr: 'Profil Threads public (threads.com/@pseudo, sans compte) : nom, bio, avatar, abonnés, nombre de threads, identifiant et liens de la bio. Le pseudo Threads étant celui du compte Instagram, un compte Instagram du même pseudo est proposé à vérifier.',
    en: 'Public Threads profile (threads.com/@username, no account needed): name, bio, avatar, followers, thread count, ID and bio links. As the Threads username is the Instagram one, an Instagram account with the same username is offered for review.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('threads', 'instagram'),
  homepage: 'https://www.threads.com',
  experimental: true,
  async run(input, ctx): Promise<ModuleOutput> {
    const fr = ctx.lang === 'fr'
    const username = requireUsername(input, /^[\w.]{1,30}$/).toLowerCase()
    const html = await fetchProfile(ctx, username)
    if (html === null) {
      // Une redirection vers la connexion peut aussi venir d'un blocage : le compte témoin tranche.
      if ((await fetchProfile(ctx, CONTROL)) === null)
        throw new ModuleError('Threads : même le compte témoin renvoie vers la connexion (adresse IP bloquée ?)', 'blocked')
      return notFound()
    }
    const parsed = parseThreads(html, ctx.lang)
    if (!parsed) throw new ModuleError('Threads : page de profil sans balises (en-têtes refusés ou format modifié)', 'other')
    if (input.type === 'account' && input.platform === 'instagram') {
      // Entrée Instagram : le compte Threads du même pseudo appartient forcément à ce compte.
      return profileOutput({ ...input, type: 'username', platform: null }, 'threads', parsed.profile, parsed.children, parsed.profile.data, ctx.lang)
    }
    const instagram: OutEntity = {
      type: 'account',
      platform: 'instagram',
      label: parsed.profile.username,
      data: { username: parsed.profile.username, url: `https://www.instagram.com/${parsed.profile.username}/` },
      linkLabel: fr ? 'compte Instagram (même pseudo)' : 'Instagram account (same username)',
      strength: 'same',
      review: true,
      reviewReason: fr ? 'le pseudo Threads est le pseudo Instagram' : 'the Threads username is the Instagram username'
    }
    return profileOutput(input, 'threads', parsed.profile, [...parsed.children, instagram], parsed.profile.data, ctx.lang)
  }
})
