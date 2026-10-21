import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type Viewport
} from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { detectEntity } from '@shared/detect'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import type { GraphNode } from '@shared/types'
import { addEntityAt, addFromText, addImageFiles, enrichNode, modulesForNode } from '../../lib/actions'
import { api, openExternal } from '../../lib/api'
import { DRAG_MIME } from '../../lib/catalog'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph, type FlowEdge, type FlowNode } from '../../store/graph'
import { confirmDialog } from '../ui'
import { DrawLayer } from './DrawLayer'
import { MasintEdge } from './edges/MasintEdge'
import { DrawingNode } from './nodes/DrawingNode'
import { EntityNode, OutDegreeContext } from './nodes/EntityNode'
import { ImageNode } from './nodes/ImageNode'
import { MapNode } from './nodes/MapNode'
import { TextNode } from './nodes/TextNode'

const nodeTypes: NodeTypes = { entity: EntityNode, text: TextNode, image: ImageNode, drawing: DrawingNode, map: MapNode }
const edgeTypes: EdgeTypes = { masint: MasintEdge }
const defaultEdgeOptions = { type: 'masint', markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--edge)' } }

type Menu =
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | { kind: 'pane'; x: number; y: number; flow: { x: number; y: number } }
  | null

export function GraphCanvas(): React.JSX.Element {
  const rf = useReactFlow()
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const tool = useGraph((s) => s.tool)
  const onNodesChange = useGraph((s) => s.onNodesChange)
  const onEdgesChange = useGraph((s) => s.onEdgesChange)
  const onConnect = useGraph((s) => s.onConnect)
  const investigation = useGraph((s) => s.investigation)
  const updateInvestigation = useGraph((s) => s.updateInvestigation)
  const settings = useApp((s) => s.settings)
  const [menu, setMenu] = useState<Menu>(null)
  const [quickAdd, setQuickAdd] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)

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
        await addEntityAt(item.type, { x: pos.x - 98, y: pos.y - 19 }, { platform: item.platform ?? null })
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
      const el = wrapper.current?.getBoundingClientRect()
      if (!el) return
      const pos = rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 })
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        void addImageFiles(files, pos)
        return
      }
      const text = e.clipboardData?.getData('text/plain')?.trim()
      if (text) {
        e.preventDefault()
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 50)
        lines.forEach((line, i) => void addFromText(line, { x: pos.x + (i % 4) * 220 - 330, y: pos.y + Math.floor(i / 4) * 70 }))
      }
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
        for (const n of useGraph.getState().selectedNodes()) void enrichNode(n.id)
      } else if (e.key === 'f' && !mod) {
        void rf.fitView({ padding: 0.2, duration: 300 })
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
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onMoveEnd={onMoveEnd}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeContextMenu={(e, node) => {
            e.preventDefault()
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
            const n = node.data.node
            if (n.kind === 'entity' && n.label) void enrichNode(n.id)
          }}
          defaultViewport={investigation?.viewport ?? { x: 0, y: 0, zoom: 1 }}
          fitView={!investigation?.viewport && nodes.length > 0}
          fitViewOptions={{ padding: 0.3, maxZoom: 1.4 }}
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
    await addEntityAt(d.type, { x: at.flow.x - 98, y: at.flow.y - 19 }, { label: d.value, platform: d.platform ?? null })
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
  const rf = useReactFlow()
  const [sub, setSub] = useState(false)
  const allNodes = useGraph((s) => s.nodes)
  const selected = useMemo(() => allNodes.filter((n) => n.selected).map((n) => n.data.node), [allNodes])
  const node: GraphNode | undefined = menu.kind === 'node' ? useGraph.getState().nodes.find((n) => n.id === menu.nodeId)?.data.node : undefined

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
        {item('ScanSearch', t('canvas.fitView'), () => void rf.fitView({ padding: 0.2, duration: 300 }), { hint: 'F' })}
      </div>
    )
  }

  if (!node) return <div />
  const applicable = modulesForNode(node, modules)
  const url = typeof node.data.url === 'string' ? node.data.url : node.type === 'url' || node.type === 'website' ? node.label : undefined
  const many = selected.length > 1

  return (
    <div data-context-menu className="glass absolute z-40 w-64 rounded-xl p-1" style={{ left, top }}>
      {!many && node.kind === 'entity' && (
        <>
          {item('Zap', t('enrich.all'), () => void enrichNode(node.id), { hint: 'Ctrl+E', disabled: !node.label })}
          <button
            onClick={() => setSub(!sub)}
            disabled={!node.label}
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
                  disabled={!m.configured}
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
          for (const n of selected) if (n.kind === 'entity') void enrichNode(n.id)
        })}
      {url && item('ExternalLink', t('canvas.openLink'), () => openExternal(url))}
      {!many &&
        node.platform &&
        getPlatform(node.platform)?.url &&
        typeof node.data.username === 'string' &&
        item('ExternalLink', t('canvas.openProfile'), () => openExternal(getPlatform(node.platform)!.url!.replace('{u}', String(node.data.username))))}
      {!many && item('Copy', t('canvas.copyValue'), () => void navigator.clipboard.writeText(node.label))}
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
