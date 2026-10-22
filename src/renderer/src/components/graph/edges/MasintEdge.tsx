import { memo, useContext } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps
} from '@xyflow/react'
import { useApp } from '../../../store/app'
import { useGraph, type FlowEdge } from '../../../store/graph'
import { OutDegreeContext, SelectedNodesContext } from '../nodes/EntityNode'

/** Au-delà de ce nombre de liens sortants, les libellés ne s'affichent que pour la sélection. */
const LABEL_MAX_SIBLINGS = 6

function MasintEdgeImpl(props: EdgeProps<FlowEdge>): React.JSX.Element {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  const style = useApp((s) => s.settings?.edgeStyle ?? 'bezier')
  const allLabels = useApp((s) => s.settings?.edgeLabels === 'always')
  const siblings = useContext(OutDegreeContext).get(source) ?? 0
  const selectedNodes = useContext(SelectedNodesContext)
  const edge = data?.edge
  // Lien vu par un seul module : pointillé, à confirmer. Le style choisi à la main l'emporte.
  const single = useGraph((s) => s.corroboration.edges[id] === 1)
  const dashed = edge?.style.dashed ?? single
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
          strokeDasharray: dashed ? (edge?.style.dashed ? '5 4' : '3 3') : undefined
        }}
        className={edge?.style.animated ? 'animated' : undefined}
      />
      {edge?.label && (allLabels || selected || siblings <= LABEL_MAX_SIBLINGS || selectedNodes.has(source) || selectedNodes.has(target)) && (
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
