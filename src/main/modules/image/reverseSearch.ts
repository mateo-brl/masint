// Liens de recherche d'image inversée (Google Lens, Yandex, Bing, TinEye) pour une photo
// accessible par une URL publique. Hors ligne : seuls les liens sont construits.

import { defineModule, type ModuleContext, type OutEntity } from '@shared/modules'
import { tr } from '../misc/_util'
import { publicUrl } from './_load'

export function reverseLinks(url: string): Array<{ engine: string; url: string }> {
  const u = encodeURIComponent(url)
  return [
    { engine: 'Google Lens', url: `https://lens.google.com/uploadbyurl?url=${u}` },
    { engine: 'Yandex Images', url: `https://yandex.com/images/search?rpt=imageview&url=${u}` },
    { engine: 'Bing Visual Search', url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${u}` },
    { engine: 'TinEye', url: `https://tineye.com/search?url=${u}` }
  ]
}

export function reverseEntities(ctx: Pick<ModuleContext, 'lang'>, url: string): OutEntity[] {
  return reverseLinks(url).map((l) => ({
    type: 'search_link',
    label: `${l.engine} · ${url}`,
    data: { url: l.url, engine: l.engine },
    linkLabel: tr(ctx, 'recherche inversée', 'reverse search')
  }))
}

export default defineModule({
  id: 'image.reverse_search',
  name: { fr: "Recherche d'image inversée", en: 'Reverse image search' },
  description: {
    fr: "Liens Google Lens, Yandex, Bing et TinEye pour retrouver où la photo a été publiée. Nécessite une URL publique de l'image (propriété url). Hors ligne.",
    en: 'Google Lens, Yandex, Bing and TinEye links to find where the photo was published. Requires a public image URL (url property). Offline.'
  },
  category: 'image',
  inputTypes: ['photo'],
  accepts: (input) => !!publicUrl(input),
  async run(input, ctx) {
    const url = publicUrl(input)
    if (!url) return {}
    return { entities: reverseEntities(ctx, url) }
  }
})
