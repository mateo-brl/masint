import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import { ENTITY_TYPES, getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import type { Lang } from '@shared/types'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import {
  chooseUnit,
  collectEvents,
  fitDomain,
  formatEventDate,
  formatRangeDate,
  humanizeKey,
  MAX_SPAN,
  MIN_SPAN,
  tickLabel,
  ticks,
  type TimelineEvent
} from '../../lib/timeline'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Button, IconButton, Switch } from '../ui'

const GUTTER = 184
const LANE_H = 48
const AXIS_H = 34
/** Écart minimal (px) entre deux marqueurs d'une piste avant regroupement. */
const MIN_GAP = 30
const TYPE_ORDER = new Map(ENTITY_TYPES.map((t, i) => [t.id, i]))

type Domain = [number, number]

interface Group {
  key: string
  x: number
  events: TimelineEvent[]
  /** Place libre à droite pour un libellé. */
  room: number
}

interface Hover {
  rect: DOMRect
  events: TimelineEvent[]
}

/** Vue « Frise » : événements datés des fiches, pistes par type, liste chronologique. */
export function TimelineView(): React.JSX.Element {
  const { t } = useTranslation()
  const { lang, tx } = useLang()
  const nodes = useGraph((s) => s.nodes)
  const investigation = useGraph((s) => s.investigation)
  const graphNodes = useMemo(() => nodes.map((n) => n.data.node), [nodes])
  const selected = useMemo(() => new Set(nodes.filter((n) => n.selected).map((n) => n.id)), [nodes])
  const all = useMemo(() => collectEvents(graphNodes), [graphNodes])
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const events = useMemo(() => all.filter((e) => !hidden.has(e.node.type)), [all, hidden])

  const types = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of all) counts.set(e.node.type, (counts.get(e.node.type) ?? 0) + 1)
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => (TYPE_ORDER.get(a.id) ?? 999) - (TYPE_ORDER.get(b.id) ?? 999))
  }, [all])
  const lanes = useMemo(() => types.filter((ty) => !hidden.has(ty.id)), [types, hidden])
  const entityCount = useMemo(() => new Set(all.map((e) => e.nodeId)).size, [all])

  const [domain, setDomain] = useState<Domain | null>(null)
  const hiddenKey = Array.from(hidden).sort().join(',')
  const hasEvents = events.length > 0
  // Recadrage à l'ouverture, quand les filtres changent ou quand les premiers événements arrivent.
  useEffect(() => {
    setDomain(hasEvents ? fitDomain(events.map((e) => e.t)) : null)
  }, [hiddenKey, hasEvents])

  const [onlyVisible, setOnlyVisible] = useState(false)
  const listed = useMemo(
    () => (onlyVisible && domain ? events.filter((e) => e.t >= domain[0] && e.t <= domain[1]) : events),
    [events, onlyVisible, domain]
  )

  const toggleType = (id: string): void => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHidden(next)
  }

  const centerOn = (time: number): void => {
    setDomain((d) => {
      if (!d) return d
      const half = (d[1] - d[0]) / 2
      return [time - half, time + half]
    })
  }

  if (all.length === 0) return <EmptyState />

  return (
    <div className="absolute inset-0 flex flex-col transition-[padding]" style={{ paddingRight: selected.size ? 350 : 0 }}>
      <div className="flex flex-wrap items-end justify-between gap-4 px-8 pt-7 pb-4">
        <div className="min-w-0">
          <div className="label-xs">{t('timeline.kicker')}</div>
          <h1 className="mt-1 truncate text-[22px] font-semibold">{investigation?.name}</h1>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {t('timeline.events', { count: all.length })} · {t('timeline.entities', { count: entityCount })} ·{' '}
            {t('timeline.range', {
              from: formatEventDate(all[0].t, all[0].precision, lang),
              to: formatEventDate(all[all.length - 1].t, all[all.length - 1].precision, lang)
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-8 pb-3">
        <Chip active={hidden.size === 0} onClick={() => setHidden(new Set())}>
          <Icon name="ListFilter" size={13} className="text-muted" />
          {t('timeline.all')}
        </Chip>
        {types.map((ty) => (
          <Chip key={ty.id} active={!hidden.has(ty.id)} onClick={() => toggleType(ty.id)}>
            <EntityBadge type={ty.id} size={16} />
            {tx(getEntityType(ty.id).label)}
            <span className="text-faint">{ty.count}</span>
          </Chip>
        ))}
      </div>

      <div className="px-8">
        {domain && lanes.length > 0 ? (
          <Frise events={events} lanes={lanes.map((l) => l.id)} domain={domain} setDomain={setDomain} selected={selected} lang={lang} />
        ) : (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-line bg-panel text-[12.5px] text-muted">
            {t('timeline.noneInView')}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-8 pt-4 pb-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <Icon name="CalendarDays" size={15} className="text-muted" />
              {t('timeline.list')}
              <span className="text-[11.5px] font-normal text-faint">{listed.length}</span>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
              {t('timeline.onlyVisible')}
              <Switch checked={onlyVisible} onChange={setOnlyVisible} />
            </label>
          </div>
          <EventList
            events={listed}
            selected={selected}
            lang={lang}
            onPick={(e) => {
              useGraph.getState().select([e.nodeId])
              centerOn(e.t)
            }}
          />
        </div>
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition ${
        active ? 'border-line-strong bg-panel-2 text-fg' : 'border-dashed border-line text-faint opacity-70 hover:opacity-100'
      }`}
    >
      {children}
    </button>
  )
}

/** Libellé du champ d'un événement : catalogue du type, clé courante traduite, sinon clé lisible. */
function useFieldLabel(): (e: TimelineEvent) => string {
  const { t, i18n } = useTranslation()
  const { tx } = useLang()
  return (e) => (e.field ? tx(e.field) : i18n.exists(`timeline.keys.${e.key}`) ? t(`timeline.keys.${e.key}`) : humanizeKey(e.key))
}

// ---------------------------------------------------------------------------
// Frise

function Frise({
  events,
  lanes,
  domain,
  setDomain,
  selected,
  lang
}: {
  events: TimelineEvent[]
  lanes: string[]
  domain: Domain
  setDomain: React.Dispatch<React.SetStateAction<Domain | null>>
  selected: Set<string>
  lang: Lang
}): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hover, setHover] = useState<Hover | null>(null)
  const drag = useRef<{ pointerId: number; x: number; moved: boolean } | null>(null)
  const plotW = Math.max(100, width - GUTTER)
  const span = domain[1] - domain[0]
  const xOf = (time: number): number => ((time - domain[0]) / span) * plotW

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const zoomAt = (ratio: number, factor: number): void => {
    setDomain((d) => {
      if (!d) return d
      const s = d[1] - d[0]
      const next = Math.min(MAX_SPAN, Math.max(MIN_SPAN, s * factor))
      const anchor = d[0] + ratio * s
      return [anchor - ratio * next, anchor + (1 - ratio) * next]
    })
  }

  // Molette : zoom centré sur le curseur ; défilement horizontal ou Maj : déplacement.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left - GUTTER
      if (px < 0) return
      e.preventDefault()
      setHover(null)
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      if (horizontal || e.shiftKey) {
        const delta = horizontal ? e.deltaX : e.deltaY
        setDomain((d) => {
          if (!d) return d
          const dt = (delta / plotW) * (d[1] - d[0])
          return [d[0] + dt, d[1] + dt]
        })
        return
      }
      const unit = e.deltaMode === 1 ? 0.05 : 0.0015
      zoomAt(px / plotW, Math.exp(e.deltaY * unit))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [plotW])

  const unit = chooseUnit(span, plotW)
  const tickList = useMemo(() => ticks(domain[0], domain[1], unit), [domain, unit])

  const byLane = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>()
    for (const e of events) {
      const list = m.get(e.node.type)
      if (list) list.push(e)
      else m.set(e.node.type, [e])
    }
    return m
  }, [events])

  const groups = useMemo(() => {
    const out = new Map<string, Group[]>()
    for (const lane of lanes) {
      const list = byLane.get(lane) ?? []
      const res: Group[] = []
      let cur: { x0: number; events: TimelineEvent[]; sum: number } | null = null
      const flush = (): void => {
        if (!cur) return
        const x = cur.sum / cur.events.length
        res.push({ key: cur.events[0].id, x, events: cur.events, room: 0 })
      }
      for (const e of list) {
        const x = ((e.t - domain[0]) / span) * plotW
        if (x < -MIN_GAP || x > plotW + MIN_GAP) continue
        if (cur && x - cur.x0 < MIN_GAP) {
          cur.events.push(e)
          cur.sum += x
        } else {
          flush()
          cur = { x0: x, events: [e], sum: x }
        }
      }
      flush()
      for (let i = 0; i < res.length; i++) res[i].room = (i + 1 < res.length ? res[i + 1].x : plotW + 200) - res[i].x
      out.set(lane, res)
    }
    return out
  }, [lanes, byLane, domain, span, plotW])

  // Durée couverte par chaque nœud sélectionné dans sa piste.
  const spans = useMemo(() => {
    const out: Array<{ lane: number; x0: number; x1: number; key: string }> = []
    if (!selected.size) return out
    lanes.forEach((lane, i) => {
      const per = new Map<string, number[]>()
      for (const e of byLane.get(lane) ?? []) if (selected.has(e.nodeId)) per.set(e.nodeId, [...(per.get(e.nodeId) ?? []), e.t])
      for (const [id, list] of per) {
        if (list.length < 2) continue
        out.push({ lane: i, x0: ((Math.min(...list) - domain[0]) / span) * plotW, x1: ((Math.max(...list) - domain[0]) / span) * plotW, key: `${lane}:${id}` })
      }
    })
    return out
  }, [selected, lanes, byLane, domain, span, plotW])

  const now = Date.now()
  const nowX = xOf(now)
  const showNow = nowX >= 0 && nowX <= plotW
  // Libellé « Aujourd'hui » à gauche ou à droite du trait, masqué s'il chevauche une graduation.
  const nowSide = useMemo(() => {
    if (!showNow) return null
    const w = t('timeline.today').length * 6.3 + 6
    const spans = tickList.map((tk) => {
      const x = ((tk - domain[0]) / span) * plotW + 6
      return [x, x + tickLabel(tk, unit, lang).text.length * 7]
    })
    const free = (a: number, b: number): boolean => a >= 0 && b <= plotW && spans.every(([x0, x1]) => x1 < a || x0 > b)
    if (free(nowX - 6 - w, nowX - 6)) return 'left'
    if (free(nowX + 6, nowX + 6 + w)) return 'right'
    return null
  }, [showNow, tickList, domain, span, plotW, unit, lang, nowX, t])

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const r = box.current!.getBoundingClientRect()
    if (e.clientX - r.left < GUTTER) return
    drag.current = { pointerId: e.pointerId, x: e.clientX, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 3) return
    d.moved = true
    d.x = e.clientX
    setHover(null)
    setDomain((cur) => {
      if (!cur) return cur
      const dt = (dx / plotW) * (cur[1] - cur[0])
      return [cur[0] - dt, cur[1] - dt]
    })
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  const pickGroup = (g: Group): void => {
    if (drag.current?.moved) return
    const first = g.events[0].t
    const last = g.events[g.events.length - 1].t
    if (g.events.length === 1 || last - first < MIN_SPAN) {
      useGraph.getState().select(Array.from(new Set(g.events.map((e) => e.nodeId))))
      return
    }
    const pad = Math.max((last - first) * 0.25, MIN_SPAN)
    setHover(null)
    setDomain([first - pad, last + pad])
  }

  const lanesH = lanes.length * LANE_H
  const maxH = Math.max(LANE_H * 3, Math.min(lanesH, 6 * LANE_H))

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 pr-2 pl-4">
        <div className="truncate text-[12px] text-muted">
          {formatRangeDate(domain[0], unit, lang)} <span className="text-faint">→</span> {formatRangeDate(domain[1], unit, lang)}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-2 hidden text-[11px] text-faint lg:inline">{t('timeline.hint')}</span>
          <IconButton icon="Minus" title={t('timeline.zoomOut')} onClick={() => zoomAt(0.5, 1 / 0.6)} />
          <IconButton icon="Plus" title={t('timeline.zoomIn')} onClick={() => zoomAt(0.5, 0.6)} />
          <IconButton icon="ScanSearch" title={t('timeline.fit')} onClick={() => setDomain(fitDomain(events.map((e) => e.t)))} />
        </div>
      </div>
      <div
        ref={box}
        className="relative cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseLeave={() => setHover(null)}
      >
        {/* Axe */}
        <div className="relative border-b border-line bg-panel-2" style={{ height: AXIS_H }}>
          <div className="absolute inset-y-0 left-0 z-[2] border-r border-line bg-panel-2" style={{ width: GUTTER }} />
          <div className="absolute inset-y-0 right-0 overflow-hidden" style={{ left: GUTTER }}>
            {tickList.map((tk) => {
              const lbl = tickLabel(tk, unit, lang)
              return (
                <div key={tk} className="absolute top-0 bottom-0" style={{ left: xOf(tk) }}>
                  <div className={`absolute bottom-0 w-px ${lbl.major ? 'h-3 bg-faint' : 'h-2 bg-line-strong'}`} />
                  <div
                    className={`absolute top-2 left-1.5 text-[11px] whitespace-nowrap tabular-nums ${lbl.major ? 'font-semibold text-fg' : 'text-muted'}`}
                  >
                    {lbl.text}
                  </div>
                </div>
              )
            })}
            {showNow && (
              <div className="absolute top-0 bottom-0" style={{ left: nowX }}>
                <div className="absolute bottom-0 h-full w-px bg-accent" />
                {nowSide && (
                  <div className={`absolute top-2 text-[10.5px] font-semibold whitespace-nowrap text-accent ${nowSide === 'left' ? 'right-1.5' : 'left-1.5'}`}>
                    {t('timeline.today')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Pistes */}
        <div className="overflow-x-hidden overflow-y-auto" style={{ maxHeight: maxH }}>
          <div className="relative" style={{ height: lanesH }}>
            <div className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden" style={{ left: GUTTER }}>
              {tickList.map((tk) => (
                <div
                  key={tk}
                  className={`absolute inset-y-0 w-px ${tickLabel(tk, unit, lang).major ? 'bg-line-strong' : 'bg-line'}`}
                  style={{ left: xOf(tk) }}
                />
              ))}
              {showNow && <div className="absolute inset-y-0 w-px bg-accent opacity-60" style={{ left: nowX }} />}
              {spans.map((s) => (
                <div
                  key={s.key}
                  className="absolute h-[3px] rounded-full bg-accent opacity-60"
                  style={{ left: s.x0, width: Math.max(0, s.x1 - s.x0), top: s.lane * LANE_H + LANE_H / 2 - 1.5 }}
                />
              ))}
            </div>
            {lanes.map((lane, i) => (
              <div key={lane} className="absolute right-0 left-0 border-b border-line last:border-b-0" style={{ top: i * LANE_H, height: LANE_H }}>
                <div className="absolute inset-y-0 left-0 z-[2] flex items-center gap-2 border-r border-line bg-panel px-3" style={{ width: GUTTER }}>
                  <EntityBadge type={lane} size={20} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{tx(getEntityType(lane).label)}</span>
                  <span className="text-[11px] text-faint tabular-nums">{byLane.get(lane)?.length ?? 0}</span>
                </div>
                <div className="absolute inset-y-0 right-0" style={{ left: GUTTER }}>
                  {(groups.get(lane) ?? []).map((g) => (
                    <Marker
                      key={g.key}
                      group={g}
                      selected={g.events.some((e) => selected.has(e.nodeId))}
                      onPick={pickGroup}
                      onHover={(rect) => setHover(rect ? { rect, events: g.events } : null)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {hover && <HoverCard hover={hover} lang={lang} />}
    </div>
  )
}

const Marker = memo(function Marker({
  group,
  selected,
  onPick,
  onHover
}: {
  group: Group
  selected: boolean
  onPick: (g: Group) => void
  onHover: (rect: DOMRect | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const e = group.events[0]
  const n = e.node
  const many = group.events.length > 1
  const showLabel = !many && group.room > 110
  return (
    <div className="absolute top-1/2 flex -translate-y-1/2 items-center" style={{ left: group.x - 14 }}>
      <button
        onPointerDown={(ev) => ev.stopPropagation()}
        onClick={() => onPick(group)}
        onMouseEnter={(ev) => onHover(ev.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => onHover(null)}
        className={`relative flex h-7 min-w-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border transition hover:-translate-y-px ${
          many ? 'gap-1 px-1' : ''
        }`}
        style={{
          background: 'var(--node)',
          borderColor: selected ? 'var(--accent)' : 'var(--node-border)',
          boxShadow: selected ? '0 0 0 2px var(--accent-soft)' : '0 2px 8px rgb(0 0 0 / .18)'
        }}
      >
        <EntityBadge
          type={n.type}
          platform={n.platform}
          imageUrl={n.imageId ? attachmentUrl(n.imageId) : null}
          size={20}
          color={n.style.color}
          icon={n.style.icon}
        />
        {many && <span className="pr-0.5 text-[11px] font-semibold tabular-nums text-fg">{group.events.length}</span>}
      </button>
      {showLabel && (
        <span className="pointer-events-none ml-1.5 truncate text-[11.5px] text-muted" style={{ maxWidth: group.room - 40 }}>
          <span className="text-fg">{n.label || t('node.untitled')}</span>
        </span>
      )}
    </div>
  )
})

function HoverCard({ hover, lang }: { hover: Hover; lang: Lang }): React.JSX.Element {
  const { t } = useTranslation()
  const fieldLabel = useFieldLabel()
  const shown = hover.events.slice(0, 6)
  const left = Math.min(Math.max(hover.rect.left + hover.rect.width / 2, 150), window.innerWidth - 150)
  const below = hover.rect.bottom + 230 < window.innerHeight
  return (
    <div
      className="glass pointer-events-none fixed z-50 w-[280px] -translate-x-1/2 rounded-xl p-2"
      style={below ? { left, top: hover.rect.bottom + 8 } : { left, bottom: window.innerHeight - hover.rect.top + 8 }}
    >
      {shown.map((e) => (
        <div key={e.id} className="flex items-start gap-2 rounded-lg px-1.5 py-1">
          <EntityBadge type={e.node.type} platform={e.node.platform} size={20} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12.5px] font-medium">{e.node.label || t('node.untitled')}</div>
            <div className="truncate text-[11px] text-muted">
              {fieldLabel(e)} · <span className="text-fg">{formatEventDate(e.t, e.precision, lang)}</span>
            </div>
          </div>
        </div>
      ))}
      {hover.events.length > shown.length && (
        <div className="px-1.5 pt-1 text-[11px] text-faint">{t('timeline.more', { count: hover.events.length - shown.length })}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Liste chronologique

function EventList({
  events,
  selected,
  lang,
  onPick
}: {
  events: TimelineEvent[]
  selected: Set<string>
  lang: Lang
  onPick: (e: TimelineEvent) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const fieldLabel = useFieldLabel()
  if (!events.length) return <div className="px-4 py-8 text-center text-[12.5px] text-muted">{t('timeline.noneInView')}</div>
  const rows: React.JSX.Element[] = []
  let year: number | null = null
  for (const e of events) {
    const y = new Date(e.t).getUTCFullYear()
    if (y !== year) {
      year = y
      rows.push(
        <div key={`y${y}`} className="sticky top-0 z-[1] border-b border-line bg-panel-2 px-4 py-1 text-[11px] font-semibold tracking-wide text-muted">
          {y}
        </div>
      )
    }
    const n = e.node
    const active = selected.has(e.nodeId)
    rows.push(
      <button
        key={e.id}
        onClick={() => onPick(e)}
        className={`flex w-full items-center gap-3 border-b border-line px-4 py-2 text-left transition last:border-b-0 ${active ? 'bg-accent-soft' : 'hover:bg-panel-2'}`}
        style={{ contentVisibility: 'auto', containIntrinsicSize: '0 41px' }}
      >
        <span className={`w-[150px] shrink-0 text-[12px] tabular-nums ${active ? 'text-accent' : 'text-muted'}`}>{formatEventDate(e.t, e.precision, lang)}</span>
        <EntityBadge
          type={n.type}
          platform={n.platform}
          imageUrl={n.imageId ? attachmentUrl(n.imageId) : null}
          size={22}
          color={n.style.color}
          icon={n.style.icon}
        />
        <span className={`min-w-0 flex-1 truncate text-[12.5px] font-medium ${n.label ? 'text-fg' : 'italic text-faint'}`}>{n.label || t('node.untitled')}</span>
        <span className="w-[170px] shrink-0 truncate text-[12px] text-muted">{fieldLabel(e)}</span>
        <span className="hidden w-[150px] shrink-0 truncate text-right text-[11.5px] text-faint xl:block">
          {getPlatform(n.platform)?.name ?? tx(getEntityType(n.type).label)}
        </span>
      </button>
    )
  }
  return <div className="min-h-0 flex-1 overflow-auto">{rows}</div>
}

function EmptyState(): React.JSX.Element {
  const { t } = useTranslation()
  const setView = useApp((s) => s.setView)
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-panel-2 text-muted">
          <Icon name="CalendarX" size={20} />
        </div>
        <div className="text-[15px] font-semibold">{t('timeline.emptyTitle')}</div>
        <div className="text-[12.5px] leading-relaxed text-muted">{t('timeline.emptyBody')}</div>
        <Button variant="secondary" icon="ArrowLeft" className="mt-3" onClick={() => setView('graph')}>
          {t('timeline.backToGraph')}
        </Button>
      </div>
    </div>
  )
}
