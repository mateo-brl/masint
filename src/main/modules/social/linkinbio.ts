// Pages « lien en bio » (Beacons, Taplink, Carrd, bio.link, Lnk.Bio, AllMyLinks, solo.to,
// hoo.be) : la page est hébergée par la plateforme, la lire n'alerte personne. Comme pour
// Linktree, les liens sortants deviennent des comptes (plateformes reconnues) ou des URL,
// avec les emails et téléphones affichés.

import { defineModule, ModuleError, type InputEntity, type ModuleContext, type OutEntity } from '@shared/modules'
import { blockedError, compact, decodeHtml, extractEmails, extractUrls, linkedEntities, looksBlocked, metaContent, notFound, statusError, type Lang } from './_lib'

interface BioService {
  name: string
  host: RegExp
  /** Le pseudo est le sous-domaine (Carrd), sinon le premier segment du chemin. */
  sub?: boolean
}

export const BIO_SERVICES: BioService[] = [
  { name: 'Beacons', host: /^(?:www\.)?beacons\.(?:ai|page)$/i },
  { name: 'Taplink', host: /^(?:www\.)?taplink\.(?:cc|at|ws)$/i },
  { name: 'Carrd', host: /^([a-z0-9-]+)\.carrd\.co$/i, sub: true },
  { name: 'bio.link', host: /^(?:www\.)?bio\.link$/i },
  { name: 'Lnk.Bio', host: /^(?:www\.)?lnk\.bio$/i },
  { name: 'AllMyLinks', host: /^(?:www\.)?allmylinks\.com$/i },
  { name: 'solo.to', host: /^(?:www\.)?solo\.to$/i },
  { name: 'hoo.be', host: /^(?:www\.)?hoo\.be$/i }
]

/** Pages de la plateforme elle-même, pas des pages d'utilisateurs. */
const RESERVED = new Set([
  'login', 'signin', 'signup', 'register', 'pricing', 'privacy', 'terms', 'help', 'about', 'blog', 'features', 'dashboard',
  'templates', 'explore', 'support', 'contact', 'legal', 'en', 'fr', 'es', 'de', 'ru', 'pt', 'it', 'app', 'api', 'system'
])

/** Liens de la plateforme (pied de page, applications, CDN) : leur nom contient celui du service. */
const BRANDS = /beacons|taplink|carrd|bio\.link|biolink|lnk\.bio|lnkbio|allmylinks|solo\.to|hoo\.be|hoobe/i

/** Hôtes techniques (mesure d'audience, polices, CDN, schémas) : jamais des liens de la personne. */
const TECHNICAL_HOSTS =
  /(^|\.)(googletagmanager|google-analytics|gstatic|googleapis|doubleclick|googlesyndication|cloudflare|cloudflareinsights|jsdelivr|unpkg|cdnjs|sentry|hotjar|facebook\.net|schema|w3|ogp|stripe|recaptcha|hcaptcha|intercom|segment|mixpanel|amplitude|tiktokcdn|cdninstagram|fbcdn)\.(com|net|org|io|me)$/i
const ASSET = /\.(css|js|mjs|json|xml|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|map)(\?|#|$)/i
const SHARE = /\/(sharer|share|intent)(\/|\.php|\?|$)/i

export interface BioPage {
  service: string
  handle: string
  url: string
}

/** Page « lien en bio » reconnue dans une URL ; `null` pour la page d'accueil ou une page de la plateforme. */
export function bioPage(raw: string): BioPage | null {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  for (const s of BIO_SERVICES) {
    const m = host.match(s.host)
    if (!m) continue
    if (s.sub) {
      if (!m[1] || m[1] === 'www') return null
      return { service: s.name, handle: m[1], url: `https://${host}/` }
    }
    const segment = decodeURIComponent(url.pathname.split('/')[1] ?? '').replace(/^@/, '')
    if (!segment || RESERVED.has(segment.toLowerCase()) || /\.(php|html?)$/i.test(segment)) return null
    return { service: s.name, handle: segment, url: `https://${host}/${encodeURIComponent(segment)}` }
  }
  return null
}

/** URL de la page portée par l'entité : son libellé ou `data.url`. */
export function inputBioPage(input: InputEntity): BioPage | null {
  return bioPage(input.label) ?? (typeof input.data.url === 'string' ? bioPage(input.data.url) : null)
}

export interface ParsedBio {
  data: Record<string, string | string[] | undefined>
  image?: string
  links: string[]
  emails: string[]
  phones: string[]
}

/** Lien sortant utile : ni ressource technique, ni lien de la plateforme, ni bouton de partage. */
function keepLink(u: URL): boolean {
  if (!/^https?:$/.test(u.protocol)) return false
  const host = u.hostname.toLowerCase()
  // Applications de la plateforme dans les magasins d'applications.
  if (/^(apps\.apple\.com|play\.google\.com)$/.test(host) && BRANDS.test(u.href)) return false
  return !TECHNICAL_HOSTS.test(host) && !BRANDS.test(host) && !ASSET.test(u.pathname) && !SHARE.test(u.pathname)
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Titre, description, avatar, liens sortants, emails et téléphones d'une page. Les liens sont lus
 * dans les attributs (`href`, `data-*-url`, texte à copier) et dans les données JSON embarquées.
 */
export function parseBioPage(html: string): ParsedBio {
  const values: string[] = []
  for (const m of html.matchAll(/\s(?:href|data-[\w-]*url|data-href|data-link|data-clipboard-text)\s*=\s*"([^"]+)"/gi)) values.push(decodeHtml(m[1]))
  for (const m of html.matchAll(/"((?:https?:|mailto:|tel:)(?:\\\/|[^"\s<>\\]|\\u0026)+)"/g))
    values.push(m[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&'))
  const links = new Set<string>()
  const emails = new Set<string>()
  const phones = new Set<string>()
  for (const v of values.map((x) => x.trim())) {
    if (/^mailto:/i.test(v)) {
      const email = safeDecode(v.slice(7).split('?')[0]).trim().toLowerCase()
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) emails.add(email)
    } else if (/^tel:/i.test(v)) {
      const phone = safeDecode(v.slice(4)).replace(/[^\d+]/g, '')
      if (phone.replace(/\D/g, '').length >= 6) phones.add(phone)
    } else if (/^https?:\/\//i.test(v)) {
      try {
        const u = new URL(v)
        if (keepLink(u)) links.add(u.toString())
      } catch {
        /* URL invalide ignorée */
      }
    } else if (/^[^@\s/]+@[^@\s/]+\.[a-z]{2,}$/i.test(v)) emails.add(v.toLowerCase())
  }
  const title = metaContent(html, 'og:title') ?? html.match(/<title>([^<]*)<\/title>/i)?.[1]
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'description')
  const image = metaContent(html, 'og:image')
  return {
    data: {
      display_name: title ? decodeHtml(title).replace(/\s*[|·]\s*[^|·]*$/, '').trim() || undefined : undefined,
      bio: description?.trim() || undefined
    },
    image: image && !/placeholder|default/i.test(image) ? image : undefined,
    links: [...links].slice(0, 50),
    emails: [...emails],
    phones: [...phones]
  }
}

/** Entités liées : comptes reconnus, sites, emails (liens et description) et téléphones. */
export function bioEntities(parsed: ParsedBio, lang: Lang): OutEntity[] {
  const fr = lang === 'fr'
  const bio = typeof parsed.data.bio === 'string' ? parsed.data.bio : ''
  // Les URL de la description passent par le même filtre que les liens (« hoo.be » cité dans le slogan...).
  const textUrls = extractUrls(bio).filter((u) => {
    try {
      return keepLink(new URL(u))
    } catch {
      return false
    }
  })
  const entities = [
    ...linkedEntities({ urls: parsed.links, emails: [...parsed.emails, ...extractEmails(bio)], lang, linkLabel: { fr: 'lien de la page', en: 'page link' } }),
    ...linkedEntities({ urls: textUrls, lang, linkLabel: { fr: 'dans la description de la page', en: 'in page description' } })
  ]
  const seen = new Set<string>()
  return [
    ...entities.filter((e) => {
      const key = `${e.type}|${e.platform ?? ''}|${e.label.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }),
    ...parsed.phones.map((p): OutEntity => ({ type: 'phone', label: p, linkLabel: fr ? 'téléphone de la page' : 'page phone number' }))
  ]
}

/**
 * Page publique ; `null` si le pseudo est inconnu (404, renvoi vers l'accueil). Les redirections
 * sont suivies à la main pour reconnaître le défi anti-robot de Taplink.
 */
async function fetchPage(ctx: ModuleContext, page: BioPage): Promise<string | null> {
  let url = page.url
  for (let hop = 0; hop < 4; hop++) {
    const res = await ctx.fetch(url, { headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' }, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined)
      if (/\/system\/challenge|captcha|challenge-platform/i.test(location)) throw blockedError(page.service, res.status)
      const next = new URL(location, url).toString()
      // Pseudo inconnu renvoyé vers l'accueil (ou une autre page) de la plateforme.
      if (!bioPage(next)) return null
      url = next
      continue
    }
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => undefined)
      return null
    }
    const html = await res.text()
    // Cloudflare protège Beacons, bio.link, Lnk.Bio et solo.to.
    if (((res.status === 403 || res.status === 503) && looksBlocked(html)) || (res.ok && looksBlocked(html))) throw blockedError(page.service, res.status)
    if (!res.ok) throw statusError(page.service, res.status, html)
    return html
  }
  throw new ModuleError(`${page.service} : trop de redirections`, 'other')
}

export default defineModule({
  id: 'social.linkinbio',
  name: { fr: 'Page « lien en bio »', en: 'Link-in-bio page' },
  description: {
    fr: 'Lit une page Beacons, Taplink, Carrd, bio.link, Lnk.Bio, AllMyLinks, solo.to ou hoo.be (hébergée par la plateforme, la lecture n’alerte personne) : titre, description, avatar, liens sortants (comptes reconnus ou sites), emails et téléphones affichés. Plusieurs de ces services bloquent les adresses IP de centres de données.',
    en: 'Reads a Beacons, Taplink, Carrd, bio.link, Lnk.Bio, AllMyLinks, solo.to or hoo.be page (hosted by the platform, reading it alerts no one): title, description, picture, outgoing links (known accounts or websites), emails and phone numbers shown. Several of these services block datacenter IP addresses.'
  },
  category: 'social',
  inputTypes: ['url', 'website', 'account'],
  accepts: (input) => !!inputBioPage(input),
  homepage: 'https://allmylinks.com',
  async run(input, ctx) {
    const page = inputBioPage(input)
    if (!page) throw new ModuleError('Adresse de page « lien en bio » non reconnue', 'invalid_input')
    const html = await fetchPage(ctx, page)
    if (html === null) return notFound()
    const parsed = parseBioPage(html)
    if (!parsed.data.display_name && !parsed.links.length) return notFound()
    const entities = bioEntities(parsed, ctx.lang)
    // Même type et même libellé que l'entrée : le moteur joint l'avatar au nœud d'origine.
    if (parsed.image) entities.unshift({ type: input.type, label: input.label, platform: input.platform ?? undefined, image: parsed.image })
    return {
      found: true,
      properties: compact({
        service: page.service,
        username: page.handle,
        ...parsed.data,
        links: parsed.links,
        emails: parsed.emails,
        phones: parsed.phones
      }),
      entities,
      raw: { url: page.url, links: parsed.links, emails: parsed.emails, phones: parsed.phones }
    }
  }
})
