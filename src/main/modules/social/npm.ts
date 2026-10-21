import { defineModule, type OutEntity } from '@shared/modules'
import { acceptsPlatform, notFound, profileOutput, requireUsername, rethrow, toIso, type Lang, type Parsed } from './_lib'

export interface NpmSearch {
  total: number
  objects: Array<{
    package: {
      name: string
      date?: string
      publisher?: { username?: string; email?: string }
      maintainers?: Array<{ username?: string; email?: string }>
      links?: { repository?: string; homepage?: string }
    }
  }>
}

export function parseNpm(res: NpmSearch, username: string, lang: Lang): Parsed | null {
  const me = username.toLowerCase()
  // La recherche peut être approximative : on ne garde que les paquets où le pseudo est mainteneur.
  const mine = res.objects.filter(
    (o) => o.package.publisher?.username?.toLowerCase() === me || (o.package.maintainers ?? []).some((m) => m.username?.toLowerCase() === me)
  )
  if (!mine.length) return null
  const emails = new Set<string>()
  const coMaintainers = new Set<string>()
  const dates: string[] = []
  for (const o of mine) {
    const p = o.package
    if (p.date) dates.push(p.date)
    if (p.publisher?.username?.toLowerCase() === me && p.publisher.email) emails.add(p.publisher.email.toLowerCase())
    for (const m of p.maintainers ?? []) {
      if (m.username?.toLowerCase() === me) {
        if (m.email) emails.add(m.email.toLowerCase())
      } else if (m.username) coMaintainers.add(m.username)
    }
  }
  dates.sort()
  const children: OutEntity[] = [...emails].map((e) => ({ type: 'email', label: e, linkLabel: lang === 'fr' ? 'email du compte npm' : 'npm account email' }))
  return {
    profile: {
      username,
      url: `https://www.npmjs.com/~${username}`,
      data: {
        packages: mine.length < res.objects.length ? mine.length : res.total,
        package_names: mine.map((o) => o.package.name).slice(0, 50),
        co_maintainers: [...coMaintainers].slice(0, 30),
        last_publish_date: toIso(dates[dates.length - 1])
      }
    },
    children
  }
}

export default defineModule({
  id: 'social.npm',
  name: { fr: 'Compte npm', en: 'npm account' },
  description: {
    fr: 'Paquets npm maintenus par le pseudo (registre public) : liste des paquets, co-mainteneurs et email du compte publié dans les métadonnées. Seuls les comptes ayant au moins un paquet sont détectés.',
    en: 'npm packages maintained by the username (public registry): package list, co-maintainers and account email published in the metadata. Only accounts with at least one package are detected.'
  },
  category: 'social',
  inputTypes: ['username', 'account'],
  accepts: acceptsPlatform('npm'),
  homepage: 'https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md',
  async run(input, ctx) {
    const username = requireUsername(input, /^[a-z0-9][\w.-]{0,213}$/i)
    let res: NpmSearch
    try {
      res = await ctx.fetchJson<NpmSearch>('https://registry.npmjs.org/-/v1/search', { query: { text: `maintainer:${username}`, size: 100 } })
    } catch (e) {
      rethrow(e, 'npm')
    }
    const parsed = parseNpm(res, username, ctx.lang)
    if (!parsed) return notFound({ total: 0 })
    return profileOutput(input, 'npm', parsed.profile, parsed.children, { total: res.total, packages: parsed.profile.data.package_names }, ctx.lang)
  }
})
