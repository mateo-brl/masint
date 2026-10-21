import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import {
  BASEMAPS,
  clusterPoints,
  formatCoord,
  geoPoints,
  getBasemap,
  loadBasemapPref,
  saveBasemapPref,
  type Basemap,
  type BasemapId,
  type GeoCluster,
  type GeoPoint
} from '../../lib/geo'
import { useLang } from '../../lib/i18n'
import { EntityBadge, Icon } from '../../lib/icons'
import { useApp } from '../../store/app'
import { useGraph } from '../../store/graph'
import { Button } from '../ui'
import './geo.css'

/** Hôte vide des marqueurs : le contenu est rendu par React dans l'élément créé par Leaflet. */
const HOST_ICON = L.divIcon({ className: 'geo-marker-host', html: '', iconSize: [34, 40], iconAnchor: [17, 40], tooltipAnchor: [0, -40] })
const CLUSTER_CELL = 46
const BASEMAP_ICONS: Record<BasemapId, string> = { dark: 'Moon', light: 'Sun', osm: 'Map', satellite: 'Satellite' }

const clusterIcons = new Map<number, L.DivIcon>()
function clusterIcon(count: number): L.DivIcon {
  let icon = clusterIcons.get(count)
  if (!icon) {
    const s = count < 10 ? 30 : count < 100 ? 36 : 42
    icon = L.divIcon({ className: 'geo-marker-host', html: `<div class="geo-cluster">${count}</div>`, iconSize: [s, s], tooltipAnchor: [0, -s / 2] })
    clusterIcons.set(count, icon)
  }
  return icon
}

/**
 * Crée une carte Leaflet dans l'élément donné et la détruit au démontage.
 * Le contrôle d'attribution est ajouté avant toute couche pour suivre aussi leur retrait.
 */
export function useLeafletMap(ref: React.RefObject<HTMLDivElement | null>, options: () => L.MapOptions): L.Map | null {
  const [map, setMap] = useState<L.Map | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const m = L.map(ref.current, { ...options(), attributionControl: false })
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(m)
    setMap(m)
    return () => {
      m.remove()
      setMap(null)
    }
    // Les options ne sont lues qu'à la création.
  }, [ref])
  return map
}

/** Fond de carte et couche de libellés éventuelle ; bascule le filtre du thème sombre. */
export function useBasemap(map: L.Map | null, base: Basemap): void {
  useEffect(() => {
    if (!map) return
    map.getContainer().classList.toggle('geo-raw', base.raw)
    const opts = (attribution?: string): L.TileLayerOptions => ({
      maxZoom: base.maxZoom,
      ...(base.maxNativeZoom ? { maxNativeZoom: base.maxNativeZoom } : {}),
      ...(base.subdomains ? { subdomains: base.subdomains } : {}),
      ...(attribution ? { attribution } : {})
    })
    const layers = [L.tileLayer(base.url, opts(base.attribution))]
    if (base.overlay) layers.push(L.tileLayer(base.overlay, opts()))
    for (const l of layers) l.addTo(map)
    return () => {
      for (const l of layers) l.remove()
    }
  }, [map, base])
}

/** Vue « Carte » : entités géolocalisées, liens entre elles, liste latérale. */
export function MapView(): React.JSX.Element {
  const { t } = useTranslation()
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const theme = useApp((s) => s.settings?.theme)
  const themeKey = theme ?? 'dark'
  const [prefs, setPrefs] = useState<Record<string, BasemapId>>({})
  const stored = useMemo(() => loadBasemapPref(theme), [theme])
  const pref = prefs[themeKey] ?? stored
  const base = getBasemap(pref, theme)
  const container = useRef<HTMLDivElement>(null)
  const map = useLeafletMap(container, () => ({ center: [30, 10], zoom: 3, minZoom: 2, zoomControl: false, worldCopyJump: true }))
  useBasemap(map, base)
  const [listOpen, setListOpen] = useState(true)
  const [popup, setPopup] = useState<GeoCluster | null>(null)

  const points = useMemo(() => geoPoints(nodes.map((n) => n.data.node)), [nodes])
  const selected = useMemo(() => new Set(nodes.filter((n) => n.selected).map((n) => n.id)), [nodes])
  const links = useMemo(() => {
    const byId = new Map(points.map((p) => [p.id, p]))
    const out: Array<{ id: string; a: GeoPoint; b: GeoPoint; label: string }> = []
    for (const e of edges) {
      const a = byId.get(e.source)
      const b = byId.get(e.target)
      if (a && b && a !== b) out.push({ id: e.id, a, b, label: e.data?.edge.label ?? '' })
    }
    return out
  }, [points, edges])

  const padding = (): { paddingTopLeft: L.PointExpression; paddingBottomRight: L.PointExpression } => ({
    paddingTopLeft: [listOpen ? 340 : 50, 50],
    paddingBottomRight: [selected.size ? 350 : 50, 90]
  })

  const fit = (animate = true): void => {
    if (!map || !points.length) return
    if (points.length === 1) map.setView([points[0].lat, points[0].lon], 12, { animate })
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])), { ...padding(), maxZoom: 13, animate })
  }

  // Ajustement automatique dès que des marqueurs sont disponibles.
  const fitted = useRef(false)
  useEffect(() => {
    if (!map || fitted.current || !points.length) return
    fitted.current = true
    fit(false)
  }, [map, points.length])

  // Clic sur le fond : désélection.
  useEffect(() => {
    if (!map) return
    const onClick = (): void => useGraph.getState().select([])
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map])

  // Amène dans le champ l'entité sélectionnée ailleurs (graphe, fiche).
  const only = selected.size === 1 ? Array.from(selected)[0] : null
  useEffect(() => {
    const p = only ? points.find((x) => x.id === only) : undefined
    if (map && p && !map.getBounds().pad(-0.15).contains([p.lat, p.lon])) map.panTo([p.lat, p.lon])
  }, [only, map])

  const focus = (p: GeoPoint): void => {
    useGraph.getState().select([p.id])
    map?.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 13), { duration: 0.6 })
  }

  const chooseBasemap = (id: BasemapId): void => {
    setPrefs({ ...prefs, [themeKey]: id })
    saveBasemapPref(theme, id)
  }

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 isolate">
        <div ref={container} className="geo-map h-full w-full" />
      </div>
      {map && (
        <>
          {links.map((l) => (
            <LinkLine key={l.id} map={map} a={l.a} b={l.b} label={l.label} active={selected.has(l.a.id) || selected.has(l.b.id)} />
          ))}
          <GeoMarkers map={map} points={points} selected={selected} onOpenCluster={setPopup} />
          {popup && <ClusterPopup map={map} cluster={popup} onClose={() => setPopup(null)} />}
        </>
      )}

      {points.length > 0 &&
        (listOpen ? (
          <LocatedList points={points} selected={selected} onFocus={focus} onClose={() => setListOpen(false)} />
        ) : (
          <button
            onClick={() => setListOpen(true)}
            title={t('map.showList')}
            className="glass absolute top-4 left-4 z-10 flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-medium hover:bg-panel-3"
          >
            <Icon name="PanelLeftOpen" size={15} className="text-muted" />
            {t('map.located', { count: points.length })}
          </button>
        ))}

      {points.length === 0 && <EmptyState />}

      <div className="glass absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl px-1.5 py-1.5">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            onClick={() => chooseBasemap(b.id)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition ${
              base.id === b.id ? 'bg-accent-soft text-accent' : 'hover:bg-panel-3'
            }`}
          >
            <Icon name={BASEMAP_ICONS[b.id]} size={14} className={base.id === b.id ? '' : 'text-muted'} />
            {t(`map.basemaps.${b.id}`)}
          </button>
        ))}
        <div className="mx-1 h-5 w-px bg-line" />
        <BarIcon icon="Minus" title={t('map.zoomOut')} onClick={() => map?.zoomOut()} />
        <BarIcon icon="Plus" title={t('map.zoomIn')} onClick={() => map?.zoomIn()} />
        <BarIcon icon="ScanSearch" title={t('map.fit')} onClick={() => fit()} disabled={!points.length} />
      </div>
    </div>
  )
}

function BarIcon({ icon, title, onClick, disabled }: { icon: string; title: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-panel-3 hover:text-fg disabled:opacity-40"
    >
      <Icon name={icon} size={15} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Couches de la carte

function GeoMarkers({
  map,
  points,
  selected,
  onOpenCluster
}: {
  map: L.Map
  points: GeoPoint[]
  selected: Set<string>
  onOpenCluster: (c: GeoCluster) => void
}): React.JSX.Element {
  const [zoom, setZoom] = useState(() => map.getZoom())
  useEffect(() => {
    const onZoom = (): void => setZoom(map.getZoom())
    map.on('zoomend', onZoom)
    return () => {
      map.off('zoomend', onZoom)
    }
  }, [map])
  const clusters = useMemo(
    () => clusterPoints(points, (lat, lon) => map.project([lat, lon], zoom), CLUSTER_CELL, selected),
    [points, zoom, selected, map]
  )
  return (
    <>
      {clusters.map((c) =>
        c.points.length === 1 ? (
          <EntityMarker key={c.key} map={map} point={c.points[0]} selected={selected.has(c.key)} />
        ) : (
          <ClusterMarker key={c.key} map={map} cluster={c} onOpen={onOpenCluster} />
        )
      )}
    </>
  )
}

/** Élément détaché servant de contenu à une info-bulle ou une fenêtre Leaflet, rempli par un portail React. */
function useDetachedElement(): HTMLDivElement {
  return useMemo(() => document.createElement('div'), [])
}

const EntityMarker = memo(function EntityMarker({ map, point, selected }: { map: L.Map; point: GeoPoint; selected: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const marker = useRef<L.Marker | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const tip = useDetachedElement()
  const n = point.node

  useEffect(() => {
    const m = L.marker([point.lat, point.lon], { icon: HOST_ICON })
      .bindTooltip(tip, { direction: 'top', offset: [0, -4], opacity: 1, className: 'geo-tip' })
      .on('click', () => useGraph.getState().select([n.id]))
      .addTo(map)
    marker.current = m
    setHost(m.getElement() ?? null)
    return () => {
      m.remove()
      marker.current = null
    }
    // La position et la mise en avant sont mises à jour sans recréer le marqueur.
  }, [map, n.id, tip])
  useEffect(() => {
    marker.current?.setLatLng([point.lat, point.lon])
  }, [point.lat, point.lon])
  useEffect(() => {
    marker.current?.setZIndexOffset(selected ? 1000 : 0)
  }, [selected])

  const kind = getPlatform(n.platform)?.name ?? tx(getEntityType(n.type).label)
  return (
    <>
      {createPortal(
        <>
          <div className="font-medium">{n.label || t('node.untitled')}</div>
          <div className="text-[11px] text-muted">{kind}</div>
        </>,
        tip
      )}
      {host &&
        createPortal(
          <div className={`geo-pin ${selected ? 'is-selected' : ''}`}>
            <EntityBadge
              type={n.type}
              platform={n.platform}
              imageUrl={n.imageId ? attachmentUrl(n.imageId) : null}
              size={24}
              color={n.style.color}
              icon={n.style.icon}
            />
          </div>,
          host
        )}
    </>
  )
})

function ClusterMarker({ map, cluster, onOpen }: { map: L.Map; cluster: GeoCluster; onOpen: (c: GeoCluster) => void }): null {
  const { t } = useTranslation()
  const latest = useRef({ cluster, onOpen })
  latest.current = { cluster, onOpen }
  const count = cluster.points.length
  const label = t('map.cluster', { count })

  useEffect(() => {
    const m = L.marker([cluster.lat, cluster.lon], { icon: clusterIcon(count) })
      .bindTooltip(label, { direction: 'top', offset: [0, -2], opacity: 1, className: 'geo-tip' })
      .on('click', () => {
        const { cluster: c, onOpen: open } = latest.current
        const bounds = L.latLngBounds(c.points.map((p) => [p.lat, p.lon]))
        const tiny = bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 30
        // Points superposés ou zoom maximal : on liste les entités au lieu de zoomer.
        if (tiny || map.getZoom() >= map.getMaxZoom() - 1) open(c)
        else map.flyToBounds(bounds, { padding: [80, 80], maxZoom: map.getMaxZoom(), duration: 0.5 })
      })
      .addTo(map)
    return () => {
      m.remove()
    }
  }, [map, cluster.lat, cluster.lon, count, label])
  return null
}

function ClusterPopup({ map, cluster, onClose }: { map: L.Map; cluster: GeoCluster; onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const content = useDetachedElement()
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const popup = L.popup({ offset: [0, -12], minWidth: 240, maxWidth: 280 }).setLatLng([cluster.lat, cluster.lon]).setContent(content)
    const onRemove = (): void => close.current()
    popup.on('remove', onRemove)
    popup.openOn(map)
    return () => {
      popup.off('remove', onRemove)
      popup.remove()
    }
  }, [map, cluster.lat, cluster.lon, content])

  return createPortal(
    <div className="max-h-64 overflow-auto">
      <div className="px-2 pt-1 pb-1.5 label-xs">{t('map.cluster', { count: cluster.points.length })}</div>
      {cluster.points.map((p) => (
        <button
          key={p.id}
          onClick={() => {
            useGraph.getState().select([p.id])
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel-3"
        >
          <EntityBadge type={p.node.type} platform={p.node.platform} imageUrl={p.node.imageId ? attachmentUrl(p.node.imageId) : null} size={22} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-fg">{p.node.label || t('node.untitled')}</span>
            <span className="block truncate text-[11px] text-muted">{tx(getEntityType(p.node.type).label)}</span>
          </span>
        </button>
      ))}
    </div>,
    content
  )
}

const LinkLine = memo(function LinkLine({ map, a, b, label, active }: { map: L.Map; a: GeoPoint; b: GeoPoint; label: string; active: boolean }): null {
  useEffect(() => {
    // Les options (dont la classe) ne sont lues qu'à la création : on recrée la ligne quand elles changent.
    const line = L.polyline(
      [
        [a.lat, a.lon],
        [b.lat, b.lon]
      ],
      { className: active ? 'geo-link is-active' : 'geo-link', weight: active ? 2.4 : 1.5, ...(active ? {} : { dashArray: '5 6' }) }
    )
    if (label) line.bindTooltip(label, { sticky: true, opacity: 1, className: 'geo-tip' })
    line.addTo(map)
    return () => {
      line.remove()
    }
  }, [map, a.lat, a.lon, b.lat, b.lon, label, active])
  return null
})

// ---------------------------------------------------------------------------
// Panneaux

function LocatedList({
  points,
  selected,
  onFocus,
  onClose
}: {
  points: GeoPoint[]
  selected: Set<string>
  onFocus: (p: GeoPoint) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { tx } = useLang()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const sorted = [...points].sort((a, b) => (a.node.label || '').localeCompare(b.node.label || ''))
    if (!s) return sorted
    return sorted.filter((p) => `${p.node.label} ${tx(getEntityType(p.node.type).label)} ${p.node.platform ?? ''}`.toLowerCase().includes(s))
  }, [points, q, tx])

  return (
    <aside className="glass absolute top-4 bottom-20 left-4 z-10 flex w-[300px] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-start justify-between px-4 pt-4 pb-3">
        <div>
          <div className="label-xs">{t('map.kicker')}</div>
          <div className="mt-1 text-[15px] font-semibold">{t('map.located', { count: points.length })}</div>
        </div>
        <button onClick={onClose} title={t('map.hideList')} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-fg">
          <Icon name="PanelLeftClose" size={16} />
        </button>
      </div>
      <div className="px-4 pb-3">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('map.search')} className="field !py-1.5 !pl-8 text-[12.5px]" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-line p-1.5">
        {list.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-muted">{t('map.noMatch')}</div>}
        {list.map((p) => {
          const n = p.node
          const active = selected.has(p.id)
          return (
            <button
              key={p.id}
              onClick={() => onFocus(p)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${active ? 'bg-accent-soft' : 'hover:bg-panel-3'}`}
              style={{ contentVisibility: 'auto', containIntrinsicSize: '0 44px' }}
            >
              <EntityBadge
                type={n.type}
                platform={n.platform}
                imageUrl={n.imageId ? attachmentUrl(n.imageId) : null}
                size={26}
                color={n.style.color}
                icon={n.style.icon}
              />
              <span className="min-w-0 flex-1 leading-tight">
                <span className={`block truncate text-[12.5px] font-medium ${active ? 'text-accent' : n.label ? 'text-fg' : 'italic text-faint'}`}>
                  {n.label || t('node.untitled')}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted">
                  {getPlatform(n.platform)?.name ?? tx(getEntityType(n.type).label)}
                  <span className="text-faint"> · </span>
                  <span className="font-mono text-[10.5px] text-faint">{formatCoord(p.lat, p.lon, 3)}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function EmptyState(): React.JSX.Element {
  const { t } = useTranslation()
  const setView = useApp((s) => s.setView)
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="glass pointer-events-auto flex max-w-md flex-col items-center gap-2 rounded-2xl px-8 py-7 text-center">
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-panel-2 text-muted">
          <Icon name="MapPinOff" size={20} />
        </div>
        <div className="text-[15px] font-semibold">{t('map.emptyTitle')}</div>
        <div className="text-[12.5px] leading-relaxed text-muted">{t('map.emptyBody')}</div>
        <Button variant="secondary" icon="ArrowLeft" className="mt-3" onClick={() => setView('graph')}>
          {t('map.backToGraph')}
        </Button>
      </div>
    </div>
  )
}
