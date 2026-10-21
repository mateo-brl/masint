import { defineModule, ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, isoDate, toUrl, uniq } from '../domain/_util'

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

/** Chemins sensibles signalés dans robots.txt (administration, sauvegardes, API...). */
const INTERESTING = /admin|login|backup|bak|old|private|secret|config|api|dev|test|staging|wp-|phpmyadmin|cgi|tmp|internal|intranet|panel|dashboard|\.git|\.env|sql|dump/i

export function buildRobotsOutput(robots: RobotsInfo | null, sec: SecurityTxt | null, origin: string, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  for (const e of sec?.emails ?? []) entities.push({ type: 'email', label: e, linkLabel: fr ? 'contact sécurité' : 'security contact' })
  for (const s of (robots?.sitemaps ?? []).slice(0, 5)) entities.push({ type: 'url', label: s, linkLabel: 'sitemap' })
  if (sec?.hiring) entities.push({ type: 'url', label: sec.hiring, linkLabel: fr ? 'recrutement' : 'hiring' })
  if (sec?.policy) entities.push({ type: 'url', label: sec.policy, linkLabel: fr ? 'politique de divulgation' : 'disclosure policy' })
  const properties = compact({
    robots_disallow: robots?.disallow.slice(0, 100) ?? [],
    robots_interesting_paths: robots?.disallow.filter((d) => INTERESTING.test(d)).slice(0, 50) ?? [],
    robots_user_agents: robots?.userAgents.filter((u) => u !== '*').slice(0, 30) ?? [],
    sitemaps: robots?.sitemaps.slice(0, 20) ?? [],
    security_contacts: sec?.contacts ?? [],
    security_txt_expires_at: sec?.expires ?? null,
    security_policy: sec?.policy ?? null,
    security_languages: sec?.languages ?? null,
    security_encryption: sec?.encryption ?? null
  })
  if (!Object.keys(properties).length && !entities.length) return {}
  return { properties, entities, raw: { origin, robots, securityTxt: sec } }
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
  name: { fr: 'robots.txt et security.txt', en: 'robots.txt and security.txt' },
  description: {
    fr: 'Contacte le site cible pour lire robots.txt (chemins cachés aux moteurs, sitemaps) et security.txt (contacts sécurité, politique de divulgation, recrutement).',
    en: 'Contacts the target site to read robots.txt (paths hidden from search engines, sitemaps) and security.txt (security contacts, disclosure policy, hiring).'
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
    return buildRobotsOutput(
      robotsTxt !== null ? parseRobots(robotsTxt) : null,
      securityTxt !== null && /contact\s*:/i.test(securityTxt) ? parseSecurityTxt(securityTxt) : null,
      origin,
      ctx.lang
    )
  }
})
