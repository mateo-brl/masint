// Données d'affichage du canevas lues nœud par nœud. Chaque nœud ou lien s'abonne à sa seule
// valeur (ses pastilles, la sélection de ses extrémités) : glisser un nœud ou changer la
// sélection ne re-rend que les éléments concernés, et non les milliers d'autres.

import { useStore, type ReactFlowState } from '@xyflow/react'
import { create } from 'zustand'

interface CanvasState {
  /** Nombre de liens sortants par nœud (pastille rouge). */
  outDegree: ReadonlyMap<string, number>
  /** Nombre de nœuds masqués sous chaque nœud replié (« +N »). */
  collapsedCount: ReadonlyMap<string, number>
  /** Nombre de résultats à vérifier par nœud d'origine (pastille orange). */
  reviewCount: ReadonlyMap<string, number>
  /** Nœuds sélectionnés : leurs liens affichent leur libellé. */
  selected: ReadonlySet<string>
  /** Grand graphe : ombres allégées. */
  dense: boolean
  /** Capture en cours (exports) : rendu complet, sans simplification ni éléments hors champ omis. */
  capturing: boolean
}

export const useCanvas = create<CanvasState>(() => ({
  outDegree: new Map(),
  collapsedCount: new Map(),
  reviewCount: new Map(),
  selected: new Set(),
  dense: false,
  capturing: false
}))

/** Au-delà de ce nombre de nœuds, ombres allégées (le flou coûte cher à dessiner). */
export const DENSE_NODES = 300

/** En dessous de ce zoom, rendu simplifié : icône seule, ni badges, ni texte, ni libellés de liens. */
export const LOW_ZOOM = 0.45

/** Booléen : ne change (et ne fait re-rendre) qu'au franchissement du seuil. */
const lowZoomSelector = (s: ReactFlowState): boolean => s.transform[2] < LOW_ZOOM

/** Rendu simplifié à faible zoom, sauf pendant une capture. À utiliser dans le canevas. */
export function useLowZoom(): boolean {
  const low = useStore(lowZoomSelector)
  const capturing = useCanvas((s) => s.capturing)
  return low && !capturing
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** Exécute une capture avec le rendu complet du canevas, puis revient au rendu normal. */
export async function withFullRender<T>(fn: () => Promise<T>): Promise<T> {
  if (useCanvas.getState().capturing) return fn()
  useCanvas.setState({ capturing: true })
  try {
    await nextFrame()
    await nextFrame()
    return await fn()
  } finally {
    useCanvas.setState({ capturing: false })
  }
}
