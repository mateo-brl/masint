// roso.info : scan d'un pseudo sur ~900 sites (séquence du site /username/ :
// start -> une requête /api/uc/<site>/profile par site). Un seul module MASINT
// pour tout le scan.

import { defineModule, ModuleError, type ModuleContext, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { creditsOf, isFatal, pool, redact, ROSO_BASE, ROSO_COMMON, RosoClient, toRosoError, type Json } from './_client'
import {
  accountEntities,
  addGeneric,
  asArr,
  asObj,
  dropEmpty,
  isEmail,
  isHttpUrl,
  pick,
  pickNum,
  siteName,
  stealerEntities,
  str,
  uniq
} from './_parse'
import { USERNAME_PATHS, USERNAME_SITES } from './_sites'

const PAGE = '/username/'
const POOL = 20
const CACHE_MS = 12 * 3600_000

export interface SiteList {
  sites: string[]
  paths: Record<string, string>
  source: 'live' | 'snapshot'
}

/** Extrait la table `APIS` et la liste `platforms` de la page /username/ (texte, jamais exécuté). */
export function parseUsernamePage(html: string): { sites: string[]; paths: Record<string, string> } {
  const apis: Record<string, string> = {}
  const a = html.indexOf('const APIS = {')
  if (a >= 0) {
    const end = html.indexOf('\n};', a) > 0 ? html.indexOf('\n};', a) : html.indexOf('};', a)
    const block = html.slice(a, end > a ? end : undefined)
    for (const m of block.matchAll(/['"]?([A-Za-z0-9_]+)['"]?\s*:\s*'(\/api\/uc\/[A-Za-z0-9_./-]+)'/g)) apis[m[1]] = m[2]
  }
  const sites: string[] = []
  const p = html.indexOf('const platforms = [')
  if (p >= 0) {
    const end = html.indexOf('];', p)
    for (const m of html.slice(p, end > p ? end : undefined).matchAll(/"([A-Za-z0-9_]+)"/g)) if (apis[m[1]]) sites.push(m[1])
  }
  const list = uniq(sites)
  const paths: Record<string, string> = {}
  for (const s of list) if (apis[s] !== `/api/uc/${s}/profile`) paths[s] = apis[s]
  return { sites: list, paths }
}

let cache: { at: number; list: SiteList } | null = null

/** Liste des sites : relue sur la page publique (cache 12 h), sinon instantané embarqué. */
export async function usernameSites(ctx: ModuleContext): Promise<SiteList> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list
  try {
    const res = await ctx.fetch(`${ROSO_BASE}/username/`, { timeoutMs: 30000, headers: { accept: 'text/html' } })
    if (res.ok) {
      const parsed = parseUsernamePage(await res.text())
      if (parsed.sites.length >= 100) {
        const list: SiteList = { ...parsed, source: 'live' }
        cache = { at: Date.now(), list }
        return list
      }
    }
  } catch {
    /* repli sur l'instantané */
  }
  return { sites: USERNAME_SITES, paths: USERNAME_PATHS, source: 'snapshot' }
}

export function resetUsernameCache(): void {
  cache = null
}

interface Found {
  site: string
  data: Json
}

function foundEntities(found: Found[], username: string, lang: 'fr' | 'en'): { entities: OutEntity[]; props: Record<string, PropValue | undefined> } {
  const entities: OutEntity[] = []
  const props: Record<string, PropValue | undefined> = {}
  for (const { site, data } of found) {
    const p = asObj(data.profile ?? data.data)
    if (site === 'hudsonrock') {
      entities.push(...stealerEntities(p.stealers, { refPrefix: 'hr', lang }))
      props.roso_hudsonrock_user_services = pickNum(p, 'totalUserServices')
      props.roso_hudsonrock_corporate_services = pickNum(p, 'totalCorporateServices')
      continue
    }
    if (site === 'wayback') {
      const archived = asArr(p.platforms).map(asObj).filter((x) => x.found === true)
      props.roso_wayback_platforms = archived.map((x) => pick(x, 'platform')).filter(Boolean)
      for (const x of archived.slice(0, 20)) {
        const snap = asObj(asArr(x.snapshots)[0])
        const url = [pick(snap, 'archiveUrl'), pick(asObj(x.archiveIs), 'archiveUrl'), str(asArr(x.searchUrls)[0])].find((u) => u && isHttpUrl(u))
        if (!url) continue
        entities.push({
          type: 'url',
          label: url,
          data: dropEmpty({ title: `Wayback : ${pick(x, 'platform')}`, snapshots: pickNum(x, 'totalSnapshots'), date: pick(snap, 'date') || undefined }),
          linkLabel: lang === 'fr' ? 'archive web' : 'web archive'
        })
      }
      continue
    }
    const ref = `acc_${site}`
    const out = accountEntities(p, { site, query: username, ref, lang })
    // GitHub : emails trouvés dans les commits, au niveau racine de la réponse.
    for (const e of asArr(data.emails ?? p.emails)) {
      const o = asObj(e)
      const mail = (typeof e === 'string' ? e : pick(o, 'email')).toLowerCase()
      if (!mail || !isEmail(mail) || out.some((x) => x.type === 'email' && x.label === mail)) continue
      out.push({
        type: 'email',
        label: mail,
        from: ref,
        data: dropEmpty({ name: pick(o, 'name') || undefined, commit_url: pick(o, 'commitUrl') || undefined }),
        linkLabel: lang === 'fr' ? 'email (commits)' : 'email (commits)'
      })
    }
    addGeneric(out, p, ref, username, lang)
    entities.push(...out)
  }
  return { entities, props }
}

export default defineModule({
  ...ROSO_COMMON,
  id: 'roso.username',
  name: { fr: 'roso.info : pseudo (~900 sites)', en: 'roso.info: username (~900 sites)' },
  description: {
    fr: "Scan roso.info d'un pseudo : présence sur ~900 sites avec profils détaillés, archives web et Hudson Rock. Un seul lancement, crédits roso.info consommés.",
    en: 'roso.info username scan: presence on ~900 sites with detailed profiles, web archives and Hudson Rock. One launch, consumes roso.info credits.'
  },
  inputTypes: ['username'],
  timeoutMs: 900_000,
  async run(input, ctx) {
    const username = input.label.trim().replace(/^@/, '')
    if (!username) throw new ModuleError('Pseudo vide', 'invalid_input')
    const c = new RosoClient(ctx, 'username')
    await c.checkMaintenance('username')

    const start = await c.launch('/api/gateway/username/start', { username }, { page: PAGE })
    const list = await usernameSites(ctx)
    const tier = str(start.tier).toLowerCase()
    const sites = list.sites.filter((s) => !(s === 'quora' && tier && !['patreon', 'admin', 'unlimited'].includes(tier)))

    const found: Found[] = []
    const errors: Record<string, string> = {}
    let notFound = 0
    await pool(sites, POOL, ctx.signal, async (site) => {
      try {
        const path = list.paths[site] ?? `/api/uc/${site}/profile`
        const res = await c.request(path, { method: 'POST', json: { username }, timeoutMs: 30000, retries: 1, throwOnError: false, page: PAGE })
        if (res.status === 401) throw toRosoError(401, res.data, 'username', ctx.lang)
        const d = res.data
        if (site === 'vinted' && d.exists === null) return void (errors[site] = 'unavailable')
        if (d.success === true && d.exists === true) found.push({ site, data: d })
        else if (!res.ok) errors[site] = str(d.error) || `HTTP ${res.status}`
        else notFound++
      } catch (e) {
        if (isFatal(e)) throw e
        errors[site] = e instanceof Error ? e.message : String(e)
      }
    })

    const { entities, props } = foundEntities(found, username, ctx.lang)
    return {
      properties: dropEmpty({
        roso_credits_left: creditsOf(start),
        roso_found_count: found.filter((f) => f.site !== 'wayback').length,
        roso_sites_checked: sites.length,
        roso_errors: Object.keys(errors).length,
        roso_found_on: found.map((f) => siteName(f.site)),
        ...props
      }),
      entities,
      raw: redact({ start, siteList: list.source, sites: sites.length, found: Object.fromEntries(found.map((f) => [f.site, f.data])), notFound, errors }, c.key)
    }
  }
})
