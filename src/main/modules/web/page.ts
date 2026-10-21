import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max'
import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, normalizeHost, toUrl } from '../domain/_util'
import { emails, htmlLang, links, metas, SECURITY_HEADERS, socialLink, technologies, title, trackers, visibleText } from './_html'

const MAX_BODY = 3_000_000
const KEPT_HEADERS = [
  'server',
  'x-powered-by',
  'x-generator',
  'via',
  'content-type',
  'content-language',
  'last-modified',
  'x-frame-options',
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'access-control-allow-origin',
  'x-cache',
  'cf-ray',
  'x-served-by',
  'x-redirect-by'
]

/** Pays par défaut pour lire les numéros nationaux : langue de la page, sinon extension du domaine. */
export function guessCountry(lang: string | null, host: string): CountryCode | undefined {
  const fromLang = lang?.match(/^[a-z]{2}[-_]([A-Z]{2})$/i)?.[1]?.toUpperCase()
  const tld = host.split('.').pop()?.toUpperCase()
  const byLang: Record<string, string> = { fr: 'FR', de: 'DE', es: 'ES', it: 'IT', nl: 'NL', pt: 'PT', pl: 'PL' }
  const candidate = fromLang ?? (tld && tld.length === 2 ? (tld === 'UK' ? 'GB' : tld) : lang ? byLang[lang.slice(0, 2).toLowerCase()] : undefined)
  return candidate && /^[A-Z]{2}$/.test(candidate) ? (candidate as CountryCode) : undefined
}

export function phones(html: string, text: string, country: CountryCode | undefined): string[] {
  const out = new Set<string>()
  for (const href of links(html, 'https://x.invalid/')) {
    if (!/^(tel|callto):/i.test(href)) continue
    const raw = decodeURIComponent(href.replace(/^(tel|callto):/i, ''))
    const p = parsePhoneNumberFromString(raw, country)
    if (p?.isValid()) out.add(p.number)
  }
  for (const found of findPhoneNumbersInText(text.slice(0, 200_000), country ? { defaultCountry: country } : undefined)) {
    if (found.number.isValid()) out.add(found.number.number)
  }
  return Array.from(out)
}

export interface PageInput {
  url: string
  finalUrl: string
  status: number
  headers: Record<string, string>
  cookies: string[]
  html: string
}

export function analyzePage(p: PageInput, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const h = p.headers
  const contentType = h['content-type'] ?? ''
  const isHtml = /html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(p.html)
  const inputHost = normalizeHost(p.url).replace(/^www\./, '')
  const finalHost = normalizeHost(p.finalUrl).replace(/^www\./, '')
  const entities: OutEntity[] = []
  if (finalHost && finalHost !== inputHost)
    entities.push({ type: 'domain', label: finalHost, linkLabel: fr ? 'redirige vers' : 'redirects to' })

  const security = SECURITY_HEADERS.filter((k) => h[k] !== undefined)
  const base: Record<string, PropValue | undefined> = {
    status_code: p.status,
    final_url: p.finalUrl !== p.url ? p.finalUrl : null,
    content_type: contentType || null,
    server: h.server ?? null,
    x_powered_by: h['x-powered-by'] ?? null,
    http_headers: Object.fromEntries(KEPT_HEADERS.filter((k) => h[k] !== undefined).map((k) => [k, h[k].slice(0, 500)])),
    security_headers: security,
    missing_security_headers: SECURITY_HEADERS.filter((k) => !security.includes(k)),
    cookies: p.cookies.map((c) => c.split('=')[0].trim()).filter(Boolean).slice(0, 30),
    last_modified_at: h['last-modified'] ? new Date(h['last-modified']).toISOString() : null
  }
  if (!isHtml) return { properties: compact(base), entities, raw: { headers: h } }

  const html = p.html
  const meta = metas(html)
  const pageLang = htmlLang(html) ?? h['content-language'] ?? null
  const text = visibleText(html)
  const country = guessCountry(pageLang, finalHost)

  const mails = emails(html)
  for (const e of mails.slice(0, 20)) entities.push({ type: 'email', label: e, linkLabel: fr ? 'cité sur la page' : 'found on page' })
  const tels = phones(html, text, country)
  for (const t of tels.slice(0, 10)) entities.push({ type: 'phone', label: t, linkLabel: fr ? 'cité sur la page' : 'found on page' })

  const socials = new Map<string, { platform: string; username: string; url: string }>()
  for (const href of links(html, p.finalUrl)) {
    const s = socialLink(href)
    if (s && !socials.has(`${s.platform}|${s.username.toLowerCase()}`)) socials.set(`${s.platform}|${s.username.toLowerCase()}`, s)
  }
  for (const s of Array.from(socials.values()).slice(0, 25))
    entities.push({ type: 'account', label: s.username, platform: s.platform, data: { url: s.url, username: s.username }, linkLabel: fr ? 'lien sur le site' : 'linked from site' })

  const tr = trackers(html)
  for (const t of tr.slice(0, 20)) entities.push({ type: 'tracker', label: t.id, data: { kind: t.kind }, linkLabel: t.kind })

  const tech = technologies(html, h, meta)
  for (const t of tech.slice(0, 25))
    entities.push({
      type: 'technology',
      label: t.name,
      data: compact({ version: t.version ?? null, kind: t.kind ?? null }),
      linkLabel: fr ? 'utilise' : 'uses'
    })

  const canonical = (html.match(/<link[^>]+rel=["']?canonical["']?[^>]*>/i)?.[0] ?? '').match(/href=["']([^"']+)["']/)?.[1] ?? null
  const properties = compact({
    ...base,
    title: title(html) ?? meta['og:title'] ?? null,
    description: meta.description ?? meta['og:description'] ?? null,
    lang: pageLang,
    generator: meta.generator ?? null,
    og_title: meta['og:title'] ?? null,
    og_image: meta['og:image'] ?? null,
    og_site_name: meta['og:site_name'] ?? null,
    canonical,
    technologies: tech.map((t) => (t.version ? `${t.name} ${t.version}` : t.name)),
    emails: mails.slice(0, 50),
    phones: tels.slice(0, 20),
    social_links: Array.from(socials.values()).map((s) => s.url),
    trackers: tr.map((t) => `${t.kind}: ${t.id}`),
    page_size: html.length
  })
  return { properties, entities, raw: { headers: h, meta } }
}

export default defineModule({
  id: 'web.page',
  name: { fr: 'Analyse de la page web', en: 'Web page analysis' },
  description: {
    fr: 'Contacte le site cible et analyse la page : titre, description, langue, en-têtes HTTP et de sécurité, technologies (CMS, serveur, frameworks), emails, téléphones, comptes de réseaux sociaux liés et identifiants de traçage (Google Analytics, GTM, AdSense, Facebook Pixel, Yandex, Hotjar...).',
    en: 'Contacts the target site and analyses the page: title, description, language, HTTP and security headers, technologies (CMS, server, frameworks), emails, phone numbers, linked social accounts and tracking IDs (Google Analytics, GTM, AdSense, Facebook Pixel, Yandex, Hotjar...).'
  },
  category: 'web',
  inputTypes: ['url', 'website'],
  noisy: true,
  timeoutMs: 60000,
  async run(input, ctx) {
    const url = toUrl(input.label)
    try {
      new URL(url)
    } catch {
      throw new ModuleError('URL invalide', 'invalid_input')
    }
    let res: Response
    try {
      res = await ctx.fetch(url, {
        redirect: 'follow',
        headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        timeoutMs: 30000
      })
    } catch (e) {
      throw new ModuleError(`Site injoignable : ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : e}`, 'unavailable')
    }
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v))
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    const contentType = headers['content-type'] ?? ''
    const textual = !contentType || /text|html|xml|json/i.test(contentType)
    const html = textual ? (await res.text()).slice(0, MAX_BODY) : ''
    if (!textual) await res.body?.cancel().catch(() => undefined)
    return analyzePage({ url, finalUrl: res.url || url, status: res.status, headers, cookies, html }, ctx.lang)
  }
})
