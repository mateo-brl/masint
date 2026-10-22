// Actions en lot de la vue « Tableau » : regrouper sur le canevas, exporter en CSV.

import { freeSpot, type Point } from '@shared/placement'
import { buildNodesCsv } from '../components/export/csv'
import { exportFileName, exportStrings } from '../components/export/format'
import { useGraph } from '../store/graph'
import { currentView } from '../store/view'
import { api } from './api'
import { currentLang } from './i18n'

const CELL_W = 216
const CELL_H = 64

/**
 * Rassemble des nœuds sur le canevas : grille compacte (environ 1,6 fois plus large que haute)
 * posée sur une place libre près de leur centre actuel. Étape annulable (Ctrl+Z).
 */
export async function groupOnCanvas(ids: string[]): Promise<void> {
  const { nodes, setPositions } = useGraph.getState()
  const members = new Set(ids)
  const chosen = nodes.filter((n) => members.has(n.id))
  if (chosen.length < 2) return
  const view = currentView()
  const cx = chosen.reduce((s, n) => s + n.position.x, 0) / chosen.length
  const cy = chosen.reduce((s, n) => s + n.position.y, 0) / chosen.length
  const cols = Math.max(2, Math.ceil(Math.sqrt(chosen.length * 1.6)))
  const rows = Math.ceil(chosen.length / cols)
  const occupied = nodes
    .filter((n) => !members.has(n.id) && !view.hidden.has(n.id) && n.data.node.kind !== 'drawing')
    .map((n) => ({ x: n.position.x, y: n.position.y, width: n.measured?.width ?? 196, height: n.measured?.height ?? 52 }))
  const at = freeSpot(occupied, { x: cx - (cols * CELL_W) / 2, y: cy - (rows * CELL_H) / 2 }, { width: cols * CELL_W, height: rows * CELL_H })
  // Ordre de lecture conservé : de haut en bas, puis de gauche à droite.
  const ordered = [...chosen].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const pos: Record<string, Point> = {}
  ordered.forEach((n, i) => (pos[n.id] = { x: at.x + (i % cols) * CELL_W, y: at.y + Math.floor(i / cols) * CELL_H }))
  await setPositions(pos)
}

/** Exporte des nœuds en CSV (mêmes colonnes que l'export des nœuds). Renvoie le chemin ou `null`. */
export async function exportNodesCsv(ids: string[]): Promise<string | null> {
  const { nodes, investigation } = useGraph.getState()
  if (!investigation) return null
  const set = new Set(ids)
  const list = nodes.filter((n) => set.has(n.id)).map((n) => ({ ...n.data.node, x: n.position.x, y: n.position.y }))
  const lang = currentLang()
  const s = exportStrings(lang).exportx
  const name = exportFileName(investigation.name, new Date(), s.files.nodes, 'csv')
  return api('export:save', name, [{ name: s.filters.csv, extensions: ['csv'] }], buildNodesCsv(list, lang), 'utf8')
}
