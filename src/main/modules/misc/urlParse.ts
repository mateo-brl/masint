// Lecture hors ligne d'une URL ou d'un site web : domaine enregistrable (sauf grandes
// plateformes, dont le domaine n'apporte rien), compte et pseudo quand l'URL est un profil
// (instagram.com/x, github.com/x, tiktok.com/@x, linkedin.com/in/x...), adresse IP quand
// l'hôte en est une. Aucune requête réseau.

import { defineModule, type InputEntity, type OutEntity } from '@shared/modules'
import { getPlatform, PLATFORMS } from '@shared/platforms'
import { accountFromUrl, normalizeUrl, type UrlAccount } from '../social/_lib'
import { tr } from './_util'

/**
 * Suffixes publics à plusieurs niveaux les plus courants (extrait de la Public Suffix List) :
 * le domaine enregistrable est le libellé qui les précède (`bbc.co.uk`, `service-public.gouv.fr`).
 */
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'co.kr', 'or.kr', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.hk', 'com.tw', 'com.sg', 'com.my', 'co.id', 'co.th', 'co.in', 'net.in', 'org.in', 'gov.in', 'com.pk',
  'com.br', 'net.br', 'org.br', 'gov.br', 'com.mx', 'gob.mx', 'com.ar', 'gob.ar', 'com.co', 'com.pe', 'cl.cl',
  'co.za', 'org.za', 'gov.za', 'com.ng', 'co.ke', 'com.eg', 'co.ma', 'gov.ma', 'com.tn', 'com.dz',
  'com.tr', 'gov.tr', 'org.tr', 'co.il', 'org.il', 'gov.il', 'com.sa', 'com.ua', 'org.ua', 'com.ru', 'org.ru',
  'gouv.fr', 'asso.fr', 'nom.fr', 'presse.fr', 'tm.fr', 'com.fr', 'gov.pl', 'com.pl', 'org.pl', 'co.at', 'or.at',
  'gv.at', 'com.es', 'org.es', 'gob.es', 'com.pt', 'com.gr', 'com.cy', 'com.mt', 'co.no', 'com.ro',
  // Hébergements où chaque sous-domaine appartient à un client distinct (section privée de la liste).
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'herokuapp.com',
  'web.app', 'firebaseapp.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'glitch.me',
  'neocities.org', 'carrd.co', 'myshopify.com', 'wixsite.com', 'webflow.io', 'square.site', 'framer.website',
  'onrender.com', 'fly.dev', 'replit.app', 'blogspot.com', 'wordpress.com', 'tumblr.com', 'substack.com'
])

/** Domaine enregistrable d'un nom d'hôte (`www.blog.example.co.uk` → `example.co.uk`). */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  return MULTI_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

/**
 * Domaines des grandes plateformes : un lien vers elles ne dit rien du propriétaire de la page.
 * Ceux des plateformes du catalogue (modèle d'URL de profil) sont ajoutés automatiquement.
 */
const BIG_PLATFORM_DOMAINS = new Set([
  'twitter.com', 'x.com', 't.co', 'facebook.com', 'fb.com', 'fb.me', 'messenger.com', 'instagram.com', 'threads.net',
  'threads.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'lnkd.in', 't.me', 'telegram.me',
  'telegram.org', 'wa.me', 'whatsapp.com', 'discord.com', 'discord.gg', 'discordapp.com', 'snapchat.com',
  'reddit.com', 'redd.it', 'pinterest.com', 'pinterest.fr', 'pin.it', 'tumblr.com', 'vk.com', 'ok.ru',
  'google.com', 'google.fr', 'goo.gl', 'g.co', 'gmail.com', 'apple.com', 'icloud.com', 'microsoft.com',
  'live.com', 'outlook.com', 'office.com', 'sharepoint.com', 'amazon.com', 'amazon.fr', 'amzn.to',
  'wikipedia.org', 'wikimedia.org', 'wikidata.org', 'archive.org', 'archive.ph', 'archive.today',
  'dropbox.com', 'bit.ly', 'tinyurl.com', 'ow.ly', 'buff.ly', 'linktr.ee', 'medium.com', 'substack.com',
  'wordpress.com', 'blogspot.com', 'github.com', 'githubusercontent.com', 'gitlab.com', 'bsky.app',
  'twitch.tv', 'spotify.com', 'soundcloud.com', 'vimeo.com', 'dailymotion.com', 'leboncoin.fr', 'vinted.fr',
  'vinted.com', 'ebay.com', 'ebay.fr', 'etsy.com', 'paypal.com', 'paypal.me'
])

const PLATFORM_DOMAINS: Set<string> = (() => {
  const set = new Set(BIG_PLATFORM_DOMAINS)
  for (const p of PLATFORMS) {
    if (!p.url || (p.category !== 'social' && p.category !== 'messaging')) continue
    try {
      const host = new URL(p.url.replace('{u}', 'x')).hostname
      // Modèle à sous-domaine (`{u}.tumblr.com`) : le domaine est celui de la plateforme.
      set.add(registrableDomain(host.replace(/^x\./, '')))
    } catch {
      /* modèle invalide : ignoré */
    }
  }
  return set
})()

export function isPlatformDomain(domain: string): boolean {
  return PLATFORM_DOMAINS.has(domain.toLowerCase())
}

/** Auteur d'un contenu (post, vidéo, dépôt) déduit de l'URL, quand elle le porte. */
export interface UrlAuthor extends UrlAccount {
  /** Le compte est l'auteur d'un contenu et non la page de profil elle-même. */
  content: boolean
}

// Contenus dont l'URL contient l'auteur : post X, vidéo TikTok, dépôt GitHub, message Telegram...
const CONTENT_PATTERNS: Array<[platform: string, host: RegExp, path: RegExp]> = [
  ['x', /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i, /^\/(\w{1,15})\/status(?:es)?\/\d+/],
  ['tiktok', /^(?:www\.|m\.)?tiktok\.com$/i, /^\/@([\w.]{2,24})\/(?:video|photo)\/\d+/],
  ['github', /^(?:www\.)?github\.com$/i, /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/[\w.-]+(?:\/|$)/],
  ['telegram', /^(?:www\.)?(?:t|telegram)\.me$/i, /^\/(?:s\/)?([A-Za-z]\w{3,31})(?:\/\d+)?\/?$/],
  ['medium', /^(?:www\.)?medium\.com$/i, /^\/@([\w.-]+)\/[\w-]+/],
  ['youtube', /^(?:www\.|m\.)?youtube\.com$/i, /^\/@([\w.-]{3,30})\/(?:videos|shorts|streams|featured|about|playlists|community)\/?$/]
]

// Chemins GitHub qui ne sont pas des comptes (github.com/orgs/x, github.com/topics/x...).
const GITHUB_RESERVED = new Set(['orgs', 'topics', 'collections', 'marketplace', 'sponsors', 'settings', 'features', 'apps', 'about', 'pricing', 'login', 'search', 'explore', 'trending', 'notifications', 'pulls', 'issues', 'enterprise', 'site', 'security', 'customer-stories', 'readme', 'events'])

/** Compte désigné par l'URL : profil reconnu, auteur d'un contenu, page GitHub Pages. */
export function accountInUrl(raw: string): UrlAuthor | null {
  const norm = normalizeUrl(raw)
  if (!norm) return null
  const url = new URL(norm)
  const host = url.hostname.toLowerCase()
  // Pages GitHub (`pseudo.github.io`) : le sous-domaine est le compte GitHub.
  const pages = host.match(/^([a-z0-9-]{1,39})\.github\.io$/)
  if (pages) return { platform: 'github', username: pages[1], content: true }
  // Sous-domaines de langue ou de version (fr.linkedin.com, fr-fr.facebook.com, fr.pinterest.com).
  const sub = host.match(/^(?:[a-z]{2}|[a-z]{2}-[a-z]{2}|web|mbasic|touch)\.(linkedin|facebook|pinterest)\.com$/)
  if (sub) url.hostname = `www.${sub[1]}.com`
  const profile = accountFromUrl(url.toString())
  if (profile) return { ...profile, content: false }
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  for (const [platform, hostRe, pathRe] of CONTENT_PATTERNS) {
    if (!hostRe.test(host)) continue
    const m = path.match(pathRe)
    if (!m) continue
    if (platform === 'github' && GITHUB_RESERVED.has(m[1].toLowerCase())) return null
    if (platform === 'telegram' && /^(joinchat|addstickers|share|proxy|iv|socks|login)$/i.test(m[1])) return null
    return { platform, username: m[1], content: platform !== 'telegram' && platform !== 'youtube' }
  }
  return null
}

/** Le pseudo vaut-il d'être suivi sur d'autres sites (pas un identifiant numérique ou technique) ? */
export function isPivotUsername(platform: string, username: string): boolean {
  if (/^\d+$/.test(username)) return false
  if (platform === 'youtube' && /^UC[\w-]{22}$/.test(username)) return false
  if (platform === 'mastodon' || username.includes('@') || (platform === 'bluesky' && username.includes('.'))) return false
  return /^[\p{L}\d_.-]{2,40}$/u.test(username)
}

function inputUrl(input: InputEntity): string | null {
  const candidates = [input.label, typeof input.data.url === 'string' ? input.data.url : '']
  for (const c of candidates) {
    const n = c ? normalizeUrl(c.trim()) : null
    if (n) return n
  }
  return null
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

export default defineModule({
  id: 'misc.url_parse',
  name: { fr: "Lecture de l'URL", en: 'URL breakdown' },
  description: {
    fr: "Lit l'URL sans la visiter : domaine enregistrable (sauf grandes plateformes), compte et pseudo quand c'est un profil ou un contenu signé (Instagram, GitHub, TikTok, YouTube, LinkedIn, X...), adresse IP quand l'hôte en est une. Hors ligne.",
    en: 'Reads the URL without visiting it: registrable domain (except large platforms), account and username when it is a profile or an authored content (Instagram, GitHub, TikTok, YouTube, LinkedIn, X...), IP address when the host is one. Offline.'
  },
  category: 'web',
  inputTypes: ['url', 'website'],
  accepts: (input) => inputUrl(input) !== null,
  async run(input, ctx) {
    const url = inputUrl(input)
    if (!url) return {}
    const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    const entities: OutEntity[] = []

    const account = accountInUrl(url)
    if (account) {
      const name = getPlatform(account.platform)?.name ?? account.platform
      const label = account.label ?? account.username
      entities.push({
        ref: 'account',
        type: 'account',
        label,
        platform: account.platform,
        data: account.content ? { username: account.username } : { username: account.username, url: url.replace(/\/$/, '') },
        linkLabel: account.content ? tr(ctx, `auteur (${name})`, `author (${name})`) : tr(ctx, `profil ${name}`, `${name} profile`)
      })
      if (isPivotUsername(account.platform, account.username))
        entities.push({ type: 'username', label: account.username, from: 'account', linkLabel: tr(ctx, 'pseudo', 'username') })
    }

    if (IPV4.test(host) || (host.includes(':') && /^[0-9a-f:.]+$/i.test(host))) {
      entities.push({ type: 'ip', label: host, linkLabel: tr(ctx, 'hôte', 'host') })
    } else if (host.includes('.') && !host.endsWith('.onion') && !host.endsWith('.local')) {
      // Un lien .onion ne passe pas par le DNS : le transformer en domaine ferait fuiter le nom.
      const domain = registrableDomain(host)
      if (!account && !isPlatformDomain(domain)) entities.push({ type: 'domain', label: domain, linkLabel: tr(ctx, 'domaine', 'domain') })
    }
    return { entities }
  }
})
