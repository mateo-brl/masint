import { memo, useEffect, useRef } from 'react'
import type L from 'leaflet'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { BASEMAPS, formatCoord, getBasemap } from '../../../lib/geo'
import { Icon } from '../../../lib/icons'
import { useApp } from '../../../store/app'
import { useGraph, type FlowNode } from '../../../store/graph'
import { useBasemap, useLeafletMap } from '../../views/MapView'
import '../../views/geo.css'

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

/** Mini-carte posée sur le canevas : l'en-tête sert de poignée, la carte reste manipulable. */
function MapNodeImpl({ id, data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  const { t } = useTranslation()
  const theme = useApp((s) => s.settings?.theme)
  const lat = num(n.data.lat, 48.8566)
  const lon = num(n.data.lon, 2.3522)
  const zoom = num(n.data.zoom, 11)
  const base = getBasemap(n.data.basemap, theme)
  const next = BASEMAPS[(BASEMAPS.findIndex((b) => b.id === base.id) + 1) % BASEMAPS.length]
  const container = useRef<HTMLDivElement>(null)
  const map = useLeafletMap(container, () => ({
    center: [lat, lon],
    zoom,
    scrollWheelZoom: 'center',
    doubleClickZoom: 'center',
    worldCopyJump: true
  }))
  useBasemap(map, base)
  useMapSync(map, id, lat, lon, zoom)

  const cycleBasemap = (): void => {
    const latest = useGraph.getState().nodes.find((x) => x.id === id)?.data.node ?? n
    void useGraph.getState().updateNode(id, { data: { ...latest.data, basemap: next.id } })
  }

  return (
    <>
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-[10px] border transition-shadow"
        style={{
          background: 'var(--node)',
          borderColor: selected ? 'var(--accent)' : (n.style.color ?? 'var(--node-border)'),
          borderWidth: n.style.color && !selected ? 2 : 1,
          boxShadow: selected ? '0 0 0 1px var(--accent), 0 8px 26px rgb(0 0 0 / .35)' : '0 4px 16px rgb(0 0 0 / .22)'
        }}
      >
        <div className="flex h-8 shrink-0 cursor-grab items-center gap-1.5 border-b border-line pr-1 pl-2.5 active:cursor-grabbing">
          <Icon name="MapPin" size={13} className="shrink-0 text-accent" />
          <span className={`min-w-0 flex-1 truncate text-[11.5px] font-semibold ${n.label ? 'text-fg' : 'text-muted'}`}>
            {n.label || t('canvas2.mapUntitled')}
          </span>
          <span className="shrink-0 font-mono text-[9.5px] text-faint">{formatCoord(lat, lon)}</span>
          <button
            onClick={cycleBasemap}
            title={t('canvas2.basemap', { name: t(`map.basemaps.${next.id}`) })}
            className="nodrag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
          >
            <Icon name="Layers" size={13} />
          </button>
        </div>
        <div className="nodrag nowheel relative isolate min-h-0 flex-1">
          <div ref={container} className="geo-map h-full w-full" />
          {/* Le point d'intérêt est le centre de la carte. */}
          <div className="pointer-events-none absolute top-1/2 left-1/2 z-[450] -translate-x-1/2 -translate-y-1/2">
            <span className="absolute top-1/2 left-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-20" />
            <span className="relative block h-3 w-3 rounded-full border-2 border-white bg-accent shadow-[0_1px_6px_rgb(0_0_0/0.5)]" />
          </div>
        </div>
      </div>
      <NodeResizer isVisible={selected} minWidth={180} minHeight={130} />
    </>
  )
}

/** Enregistre le centre et le zoom après un déplacement, et suit les changements externes. */
function useMapSync(map: L.Map | null, id: string, lat: number, lon: number, zoom: number): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!map) return
    const onMoveEnd = (): void => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const node = useGraph.getState().nodes.find((x) => x.id === id)?.data.node
        if (!node) return
        const c = map.getCenter()
        const next = { lat: round6(c.lat), lon: round6(c.lng), zoom: map.getZoom() }
        if (next.lat === node.data.lat && next.lon === node.data.lon && next.zoom === node.data.zoom) return
        void useGraph.getState().updateNode(id, { data: { ...node.data, ...next } })
      }, 600)
    }
    map.on('moveend', onMoveEnd)
    // Redimensionnement du nœud : Leaflet doit recalculer sa taille en gardant le centre.
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    ro.observe(map.getContainer())
    return () => {
      map.off('moveend', onMoveEnd)
      ro.disconnect()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [map, id])

  // Coordonnées modifiées ailleurs (fiche) : on recentre.
  useEffect(() => {
    if (!map) return
    const c = map.getCenter()
    if (Math.abs(c.lat - lat) > 1e-6 || Math.abs(c.lng - lon) > 1e-6 || map.getZoom() !== zoom) map.setView([lat, lon], zoom, { animate: false })
  }, [map, lat, lon, zoom])
}

export const MapNode = memo(MapNodeImpl)
