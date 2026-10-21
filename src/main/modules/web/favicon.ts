import { createHash } from 'node:crypto'
import { defineModule, ModuleError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { toUrl } from '../domain/_util'
import { tags } from './_html'

const MAX_ICON = 1_000_000

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

export function buildFaviconOutput(url: string, data: Uint8Array, mime: string, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const mmh3 = faviconHash(data)
  const md5 = createHash('md5').update(data).digest('hex')
  const sha256 = createHash('sha256').update(data).digest('hex')
  const fofa = Buffer.from(`icon_hash="${mmh3}"`).toString('base64')
  const searches: Array<[string, string]> = [
    ['Shodan', `https://www.shodan.io/search?query=${encodeURIComponent(`http.favicon.hash:${mmh3}`)}`],
    ['FOFA', `https://en.fofa.info/result?qbase64=${encodeURIComponent(fofa)}`],
    ['Censys', `https://search.censys.io/search?resource=hosts&q=${encodeURIComponent(`services.http.response.favicons.md5_hash:${md5}`)}`],
    ['ZoomEye', `https://www.zoomeye.ai/searchResult?q=${encodeURIComponent(`iconhash="${mmh3}"`)}`]
  ]
  return {
    properties: {
      favicon_url: url,
      favicon_mmh3: String(mmh3),
      favicon_md5: md5,
      favicon_sha256: sha256
    },
    entities: [
      {
        ref: 'hash',
        type: 'hash',
        label: String(mmh3),
        data: { algorithm: 'MurmurHash3 (favicon Shodan)', md5, sha256, url, mime },
        image: url,
        linkLabel: 'favicon'
      },
      ...searches.map(([engine, link]) => ({
        type: 'search_link',
        label: `${engine} favicon ${mmh3}`,
        data: { url: link, engine },
        from: 'hash',
        linkLabel: fr ? 'sites avec la même icône' : 'sites with the same icon'
      }))
    ],
    raw: { url, mime, size: data.length, mmh3, md5, sha256 }
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
    fr: 'Contacte le site cible pour télécharger son favicon et calcule l’empreinte MurmurHash3 utilisée par Shodan, FOFA et ZoomEye (et MD5 pour Censys) : permet de retrouver d’autres serveurs, souvent l’origine cachée derrière un CDN.',
    en: 'Contacts the target site to download its favicon and computes the MurmurHash3 fingerprint used by Shodan, FOFA and ZoomEye (and MD5 for Censys): finds other servers, often the origin hidden behind a CDN.'
  },
  category: 'web',
  inputTypes: ['url', 'website', 'domain'],
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
      if (icon) return buildFaviconOutput(url, icon.data, icon.mime, ctx.lang)
    }
    return {}
  }
})
