// Recherche d'image inversée. Photo accessible par une URL publique : TinEye est interrogé
// directement (pages où la même image est publiée) ; Google Lens, Yandex et Bing sont proposés à
// la main avec l'URL déjà remplie. Photo importée depuis l'ordinateur : les pages de dépôt des
// moteurs sont proposées à la main (la photo n'est jamais envoyée sans l'accord de l'enquêteur).

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity, type OutManualCheck } from '@shared/modules'
import { compact } from '../social/_lib'
import { publicUrl } from './_load'

const MAX_MATCHES = 10

export interface TinEyeMatch {
  domain?: string
  score?: number
  first_crawl_date?: string
  backlinks?: Array<{ url?: string; backlink?: string; crawl_date?: string }>
}

export interface TinEyeResponse {
  num_matches?: number
  first_crawl_date?: string
  query_hash?: string
  matches?: TinEyeMatch[]
  suggestions?: { key?: string; description?: string[] } | null
}

const t = (lang: 'fr' | 'en', fr: string, en: string): string => (lang === 'fr' ? fr : en)

/** Recherches à faire à la main : avec l'URL de l'image, ou sur la page de dépôt du moteur. */
export function manualChecks(url: string | null, lang: 'fr' | 'en', withTinEye = !url): OutManualCheck[] {
  const u = url ? encodeURIComponent(url) : ''
  const upload = t(lang, 'Déposez la photo sur la page.', 'Drop the photo on the page.')
  const checks: OutManualCheck[] = [
    {
      label: 'Google Lens',
      url: url ? `https://lens.google.com/uploadbyurl?url=${u}` : 'https://lens.google.com/',
      hint: `${url ? '' : `${upload} `}${t(lang, 'Pages et profils qui publient la photo, lieux et objets reconnus.', 'Pages and profiles publishing the photo, recognised places and objects.')}`
    },
    {
      label: 'Yandex Images',
      url: url ? `https://yandex.com/images/search?rpt=imageview&url=${u}` : 'https://yandex.com/images/',
      hint: `${url ? '' : `${upload} `}${t(lang, 'Efficace sur les visages et les sites d’Europe de l’Est.', 'Effective on faces and Eastern European sites.')}`
    },
    {
      label: 'Bing Visual Search',
      url: url
        ? `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${u}`
        : 'https://www.bing.com/visualsearch',
      hint: `${url ? '' : `${upload} `}${t(lang, 'Copies de la photo et images similaires.', 'Copies of the photo and similar images.')}`
    }
  ]
  if (withTinEye) {
    checks.push({
      label: 'TinEye',
      url: url ? `https://tineye.com/search?url=${u}` : 'https://tineye.com/',
      hint: `${url ? '' : `${upload} `}${t(lang, 'Copies exactes ou retouchées, avec la date de première apparition.', 'Exact or edited copies, with the date first seen.')}`
    })
  }
  return checks
}

/** Pages où TinEye a trouvé la même image (une par correspondance, les meilleures d'abord). */
export function tineyeOutput(res: TinEyeResponse, lang: 'fr' | 'en'): ModuleOutput {
  const matches = res.matches ?? []
  const total = res.num_matches ?? matches.length
  if (!total) return { properties: { tineye_matches: 0 } }
  const entities: OutEntity[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    const b = m.backlinks?.find((x) => x.backlink)
    if (!b?.backlink || seen.has(b.backlink)) continue
    seen.add(b.backlink)
    entities.push({
      type: 'url',
      label: b.backlink,
      data: compact({
        domain: m.domain,
        image_url: b.url,
        first_seen: m.first_crawl_date ?? b.crawl_date,
        match_score: typeof m.score === 'number' ? Math.round(m.score) : undefined
      }),
      linkLabel: t(lang, 'même image (TinEye)', 'same image (TinEye)')
    })
    if (entities.length >= MAX_MATCHES) break
  }
  return {
    entities,
    properties: compact({
      tineye_matches: total,
      tineye_first_seen: res.first_crawl_date,
      tineye_search_url: res.query_hash ? `https://tineye.com/search/${res.query_hash}` : undefined
    }),
    raw: { num_matches: total, first_crawl_date: res.first_crawl_date, matches: matches.slice(0, 50) }
  }
}

async function tineye(ctx: ModuleContext, url: string): Promise<TinEyeResponse> {
  const res = await ctx.fetch('https://tineye.com/api/v1/result_json/', { query: { url }, timeoutMs: 45000, headers: { accept: 'application/json' } })
  const text = await res.text()
  let json: TinEyeResponse
  try {
    json = JSON.parse(text) as TinEyeResponse
  } catch {
    throw new Error(`HTTP ${res.status}`)
  }
  // Image illisible par TinEye (format, accès refusé) : réponse 422 avec une explication.
  if (!res.ok && !json.matches) throw new Error(json.suggestions?.description?.[0] ?? `HTTP ${res.status}`)
  return json
}

export default defineModule({
  id: 'image.reverse_search',
  name: { fr: "Recherche d'image inversée", en: 'Reverse image search' },
  description: {
    fr: "Photo accessible par une URL publique : interroge TinEye et relie les pages où la même image est publiée (10 au plus), avec la date de première apparition ; Google Lens, Yandex et Bing sont proposés dans « À vérifier ». Photo importée depuis l'ordinateur : les pages de dépôt de ces moteurs sont proposées dans « À vérifier », la photo n'est envoyée nulle part.",
    en: 'Photo with a public URL: queries TinEye and links the pages publishing the same image (up to 10), with the date first seen; Google Lens, Yandex and Bing are listed in "To review". Photo imported from the computer: the upload pages of these engines are listed in "To review", the photo is not sent anywhere.'
  },
  category: 'image',
  inputTypes: ['photo'],
  homepage: 'https://tineye.com/',
  experimental: true,
  accepts: (input) => !!publicUrl(input) || !!input.imageId,
  async run(input, ctx) {
    const url = publicUrl(input)
    if (!url) return input.imageId ? { manual: manualChecks(null, ctx.lang) } : {}
    try {
      const out = tineyeOutput(await tineye(ctx, url), ctx.lang)
      return { ...out, manual: manualChecks(url, ctx.lang, false) }
    } catch (e) {
      // TinEye indisponible ou image illisible : la recherche reste possible à la main.
      ctx.log(`TinEye : ${e instanceof Error ? e.message : String(e)}`)
      return { manual: manualChecks(url, ctx.lang, true) }
    }
  }
})
