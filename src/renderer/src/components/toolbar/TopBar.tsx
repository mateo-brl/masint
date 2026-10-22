import { useEffect, useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import type { JobProgress, ModuleRun } from '@shared/types'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import type { LayoutKind } from '../../lib/layout'
import { computeLayoutAsync } from '../../lib/layoutAsync'
import { searchNodes } from '../../lib/search'
import { useApp } from '../../store/app'
import { useGraph, type FlowEdge, type FlowNode } from '../../store/graph'
import { fitGraph } from '../../lib/viewport'
import { currentView, revealNode, useView } from '../../store/view'
import { exportGraph, type ExportFormat } from '../export/exporters'
import { Dialog, Dropdown, Spinner } from '../ui'
import { ReviewAll } from '../panels/ReviewList'

/** Barre flottante du haut : disposition, export, rapport, nombre de liens, recherche. */
export function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const edgesCount = useGraph((s) => s.edges.length)
  const nodesCount = useGraph((s) => {
    // Simple décompte : ce sélecteur tourne à chaque image d'un glisser.
    let count = 0
    for (const n of s.nodes) if (n.data.node.kind === 'entity') count++
    return count
  })
  const investigation = useGraph((s) => s.investigation)
  const catalogOpen = useApp((s) => s.catalogOpen)
  const toggleCatalog = useApp((s) => s.toggleCatalog)
  const setReportOpen = useApp((s) => s.setReportOpen)
  const toast = useApp((s) => s.toast)
  const [searching, setSearching] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const pendingReview = useGraph((s) => s.suggestions.filter((x) => x.status === 'pending').length)
  const canUndo = useGraph((s) => s.canUndo)
  const canRedo = useGraph((s) => s.canRedo)
  const [layingOut, setLayingOut] = useState(false)

  const layout = async (kind: LayoutKind): Promise<void> => {
    if (layingOut) return
    const { nodes, edges, investigation: inv } = useGraph.getState()
    // Disposition de ce qui est affiché : nœuds masqués exclus, groupes traités comme un nœud.
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
    // Calcul dans un Worker : l'interface reste utilisable, un indicateur signale le calcul.
    setLayingOut(true)
    let all: Record<string, { x: number; y: number }>
    try {
      all = await computeLayoutAsync(kind, items, links)
    } catch (e) {
      toast('error', errorMessage(e))
      return
    } finally {
      setLayingOut(false)
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
    void current.setPositions(pos).then(() => setTimeout(() => fitGraph(rf, 400), 50))
  }

  const doExport = async (format: ExportFormat): Promise<void> => {
    try {
      const path = await exportGraph(format)
      if (path) toast('success', t('export.saved', { path }))
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  return (
    <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="glass flex items-center gap-1 rounded-2xl px-2 py-1.5">
        <button
          onClick={() => toggleCatalog()}
          className="rounded-lg p-1.5 text-muted hover:bg-panel-3 hover:text-fg"
          title={catalogOpen ? t('topbar.hideCatalog') : t('topbar.showCatalog')}
        >
          <Icon name={catalogOpen ? 'PanelLeftClose' : 'PanelLeftOpen'} size={15} />
        </button>
        <button
          onClick={() => void useGraph.getState().undo()}
          disabled={!canUndo}
          className="rounded-lg p-1.5 text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-30"
          title={`${t('topbar.undo')} (Ctrl+Z)`}
        >
          <Icon name="Undo2" size={15} />
        </button>
        <button
          onClick={() => void useGraph.getState().redo()}
          disabled={!canRedo}
          className="rounded-lg p-1.5 text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-30"
          title={`${t('topbar.redo')} (Ctrl+Y)`}
        >
          <Icon name="Redo2" size={15} />
        </button>
        <div className="mx-1 h-5 w-px bg-line" />
        <div className="max-w-56 truncate px-1.5 text-[12.5px] font-semibold" title={investigation?.name}>
          {investigation?.name}
        </div>
        <div className="mx-1 h-5 w-px bg-line" />
        <Dropdown
          align="center"
          trigger={() => <ToolbarButton icon="LayoutGrid" label={t('topbar.layout')} />}
          items={[
            { label: t('layout.treeTb'), icon: 'Network', onClick: () => void layout('tree-tb') },
            { label: t('layout.treeLr'), icon: 'Workflow', onClick: () => void layout('tree-lr') },
            { label: t('layout.force'), icon: 'Orbit', onClick: () => void layout('force') },
            { label: t('layout.radial'), icon: 'Radar', onClick: () => void layout('radial') },
            { label: t('layout.circle'), icon: 'CircleDot', onClick: () => void layout('circle') },
            { label: t('layout.grid'), icon: 'Grid3x3', onClick: () => void layout('grid') },
            { separator: true, label: '' },
            { label: t('canvas.fitView'), icon: 'ScanSearch', hint: 'F', onClick: () => fitGraph(rf) }
          ]}
        />
        <Dropdown
          align="center"
          width={280}
          trigger={() => <ToolbarButton icon="Download" label={t('topbar.export')} />}
          items={[
            { label: t('export.png'), icon: 'Image', onClick: () => void doExport('png') },
            { label: t('export.svg'), icon: 'PenTool', onClick: () => void doExport('svg') },
            { label: t('export.html'), icon: 'Globe', onClick: () => void doExport('html') },
            { separator: true, label: '' },
            { label: t('export.json'), icon: 'Braces', onClick: () => void doExport('json') },
            { label: t('export.csvNodes'), icon: 'Sheet', onClick: () => void doExport('csv-nodes') },
            { label: t('export.csvEdges'), icon: 'Sheet', onClick: () => void doExport('csv-edges') },
            { separator: true, label: '' },
            { label: t('export.graphml'), icon: 'Share2', onClick: () => void doExport('graphml') },
            { label: t('export.gexf'), icon: 'Network', onClick: () => void doExport('gexf') },
            { label: t('export.maltego'), icon: 'Table', onClick: () => void doExport('maltego') },
            { separator: true, label: '' },
            {
              label: t('export.archive'),
              icon: 'Archive',
              onClick: () =>
                investigation &&
                void api('investigations:exportArchive', investigation.id).then((p) => p && toast('success', t('export.saved', { path: p })))
            }
          ]}
        />
        <ToolbarButton icon="FileText" label={t('topbar.report')} onClick={() => setReportOpen(true)} />
        <div className="mx-1 h-5 w-px bg-line" />
        <div className="flex items-center gap-1.5 pl-2 text-[12.5px] font-semibold text-muted" title={t('topbar.nodes')}>
          <Icon name="Waypoints" size={14} /> <span className="text-fg">{nodesCount}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 text-[12.5px] font-semibold text-muted" title={t('topbar.links')}>
          <Icon name="Link" size={14} /> <span className="text-fg">{edgesCount}</span>
        </div>
        {pendingReview > 0 && (
          <button
            onClick={() => setReviewOpen(true)}
            className="ml-1 flex items-center gap-1.5 rounded-lg bg-warning/15 px-2 py-1 text-[12px] font-semibold text-warning hover:bg-warning/25"
            title={t('review.title')}
          >
            <Icon name="ListTodo" size={14} /> {pendingReview}
          </button>
        )}
        <button onClick={() => setSearching(!searching)} className="rounded-lg p-1.5 text-muted hover:bg-panel-3 hover:text-fg" title={t('topbar.search')}>
          <Icon name="Search" size={15} />
        </button>
      </div>
      {layingOut && (
        <div className="glass flex items-center gap-2 rounded-2xl px-3 py-1.5 text-[12px] text-muted">
          <Spinner size={13} />
          {t('layout.running')}
        </div>
      )}
      {searching && <GraphSearch onClose={() => setSearching(false)} />}
      <Dialog open={reviewOpen} onClose={() => setReviewOpen(false)} title={t('review.title')} width={620}>
        <ReviewAll
          onPick={async (id) => {
            setReviewOpen(false)
            await revealNode(id)
            const n = useGraph.getState().nodes.find((x) => x.id === id)
            if (!n) return
            useGraph.getState().select([id])
            void rf.setCenter(n.position.x + 98, n.position.y + 26, { zoom: 1.2, duration: 400 })
          }}
        />
      </Dialog>
      <JobPills />
    </div>
  )
}

function ToolbarButton({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }): React.JSX.Element {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-panel-3">
      <Icon name={icon} size={14} className="text-muted" />
      {label}
    </button>
  )
}

/** Recherche d'un nœud dans le graphe : centre la vue dessus et le sélectionne. */
function GraphSearch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const rf = useReactFlow()
  const nodes = useGraph((s) => s.nodes)
  const [q, setQ] = useState('')
  // Léger différé : la recherche ne tourne pas à chaque frappe d'une saisie rapide.
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q), q.trim() ? 120 : 0)
    return () => clearTimeout(timer)
  }, [q])
  const matches = useMemo(() => searchNodes(nodes, query), [query, nodes])
  const focus = async (id: string): Promise<void> => {
    onClose()
    // Un nœud replié ou regroupé est d'abord rendu visible.
    await revealNode(id)
    const n = useGraph.getState().nodes.find((x) => x.id === id)
    if (!n) return
    useGraph.getState().select([id])
    void rf.setCenter(n.position.x + 98, n.position.y + 20, { zoom: 1.3, duration: 400 })
  }
  return (
    <div className="glass w-96 rounded-xl p-1.5">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter') {
            // Saisie pas encore prise en compte (différé) : recherche immédiate.
            const first = q === query ? matches[0] : searchNodes(nodes, q, 1)[0]
            if (first) void focus(first.id)
          }
        }}
        placeholder={t('topbar.searchPlaceholder')}
        className="field"
      />
      {matches.length > 0 && (
        <div className="mt-1 max-h-72 overflow-auto">
          {matches.map((m) => (
            <button key={m.id} onClick={() => void focus(m.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel-3">
              <EntityBadge type={m.data.node.type} platform={m.data.node.platform} size={18} />
              <span className="truncate text-[12.5px]">{m.data.node.label || '…'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Pastilles de progression : une par enrichissement en cours ou tout juste terminé. */
function JobPills(): React.JSX.Element | null {
  const investigation = useGraph((s) => s.investigation)
  const jobsMap = useApp((s) => s.jobs)
  const jobs = Object.values(jobsMap).filter((j) => j.investigationId === investigation?.id && j.total > 0)
  if (!jobs.length) return null
  return (
    <div className="flex flex-col items-center gap-1.5">
      {jobs.map((j) => (
        <JobPill key={j.jobId} job={j} />
      ))}
    </div>
  )
}

/**
 * Une tâche d'enrichissement : nœud concerné, modules terminés, résultats, éléments à vérifier,
 * modules en cours avec leur avancement interne (« 23/57 · WhatsApp »). Un clic déplie la liste
 * des modules et leur état.
 */
function JobPill({ job: j }: { job: JobProgress }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  // Seulement le nœud de la tâche : même objet tant qu'il ne change pas (pas à chaque glisser).
  const node = useGraph((s) => s.nodes.find((n) => n.id === j.nodeId)?.data.node)
  const modules = useApp((s) => s.modules)
  const [open, setOpen] = useState(false)
  const label = node?.label || j.nodeLabel
  const name = (id: string): string => {
    const m = modules.find((x) => x.id === id)
    return m ? tx(m.name) : id
  }
  const pct = Math.round((j.done / j.total) * 100)
  const step = (id: string): string => {
    const s = j.steps?.[id]
    if (!s) return name(id)
    return `${name(id)} · ${s.done}/${s.total}${s.detail ? ` · ${s.detail}` : ''}`
  }
  return (
    <div className="glass w-[min(560px,calc(100vw-120px))] rounded-2xl px-3 py-2 text-[12px]">
      <div className="flex items-center gap-2.5">
        {j.finished ? <Icon name="CircleCheck" size={14} className="shrink-0 text-success" /> : <Spinner size={13} />}
        {node && <EntityBadge type={node.type} platform={node.platform} size={18} />}
        <span className="min-w-0 truncate font-semibold" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-muted">{t('jobs.modules', { done: j.done, total: j.total })}</span>
        <div className="flex-1" />
        <span className="shrink-0 text-muted">
          {t('runs.nResults', { count: j.results })}
          {(j.review ?? 0) > 0 && <span className="text-warning"> · {t('review.count', { count: j.review })}</span>}
          {j.errors > 0 && <span className="text-accent"> · {t('runs.nErrors', { count: j.errors })}</span>}
        </span>
        <button onClick={() => setOpen(!open)} className="rounded-full p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('jobs.details')}>
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
        {!j.finished &&
          (j.chain ? (
            <button
              onClick={() => void api('modules:cancel', j.jobId)}
              className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-accent"
              title={t('jobs.stopTitle')}
            >
              {t('jobs.stop')}
            </button>
          ) : (
            <button onClick={() => void api('modules:cancel', j.jobId)} className="rounded-full p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('common.cancel')}>
              <Icon name="X" size={12} />
            </button>
          ))}
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-panel-3">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      {j.chain && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
          <Icon name="Waypoints" size={12} className="shrink-0 text-faint" />
          <span>{t('jobs.chain', { depth: j.chain.depth, max: j.chain.maxDepth })}</span>
          <span>· {t('jobs.chainNodes', { count: j.chain.created })}</span>
          <span>· {t('jobs.chainEnriched', { count: j.chain.enriched })}</span>
          {j.chain.budget && <span className="text-warning">· {t('jobs.chainBudget')}</span>}
        </div>
      )}
      {!j.finished && j.running.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5 text-[11.5px] text-muted">
          {j.running.slice(0, 3).map((id) => (
            <div key={id} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning" />
              <span className="min-w-0 truncate">{step(id)}</span>
            </div>
          ))}
          {j.running.length > 3 && <div className="pl-3 text-faint">{t('jobs.moreRunning', { count: j.running.length - 3 })}</div>}
        </div>
      )}
      {open && <JobDetails job={j} name={name} step={step} />}
    </div>
  )
}

/** État de chaque module de la tâche, relu à chaque avancée. */
function JobDetails({ job: j, name, step }: { job: JobProgress; name: (id: string) => string; step: (id: string) => string }): React.JSX.Element {
  const { t } = useTranslation()
  const [runs, setRuns] = useState<ModuleRun[]>([])
  const chained = !!j.chain
  useEffect(() => {
    // Tâche en chaîne : ses exécutions portent sur plusieurs nœuds.
    void api('modules:runs', j.investigationId, chained ? undefined : j.nodeId).then((r) => setRuns(r.filter((x) => x.jobId === j.jobId)))
  }, [j.investigationId, j.nodeId, j.jobId, j.done, j.finished, chained])
  const nodes = useGraph((s) => s.nodes)
  const labelOf = (id: string): string => nodes.find((n) => n.id === id)?.data.node.label ?? ''
  const order = { running: 0, queued: 1, error: 2, done: 3, cancelled: 4 } as Record<string, number>
  const sorted = [...runs].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || (b.resultCount || 0) - (a.resultCount || 0))
  return (
    <div className="mt-2 flex max-h-64 flex-col gap-0.5 overflow-auto border-t border-line pt-2 text-[11.5px]">
      {sorted.map((r) => (
        <div key={r.id} className="flex items-start gap-2">
          <Icon
            name={r.status === 'running' ? 'LoaderCircle' : r.status === 'error' ? 'CircleX' : r.found || r.resultCount > 0 ? 'CircleCheck' : 'CircleMinus'}
            size={12}
            className={`mt-px shrink-0 ${r.status === 'running' ? 'spin text-warning' : r.status === 'error' ? 'text-accent' : r.found || r.resultCount > 0 ? 'text-success' : 'text-faint'}`}
          />
          <span className="min-w-0 flex-1 truncate">
            {r.status === 'running' ? step(r.moduleId) : name(r.moduleId)}
            {r.nodeId !== j.nodeId && <span className="text-faint"> · {labelOf(r.nodeId)}</span>}
          </span>
          <span className="max-w-[45%] shrink-0 truncate text-right text-faint" title={r.error ?? undefined}>
            {r.status === 'error'
              ? r.error
              : r.status === 'running'
                ? t('jobs.running')
                : r.found === false
                  ? t('runs.notFound')
                  : r.found
                    ? t('runs.found')
                    : r.resultCount > 0
                      ? t('runs.results', { count: r.resultCount })
                      : r.status === 'done'
                        ? t('runs.empty')
                        : ''}
          </span>
        </div>
      ))}
    </div>
  )
}
