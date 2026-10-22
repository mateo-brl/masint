import { createHash } from 'node:crypto'
import { defineModule, ModuleError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { cappedList, compact, isDomain, MAX_LIST_ENTITIES, toUrl, uniq } from '../domain/_util'
import { tags } from './_html'

const MAX_ICON = 1_000_000

/** Même clé que le module domain.urlscan : une seule saisie pour l'utilisateur. */
const URLSCAN_KEY = { id: 'urlscan', label: 'URLScan API key', url: 'https://urlscan.io/user/profile/', optional: true }

/** MurmurHash3 32 bits (x86), signé, graine 0 : algorithme de `mmh3.hash` en Python. */
export function murmur3(data: Uint8Array, seed = 0): number {
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  let h = seed >>> 0
  const len = data.length
  const blocks = len - (len % 4)
  for (let i = 0; i < blocks; i += 4) {
    let k = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
    k = Math.imul(k, c1)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, c2)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  let k = 0
  switch (len & 3) {
    case 3:
      k ^= data[blocks + 2] << 16
    // falls through
    case 2:
      k ^= data[blocks + 1] << 8
    // falls through
    case 1:
      k ^= data[blocks]
      k = Math.imul(k, c1)
      k = (k << 15) | (k >>> 17)
      k = Math.imul(k, c2)
      h ^= k
  }
  h ^= len
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h | 0
}

/** Base64 découpé en lignes de 76 caractères avec saut de ligne final (`base64.encodebytes`). */
export function encodebytes(data: Uint8Array): string {
  const b64 = Buffer.from(data).toString('base64')
  return (b64.match(/.{1,76}/g) ?? []).map((l) => l + '\n').join('')
}

/** Empreinte de favicon au format Shodan (`http.favicon.hash`). */
export function faviconHash(data: Uint8Array): number {
  return murmur3(Buffer.from(encodebytes(data), 'utf8'))
}

/** URL de l'icône déclarée dans la page (`<link rel="icon">`), sinon `/favicon.ico`. */
export function iconUrl(html: string, base: string): string {
  const icons = tags(html, 'link').filter((a) => /(^|\s)(shortcut\s+)?icon(\s|$)/i.test(a.rel ?? '') && a.href)
  // On préfère l'.ico ou le PNG classique au SVG (hash moins répandu dans les moteurs).
  const pick = icons.find((a) => /\.ico(\?|$)/i.test(a.href)) ?? icons.find((a) => !/\.svg(\?|$)/i.test(a.href)) ?? icons[0]
  try {
    return new URL(pick?.href ?? '/favicon.ico', base).toString()
  } catch {
    return new URL('/favicon.ico', base).toString()
  }
}

/** Empreintes du favicon, rangées dans la fiche du site (pas de nœud). */
export function buildFaviconOutput(url: string, data: Uint8Array, mime: string, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const mmh3 = faviconHash(data)
  const md5 = createHash('md5').update(data).digest('hex')
  const sha256 = createHash('sha256').update(data).digest('hex')
  const fofa = Buffer.from(`icon_hash="${mmh3}"`).toString('base64')
  const servers = fr ? 'Serveurs qui exposent la même icône, souvent l’origine cachée derrière un CDN' : 'Servers exposing the same icon, often the origin hidden behind a CDN'
  return {
    properties: {
      favicon_url: url,
      favicon_mmh3: String(mmh3),
      favicon_md5: md5,
      favicon_sha256: sha256
    },
    // Index des serveurs par empreinte : compte requis pour filtrer, donc à la main.
    manual: [
      {
        label: 'Shodan',
        url: `https://www.shodan.io/search?query=${encodeURIComponent(`http.favicon.hash:${mmh3}`)}`,
        hint: `${servers} ${fr ? '(compte gratuit requis).' : '(free account required).'}`
      },
      {
        label: 'Censys',
        url: `https://search.censys.io/search?resource=hosts&q=${encodeURIComponent(`services.http.response.favicons.md5_hash:${md5}`)}`,
        hint: `${servers} ${fr ? '(compte gratuit requis).' : '(free account required).'}`
      },
      {
        label: 'FOFA',
        url: `https://en.fofa.info/result?qbase64=${encodeURIComponent(fofa)}`,
        hint: `${servers}.`
      }
    ],
    raw: { url, mime, size: data.length, mmh3, md5, sha256 }
  }
}

/** Au-delà, l'icône est celle d'un hébergeur ou d'un CMS : les sites n'ont rien en commun. */
const MAX_SHARED = 25

/** Le nom appartient-il au site lui-même (même domaine ou sous-domaine) ? */
const sameSite = (host: string, site: string): boolean => host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`)

export interface UrlscanHit {
  page?: { domain?: string; url?: string }
  task?: { time?: string }
}

/**
 * Autres sites dont les pages chargent exactement le même fichier d'icône (urlscan.io). Indice
 * faible : l'icône par défaut d'un hébergeur ou d'un CMS est partagée par des sites sans rapport,
 * d'où le passage par « À vérifier ».
 */
export function sharedFaviconOutput(hits: UrlscanHit[], sites: string[], lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const domains = uniq(
    hits
      .map((h) => (h.page?.domain ?? '').toLowerCase().replace(/^www\./, ''))
      .filter((d) => isDomain(d) && !sites.some((s) => sameSite(d, s)))
  )
  if (!domains.length) return {}
  const generic = domains.length > MAX_SHARED
  return {
    properties: compact({
      ...cappedList('favicon_shared_domains', domains),
      favicon_generic: generic || null
    }),
    entities: generic
      ? []
      : domains.slice(0, MAX_LIST_ENTITIES).map((d) => ({
          type: 'domain',
          label: d,
          linkLabel: fr ? 'même favicon' : 'same favicon',
          review: true,
          reviewReason: fr
            ? 'même icône de site : vérifier qu’il ne s’agit pas de l’icône par défaut d’un hébergeur ou d’un CMS'
            : 'same site icon: check it is not a hosting or CMS default icon'
        }))
  }
}

async function sharedFavicon(ctx: ModuleContext, sha256: string, sites: string[]): Promise<ModuleOutput> {
  const key = ctx.key(URLSCAN_KEY.id)
  try {
    const res = await ctx.fetchJson<{ results?: UrlscanHit[] }>('https://urlscan.io/api/v1/search/', {
      query: { q: `hash:${sha256}`, size: 100 },
      headers: key ? { 'API-Key': key } : {},
      timeoutMs: 20000
    })
    return sharedFaviconOutput(res.results ?? [], sites, ctx.lang)
  } catch (e) {
    // Quota ou panne d'urlscan : les empreintes restent utiles sans la recherche inversée.
    ctx.log(`urlscan.io : ${e instanceof Error ? e.message : String(e)}`)
    return {}
  }
}

async function download(ctx: ModuleContext, url: string): Promise<{ data: Uint8Array; mime: string } | null> {
  const res = await ctx.fetch(url, { redirect: 'follow', timeoutMs: 20000 })
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!res.ok || /html/i.test(mime)) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  const data = new Uint8Array(await res.arrayBuffer())
  return data.length && data.length <= MAX_ICON ? { data, mime } : null
}

export default defineModule({
  id: 'web.favicon',
  name: { fr: 'Empreinte du favicon', en: 'Favicon fingerprint' },
  description: {
    fr: 'Contacte le site cible pour télécharger son favicon, range ses empreintes dans la fiche (MurmurHash3 de Shodan et FOFA, MD5 de Censys, SHA-256) et relie les autres sites dont les pages chargent exactement la même icône (urlscan.io, clé facultative). Les recherches de serveurs par empreinte (Shodan, Censys, FOFA) sont proposées dans « À vérifier ».',
    en: 'Contacts the target site to download its favicon, stores its fingerprints in the record (Shodan and FOFA MurmurHash3, Censys MD5, SHA-256) and links other sites whose pages load exactly the same icon (urlscan.io, optional key). Server searches by fingerprint (Shodan, Censys, FOFA) are listed in "To review".'
  },
  category: 'web',
  inputTypes: ['url', 'website', 'domain'],
  keys: [URLSCAN_KEY],
  homepage: 'https://urlscan.io/',
  noisy: true,
  async run(input, ctx) {
    let page: URL
    try {
      page = new URL(toUrl(input.label))
    } catch {
      throw new ModuleError('URL invalide', 'invalid_input')
    }
    let html = ''
    let base = page.origin + '/'
    try {
      const res = await ctx.fetch(page.origin + '/', { redirect: 'follow', timeoutMs: 20000 })
      base = res.url || base
      html = /html/i.test(res.headers.get('content-type') ?? '') ? (await res.text()).slice(0, 1_000_000) : ''
    } catch (e) {
      throw new ModuleError(`Site injoignable : ${e instanceof Error ? e.message : e}`, 'unavailable')
    }
    const candidates = Array.from(new Set([iconUrl(html, base), new URL('/favicon.ico', base).toString()]))
    for (const url of candidates) {
      const icon = await download(ctx, url).catch(() => null)
      if (!icon) continue
      const out = buildFaviconOutput(url, icon.data, icon.mime, ctx.lang)
      // Le site lui-même, avant et après redirection, n'est pas une correspondance.
      const sites = uniq([page.hostname, new URL(base).hostname].map((h) => h.toLowerCase().replace(/^www\./, '')))
      const shared = await sharedFavicon(ctx, String(out.properties!.favicon_sha256), sites)
      return { ...out, properties: { ...out.properties, ...shared.properties }, entities: shared.entities }
    }
    return {}
  }
})
