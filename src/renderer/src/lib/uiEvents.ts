// Demandes d'interface sans lien direct entre composants : Ctrl+F (ou la palette) demande le
// champ de recherche de la vue affichée, qui s'en charge (barre du haut, tableau, accueil) ;
// la palette demande la saisie rapide du canevas, l'aide des raccourcis, une nouvelle enquête.

import { useEffect, useRef } from 'react'

export type UiEvent = 'focus-search' | 'quick-add' | 'shortcuts' | 'new-investigation'

/** Envoie une demande. Renvoie `true` si un composant affiché l'a prise en charge. */
export function emitUi(name: UiEvent): boolean {
  const e = new CustomEvent(`masint:${name}`, { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

/** Prend en charge une demande tant que le composant est affiché. */
export function useUiEvent(name: UiEvent, handler: () => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const on = (e: Event): void => {
      e.preventDefault()
      ref.current()
    }
    window.addEventListener(`masint:${name}`, on)
    return () => window.removeEventListener(`masint:${name}`, on)
  }, [name])
}

/** Demande le champ de recherche de la vue affichée. Renvoie `false` si aucun ne l'a pris. */
export function requestSearchFocus(): boolean {
  return emitUi('focus-search')
}

/** Prend en charge les demandes de recherche (Ctrl+F) tant que le composant est affiché. */
export function useSearchFocus(handler: () => void): void {
  useUiEvent('focus-search', handler)
}
