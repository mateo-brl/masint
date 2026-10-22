import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { cappedList, compact, isoDate, toUrl, uniq } from '../domain/_util'
import { fetchSiteFile } from './_files'
import { decodeEntities } from './_html'

/** Taille maximale d'un plan du site lu (XML, éventuellement gzip). */
const MAX_SITEMAP = 2_000_000

export interface RobotsInfo {
  disallow: string[]
  allow: string[]
  sitemaps: string[]
  userAgents: string[]
}

export function parseRobots(text: string): RobotsInfo {
  const info: RobotsInfo = { disallow: [], allow: [], sitemaps: [], userAgents: [] }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const [, field, value] = m
    if (!value) continue
    switch (field.toLowerCase()) {
      case 'disallow':
        info.disallow.push(value)
        break
      case 'allow':
        info.allow.push(value)
        break
      case 'sitemap':
        info.sitemaps.push(value)
        break
      case 'user-agent':
        info.userAgents.push(value)
        break
    }
  }
  info.disallow = uniq(info.disallow)
  info.allow = uniq(info.allow)
  info.sitemaps = uniq(info.sitemaps)
  info.userAgents = uniq(info.userAgents)
  return info
}

export interface SecurityTxt {
  contacts: string[]
  emails: string[]
  expires: string | null
  policy: string | null
  hiring: string | null
  languages: string | null
  encryption: string | null
}

/** Fichier security.txt (RFC 9116), éventuellement signé PGP. */
export function parseSecurityTxt(text: string): SecurityTxt {
  const out: SecurityTxt = { contacts: [], emails: [], expires: null, policy: null, hiring: null, languages: null, encryption: null }
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^([A-Za-z-]+)\s*:\s*(.+)$/)
    if (!m) continue
    const value = m[2].trim()
    switch (m[1].toLowerCase()) {
      case 'contact': {
        out.contacts.push(value)
        const email = value.replace(/^mailto:/i, '')
        if (/^[^@\s/]+@[^@\s/]+\.[a-z]{2,}$/i.test(email)) out.emails.push(email.toLowerCase())
        break
      }
      case 'expires':
        out.expires = isoDate(value)
        break
      case 'policy':
        out.policy = value
        break
      case 'hiring':
        out.hiring = value
        break
      case 'preferred-languages':
        out.languages = value
        break
      case 'encryption':
        out.encryption = value
        break
    }
  }
  out.contacts = uniq(out.contacts)
  out.emails = uniq(out.emails)
  return out
}

export interface Sitemap {
  /** Index de plans du site (`<sitemapindex>`) ou liste d'URL (`<urlset>`). */
  kind: 'index' | 'urlset'
  /** URL des pages (`<url><loc>`), sans les images ni les vidéos. */
  urls: string[]
  /** Plans du site enfants d'un index (`<sitemap><loc>`). */
  children: string[]
}

const locOf = (block: string): string | null => {
  const m = block.match(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/i)
  return m ? decodeEntities(m[1]).trim() : null
}

/** Plan du site XML (protocole sitemaps.org). `null` si le texte n'en est pas un. */
export function parseSitemap(xml: string): Sitemap | null {
  const blocks = (tag: string): string[] =>
    Array.from(xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi')), (m) => locOf(m[1])).filter((l): l is string => !!l)
  if (/<sitemapindex[\s>]/i.test(xml)) return { kind: 'index', urls: [], children: uniq(blocks('sitemap')) }
  if (/<urlset[\s>]/i.test(xml)) return { kind: 'urlset', urls: uniq(blocks('url')), children: [] }
  return null
}

/** Documents bureautiques cités dans le plan du site (rapports, tarifs, organigrammes...). */
const DOCUMENT = /\.(pdf|docx?|xlsx?|pptx?)$/i

export function sitemapDocuments(urls: string[]): string[] {
  return urls.filter((u) => {
    try {
      return DOCUMENT.test(new URL(u).pathname)
    } catch {
      return false
    }
  })
}

export interface SitemapSummary {
  url: string
  urls: string[]
  /** Nombre de plans enfants quand le premier plan est un index. */
  children: number | null
  truncated: boolean
}

/** Chemins sensibles signalés dans robots.txt (administration, sauvegardes, API...). */
const INTERESTING = /admin|login|backup|bak|old|private|secret|config|api|dev|test|staging|wp-|phpmyadmin|cgi|tmp|internal|intranet|panel|dashboard|\.git|\.env|sql|dump/i

/**
 * Seuls les emails de security.txt deviennent des entités (contacts réels, à croiser) ; sitemaps,
 * chemins, page de recrutement et politique de divulgation restent des propriétés du site.
 */
export function buildRobotsOutput(
  robots: RobotsInfo | null,
  sec: SecurityTxt | null,
  origin: string,
  lang: 'fr' | 'en',
  sitemap: SitemapSummary | null = null
): ModuleOutput {
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  for (const e of sec?.emails ?? []) entities.push({ type: 'email', label: e, linkLabel: fr ? 'contact sécurité' : 'security contact' })
  const properties = compact({
    ...cappedList('robots_disallow', robots?.disallow ?? []),
    robots_interesting_paths: robots?.disallow.filter((d) => INTERESTING.test(d)).slice(0, 50) ?? [],
    robots_user_agents: robots?.userAgents.filter((u) => u !== '*').slice(0, 30) ?? [],
    sitemaps: robots?.sitemaps.slice(0, 20) ?? [],
    security_contacts: sec?.contacts ?? [],
    security_txt_expires_at: sec?.expires ?? null,
    security_policy: sec?.policy ?? null,
    security_hiring: sec?.hiring ?? null,
    security_languages: sec?.languages ?? null,
    security_encryption: sec?.encryption ?? null,
    sitemap_url: sitemap?.url ?? null,
    sitemap_urls_count: sitemap ? sitemap.urls.length : null,
    sitemap_children_count: sitemap?.children ?? null,
    sitemap_partial: sitemap?.truncated || null,
    ...cappedList('documents', sitemap ? sitemapDocuments(sitemap.urls) : [])
  })
  if (!Object.keys(properties).length && !entities.length) return {}
  return {
    properties,
    entities,
    raw: { origin, robots, securityTxt: sec, sitemap: sitemap ? { ...sitemap, urls: sitemap.urls.slice(0, 200) } : null }
  }
}

/**
 * Premier plan du site annoncé dans robots.txt (2 Mo au plus). Un index renvoie à d'autres plans :
 * on lit alors le premier d'entre eux, et le nombre d'URL ne porte que sur celui-là.
 */
export async function readFirstSitemap(ctx: ModuleContext, sitemaps: string[]): Promise<SitemapSummary | null> {
  const first = sitemaps.find((u) => /^https?:\/\//i.test(u))
  if (!first) return null
  const file = await fetchSiteFile(ctx, first, MAX_SITEMAP)
  const parsed = file ? parseSitemap(file.text) : null
  if (!file || !parsed) return null
  if (parsed.kind === 'urlset') return { url: first, urls: parsed.urls, children: null, truncated: file.truncated }
  const child = parsed.children.find((u) => /^https?:\/\//i.test(u))
  const sub = child ? await fetchSiteFile(ctx, child, MAX_SITEMAP) : null
  const subParsed = sub ? parseSitemap(sub.text) : null
  return {
    url: subParsed && child ? child : first,
    urls: subParsed?.urls ?? [],
    children: parsed.children.length,
    truncated: file.truncated || !!sub?.truncated
  }
}

async function getText(ctx: ModuleContext, url: string): Promise<string | null> {
  const res = await ctx.fetch(url, { redirect: 'follow', timeoutMs: 20000 })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || /html/i.test(type)) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  const text = await res.text()
  return text.slice(0, 500_000)
}

export default defineModule({
  id: 'web.robots',
  name: { fr: 'robots.txt, security.txt et plan du site', en: 'robots.txt, security.txt and sitemap' },
  description: {
    fr: 'Contacte le site cible pour lire robots.txt (chemins cachés aux moteurs, sitemaps), security.txt (contacts sécurité, politique de divulgation, recrutement) et le premier plan du site annoncé (nombre de pages, documents PDF et bureautiques cités, 2 Mo au plus).',
    en: 'Contacts the target site to read robots.txt (paths hidden from search engines, sitemaps), security.txt (security contacts, disclosure policy, hiring) and the first advertised sitemap (page count, PDF and office documents listed, 2 MB at most).'
  },
  category: 'web',
  inputTypes: ['url', 'website', 'domain'],
  noisy: true,
  async run(input, ctx) {
    let origin: string
    try {
      origin = new URL(toUrl(input.label)).origin
    } catch {
      throw new ModuleError('URL invalide', 'invalid_input')
    }
    const settle = async (url: string): Promise<string | null> => getText(ctx, url).catch(() => null)
    const [robotsTxt, wellKnown] = await Promise.all([settle(`${origin}/robots.txt`), settle(`${origin}/.well-known/security.txt`)])
    const securityTxt = wellKnown ?? (await settle(`${origin}/security.txt`))
    if (robotsTxt === null && securityTxt === null) {
      // Vérifie que le site répond : sinon c'est une erreur, pas un résultat vide.
      try {
        const res = await ctx.fetch(origin, { redirect: 'follow', timeoutMs: 15000 })
        await res.body?.cancel().catch(() => undefined)
      } catch (e) {
        throw new ModuleError(`Site injoignable : ${e instanceof Error ? e.message : e}`, 'unavailable')
      }
      return {}
    }
    const robots = robotsTxt !== null ? parseRobots(robotsTxt) : null
    const sitemap = robots?.sitemaps.length ? await readFirstSitemap(ctx, robots.sitemaps).catch(() => null) : null
    return buildRobotsOutput(
      robots,
      securityTxt !== null && /contact\s*:/i.test(securityTxt) ? parseSecurityTxt(securityTxt) : null,
      origin,
      ctx.lang,
      sitemap
    )
  }
})
