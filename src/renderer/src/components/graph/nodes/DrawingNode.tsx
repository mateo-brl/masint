import { memo, useMemo } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../../../store/graph'
import { strokeToPath, type StrokePoint } from '../DrawLayer'
import '../../views/geo.css'

const RESIZER_STYLE = { pointerEvents: 'all' } as const

function readPoints(v: unknown): StrokePoint[] {
  if (!Array.isArray(v)) return []
  return v.filter((p): p is StrokePoint => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
}

/** Trait à main levée : seul le trait capte les clics, la boîte englobante reste transparente. */
function DrawingNodeImpl({ data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  const points = useMemo(() => readPoints(n.data.points), [n.data.points])
  const size = n.style.strokeWidth ?? 4
  const color = n.style.color ?? 'var(--accent)'

  const view = useMemo(() => {
    const w = typeof n.data.w === 'number' ? n.data.w : 0
    const h = typeof n.data.h === 'number' ? n.data.h : 0
    if (w > 0 && h > 0) return { w, h }
    let mx = 1
    let my = 1
    for (const [x, y] of points) {
      mx = Math.max(mx, x)
      my = Math.max(my, y)
    }
    return { w: mx + size, h: my + size }
  }, [n.data.w, n.data.h, points, size])

  const fill = useMemo(() => strokeToPath(points, size), [points, size])
  const centerline = useMemo(() => (points.length ? `M${points.map((p) => `${p[0]},${p[1]}`).join('L')}` : ''), [points])

  return (
    <>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${view.w} ${view.h}`}
        preserveAspectRatio="none"
        className="block overflow-visible"
        style={{ filter: selected ? 'drop-shadow(0 0 3px var(--accent-soft)) drop-shadow(0 0 1px var(--accent))' : undefined }}
      >
        <path d={fill} fill={color} style={{ pointerEvents: 'none' }} />
        {/* Zone de clic élargie le long du trait. */}
        <path
          d={centerline}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(size, 12)}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: 'move' }}
        />
      </svg>
      <NodeResizer isVisible={selected} minWidth={8} minHeight={8} handleStyle={RESIZER_STYLE} lineStyle={RESIZER_STYLE} />
    </>
  )
}

export const DrawingNode = memo(DrawingNodeImpl)
