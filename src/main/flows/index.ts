// Parcours scriptés de la recherche assistée (voir `AssistFlow`) : valeur saisie ou cherchée
// pour chaque parcours, à partir du nœud de la recherche manuelle.

import type { AssistFlow } from '@shared/types'
import { facebookValue } from './facebook'

/** Valeur que le parcours utilise pour ce nœud, ou `null` si elle est inexploitable. */
export function flowValue(flow: AssistFlow, type: string, label: string): string | null {
  switch (flow) {
    case 'facebook_identify':
      return facebookValue(type, label)
    default:
      return null
  }
}
