// Photo de profil d'un compte → entité `photo` reliée au compte, pour que les modules image
// (EXIF, empreintes, recherche inversée) la traitent. L'image vient du CDN de la plateforme,
// jamais du site de la cible : l'avatar déjà joint au compte est réutilisé tel quel, sinon le
// moteur le télécharge à travers le proxy. Les avatars par défaut sont ignorés.

import { defineModule, type InputEntity } from '@shared/modules'
import { isDefaultAvatar } from '@shared/avatars'
import { getPlatform } from '@shared/platforms'

// Propriétés où des modules rangent l'URL d'une photo de profil.
const AVATAR_KEYS = ['avatar', 'avatar_url', 'profile_image', 'profile_image_url', 'profile_picture', 'picture', 'photo_url', 'image', 'image_url']

export { isDefaultAvatar }

/** URL de la photo de profil : origine de l'image jointe, sinon propriété du compte. */
export function avatarUrl(input: InputEntity): string | null {
  const candidates = [input.imageOrigin, ...AVATAR_KEYS.map((k) => input.data[k])]
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\/\S+$/i.test(c.trim()) && !isDefaultAvatar(c.trim())) return c.trim()
  }
  return null
}

export default defineModule({
  id: 'social.avatar_photo',
  name: { fr: 'Photo de profil', en: 'Profile picture' },
  description: {
    fr: 'Crée une entité Photo à partir de la photo de profil du compte (téléchargée depuis le CDN de la plateforme), pour lancer dessus les modules image : EXIF, empreintes, recherche inversée. Les avatars par défaut sont ignorés. Aucune requête quand l’avatar est déjà joint au compte.',
    en: 'Creates a Photo entity from the account profile picture (downloaded from the platform CDN), so the image modules can run on it: EXIF, hashes, reverse search. Default avatars are skipped. No request when the avatar is already attached to the account.'
  },
  category: 'image',
  inputTypes: ['account'],
  accepts: (input) => avatarUrl(input) !== null,
  // Un module de profil vient de joindre l'avatar au compte : la photo peut être créée.
  followUp: true,
  async run(input, ctx) {
    const url = avatarUrl(input)
    if (!url) return {}
    // Avatar déjà joint au compte : on le recopie, sans nouveau téléchargement.
    let image = url
    if (input.imageId && input.imageOrigin === url) {
      const att = await ctx.attachment(input.imageId)
      if (att && att.mime.startsWith('image/')) image = `data:${att.mime};base64,${att.data.toString('base64')}`
    }
    const site = getPlatform(input.platform)?.name ?? (typeof input.data.site === 'string' ? input.data.site : null)
    const user = typeof input.data.username === 'string' && input.data.username ? input.data.username : input.label
    return {
      entities: [
        {
          type: 'photo',
          // Libellé stable : relancer le module retrouve la même photo au lieu d'en créer une autre.
          label: site ? `Avatar ${site} : ${user}` : `Avatar : ${user}`,
          image,
          data: { url },
          linkLabel: ctx.lang === 'fr' ? 'photo de profil' : 'profile picture'
        }
      ]
    }
  }
})
