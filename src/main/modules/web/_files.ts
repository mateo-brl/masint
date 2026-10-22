// Lecture des fichiers publics d'un site (plan du site, ads.txt, associations d'applications),
// avec une taille maximale : on n'attend jamais la fin d'un fichier démesuré.

import { gunzipSync } from 'node:zlib'
import type { ModuleContext } from '@shared/modules'

export interface SiteFile {
  text: string
  /** Fichier plus gros que la limite : seul le début a été lu. */
  truncated: boolean
  contentType: string
  /** Adresse finale, après redirection. */
  url: string
}

/** Corps de la réponse lu jusqu'à `max` octets. */
export async function readCapped(res: Response, max: number): Promise<{ data: Buffer; truncated: boolean }> {
  if (!res.body) return { data: Buffer.alloc(0), truncated: false }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
      if (size >= max) {
        truncated = true
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  } catch {
    /* corps interrompu : on garde ce qui a été lu */
  }
  const data = Buffer.concat(chunks)
  return { data: data.subarray(0, max), truncated }
}

/**
 * Fichier texte du site, ou `null` s'il est absent, injoignable ou remplacé par une page HTML
 * (erreur 404 déguisée en 200). Un fichier gzip (`sitemap.xml.gz`) est décompressé, dans la même
 * limite de taille.
 */
export async function fetchSiteFile(ctx: ModuleContext, url: string, max: number): Promise<SiteFile | null> {
  let res: Response
  try {
    res = await ctx.fetch(url, { redirect: 'follow', timeoutMs: 20000 })
  } catch {
    return null
  }
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  if (!res.ok || /html/.test(contentType)) {
    await res.body?.cancel().catch(() => undefined)
    return null
  }
  const read = await readCapped(res, max)
  const truncated = read.truncated
  let data = read.data
  if (data[0] === 0x1f && data[1] === 0x8b) {
    if (truncated) return null
    try {
      data = gunzipSync(data, { maxOutputLength: max })
    } catch {
      // Archive corrompue ou plus grosse que la limite une fois décompressée.
      return null
    }
  }
  return { text: data.toString('utf8'), truncated, contentType, url: res.url || url }
}
