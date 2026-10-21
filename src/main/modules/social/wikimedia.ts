import { defineModule } from '@shared/modules'
import { acceptsPlatform, notFound, profileOutput, requireUsername, rethrow, toIso, type Parsed } from './_lib'

export interface GlobalUserInfo {
  missing?: string
  id?: number
  name?: string
  home?: string
  registration?: string
  groups?: string[]
  locked?: string
  editcount?: number
  merged?: Array<{ wiki: string; url: string; editcount?: number; registration?: string; blocked?: unknown }>
}

export function parseWikimedia(g: GlobalUserInfo): Parsed | null {
  if (g.missing !== undefined || !g.name) return null
  const merged = g.merged ?? []
  const active = merged.filter((m) => (m.editcount ?? 0) > 0).sort((a, b) => (b.editcount ?? 0) - (a.editcount ?? 0))
  const edits = merged.reduce((s, m) => s + (m.editcount ?? 0), 0)
  const home = merged.find((m) => m.wiki === g.home)
  return {
    profile: {
      username: g.name,
      url: `${home?.url ?? 'https://meta.wikimedia.org'}/wiki/User:${encodeURIComponent(g.name.replace(/ /g, '_'))}`,
      data: {
        user_id: g.id !== undefined ? String(g.id) : undefined,
        home_wiki: g.home,
        edits,
        wikis: merged.length,
        active_wikis: active.slice(0, 30).map((m) => `${m.url.replace(/^https?:\/\//, '')} (${m.editcount})`),
        groups: g.groups ?? [],
        locked: g.locked !== undefined || undefined,
        blocked_on: merged.filter((m) => m.blocked).map((m) => m.wiki),
        created_at: toIso(g.registration)
      }
    },
    children: []
  }
}

export default defineModule({
  id: 'social.wikimedia',
  name: { fr: 'Compte Wikipédia / Wikimedia', en: 'Wikipedia / Wikimedia account' },
  description: {
    fr: 'Compte global Wikimedia : date de création, wiki d’origine, nombre de modifications par wiki (langues et projets fréquentés), droits et blocages.',
    en: 'Global Wikimedia account: creation date, home wiki, edit count per wiki (languages and projects used), rights and blocks.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('wikipedia'),
  homepage: 'https://www.mediawiki.org/wiki/Extension:CentralAuth/API',
  async run(input, ctx) {
    const raw = requireUsername(input, /^[^#<>[\]|{}/@]{1,85}$/)
    // Les pseudos MediaWiki commencent par une majuscule et utilisent des espaces.
    const username = raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, ' ')
    let res: { query?: { globaluserinfo?: GlobalUserInfo } }
    try {
      res = await ctx.fetchJson('https://meta.wikimedia.org/w/api.php', {
        // Politique Wikimedia : User-Agent identifiant l'outil, sinon limitation rapide.
        headers: { 'user-agent': 'MASINT/0.1 (https://github.com/mateo-brl/masint)' },
        query: { action: 'query', meta: 'globaluserinfo', guiuser: username, guiprop: 'merged|groups|editcount', format: 'json', formatversion: 1 }
      })
    } catch (e) {
      rethrow(e, 'Wikimedia')
    }
    const g = res.query?.globaluserinfo
    const parsed = g ? parseWikimedia(g) : null
    if (!parsed) return notFound(g)
    return profileOutput(input, 'wikipedia', parsed.profile, parsed.children, { ...g, merged: g?.merged?.length }, ctx.lang)
  }
})
