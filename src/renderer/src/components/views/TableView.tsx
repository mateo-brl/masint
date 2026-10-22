import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import type { GraphNode } from '@shared/types'
import { canEnrich, enrichNodes } from '../../lib/actions'
import { errorMessage } from '../../lib/errors'
import { focusNode, showOnCanvas } from '../../lib/focus'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { searchText } from '../../lib/search'
import { exportNodesCsv, groupOnCanvas } from '../../lib/tableActions'
import { useSearchFocus } from '../../lib/uiEvents'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { useGraphView } from '../../store/view'
import { FilterPanel } from '../panels/FilterPanel'
import { Button, confirmDialog } from '../ui'

const ROW_H = 34
/** Lignes rendues au-delà de la zone visible, de part et d'autre. */
const OVERSCAN = 8
const COLUMNS = '36px 170px minmax(220px, 1fr) 140px 170px 150px 70px 92px'

type SortKey = 'type' | 'label' | 'platform' | 'source' | 'createdAt' | 'links' | 'review'

interface Row {
  id: string
  node: GraphNode
  type: string
  platform: string
  source: string
  links: number
  review: number
  /** Texte de recherche en minuscules. */
  text: string
}

/**
 * Vue « Tableau » : les entités de l'enquête en liste (virtualisée : seules les lignes visibles
 * sont rendues), avec tri, filtre texte, sélection multiple (celle du canevas) et actions en lot.
 * Le filtre du canevas en mode « masquer » s'applique aussi ici.
 */
export function TableView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { tx } = useLang()
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const suggestions = useGraph((s) => s.suggestions)
  const modules = useApp((s) => s.modules)
  const filtersOpen = useApp((s) => s.filtersOpen)
  const togglePanel = useApp((s) => s.togglePanel)
  const toast = useApp((s) => s.toast)
  const filtered = useGraphView().filtered
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'createdAt', dir: -1 })
  const anchor = useRef<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useSearchFocus(() => input.current?.focus())

  const all = useMemo<Row[]>(() => {
    const degree = new Map<string, number>()
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const review = new Map<string, number>()
    for (const s of suggestions) if (s.status === 'pending') review.set(s.nodeId, (review.get(s.nodeId) ?? 0) + 1)
    const moduleName = (id: string): string => (id === 'manual' ? t('props.manual') : tx(modules.find((m) => m.id === id)?.name) || id)
    const out: Row[] = []
    for (const f of nodes) {
      const n = f.data.node
      if (n.kind !== 'entity' || filtered.has(n.id)) continue
      const type = tx(getEntityType(n.type).label)
      const platform = n.platform ? (getPlatform(n.platform)?.name ?? n.platform) : ''
      const source = moduleName(n.source)
      out.push({
        id: n.id,
        node: n,
        type,
        platform,
        source,
        links: degree.get(n.id) ?? 0,
        review: review.get(n.id) ?? 0,
        text: `${searchText(n)}\u0000${type}\u0000${platform}\u0000${source}`.toLowerCase()
      })
    }
    return out
  }, [nodes, edges, suggestions, modules, filtered, t, tx])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? all.filter((r) => r.text.includes(q)) : [...all]
    const cmp = (a: Row, b: Row): number => {
      switch (sort.key) {
        case 'createdAt':
          return a.node.createdAt - b.node.createdAt
        case 'links':
          return a.links - b.links
        case 'review':
          return a.review - b.review
        case 'label':
          return a.node.label.localeCompare(b.node.label, i18n.language, { numeric: true, sensitivity: 'base' })
        default:
          return a[sort.key].localeCompare(b[sort.key], i18n.language, { sensitivity: 'base' })
      }
    }
    return list.sort((a, b) => cmp(a, b) * sort.dir || a.node.createdAt - b.node.createdAt)
  }, [all, query, sort, i18n.language])

  const selected = useMemo(() => new Set(nodes.filter((n) => n.selected).map((n) => n.id)), [nodes])
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected])
  const allChecked = rows.length > 0 && selectedRows.length === rows.length

  // Virtualisation : zone visible suivie au défilement et au redimensionnement.
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN)
  const visible = rows.slice(first, last)

  const select = (ids: string[]): void => useGraph.getState().select(ids)
  const onRowClick = (e: React.MouseEvent, id: string): void => {
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((r) => r.id === anchor.current)
      const b = rows.findIndex((r) => r.id === id)
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a]
        const range = rows.slice(from, to + 1).map((r) => r.id)
        select(e.ctrlKey || e.metaKey ? Array.from(new Set([...selected, ...range])) : range)
        return
      }
    }
    anchor.current = id
    if (e.ctrlKey || e.metaKey) toggle(id)
    else select([id])
  }
  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    anchor.current = id
    select(Array.from(next))
  }

  const ids = selectedRows.map((r) => r.id)
  const bulkDelete = async (): Promise<void> => {
    if (await confirmDialog(t('canvas.deleteMany', { count: ids.length }))) await useGraph.getState().deleteNodes(ids)
  }
  const bulkGroup = async (): Promise<void> => {
    await groupOnCanvas(ids)
    toast('success', t('table.grouped', { count: ids.length }), [{ label: t('table.showOnCanvas'), onClick: () => showOnCanvas(ids) }])
  }
  const bulkExport = async (): Promise<void> => {
    try {
      const path = await exportNodesCsv(ids)
      if (path) toast('success', t('export.saved', { path }))
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'left'): React.JSX.Element => {
    const active = sort.key === key
    return (
      <div role="columnheader" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={align === 'right' ? 'text-right' : ''}>
        <button
          onClick={() => setSort(active ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'createdAt' || key === 'links' || key === 'review' ? -1 : 1 })}
          className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-fg ${active ? 'text-fg' : ''}`}
        >
          {label}
          {active && <Icon name={sort.dir === 1 ? 'ArrowUp' : 'ArrowDown'} size={11} />}
        </button>
      </div>
    )
  }

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }), [i18n.language])

  return (
    <div className="absolute inset-0 flex flex-col transition-[padding]" style={{ paddingRight: selected.size ? 350 : 0 }}>
      <div className="flex flex-wrap items-center gap-3 px-6 pt-6 pb-3">
        <div className="min-w-0">
          <div className="label-xs">{t('table.kicker')}</div>
          <h1 className="mt-1 text-[20px] font-semibold">{t('table.count', { count: all.length })}</h1>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Icon name="Search" size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder={t('table.filterPlaceholder')}
            aria-label={t('table.filterPlaceholder')}
            className="field !w-72 !pl-8"
          />
        </div>
        <Button icon="Funnel" variant={filtersOpen ? 'primary' : 'secondary'} aria-pressed={filtersOpen} onClick={() => togglePanel('filtersOpen')}>
          {t('filters.title')}
        </Button>
      </div>
      {filtersOpen && (
        <div className="flex justify-center px-6 pb-3">
          <FilterPanel onClose={() => togglePanel('filtersOpen', false)} />
        </div>
      )}

      <div className="flex min-h-9 items-center gap-2 px-6 pb-2 text-[12px]" aria-live="polite">
        {selectedRows.length > 0 ? (
          <>
            <span className="font-semibold">{t('table.selected', { count: selectedRows.length })}</span>
            <Button size="sm" icon="Zap" onClick={() => void enrichNodes(selectedRows.map((r) => r.node).filter(canEnrich))}>
              {t('table.enrich')}
            </Button>
            <Button size="sm" icon="Group" disabled={selectedRows.length < 2} onClick={() => void bulkGroup()}>
              {t('table.group')}
            </Button>
            <Button size="sm" icon="Sheet" onClick={() => void bulkExport()}>
              {t('table.exportCsv')}
            </Button>
            <Button size="sm" variant="danger" icon="Trash" onClick={() => void bulkDelete()}>
              {t('common.delete')}
            </Button>
            <Button size="sm" variant="ghost" icon="X" onClick={() => select([])}>
              {t('table.clearSelection')}
            </Button>
          </>
        ) : (
          <span className="text-muted">{t('table.hint')}</span>
        )}
        <div className="flex-1" />
        {query && <span className="text-muted">{t('table.shown', { count: rows.length })}</span>}
      </div>

      <div role="table" aria-label={t('table.kicker')} aria-rowcount={rows.length + 1} className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel">
        <div role="row" aria-rowindex={1} className="grid shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-[11.5px] font-medium text-muted" style={{ gridTemplateColumns: COLUMNS }}>
          <div role="columnheader">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = selectedRows.length > 0 && !allChecked
              }}
              onChange={() => select(allChecked ? [] : rows.map((r) => r.id))}
              aria-label={t('table.selectAll')}
              className="accent-[var(--accent)]"
            />
          </div>
          {header('type', t('table.type'))}
          {header('label', t('table.label'))}
          {header('platform', t('table.platform'))}
          {header('source', t('table.source'))}
          {header('createdAt', t('table.created'))}
          {header('links', t('table.links'), 'right')}
          {header('review', t('table.review'), 'right')}
        </div>
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          {rows.length === 0 ? (
            <div className="p-8 text-center text-muted">{t(all.length ? 'table.noMatch' : 'table.empty')}</div>
          ) : (
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {visible.map((r, i) => {
                const index = first + i
                const on = selected.has(r.id)
                return (
                  <div
                    key={r.id}
                    role="row"
                    aria-rowindex={index + 2}
                    aria-selected={on}
                    tabIndex={0}
                    onClick={(e) => onRowClick(e, r.id)}
                    onDoubleClick={() => void focusNode(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void focusNode(r.id)
                      if (e.key === ' ') {
                        e.preventDefault()
                        toggle(r.id)
                      }
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        const sibling = (e.currentTarget as HTMLElement)[e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling'] as HTMLElement | null
                        sibling?.focus()
                      }
                    }}
                    title={t('table.rowHint')}
                    className={`absolute inset-x-0 grid cursor-default items-center gap-2 border-b border-line/60 px-3 text-[12.5px] outline-none focus-visible:bg-panel-3 ${
                      on ? 'bg-accent-soft' : 'hover:bg-panel-2'
                    }`}
                    style={{ top: index * ROW_H, height: ROW_H, gridTemplateColumns: COLUMNS }}
                  >
                    <div role="cell" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={on} onChange={() => toggle(r.id)} aria-label={t('table.selectRow', { label: r.node.label })} className="accent-[var(--accent)]" />
                    </div>
                    <div role="cell" className="flex min-w-0 items-center gap-2">
                      <EntityBadge type={r.node.type} platform={r.node.platform} size={18} />
                      <span className="truncate text-muted">{r.type}</span>
                    </div>
                    <div role="cell" className={`truncate font-medium ${r.node.label ? '' : 'italic text-faint'}`} title={r.node.label}>
                      {r.node.label || t('node.untitled')}
                    </div>
                    <div role="cell" className="truncate text-muted">
                      {r.platform}
                    </div>
                    <div role="cell" className="truncate text-muted" title={r.source}>
                      {r.source}
                    </div>
                    <div role="cell" className="truncate text-muted">
                      {dateFmt.format(r.node.createdAt)}
                    </div>
                    <div role="cell" className="text-right font-mono text-[11.5px]">
                      {r.links}
                    </div>
                    <div role="cell" className="text-right">
                      {r.review > 0 && <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning">{r.review}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
