// Disposition automatique du canevas, appelée par la barre du haut et la palette de commandes.

import { create } from 'zustand'
import { useApp } from '../store/app'
import { useGraph } from '../store/graph'
import { currentView, useView } from '../store/view'
import { errorMessage } from './errors'
import { getCanvas } from './focus'
import type { LayoutKind } from './layout'
import { computeLayoutAsync } from './layoutAsync'
import { fitGraph } from './viewport'

/** Disposition en cours de calcul (indicateur de la barre du haut). */
export const useLayoutState = create<{ running: boolean }>(() => ({ running: false }))

/**
 * Dispose ce qui est affiché (nœuds masqués exclus, groupes traités comme un nœud) : la
 * sélection si elle compte plusieurs nœuds, sinon tout le graphe. Calcul dans un Worker.
 */
export async function runLayout(kind: LayoutKind): Promise<void> {
  if (useLayoutState.getState().running) return
  const { nodes, edges, investigation: inv } = useGraph.getState()
  const view = currentView()
  const bundleState = useView.getState().bundles
  const selected = nodes.filter((n) => n.selected)
  const scope = (selected.length > 1 ? selected : nodes).filter((n) => n.data.node.kind === 'entity' && !view.hidden.has(n.id))
  const items = scope.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? 196,
    height: n.measured?.height ?? 40
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  if (selected.length <= 1)
    for (const b of view.bundles) {
      const st = bundleState[b.id]
      const first = byId.get(b.members[0])!.position
      items.push({ id: b.id, x: st?.position?.x ?? first.x, y: st?.position?.y ?? first.y, width: st?.measured?.width ?? 212, height: st?.measured?.height ?? 48 })
    }
  const links = [
    ...edges.filter((e) => !view.hidden.has(e.source) && !view.hidden.has(e.target)).map((e) => ({ source: e.source, target: e.target })),
    ...view.bundles.map((b) => ({ source: b.parentId, target: b.id }))
  ]
  useLayoutState.setState({ running: true })
  let all: Record<string, { x: number; y: number }>
  try {
    all = await computeLayoutAsync(kind, items, links)
  } catch (e) {
    useApp.getState().toast('error', errorMessage(e))
    return
  } finally {
    useLayoutState.setState({ running: false })
  }
  // Le graphe a pu changer pendant le calcul : on ignore une autre enquête et les nœuds supprimés.
  const current = useGraph.getState()
  if (current.investigation?.id !== inv?.id) return
  const present = new Set(current.nodes.map((n) => n.id))
  const pos: Record<string, { x: number; y: number }> = {}
  for (const [id, p] of Object.entries(all)) {
    if (id.startsWith('bundle:')) useView.getState().patchBundle(id, { position: p }, true)
    else if (present.has(id)) pos[id] = p
  }
  void current.setPositions(pos).then(() =>
    setTimeout(() => {
      const rf = getCanvas()
      if (rf) fitGraph(rf, 400)
    }, 50)
  )
}
