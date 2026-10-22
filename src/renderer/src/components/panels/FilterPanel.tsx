import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import { isFilterActive, toggleIn, type NodeFilter } from '../../lib/filters'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useFilters } from '../../store/filters'
import { useGraph } from '../../store/graph'
import { useGraphView } from '../../store/view'
import { Button, Switch, Tabs } from '../ui'

const DAY = 86_400_000

/** Valeur d'un champ date (AAAA-MM-JJ, heure locale). */
function dayValue(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Début (ou fin) du jour d'un champ date, en heure locale. */
function parseDay(value: string, end: boolean): number | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  const start = new Date(y, m - 1, d).getTime()
  return Number.isFinite(start) ? (end ? start + DAY - 1 : start) : null
}

interface Counts {
  types: Array<[string, number]>
  platforms: Array<[string, number]>
  sources: Array<[string, number]>
  review: number
  minAt: number
  maxAt: number
}

/**
 * Filtres et calques du canevas : type d'entité, plateforme, module source, date de création
 * (avec un curseur temporel), statut « À vérifier » ; mode masquer ou estomper.
 */
export function FilterPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { tx } = useLang()
  const filter = useFilters((s) => s.filter)
  const mode = useFilters((s) => s.mode)
  const layers = useFilters((s) => s.layers)
  const activeLayer = useFilters((s) => s.activeLayer)
  const { setFilter, setMode, reset, saveLayer, applyLayer, deleteLayer } = useFilters.getState()
  const modules = useApp((s) => s.modules)
  const suggestions = useGraph((s) => s.suggestions)
  // La vue mémorisée ne change pas pendant un glisser : les décomptes non plus.
  const view = useGraphView()
  const [layerName, setLayerName] = useState('')

  const counts = useMemo<Counts>(() => {
    const pending = new Set(suggestions.filter((s) => s.status === 'pending').map((s) => s.nodeId))
    const types = new Map<string, number>()
    const platforms = new Map<string, number>()
    const sources = new Map<string, number>()
    let review = 0
    let minAt = Infinity
    let maxAt = -Infinity
    for (const f of useGraph.getState().nodes) {
      const n = f.data.node
      if (n.kind !== 'entity') continue
      types.set(n.type, (types.get(n.type) ?? 0) + 1)
      platforms.set(n.platform ?? '', (platforms.get(n.platform ?? '') ?? 0) + 1)
      sources.set(n.source, (sources.get(n.source) ?? 0) + 1)
      if (pending.has(n.id)) review++
      minAt = Math.min(minAt, n.createdAt)
      maxAt = Math.max(maxAt, n.createdAt)
    }
    const sorted = (m: Map<string, number>): Array<[string, number]> => Array.from(m).sort((a, b) => b[1] - a[1])
    return { types: sorted(types), platforms: sorted(platforms), sources: sorted(sources), review, minAt, maxAt }
    // `view` : la structure du graphe ; les nœuds sont relus dans le store.
  }, [view, suggestions])

  const moduleName = (id: string): string => {
    if (id === 'manual') return t('props.manual')
    const m = modules.find((x) => x.id === id)
    return m ? tx(m.name) : id
  }
  const platformName = (id: string): string => (id ? (getPlatform(id)?.name ?? id) : t('filters.noPlatform'))
  const active = isFilterActive(filter)
  const affected = mode === 'hide' ? view.filtered.size : view.dimmed.size
  const hasTime = Number.isFinite(counts.minAt) && counts.maxAt > counts.minAt
  const sliderValue = filter.to === null ? counts.maxAt : Math.min(Math.max(filter.to, counts.minAt), counts.maxAt)
  const dateTime = (ms: number): string => new Date(ms).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  const chip = (key: string, label: React.ReactNode, count: number, on: boolean, toggle: () => void, icon?: React.ReactNode): React.JSX.Element => (
    <button
      key={key}
      onClick={toggle}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] transition ${
        on ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {icon}
      <span className="max-w-40 truncate">{label}</span>
      <span className="text-faint">{count}</span>
    </button>
  )

  const section = (title: string, children: React.ReactNode): React.JSX.Element => (
    <div className="flex flex-col gap-1.5">
      <div className="label-xs">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )

  const patch = (p: Partial<NodeFilter>): void => setFilter(p)

  return (
    <section
      aria-label={t('filters.title')}
      data-panel="filters"
      className="glass flex max-h-[min(560px,calc(100vh-200px))] w-[min(600px,calc(100vw-140px))] flex-col gap-3 overflow-y-auto rounded-2xl p-4"
    >
      <div className="flex items-center gap-3">
        <Icon name="Funnel" size={15} className="text-muted" />
        <span className="font-semibold">{t('filters.title')}</span>
        <div className="w-40 shrink-0">
          <Tabs
            value={mode}
            onChange={setMode}
            items={[
              { id: 'hide', label: t('filters.hide') },
              { id: 'dim', label: t('filters.dim') }
            ]}
          />
        </div>
        <span className="whitespace-nowrap text-[11.5px] text-muted" aria-live="polite">
          {active ? t(mode === 'hide' ? 'filters.hidden' : 'filters.dimmed', { count: affected }) : t('filters.none')}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon="RotateCcw" disabled={!active} onClick={reset} className="whitespace-nowrap">
          {t('filters.reset')}
        </Button>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-fg" title={t('common.close')} aria-label={t('common.close')}>
          <Icon name="X" size={15} />
        </button>
      </div>

      {section(
        t('filters.types'),
        counts.types.map(([type, count]) =>
          chip(type, tx(getEntityType(type).label), count, filter.types.includes(type), () => patch({ types: toggleIn(filter.types, type) }), <EntityBadge type={type} size={14} />)
        )
      )}
      {counts.platforms.some(([p]) => p) &&
        section(
          t('filters.platforms'),
          counts.platforms.map(([p, count]) => chip(p || 'none', platformName(p), count, filter.platforms.includes(p), () => patch({ platforms: toggleIn(filter.platforms, p) })))
        )}
      {section(
        t('filters.sources'),
        counts.sources.map(([src, count]) => chip(src, moduleName(src), count, filter.sources.includes(src), () => patch({ sources: toggleIn(filter.sources, src) })))
      )}

      <div className="flex flex-col gap-1.5">
        <div className="label-xs">{t('filters.created')}</div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <label className="flex items-center gap-1.5">
            {t('filters.from')}
            <input type="date" value={dayValue(filter.from)} onChange={(e) => patch({ from: parseDay(e.target.value, false) })} className="field !w-36 !py-1" />
          </label>
          <label className="flex items-center gap-1.5">
            {t('filters.to')}
            <input type="date" value={dayValue(filter.to)} onChange={(e) => patch({ to: parseDay(e.target.value, true) })} className="field !w-36 !py-1" />
          </label>
        </div>
        {hasTime && (
          <label className="mt-1 flex items-center gap-3 text-[12px]">
            <Icon name="Clock" size={14} className="shrink-0 text-muted" />
            <input
              type="range"
              min={counts.minAt}
              max={counts.maxAt}
              // Pas assez fin pour atteindre chaque extrémité, même sur un intervalle très court.
              step={Math.max(1, Math.round((counts.maxAt - counts.minAt) / 500))}
              value={sliderValue}
              aria-label={t('filters.timeline')}
              aria-valuetext={dateTime(sliderValue)}
              onChange={(e) => {
                const v = Number(e.target.value)
                patch({ to: v >= counts.maxAt ? null : v })
              }}
              className="min-w-0 flex-1 accent-[var(--accent)]"
            />
            <span className="w-40 shrink-0 text-right text-muted">{filter.to === null ? t('filters.now') : dateTime(sliderValue)}</span>
          </label>
        )}
      </div>

      <label className="flex items-center justify-between gap-3 text-[12.5px]">
        <span>
          {t('filters.reviewOnly')} <span className="text-faint">({counts.review})</span>
        </span>
        <Switch checked={filter.review} onChange={(v) => patch({ review: v })} />
      </label>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <div className="label-xs">{t('filters.layers')}</div>
        {layers.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {layers.map((l) => (
              <span
                key={l.id}
                className={`flex items-center rounded-full border text-[11.5px] ${activeLayer === l.id ? 'border-accent bg-accent-soft' : 'border-line'}`}
              >
                <button onClick={() => applyLayer(l.id)} className="flex items-center gap-1 py-0.5 pr-1 pl-2.5" aria-pressed={activeLayer === l.id} title={t('filters.applyLayer')}>
                  <Icon name="Layers" size={12} className="text-muted" />
                  {l.name}
                </button>
                <button
                  onClick={() => deleteLayer(l.id)}
                  className="rounded-full p-1 text-faint hover:text-accent"
                  title={t('filters.deleteLayer', { name: l.name })}
                  aria-label={t('filters.deleteLayer', { name: l.name })}
                >
                  <Icon name="X" size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[11.5px] text-muted">{t('filters.noLayer')}</div>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            saveLayer(layerName)
            setLayerName('')
          }}
        >
          <input
            value={layerName}
            onChange={(e) => setLayerName(e.target.value)}
            placeholder={t('filters.layerName')}
            aria-label={t('filters.layerName')}
            className="field !py-1"
          />
          <Button size="sm" type="submit" icon="BookmarkPlus" disabled={!active || !layerName.trim()}>
            {t('filters.saveLayer')}
          </Button>
        </form>
      </div>
    </section>
  )
}
