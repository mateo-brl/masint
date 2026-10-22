// Données d'affichage du canevas lues nœud par nœud. Chaque nœud ou lien s'abonne à sa seule
// valeur (ses pastilles, la sélection de ses extrémités) : glisser un nœud ou changer la
// sélection ne re-rend que les éléments concernés, et non les milliers d'autres.

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
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

/** Couleurs des communautés, de la plus grande à la plus petite ; les suivantes ne sont pas colorées. */
export const COMMUNITY_COLORS = ['#0090ff', '#30a46c', '#f76b15', '#d6409f', '#6e56cf', '#12a594', '#ffc53d', '#e5484d', '#a18072', '#8d8d93']

/** Opacité d'un élément estompé (filtre « estomper », hors du chemin mis en évidence). */
export const DIM_NODE = '0.2'
export const DIM_EDGE = '0.12'

/** Nœud sur le chemin mis en évidence : booléen, seuls les nœuds du chemin sont re-rendus. */
export function useOnPath(id: string): boolean {
  return useCanvas((s) => !!s.focus?.nodes.has(id))
}

/** Lien sur le chemin mis en évidence. */
export function useEdgeOnPath(id: string): boolean {
  return useCanvas((s) => !!s.focus?.edges.has(id))
}

/** Écrit une propriété de style seulement si elle change : pas d'invalidation inutile au montage. */
function setStyle(el: HTMLElement | SVGElement | null, prop: 'opacity' | 'outline' | 'visibility', value: string): void {
  if (el && el.style[prop] !== value) el.style[prop] = value
}

/**
 * Abonnement fin d'un élément du canevas qui écrit directement dans le DOM, sans re-rendu :
 * estomper 2000 nœuds (filtre, chemin) ou les colorer par communauté ne fait re-rendre aucun
 * d'eux. `decor` renvoie une clé : le DOM n'est touché que si elle change. Après chaque rendu
 * (élément remplacé, style recalculé par React), le décor est appliqué de nouveau.
 */
function useDecor(decor: (s: CanvasState, apply: boolean) => string): void {
  const last = useRef<string | null>(null)
  const fn = useRef(decor)
  fn.current = decor
  useLayoutEffect(() => {
    last.current = fn.current(useCanvas.getState(), true)
  })
  useEffect(
    () =>
      useCanvas.subscribe((s) => {
        const key = fn.current(s, false)
        if (key !== last.current) last.current = fn.current(s, true)
      }),
    []
  )
}

/** Décor d'un nœud : estompé, contour de sa communauté (sauf sur le chemin, contour rendu par React). */
export function useNodeDecor(id: string, ref: RefObject<HTMLElement | null>): void {
  useDecor((s, apply) => {
    const onPath = !!s.focus?.nodes.has(id)
    const dim = s.focus ? !onPath : s.dimmed.has(id)
    const c = s.community?.get(id)
    const color = c === undefined || onPath ? '' : `2px solid ${COMMUNITY_COLORS[c]}aa`
    if (apply) {
      setStyle(ref.current, 'opacity', dim ? DIM_NODE : '')
      if (!onPath) setStyle(ref.current, 'outline', color)
    }
    return `${dim ? 1 : 0}${onPath ? 1 : 0}${color}`
  })
}

/** Décor d'un lien : estompé (hors du chemin, ou extrémité estompée par le filtre), libellé masqué. */
export function useEdgeDecor(id: string, source: string, target: string, ref: RefObject<SVGGElement | null>, label: RefObject<HTMLElement | null>): void {
  useDecor((s, apply) => {
    const dim = s.focus ? !s.focus.edges.has(id) : s.dimmed.has(source) || s.dimmed.has(target)
    if (apply) {
      setStyle(ref.current, 'opacity', dim ? DIM_EDGE : '')
      setStyle(label.current, 'visibility', dim ? 'hidden' : '')
    }
    return dim ? '1' : '0'
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
