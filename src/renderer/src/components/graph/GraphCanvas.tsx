import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useNodesInitialized,
  useReactFlow,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type Viewport
} from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { detectEntity } from '@shared/detect'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import type { GraphNode } from '@shared/types'
import { addEntityAt, addFromLines, addFromText, addImageFiles, canEnrich, enrichNode, enrichNodes, modulesForNode, pasteImages, useApplicable } from '../../lib/actions'
import { api, openLink } from '../../lib/api'
import { DRAG_MIME } from '../../lib/catalog'
import { fitGraph, visibleCenter } from '../../lib/viewport'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph, type FlowEdge, type FlowNode } from '../../store/graph'
import { currentView, useView } from '../../store/view'
import { bundleId, computeView } from '../../lib/collapse'
import { confirmDialog } from '../ui'
import { DrawLayer } from './DrawLayer'
import { MasintEdge } from './edges/MasintEdge'
import { DrawingNode } from './nodes/DrawingNode'
import { CollapsedCountContext, EntityNode, OutDegreeContext, ReviewCountContext, SelectedNodesContext } from './nodes/EntityNode'
import { ImageNode } from './nodes/ImageNode'
import { MapNode } from './nodes/MapNode'
import { TextNode } from './nodes/TextNode'
import { BundleNode } from './nodes/BundleNode'

const nodeTypes: NodeTypes = { entity: EntityNode, text: TextNode, image: ImageNode, drawing: DrawingNode, map: MapNode, bundle: BundleNode }
const edgeTypes: EdgeTypes = { masint: MasintEdge }
const defaultEdgeOptions = { type: 'masint', markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--edge)' } }

/** Dernière enquête recadrée : on recadre à l'ouverture, pas à chaque retour sur la vue Graphe. */
let fittedInvestigation: string | null = null

type Menu =
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'bundle'; x: number; y: number; bundleId: string }
  | { kind: 'pane'; x: number; y: number; flow: { x: number; y: number } }
  | null

export function GraphCanvas(): React.JSX.Element {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const tool = useGraph((s) => s.tool)
  const onNodesChange = useGraph((s) => s.onNodesChange)
  const onEdgesChange = useGraph((s) => s.onEdgesChange)
  const onConnect = useGraph((s) => s.onConnect)
  const investigation = useGraph((s) => s.investigation)
  const updateInvestigation = useGraph((s) => s.updateInvestigation)
  const settings = useApp((s) => s.settings)
  const expanded = useView((s) => s.expanded)
  const bundleState = useView((s) => s.bundles)
  const [menu, setMenu] = useState<Menu>(null)
  const [quickAdd, setQuickAdd] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)

  // Recadrage à l'ouverture d'une enquête, une fois les nœuds mesurés.
  const initialized = useNodesInitialized()
  useEffect(() => {
    // Enquête vide : on attend son premier nœud pour le centrer.
    if (!investigation || !nodes.length || !initialized || fittedInvestigation === investigation.id) return
    fittedInvestigation = investigation.id
    fitGraph(rf, 0, 1)
  }, [investigation, initialized, nodes.length, rf])

  // Premier enrichissement d'une enquête presque vide : on recadre quand il se termine.
  const jobs = useApp((s) => s.jobs)
  const fitAfter = useRef(new Set<string>())
  useEffect(() => {
    for (const j of Object.values(jobs)) {
      if (j.investigationId !== investigation?.id) continue
      if (!j.finished && j.done === 0 && useGraph.getState().nodes.length <= 1) fitAfter.current.add(j.jobId)
      if (j.finished && fitAfter.current.delete(j.jobId)) setTimeout(() => fitGraph(rf, 400), 150)
    }
  }, [jobs, investigation?.id, rf])

  // Ensemble stable tant que la sélection ne change pas (pas à chaque déplacement).
  const selectedKey = nodes
    .filter((n) => n.selected)
    .map((n) => n.id)
    .join('|')
  const selectedNodes = useMemo(() => new Set(selectedKey ? selectedKey.split('|') : []), [selectedKey])

  useEffect(() => {
    if (investigation) useView.getState().load(investigation.id)
  }, [investigation])

  // Affichage : descendance des nœuds repliés masquée, feuilles semblables regroupées.
  const view = useMemo(
    () =>
      computeView(
        nodes.map((n) => n.data.node),
        edges.map((e) => e.data!.edge),
        expanded
      ),
    [nodes, edges, expanded]
  )
  const displayNodes = useMemo(() => {
    const out: FlowNode[] = nodes.map((n) => (view.hidden.has(n.id) ? { ...n, hidden: true } : n))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const b of view.bundles) {
      const first = byId.get(b.members[0])!
      const st = bundleState[b.id]
      const start = b.members.reduce(
        (p, id) => {
          const m = byId.get(id)!.position
          return { x: Math.min(p.x, m.x), y: Math.min(p.y, m.y) }
        },
        { ...first.position }
      )
      out.push({
        id: b.id,
        type: 'bundle',
        position: st?.position ?? start,
        data: { node: first.data.node, bundle: b },
        selected: !!st?.selected,
        deletable: false,
        zIndex: 2,
        ...(st?.measured ? { measured: st.measured } : {})
      })
    }
    return out
  }, [nodes, view, bundleState])
  const displayEdges = useMemo(() => {
    const out: FlowEdge[] = edges.filter((e) => !view.hidden.has(e.source) && !view.hidden.has(e.target))
    for (const b of view.bundles) {
      const model = edges.find((e) => e.source === b.parentId && e.target === b.members[0])
      if (!model) continue
      out.push({ ...model, id: `${b.id}:edge`, target: b.id, selected: false, selectable: false, deletable: false })
    }
    return out
  }, [edges, view])

  // Les changements des nœuds de regroupement restent dans l'état d'affichage.
  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const real: NodeChange<FlowNode>[] = []
      const v = useView.getState()
      for (const c of changes) {
        const id = 'id' in c ? c.id : ''
        if (!id.startsWith('bundle:')) {
          real.push(c)
          if (c.type === 'select' && c.selected) v.selectBundle(null)
          continue
        }
        if (c.type === 'dimensions' && c.dimensions) v.patchBundle(id, { measured: c.dimensions })
        else if (c.type === 'position' && c.position) v.patchBundle(id, { position: c.position }, c.dragging === false)
        else if (c.type === 'select') {
          if (c.selected) v.selectBundle(id)
          else if (v.bundles[id]?.selected) v.patchBundle(id, { selected: false })
        }
      }
      if (real.length) onNodesChange(real)
    },
    [onNodesChange]
  )

  const suggestions = useGraph((s) => s.suggestions)
  const reviewCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of suggestions) if (s.status === 'pending') m.set(s.nodeId, (m.get(s.nodeId) ?? 0) + 1)
    return m
  }, [suggestions])

  const outDegree = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of edges) m.set(e.source, (m.get(e.source) ?? 0) + 1)
    return m
  }, [edges])

  // Sauvegarde du point de vue (déplacement, zoom) avec un léger différé.
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMoveEnd = useCallback(
    (_: unknown, vp: Viewport) => {
      if (viewportTimer.current) clearTimeout(viewportTimer.current)
      viewportTimer.current = setTimeout(() => void updateInvestigation({ viewport: vp }), 600)
    },
    [updateInvestigation]
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const raw = e.dataTransfer.getData(DRAG_MIME)
      if (raw) {
        const item = JSON.parse(raw) as { type: string; platform?: string }
        await addEntityAt(item.type, pos, { platform: item.platform ?? null })
        return
      }
      const files = Array.from(e.dataTransfer.files)
      if (files.length) {
        await addImageFiles(files, pos)
        return
      }
      const text = e.dataTransfer.getData('text/plain')
      if (text) await addFromText(text, pos)
    },
    [rf]
  )

  // Coller : texte → entité détectée, image → entité Photo.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]')) return
      if (!wrapper.current) return
      e.preventDefault()
      const pos = visibleCenter(rf)
      // Lu tout de suite : le contenu de l'événement n'est plus accessible après coup.
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      const text = e.clipboardData?.getData('text/plain')?.trim() ?? ''
      void (async () => {
        // Images d'abord, y compris les fichiers copiés dans l'explorateur, invisibles pour la page.
        if (await pasteImages(pos).catch(() => false)) return
        if (files.length) return void addImageFiles(files, pos)
        if (text) {
          // Limite du nombre de lignes et message de troncature : voir addFromLines.
          const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
          void addFromLines(lines, pos)
        }
      })()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [rf])

  // Raccourcis clavier du canevas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        useGraph.getState().select(useGraph.getState().nodes.map((n) => n.id))
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        void useGraph.getState().undo()
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        void useGraph.getState().redo()
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void enrichNodes(useGraph.getState().selectedNodes())
      } else if (e.key === 'f' && !mod) {
        fitGraph(rf)
      } else if (e.key === 'Escape') {
        useGraph.getState().setTool('select')
        setMenu(null)
        setQuickAdd(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rf])

  const onPaneDoubleClick = (e: React.MouseEvent): void => {
    if (tool !== 'select') return
    const target = e.target as HTMLElement
    if (!target.classList.contains('react-flow__pane')) return
    const box = wrapper.current!.getBoundingClientRect()
    setQuickAdd({ x: e.clientX - box.left, y: e.clientY - box.top, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
  }

  return (
    <div ref={wrapper} className="absolute inset-0" onDoubleClick={onPaneDoubleClick}>
      <OutDegreeContext.Provider value={outDegree}>
        <SelectedNodesContext.Provider value={selectedNodes}>
          <ReviewCountContext.Provider value={reviewCount}>
            <CollapsedCountContext.Provider value={view.collapsedCount}>
              <ReactFlow<FlowNode, FlowEdge>
                // `isolate` : les calques Leaflet des blocs Carte (z-index 400 à 1000) restent sous les barres et menus.
                className="isolate"
                nodes={displayNodes}
                edges={displayEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={defaultEdgeOptions}
                onNodesChange={handleNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onMoveEnd={onMoveEnd}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onNodeContextMenu={(e, node) => {
                  e.preventDefault()
                  if (node.data.bundle) {
                    setMenu({ kind: 'bundle', x: e.clientX, y: e.clientY, bundleId: node.id })
                    return
                  }
                  if (!node.selected) useGraph.getState().select([node.id])
                  setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id })
                }}
                onPaneContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ kind: 'pane', x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) })
                }}
                onPaneClick={() => {
                  setMenu(null)
                  setQuickAdd(null)
                }}
                onNodeDoubleClick={(_, node) => {
                  if (node.data.bundle) return void useView.getState().expandBundle(node.id)
                  const n = node.data.node
                  if (canEnrich(n)) void enrichNode(n.id)
                }}
                defaultViewport={investigation?.viewport ?? { x: 0, y: 0, zoom: 1 }}
                minZoom={0.05}
                maxZoom={3}
                connectionMode={ConnectionMode.Loose}
                selectionMode={SelectionMode.Partial}
                panOnDrag={tool === 'select'}
                panOnScroll={false}
                zoomOnDoubleClick={false}
                deleteKeyCode={['Delete', 'Backspace']}
                multiSelectionKeyCode={['Meta', 'Control']}
                elementsSelectable={tool === 'select'}
                nodesDraggable={tool === 'select'}
                proOptions={{ hideAttribution: true }}
                colorMode={settings?.theme === 'light' ? 'light' : 'dark'}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--canvas-dot)" />
                {settings?.showMinimap !== false && (
                  <MiniMap
                    position="bottom-left"
                    pannable
                    zoomable
                    nodeColor={(n) => ((n as FlowNode).data.node.kind === 'entity' ? 'var(--accent)' : 'var(--faint)')}
                    nodeStrokeWidth={0}
                    nodeBorderRadius={2}
                    style={{ width: 190, height: 130, marginLeft: 16, marginBottom: 16 }}
                  />
                )}
                {tool === 'draw' && <DrawLayer />}
              </ReactFlow>
            </CollapsedCountContext.Provider>
          </ReviewCountContext.Provider>
        </SelectedNodesContext.Provider>
      </OutDegreeContext.Provider>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} onQuickAdd={(p) => setQuickAdd(p)} wrapper={wrapper} />}
      {quickAdd && <QuickAdd at={quickAdd} onClose={() => setQuickAdd(null)} />}
      {nodes.length === 0 && <EmptyHint />}
    </div>
  )
}

function EmptyHint(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="max-w-sm text-center text-muted">
        <Icon name="MousePointerClick" size={26} className="mx-auto mb-3 text-faint" />
        <div className="font-medium text-fg">{t('canvas.emptyTitle')}</div>
        <div className="mt-1 text-[12.5px]">{t('canvas.emptyBody')}</div>
      </div>
    </div>
  )
}

/** Saisie rapide au double-clic sur le fond : le type est détecté automatiquement. */
function QuickAdd({ at, onClose }: { at: { x: number; y: number; flow: { x: number; y: number } }; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const [value, setValue] = useState('')
  const d = detectEntity(value)
  const submit = async (): Promise<void> => {
    if (!d) return
    onClose()
    await addEntityAt(d.type, at.flow, { label: d.value, platform: d.platform ?? null })
  }
  return (
    <div className="glass absolute z-30 w-80 rounded-xl p-1.5" style={{ left: at.x - 10, top: at.y - 10 }}>
      <div className="flex items-center gap-2 px-1">
        {d ? <EntityBadge type={d.type} platform={d.platform} size={20} /> : <Icon name="Plus" size={16} className="text-muted" />}
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') onClose()
          }}
          onBlur={() => !value && onClose()}
          placeholder={t('canvas.quickAdd')}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
      </div>
      {d && <div className="px-2 pt-1 pb-0.5 text-[11px] text-muted">{tx(getEntityType(d.type).label)}</div>}
    </div>
  )
}

function ContextMenu({
  menu,
  onClose,
  onQuickAdd,
  wrapper
}: {
  menu: NonNullable<Menu>
  onClose: () => void
  onQuickAdd: (p: { x: number; y: number; flow: { x: number; y: number } }) => void
  wrapper: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const modules = useApp((s) => s.modules)
  const toast = useApp((s) => s.toast)
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const [sub, setSub] = useState(false)
  const allNodes = useGraph((s) => s.nodes)
  const selected = useMemo(() => allNodes.filter((n) => n.selected).map((n) => n.data.node), [allNodes])
  const node: GraphNode | undefined = menu.kind === 'node' ? useGraph.getState().nodes.find((n) => n.id === menu.nodeId)?.data.node : undefined
  const server = useApplicable(node)

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-context-menu]')) onClose()
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])

  const box = wrapper.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1000, height: 800 }
  const left = Math.min(menu.x - box.left, box.width - 250)
  const top = Math.min(menu.y - box.top, box.height - 320)

  const item = (icon: string, label: string, onClick: () => void, opts: { danger?: boolean; hint?: string; disabled?: boolean } = {}): React.JSX.Element => (
    <button
      disabled={opts.disabled}
      onClick={() => {
        onClose()
        onClick()
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] disabled:opacity-40 ${
        opts.danger ? 'text-accent hover:bg-accent-soft' : 'hover:bg-panel-3'
      }`}
    >
      <Icon name={icon} size={14} className="text-muted" />
      <span className="flex-1">{label}</span>
      {opts.hint && <span className="text-[11px] text-faint">{opts.hint}</span>}
    </button>
  )

  if (menu.kind === 'pane') {
    return (
      <div data-context-menu className="glass absolute z-40 w-56 rounded-xl p-1" style={{ left, top }}>
        {item('Plus', t('canvas.addHere'), () => onQuickAdd({ x: menu.x - box.left, y: menu.y - box.top, flow: menu.flow }))}
        {item('ClipboardPaste', t('canvas.pasteHere'), async () => {
          const text = await navigator.clipboard.readText().catch(() => '')
          if (text) await addFromText(text.trim(), menu.flow)
        })}
        <div className="my-1 border-t border-line" />
        {item('ScanSearch', t('canvas.fitView'), () => fitGraph(rf), { hint: 'F' })}
        {item('ChevronsUpDown', t('collapse.expandAll'), () => void expandAll())}
        {item('Group', t('collapse.regroupAll'), () => useView.getState().regroupAll())}
      </div>
    )
  }

  if (menu.kind === 'bundle') {
    return (
      <div data-context-menu className="glass absolute z-40 w-56 rounded-xl p-1" style={{ left, top }}>
        {item('UnfoldVertical', t('bundle.expand'), () => void useView.getState().expandBundle(menu.bundleId))}
      </div>
    )
  }

  if (!node) return <div />
  // Réduire : les nœuds sélectionnés qui ont des enfants ; Déplier : ceux qui sont repliés.
  const allEdges = useGraph.getState().edges
  const withChildren = selected.filter((s) => allEdges.some((e) => e.source === s.id))
  const collapsible = withChildren.filter((s) => !s.style.collapsed)
  const folded = selected.filter((s) => s.style.collapsed)
  const memberOf = (id: string): string | undefined => {
    const e = allEdges.find((x) => x.target === id)
    if (!e) return undefined
    const parent = useGraph.getState().nodes.find((n) => n.id === e.source)?.data.node
    const n = useGraph.getState().nodes.find((x) => x.id === id)?.data.node
    const bid = parent && n ? bundleId(parent.id, n.type, e.data!.edge.label) : undefined
    return bid && useView.getState().expanded.has(bid) ? bid : undefined
  }
  const regroupable = selected.length <= 1 ? memberOf(node.id) : undefined
  const applicable = modulesForNode(node, modules)
  const url = typeof node.data.url === 'string' ? node.data.url : node.type === 'url' || node.type === 'website' ? node.label : undefined
  const many = selected.length > 1

  return (
    <div data-context-menu className="glass absolute z-40 w-64 rounded-xl p-1" style={{ left, top }}>
      {!many && node.kind === 'entity' && (
        <>
          {item('Zap', t('enrich.all'), () => void enrichNode(node.id), { hint: 'Ctrl+E', disabled: !canEnrich(node) || server?.auto.size === 0 })}
          <button
            onClick={() => setSub(!sub)}
            disabled={!canEnrich(node)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-panel-3 disabled:opacity-40"
          >
            <Icon name="ListChecks" size={14} className="text-muted" />
            <span className="flex-1">{t('enrich.choose')}</span>
            <Icon name={sub ? 'ChevronUp' : 'ChevronDown'} size={13} className="text-faint" />
          </button>
          {sub && (
            <div className="mx-1 mb-1 max-h-64 overflow-auto rounded-lg border border-line bg-panel-2 p-1">
              {applicable.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted">{t('enrich.noneForType')}</div>}
              {applicable.map((m) => (
                <button
                  key={m.id}
                  disabled={!m.configured || (server ? !server.accepted.has(m.id) : false)}
                  onClick={() => {
                    onClose()
                    void enrichNode(node.id, [m.id])
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-panel-3 disabled:opacity-40"
                  title={tx(m.description)}
                >
                  <span className="min-w-0 flex-1 truncate">{tx(m.name)}</span>
                  {m.ondemand && <span className="rounded bg-accent-soft px-1 text-[9.5px] text-accent">{t('modules.ondemand')}</span>}
                  {!m.configured && <Icon name="KeyRound" size={11} className="text-faint" />}
                </button>
              ))}
            </div>
          )}
          <div className="my-1 border-t border-line" />
        </>
      )}
      {many &&
        item('Zap', t('enrich.selection', { count: selected.length }), () => {
          void enrichNodes(selected)
        })}
      {url && item('ExternalLink', t('canvas.openLink'), () => openLink(url))}
      {!many &&
        node.platform &&
        getPlatform(node.platform)?.url &&
        typeof node.data.username === 'string' &&
        item('ExternalLink', t('canvas.openProfile'), () => openLink(getPlatform(node.platform)!.url!.replace('{u}', String(node.data.username))))}
      {!many && item('Copy', t('canvas.copyValue'), () => void navigator.clipboard.writeText(node.label))}
      {collapsible.length > 0 &&
        item('FoldVertical', t('collapse.collapse'), () => void setCollapsed(collapsible, true), {
          hint: t('collapse.hidden', { count: countDescendants(collapsible.map((s) => s.id)) })
        })}
      {folded.length > 0 && item('UnfoldVertical', t('collapse.expand'), () => void setCollapsed(folded, false))}
      {regroupable && item('Group', t('collapse.regroup'), () => useView.getState().regroup(regroupable))}
      {item('GitFork', t('canvas.selectChildren'), () => {
        const { edges, select } = useGraph.getState()
        const ids = new Set(selected.map((s) => s.id))
        for (const e of edges) if (ids.has(e.source)) ids.add(e.target)
        select(Array.from(ids))
      })}
      {many &&
        item('Merge', t('canvas.merge'), async () => {
          const inv = useGraph.getState().investigation
          if (!inv) return
          if (!(await confirmDialog(t('canvas.mergeTitle'), t('canvas.mergeBody', { label: node.label }), false))) return
          const change = await api('graph:mergeNodes', inv.id, node.id, selected.map((s) => s.id))
          useGraph.getState().applyChange(change)
          toast('success', t('canvas.merged'))
        })}
      <div className="my-1 border-t border-line" />
      {item('Trash', many ? t('canvas.deleteMany', { count: selected.length }) : t('common.delete'), () => {
        void useGraph.getState().deleteNodes(many ? selected.map((s) => s.id) : [node.id])
      }, { danger: true, hint: 'Suppr' })}
    </div>
  )
}

/** Replie ou déplie des nœuds (style `collapsed`, enregistré et annulable). */
async function setCollapsed(nodes: GraphNode[], collapsed: boolean): Promise<void> {
  await useGraph.getState().updateNodes(nodes.map((n) => ({ id: n.id, style: { ...n.style, collapsed } })))
}

/** Déplie tout : nœuds repliés et groupes automatiques. */
async function expandAll(): Promise<void> {
  const folded = useGraph
    .getState()
    .nodes.map((n) => n.data.node)
    .filter((n) => n.style.collapsed)
  if (folded.length) await setCollapsed(folded, false)
  for (const b of currentView().bundles) await useView.getState().expandBundle(b.id)
}

/** Nombre de descendants distincts des nœuds donnés. */
function countDescendants(ids: string[]): number {
  const edges = useGraph.getState().edges
  const seen = new Set(ids)
  const queue = [...ids]
  let count = 0
  while (queue.length) {
    const id = queue.shift()!
    for (const e of edges)
      if (e.source === id && !seen.has(e.target)) {
        seen.add(e.target)
        count++
        queue.push(e.target)
      }
  }
  return count
}
