// Registre des commandes : une seule liste pour la palette (Ctrl+K), avec le raccourci de
// chaque commande quand elle en a un. Les commandes de l'enquête n'apparaissent que si une
// enquête est ouverte ; une commande non disponible (rien de sélectionné...) est omise.

import type { TFunction } from 'i18next'
import { detectEntity } from '@shared/detect'
import { getEntityType } from '@shared/entityTypes'
import { exportGraph, type ExportFormat } from '../components/export/exporters'
import { useApp, type View } from '../store/app'
import { clearPath, showShortestPath, useAnalysis } from '../store/analysis'
import { useCanvas } from '../store/canvas'
import { useFilters } from '../store/filters'
import { useGraph } from '../store/graph'
import { addEntityAt, enrichNodes } from './actions'
import { api } from './api'
import { errorMessage } from './errors'
import { isFilterActive } from './filters'
import { focusNode, getCanvas } from './focus'
import type { LayoutKind } from './layout'
import { runLayout } from './layoutActions'
import { emitUi, requestSearchFocus } from './uiEvents'
import { fitGraph, visibleCenter } from './viewport'

export type CommandSection = 'actions' | 'views' | 'layout' | 'export' | 'analysis' | 'app'

export interface Command {
  id: string
  title: string
  section: CommandSection
  icon: string
  /** Commande proposée d'après une saisie peu caractéristique (un simple mot). */
  weak?: boolean
  /** Raccourci affiché à côté de la commande. */
  shortcut?: string
  /** Mots supplémentaires pour la recherche. */
  keywords?: string
  run: () => void | Promise<void>
}

/** Vues dans l'ordre de la barre latérale : Ctrl+1 à Ctrl+7. */
export const VIEW_ORDER: View[] = ['graph', 'map', 'timeline', 'modules', 'notes', 'table', 'journal']

export const VIEW_ICONS: Record<View, string> = {
  graph: 'Share2',
  map: 'Map',
  timeline: 'CalendarDays',
  modules: 'Puzzle',
  notes: 'NotebookPen',
  table: 'Sheet',
  journal: 'ScrollText'
}

export function viewShortcut(view: View): string {
  return `Ctrl+${VIEW_ORDER.indexOf(view) + 1}`
}

/** Affiche le canevas (s'il ne l'est pas) puis exécute `fn` une fois monté. */
function onCanvas(fn: () => void): void {
  if (useApp.getState().view === 'graph' && getCanvas()) return fn()
  useApp.getState().setView('graph')
  let tries = 0
  const wait = (): void => {
    if (getCanvas() || tries++ > 40) fn()
    else setTimeout(wait, 25)
  }
  setTimeout(wait, 0)
}

async function doExport(format: ExportFormat | 'archive', t: TFunction): Promise<void> {
  const { toast } = useApp.getState()
  try {
    const inv = useGraph.getState().investigation
    const path = format === 'archive' ? (inv ? await api('investigations:exportArchive', inv.id) : null) : await exportGraph(format)
    if (path) toast('success', t('export.saved', { path }))
  } catch (e) {
    toast('error', errorMessage(e))
  }
}

/** Commandes disponibles dans l'état courant de l'application. */
export function buildCommands(t: TFunction): Command[] {
  const app = useApp.getState()
  const graph = useGraph.getState()
  const open = !!app.currentId && !!graph.investigation
  const out: Command[] = []
  const add = (c: Command): void => void out.push(c)

  if (open) {
    const selected = graph.nodes.filter((n) => n.selected && n.data.node.kind === 'entity').map((n) => n.data.node)
    add({ id: 'add', title: t('palette.cmd.add'), section: 'actions', icon: 'Plus', shortcut: t('palette.doubleClick'), run: () => onCanvas(() => void emitUi('quick-add')) })
    add({ id: 'import', title: t('bottombar.importList'), section: 'actions', icon: 'FileSpreadsheet', run: () => app.setImportOpen(true) })
    if (selected.length)
      add({ id: 'enrich', title: t('enrich.selection', { count: selected.length }), section: 'actions', icon: 'Zap', shortcut: 'Ctrl+E', run: () => enrichNodes(selected) })
    add({ id: 'search', title: t('palette.cmd.search'), section: 'actions', icon: 'Search', shortcut: 'Ctrl+F', run: () => searchInView() })
    add({ id: 'selectAll', title: t('shortcuts.selectAll'), section: 'actions', icon: 'LassoSelect', shortcut: 'Ctrl+A', run: () => graph.select(graph.nodes.map((n) => n.id)) })
    if (graph.canUndo) add({ id: 'undo', title: t('topbar.undo'), section: 'actions', icon: 'Undo2', shortcut: 'Ctrl+Z', run: () => useGraph.getState().undo() })
    if (graph.canRedo) add({ id: 'redo', title: t('topbar.redo'), section: 'actions', icon: 'Redo2', shortcut: 'Ctrl+Y', run: () => useGraph.getState().redo() })
    add({ id: 'report', title: t('topbar.report'), section: 'actions', icon: 'FileText', run: () => app.setReportOpen(true) })

    for (const v of VIEW_ORDER)
      add({ id: `view:${v}`, title: t('palette.cmd.view', { view: t(`rail.${v}`) }), section: 'views', icon: VIEW_ICONS[v], shortcut: viewShortcut(v), run: () => app.setView(v) })

    add({ id: 'fit', title: t('canvas.fitView'), section: 'layout', icon: 'ScanSearch', shortcut: 'F', run: () => onCanvas(() => fitGraph(getCanvas()!)) })
    const layouts: Array<[LayoutKind, string, string]> = [
      ['tree-tb', 'layout.treeTb', 'Network'],
      ['tree-lr', 'layout.treeLr', 'Workflow'],
      ['force', 'layout.force', 'Orbit'],
      ['radial', 'layout.radial', 'Radar'],
      ['circle', 'layout.circle', 'CircleDot'],
      ['grid', 'layout.grid', 'Grid3x3']
    ]
    for (const [kind, key, icon] of layouts)
      add({ id: `layout:${kind}`, title: t('palette.cmd.layout', { name: t(key) }), section: 'layout', icon, run: () => onCanvas(() => void runLayout(kind)) })

    const exports: Array<[ExportFormat | 'archive', string, string]> = [
      ['png', 'export.png', 'Image'],
      ['svg', 'export.svg', 'PenTool'],
      ['html', 'export.html', 'Globe'],
      ['json', 'export.json', 'Braces'],
      ['csv-nodes', 'export.csvNodes', 'Sheet'],
      ['csv-edges', 'export.csvEdges', 'Sheet'],
      ['graphml', 'export.graphml', 'Share2'],
      ['gexf', 'export.gexf', 'Network'],
      ['maltego', 'export.maltego', 'Table'],
      ['archive', 'export.archive', 'Archive']
    ]
    for (const [format, key, icon] of exports)
      add({ id: `export:${format}`, title: t('palette.cmd.export', { name: t(key) }), section: 'export', icon, keywords: format, run: () => doExport(format, t) })

    add({ id: 'filters', title: t('palette.cmd.filters'), section: 'analysis', icon: 'Funnel', run: () => onCanvas(() => app.togglePanel('filtersOpen', true)) })
    if (isFilterActive(useFilters.getState().filter)) add({ id: 'filters:reset', title: t('filters.reset'), section: 'analysis', icon: 'RotateCcw', run: () => useFilters.getState().reset() })
    for (const layer of useFilters.getState().layers)
      add({ id: `layer:${layer.id}`, title: t('palette.cmd.layer', { name: layer.name }), section: 'analysis', icon: 'Layers', run: () => useFilters.getState().applyLayer(layer.id) })
    add({ id: 'analysis', title: t('palette.cmd.analysis'), section: 'analysis', icon: 'ChartNetwork', run: () => onCanvas(() => app.togglePanel('analysisOpen', true)) })
    if (selected.length === 2)
      add({ id: 'path', title: t('analysis.shortestPath'), section: 'analysis', icon: 'Route', run: () => onCanvas(() => void showShortestPath(selected[0].id, selected[1].id)) })
    if (useCanvas.getState().focus) add({ id: 'path:clear', title: t('analysis.clearPath'), section: 'analysis', icon: 'X', shortcut: t('palette.esc'), run: clearPath })
    const colored = useAnalysis.getState().colorByCommunity
    add({
      id: 'communities',
      title: colored ? t('palette.cmd.communitiesOff') : t('analysis.colorByCommunity'),
      section: 'analysis',
      icon: 'Blend',
      run: () => onCanvas(() => useAnalysis.getState().setColorByCommunity(!colored))
    })
    add({ id: 'home', title: t('palette.cmd.home'), section: 'app', icon: 'LayoutGrid', run: () => app.goHome() })
  }

  add({
    id: 'new',
    title: t('home.new'),
    section: 'app',
    icon: 'FolderPlus',
    run: () => {
      if (useApp.getState().currentId) useApp.getState().goHome()
      setTimeout(() => void emitUi('new-investigation'), 30)
    }
  })
  add({ id: 'settings', title: t('rail.settings'), section: 'app', icon: 'Settings', run: () => app.openSettings('general') })
  add({ id: 'keys', title: t('rail.keys'), section: 'app', icon: 'KeyRound', run: () => app.openSettings('keys') })
  const light = app.theme === 'light'
  add({ id: 'theme', title: light ? t('palette.cmd.darkTheme') : t('style.lightTheme'), section: 'app', icon: light ? 'Moon' : 'Sun', run: () => app.updateSettings({ theme: light ? 'dark' : 'light' }) })
  if (open)
    add({
      id: 'minimap',
      title: t('style.minimap'),
      section: 'app',
      icon: 'Map',
      run: () => app.updateSettings({ showMinimap: !(app.settings?.showMinimap !== false) })
    })
  add({ id: 'shortcuts', title: t('shortcuts.title'), section: 'app', icon: 'Keyboard', shortcut: '?', run: () => void emitUi('shortcuts') })
  return out
}

/** Ctrl+F : champ de recherche de la vue affichée ; sinon, recherche du canevas. */
export function searchInView(): void {
  if (requestSearchFocus()) return
  if (useApp.getState().currentId) onCanvas(() => void requestSearchFocus())
}

/**
 * Commande proposée d'après la saisie : une valeur reconnue (email, numéro, domaine...) devient
 * « Ajouter … » au centre de la vue.
 */
export function entityCommand(query: string, t: TFunction, tx: (l: { fr: string; en: string }) => string): Command | null {
  if (!useApp.getState().currentId) return null
  const d = detectEntity(query.trim())
  if (!d) return null
  return {
    id: 'add:detected',
    title: t('palette.addDetected', { value: d.value, type: tx(getEntityType(d.type).label) }),
    section: 'actions',
    icon: 'Plus',
    weak: d.type === 'username' || d.type === 'keyword',
    run: () =>
      onCanvas(async () => {
        const rf = getCanvas()
        const node = await addEntityAt(d.type, rf ? visibleCenter(rf) : { x: 0, y: 0 }, { label: d.value, platform: d.platform ?? null })
        if (node) await focusNode(node.id, { zoom: rf?.getZoom() })
      })
  }
}
