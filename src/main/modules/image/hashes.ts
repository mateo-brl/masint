// Empreintes cryptographiques d'une photo (SHA-256, SHA-1, MD5) : identifiants stables
// pour retrouver le même fichier ailleurs (bases de hash, VirusTotal...). Hors ligne.

import { createHash } from 'node:crypto'
import { defineModule, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { tr } from '../misc/_util'
import { loadImage, publicUrl } from './_load'

export function hashOutput(ctx: Pick<ModuleContext, 'lang'>, data: Buffer, mime: string): ModuleOutput {
  const digest = (algo: string): string => createHash(algo).update(data).digest('hex')
  const sha256 = digest('sha256')
  const md5 = digest('md5')
  return {
    properties: { sha256, sha1: digest('sha1'), md5, size: data.length, mime },
    entities: [
      { type: 'hash', label: sha256, data: { algorithm: 'SHA-256' }, linkLabel: tr(ctx, 'empreinte SHA-256', 'SHA-256 hash') },
      { type: 'hash', label: md5, data: { algorithm: 'MD5' }, linkLabel: tr(ctx, 'empreinte MD5', 'MD5 hash') }
    ]
  }
}

export default defineModule({
  id: 'image.hashes',
  name: { fr: 'Empreintes du fichier image', en: 'Image file hashes' },
  description: {
    fr: "Calcule les empreintes SHA-256, SHA-1 et MD5 de la photo, la taille et le type du fichier. Les empreintes peuvent ensuite être recherchées dans les bases de fichiers connus. Hors ligne pour une photo importée.",
    en: 'Computes the SHA-256, SHA-1 and MD5 hashes, size and type of the photo file. The hashes can then be looked up in known-file databases. Offline for an imported photo.'
  },
  category: 'image',
  inputTypes: ['photo'],
  accepts: (input) => !!input.imageId || !!publicUrl(input),
  async run(input, ctx) {
    const img = await loadImage(input, ctx)
    if (!img) return {}
    return hashOutput(ctx, img.data, img.mime)
  }
})
