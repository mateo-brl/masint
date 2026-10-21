import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { getStroke } from 'perfect-freehand'
import type { PropValue } from '@shared/types'
import { useGraph } from '../../store/graph'

/** Point d'un trait : x, y et pression facultative (stylet). */
export type StrokePoint = number[]

/** Contour d'un trait à main levée sous forme de chemin SVG rempli. */
export function strokeToPath(points: StrokePoint[], size: number, last = true): string {
  if (!points.length) return ''
  const pen = points.length > 0 && points[0].length > 2
  const outline = getStroke(points, {
    size,
    thinning: pen ? 0.6 : 0.45,
    smoothing: 0.55,
    streamline: 0.4,
    simulatePressure: !pen,
    last
  })
  if (outline.length < 3) return ''
  const r = (n: number): string => n.toFixed(2)
  let d = `M${r(outline[0][0])},${r(outline[0][1])} Q`
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    d += `${r(x0)},${r(y0)} ${r((x0 + x1) / 2)},${r((y0 + y1) / 2)} `
  }
  return `${d}Z`
}

interface Pending {
  id: number
  points: StrokePoint[]
  color: string
  width: number
}

let seq = 0

/**
 * Calque de dessin libre, monté au-dessus des nœuds quand l'outil « Dessiner » est actif.
 * Les points sont gardés en coordonnées du graphe pour que le zoom reste possible pendant le tracé.
 */
export function DrawLayer(): React.JSX.Element {
  const rf = useReactFlow()
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const domNode = useStore((s) => s.domNode)
  const color = useGraph((s) => s.drawColor)
  const width = useGraph((s) => s.drawWidth)
  const ref = useRef<HTMLDivElement>(null)
  const stroke = useRef<{ pointerId: number; points: StrokePoint[]; pen: boolean } | null>(null)
  const pan = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const [live, setLive] = useState<StrokePoint[] | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  // La molette n'atteint plus le panneau de React Flow : on la lui retransmet.
  useEffect(() => {
    const el = ref.current
    const target = domNode?.querySelector('.react-flow__renderer')
    if (!el || !target) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      target.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          bubbles: true,
          cancelable: true
        })
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [domNode])

  const local = (e: React.PointerEvent): { x: number; y: number } => {
    const box = ref.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (stroke.current || pan.current) return
    ref.current?.setPointerCapture(e.pointerId)
    // Bouton du milieu ou droit : déplacement de la vue.
    if (e.button === 1 || e.button === 2) {
      pan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    if (e.button !== 0) return
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const pen = e.pointerType === 'pen'
    stroke.current = { pointerId: e.pointerId, points: [pen ? [p.x, p.y, e.pressure] : [p.x, p.y]], pen }
    setLive(stroke.current.points.slice())
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    setCursor(local(e))
    if (pan.current && pan.current.pointerId === e.pointerId) {
      const vp = rf.getViewport()
      void rf.setViewport({ x: vp.x + e.clientX - pan.current.x, y: vp.y + e.clientY - pan.current.y, zoom: vp.zoom })
      pan.current = { ...pan.current, x: e.clientX, y: e.clientY }
      return
    }
    const s = stroke.current
    if (!s || s.pointerId !== e.pointerId) return
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
    const list = events.length ? events : [e.nativeEvent]
    const minDist = 0.8 / zoom
    for (const ev of list) {
      const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      const prev = s.points[s.points.length - 1]
      if (Math.hypot(p.x - prev[0], p.y - prev[1]) < minDist) continue
      s.points.push(s.pen ? [p.x, p.y, ev.pressure] : [p.x, p.y])
    }
    setLive(s.points.slice())
  }

  const finish = (e: React.PointerEvent, cancel = false): void => {
    if (pan.current && pan.current.pointerId === e.pointerId) {
      pan.current = null
      return
    }
    const s = stroke.current
    if (!s || s.pointerId !== e.pointerId) return
    stroke.current = null
    setLive(null)
    if (cancel) return
    const points = s.points.length === 1 ? [s.points[0], [s.points[0][0] + 0.1, s.points[0][1] + 0.1, ...s.points[0].slice(2)]] : s.points
    const id = ++seq
    setPending((list) => [...list, { id, points, color, width }])
    void createDrawing(points, color, width).finally(() => setPending((list) => list.filter((p) => p.id !== id)))
  }

  const livePath = useMemo(() => (live ? strokeToPath(live, width, false) : ''), [live, width])

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[4]"
      style={{ cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={() => setCursor(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
          {pending.map((p) => (
            <path key={p.id} d={strokeToPath(p.points, p.width)} fill={p.color} />
          ))}
          {livePath && <path d={livePath} fill={color} />}
        </g>
        {cursor && !live && (
          <circle
            cx={cursor.x}
            cy={cursor.y}
            r={Math.max(2.5, (width * zoom) / 2)}
            fill={color}
            fillOpacity={0.35}
            stroke={color}
            strokeWidth={1}
          />
        )}
      </svg>
    </div>
  )
}

/** Enregistre un trait comme nœud `drawing` dont les points sont relatifs à son coin haut gauche. */
async function createDrawing(points: StrokePoint[], color: string, width: number): Promise<void> {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const pad = width
  const x0 = minX - pad
  const y0 = minY - pad
  const w = Math.max(maxX - minX + 2 * pad, 4)
  const h = Math.max(maxY - minY + 2 * pad, 4)
  const r1 = (n: number): number => Math.round(n * 10) / 10
  const rel = points.map((p) => (p.length > 2 ? [r1(p[0] - x0), r1(p[1] - y0), Math.round(p[2] * 100) / 100] : [r1(p[0] - x0), r1(p[1] - y0)]))
  await useGraph.getState().addNodes(
    [
      {
        kind: 'drawing',
        type: 'drawing',
        label: '',
        // Les points sont stockés tels quels en JSON (tableau de tableaux).
        data: { points: rel as unknown as PropValue, w: r1(w), h: r1(h) },
        x: r1(x0),
        y: r1(y0),
        width: r1(w),
        height: r1(h),
        style: { color, strokeWidth: width }
      }
    ],
    false
  )
}
