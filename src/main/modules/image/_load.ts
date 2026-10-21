// Récupère le contenu d'une photo : pièce jointe de l'enquête, sinon URL publique
// (propriété `url` ou libellé), téléchargée via le proxy.

import { ModuleError, type InputEntity, type ModuleContext } from '@shared/modules'
import { serviceError } from '../misc/_util'

const MAX_SIZE = 40 * 1024 * 1024

export interface LoadedImage {
  data: Buffer
  mime: string
  name: string
  url: string | null
}

/** URL publique (http/https) de l'image, si elle est connue. */
export function publicUrl(input: InputEntity): string | null {
  const candidates = [input.data.url, input.data.image_url, input.label]
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\/\S+$/i.test(c.trim())) return c.trim()
  }
  return null
}

export async function loadImage(input: InputEntity, ctx: ModuleContext): Promise<LoadedImage | null> {
  const url = publicUrl(input)
  if (input.imageId) {
    const att = await ctx.attachment(input.imageId)
    if (att) return { data: att.data, mime: att.mime, name: att.name, url }
  }
  if (!url) return null
  let res: Response
  try {
    res = await ctx.fetch(url, { timeoutMs: 30000 })
  } catch (e) {
    throw serviceError(e, new URL(url).host)
  }
  if (!res.ok) throw serviceError(Object.assign(new Error(`HTTP ${res.status}`), { status: res.status }), new URL(url).host)
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_SIZE) throw new ModuleError('Image trop volumineuse (plus de 40 Mo)', 'invalid_input')
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length > MAX_SIZE) throw new ModuleError('Image trop volumineuse (plus de 40 Mo)', 'invalid_input')
  const mime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim()
  return { data, mime, name: new URL(url).pathname.split('/').pop() || 'image', url }
}
