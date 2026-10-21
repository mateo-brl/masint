import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps
} from '@xyflow/react'
import { useApp } from '../../../store/app'
import type { FlowEdge } from '../../../store/graph'

function MasintEdgeImpl(props: EdgeProps<FlowEdge>): React.JSX.Element {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  const style = useApp((s) => s.settings?.edgeStyle ?? 'bezier')
  const edge = data?.edge
  const params = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }
  const [path, labelX, labelY] =
    style === 'straight' ? getStraightPath(params) : style === 'smoothstep' ? getSmoothStepPath({ ...params, borderRadius: 10 }) : getBezierPath(params)
  const color = selected ? 'var(--accent)' : (edge?.style.color ?? 'var(--edge)')

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: (edge?.style.width ?? 1.1) * (selected ? 1.6 : 1),
          strokeDasharray: edge?.style.dashed ? '5 4' : undefined
        }}
        className={edge?.style.animated ? 'animated' : undefined}
      />
      {edge?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded-md border border-line bg-panel px-1.5 py-0.5 text-[9px] text-muted"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const MasintEdge = memo(MasintEdgeImpl)
