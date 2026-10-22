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
  /** Nœuds écartés par le filtre en mode « estomper ». */
  dimmed: ReadonlySet<string>
  /** Mise en évidence (plus court chemin) : le reste est estompé jusqu'à Échap. */
  focus: { nodes: ReadonlySet<string>; edges: ReadonlySet<string> } | null
  /** Communauté de chaque nœud (« Colorer par communauté ») ; `null` si l'option est coupée. */
  community: ReadonlyMap<string, number> | null
}

export const useCanvas = create<CanvasState>(() => ({
  outDegree: new Map(),
  collapsedCount: new Map(),
  reviewCount: new Map(),
  selected: new Set(),
  dense: false,
  capturing: false,
  dimmed: new Set(),
  focus: null,
  community: null
}))

/** 0 : normal, 1 : estompé, 2 : mis en évidence. */
export type Emphasis = 0 | 1 | 2

/** Mise en avant d'un nœud : un nombre, pour ne re-rendre que les nœuds dont l'état change. */
export function useNodeEmphasis(id: string): Emphasis {
  return useCanvas((s) => (s.focus ? (s.focus.nodes.has(id) ? 2 : 1) : s.dimmed.has(id) ? 1 : 0))
}

/** Mise en avant d'un lien : chemin en évidence, ou extrémité estompée par le filtre. */
export function useEdgeEmphasis(id: string, source: string, target: string): Emphasis {
  return useCanvas((s) => (s.focus ? (s.focus.edges.has(id) ? 2 : 1) : s.dimmed.has(source) || s.dimmed.has(target) ? 1 : 0))
}

/** Couleurs des communautés, de la plus grande à la plus petite ; les suivantes ne sont pas colorées. */
export const COMMUNITY_COLORS = ['#0090ff', '#30a46c', '#f76b15', '#d6409f', '#6e56cf', '#12a594', '#ffc53d', '#e5484d', '#a18072', '#8d8d93']

/** Couleur de la communauté d'un nœud, ou `undefined`. */
export function useCommunityColor(id: string): string | undefined {
  return useCanvas((s) => {
    const c = s.community?.get(id)
    return c === undefined ? undefined : COMMUNITY_COLORS[c]
  })
}

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
