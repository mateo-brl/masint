import { useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { getEntityType } from '@shared/entityTypes'
import { api } from '../../lib/api'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { computeLayout, type LayoutKind } from '../../lib/layout'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { exportGraph, type ExportFormat } from '../export/exporters'
import { Dropdown, Spinner } from '../ui'

/** Barre flottante du haut : disposition, export, rapport, nombre de liens, recherche. */
export function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const rf = useReactFlow()
  const edgesCount = useGraph((s) => s.edges.length)
  const investigation = useGraph((s) => s.investigation)
  const catalogOpen = useApp((s) => s.catalogOpen)
  const toggleCatalog = useApp((s) => s.toggleCatalog)
  const setReportOpen = useApp((s) => s.setReportOpen)
  const toast = useApp((s) => s.toast)
  const [searching, setSearching] = useState(false)

  const layout = (kind: LayoutKind): void => {
    const { nodes, edges, setPositions } = useGraph.getState()
    const selected = nodes.filter((n) => n.selected)
    const scope = (selected.length > 1 ? selected : nodes).filter((n) => n.data.node.kind === 'entity')
    const pos = computeLayout(
      kind,
      scope.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width ?? 196,
        height: n.measured?.height ?? 40
      })),
      edges.map((e) => ({ source: e.source, target: e.target }))
    )
    void setPositions(pos).then(() => setTimeout(() => void rf.fitView({ padding: 0.2, duration: 400 }), 50))
  }

  const doExport = async (format: ExportFormat): Promise<void> => {
    try {
      const path = await exportGraph(format)
      if (path) toast('success', t('export.saved', { path }))
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e))
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
        <div className="mx-1 h-5 w-px bg-line" />
        <div className="max-w-56 truncate px-1.5 text-[12.5px] font-semibold" title={investigation?.name}>
          {investigation?.name}
        </div>
        <div className="mx-1 h-5 w-px bg-line" />
        <Dropdown
          align="center"
          trigger={() => <ToolbarButton icon="LayoutGrid" label={t('topbar.layout')} />}
          items={[
            { label: t('layout.treeTb'), icon: 'Network', onClick: () => layout('tree-tb') },
            { label: t('layout.treeLr'), icon: 'Workflow', onClick: () => layout('tree-lr') },
            { label: t('layout.force'), icon: 'Orbit', onClick: () => layout('force') },
            { label: t('layout.radial'), icon: 'Radar', onClick: () => layout('radial') },
            { label: t('layout.circle'), icon: 'CircleDot', onClick: () => layout('circle') },
            { label: t('layout.grid'), icon: 'Grid3x3', onClick: () => layout('grid') },
            { separator: true, label: '' },
            { label: t('canvas.fitView'), icon: 'ScanSearch', hint: 'F', onClick: () => void rf.fitView({ padding: 0.2, duration: 300 }) }
          ]}
        />
        <Dropdown
          align="center"
          width={240}
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
        <div className="flex items-center gap-1.5 px-2 text-[12.5px] font-semibold text-muted" title={t('topbar.links')}>
          <Icon name="Link" size={14} /> <span className="text-fg">{edgesCount}</span>
        </div>
        <button onClick={() => setSearching(!searching)} className="rounded-lg p-1.5 text-muted hover:bg-panel-3 hover:text-fg" title={t('topbar.search')}>
          <Icon name="Search" size={15} />
        </button>
      </div>
      {searching && <GraphSearch onClose={() => setSearching(false)} />}
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
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return nodes
      .filter((n) => {
        const node = n.data.node
        return node.label.toLowerCase().includes(s) || JSON.stringify(node.data).toLowerCase().includes(s)
      })
      .slice(0, 12)
  }, [q, nodes])
  const focus = (id: string): void => {
    const n = nodes.find((x) => x.id === id)
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
          if (e.key === 'Enter' && matches[0]) focus(matches[0].id)
        }}
        placeholder={t('topbar.searchPlaceholder')}
        className="field"
      />
      {matches.length > 0 && (
        <div className="mt-1 max-h-72 overflow-auto">
          {matches.map((m) => (
            <button key={m.id} onClick={() => focus(m.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel-3">
              <EntityBadge type={m.data.node.type} platform={m.data.node.platform} size={18} />
              <span className="truncate text-[12.5px]">{m.data.node.label || '…'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Pastilles de progression des modules en cours, comme « phone · 56/57 · facebook ». */
function JobPills(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { tx } = useLang()
  const investigation = useGraph((s) => s.investigation)
  const nodes = useGraph((s) => s.nodes)
  const jobsMap = useApp((s) => s.jobs)
  const modules = useApp((s) => s.modules)
  const jobs = Object.values(jobsMap).filter((j) => j.investigationId === investigation?.id && j.total > 0)
  if (!jobs.length) return null
  return (
    <div className="flex flex-col items-center gap-1.5">
      {jobs.map((j) => {
        const node = nodes.find((n) => n.id === j.nodeId)?.data.node
        const type = node ? tx(getEntityType(node.type).label).toLowerCase() : ''
        const current = j.running[0] ? (modules.find((m) => m.id === j.running[0])?.name ?? null) : null
        const pct = Math.round((j.done / j.total) * 100)
        return (
          <div key={j.jobId} className="glass flex items-center gap-2.5 rounded-full py-1 pr-1.5 pl-3 text-[12px]">
            <div className="h-1 w-10 overflow-hidden rounded-full bg-panel-3">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            {j.finished ? <Icon name="CircleCheck" size={13} className="text-success" /> : <Spinner size={12} />}
            <span className="font-semibold">
              {type} · {j.done}/{j.total}
            </span>
            {j.finished ? (
              <span className="text-muted">{t('jobs.finished', { results: j.results, errors: j.errors })}</span>
            ) : (
              current && <span className="max-w-40 truncate text-muted">· {tx(current)}</span>
            )}
            {!j.finished && (
              <button onClick={() => void api('modules:cancel', j.jobId)} className="rounded-full p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('common.cancel')}>
                <Icon name="X" size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
