// Avatars par défaut des plateformes : sans intérêt pour l'enquête (aucune photo à analyser).

// Images génériques des plateformes (silhouette, initiales, identicône). Les trois identifiants
// numériques sont les silhouettes par défaut de Facebook, servies par son CDN (fbcdn).
const DEFAULT_AVATAR =
  /default|placeholder|missing\.(png|jpe?g|gif)|no[_-]?avatar|noavatar|blank\.(png|jpe?g|gif)|anonymous|silhouette|\/embed\/avatars\/|user-default-pictures|fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb|abs\.twimg\.com\/sticky\/default|static\.licdn\.com\/[^ ]*ghost|telegram\.org\/img\/|84628273_176159830277856_972693363922829312|10354686_10150004552801856_220367501106153455|1379841_10150004552801901_469209496895221757/i

/** Avatar par défaut ou généré (Gravatar `d=identicon`, `d=mp`...), sans intérêt pour l'enquête. */
export function isDefaultAvatar(url: string): boolean {
  if (DEFAULT_AVATAR.test(url)) return true
  try {
    const u = new URL(url)
    if (/(^|\.)gravatar\.com$/i.test(u.hostname)) {
      // `d=404` : Gravatar répond 404 sans vraie photo, l'image jointe est donc réelle.
      const d = u.searchParams.get('d') ?? u.searchParams.get('default')
      return !!d && d !== '404'
    }
  } catch {
    return true
  }
  return false
}
