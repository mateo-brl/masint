// Données d'affichage du canevas lues nœud par nœud. Chaque nœud ou lien s'abonne à sa seule
// valeur (ses pastilles, la sélection de ses extrémités) : glisser un nœud ou changer la
// sélection ne re-rend que les éléments concernés, et non les milliers d'autres.

import { useEffect, useReducer, useState } from 'react'
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
  /** Nombre d'autres enquêtes où chaque nœud apparaît (corrélation). */
  crossRefs: ReadonlyMap<string, number>
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
  community: null,
  crossRefs: new Map()
}))

/** Couleurs des communautés, de la plus grande à la plus petite ; les suivantes ne sont pas colorées. */
export const COMMUNITY_COLORS = ['#0090ff', '#30a46c', '#f76b15', '#d6409f', '#6e56cf', '#12a594', '#ffc53d', '#e5484d', '#a18072', '#8d8d93']

/** Opacité d'un élément estompé (filtre « estomper », hors du chemin mis en évidence). */
export const DIM_NODE = '0.2'
export const DIM_EDGE = '0.12'

/** Écrit une propriété de style seulement si elle change : pas d'invalidation inutile au montage. */
function setStyle(el: HTMLElement | SVGElement | null, prop: 'opacity' | 'outline' | 'visibility', value: string): void {
  if (el && el.style[prop] !== value) el.style[prop] = value
}

function setClass(el: Element | null, name: string, on: boolean): void {
  if (el && el.classList.contains(name) !== on) el.classList.toggle(name, on)
}

/** Classe des éléments du plus court chemin mis en évidence (voir styles.css). */
const ON_PATH = 'masint-on-path'

interface DecorSlot {
  /** Élément décoré (racine du nœud, groupe SVG du lien) et élément secondaire (libellé du lien). */
  el: HTMLElement | SVGElement | null
  extra: HTMLElement | null
  /** Clé du décor écrit et clé de ce qui a été rendu par React. */
  key: string | null
  rendered: string
  paint: (s: CanvasState, el: HTMLElement | SVGElement | null, extra: HTMLElement | null) => string
  renderKey: (s: CanvasState) => string
  rerender: () => void
  ref: (el: HTMLElement | SVGElement | null) => void
  extraRef: (el: HTMLElement | null) => void
}

const bump = (n: number): number => n + 1
const nothing = (): void => undefined

/**
 * Décor d'un élément du canevas écrit directement dans le DOM, sans re-rendu : estomper 2000
 * nœuds (filtre, chemin), les colorer par communauté ou mettre un chemin en évidence ne fait
 * re-rendre aucun d'eux. Un seul abonnement par élément, et peu de crochets (la mémoire compte
 * à 4 500 éléments). `paint` écrit le décor (si un élément est donné) et renvoie sa clé : le DOM
 * n'est touché que quand elle change. `renderKey` : ce qui demande un vrai rendu (pastille,
 * libellé) ; l'élément n'est re-rendu que si elle change. Les références renvoyées s'attachent
 * aux éléments : un élément remplacé (rendu simplifié à faible zoom) reçoit aussitôt le décor.
 */
function useDecor(
  paint: DecorSlot['paint'],
  renderKey: DecorSlot['renderKey']
): { ref: (el: HTMLElement | SVGElement | null) => void; extraRef: (el: HTMLElement | null) => void } {
  const [, rerender] = useReducer(bump, 0)
  const [slot] = useState<DecorSlot>(() => {
    const d: DecorSlot = {
      el: null,
      extra: null,
      key: null,
      rendered: '',
      paint,
      renderKey,
      rerender: nothing,
      ref: (el) => {
        d.el = el
        if (el) d.key = d.paint(useCanvas.getState(), el, d.extra)
      },
      extraRef: (el) => {
        d.extra = el
        if (el) d.key = d.paint(useCanvas.getState(), d.el, el)
      }
    }
    return d
  })
  slot.paint = paint
  slot.renderKey = renderKey
  slot.rerender = rerender
  slot.rendered = renderKey(useCanvas.getState())
  useEffect(() => {
    const update = (s: CanvasState): void => {
      if (slot.paint(s, null, null) !== slot.key) slot.key = slot.paint(s, slot.el, slot.extra)
      if (slot.renderKey(s) !== slot.rendered) slot.rerender()
    }
    // État changé entre le rendu et l'abonnement : rattrapé tout de suite.
    update(useCanvas.getState())
    return useCanvas.subscribe(update)
  }, [slot])
  return slot
}

/**
 * Décor d'un nœud : estompé (filtre « estomper », hors du chemin), contour de sa communauté,
 * mise en évidence sur le chemin. Re-rendu seulement quand le nombre d'autres enquêtes où il
 * apparaît change. Renvoie la référence à poser sur la racine du nœud et ce nombre.
 */
export function useNodeDecor(id: string): { ref: (el: HTMLElement | SVGElement | null) => void; seenElsewhere: number } {
  const { ref } = useDecor(
    (s, el) => {
      const onPath = !!s.focus?.nodes.has(id)
      const dim = s.focus ? !onPath : s.dimmed.has(id)
      const c = s.community?.get(id)
      const color = c === undefined ? '' : `2px solid ${COMMUNITY_COLORS[c]}aa`
      if (el) {
        setStyle(el, 'opacity', dim ? DIM_NODE : '')
        setStyle(el, 'outline', color)
        setClass(el, ON_PATH, onPath)
      }
      return `${dim ? 1 : 0}${onPath ? 1 : 0}${color}`
    },
    (s) => String(s.crossRefs.get(id) ?? 0)
  )
  return { ref, seenElsewhere: useCanvas.getState().crossRefs.get(id) ?? 0 }
}

/**
 * Décor d'un lien : estompé (hors du chemin, ou extrémité estompée par le filtre), libellé
 * masqué, mis en évidence sur le chemin. Re-rendu seulement quand il entre sur le chemin ou en
 * sort (son libellé s'affiche alors). Renvoie les références du groupe SVG et du libellé.
 */
export function useEdgeDecor(
  id: string,
  source: string,
  target: string
): { ref: (el: HTMLElement | SVGElement | null) => void; extraRef: (el: HTMLElement | null) => void; onPath: boolean } {
  const refs = useDecor(
    (s, el, label) => {
      const onPath = !!s.focus?.edges.has(id)
      const dim = s.focus ? !onPath : s.dimmed.has(source) || s.dimmed.has(target)
      if (el) {
        setStyle(el, 'opacity', dim ? DIM_EDGE : '')
        setClass(el, ON_PATH, onPath)
      }
      setStyle(label, 'visibility', dim ? 'hidden' : '')
      return `${dim ? 1 : 0}${onPath ? 1 : 0}`
    },
    (s) => (s.focus?.edges.has(id) ? '1' : '0')
  )
  return { ref: refs.ref, extraRef: refs.extraRef, onPath: !!useCanvas.getState().focus?.edges.has(id) }
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
