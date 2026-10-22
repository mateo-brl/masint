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
import { useCanvas, useEdgeDecor, useLowZoom } from '../../../store/canvas'
import type { FlowEdge } from '../../../store/graph'

/** Au-delà de ce nombre de liens sortants, les libellés ne s'affichent que pour la sélection. */
const LABEL_MAX_SIBLINGS = 6

/** Au-delà de ce nombre de nœuds sélectionnés (Ctrl+A...), la sélection n'affiche plus les libellés. */
const LABEL_MAX_SELECTED = 50

function MasintEdgeImpl(props: EdgeProps<FlowEdge>): React.JSX.Element {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  const style = useApp((s) => s.settings?.edgeStyle ?? 'bezier')
  const allLabels = useApp((s) => s.settings?.edgeLabels === 'always')
  const siblings = useCanvas((s) => s.outDegree.get(source) ?? 0)
  // Libellé dû à la sélection (le lien ou l'une de ses extrémités), sauf quand elle est trop
  // grande. Booléen : seul un lien dont la réponse change est re-rendu.
  const bySelection = useCanvas(
    (s) => s.selected.size <= LABEL_MAX_SELECTED && (!!selected || s.selected.has(source) || s.selected.has(target))
  )
  // Faible zoom : libellés illisibles, donc omis.
  const low = useLowZoom()
  // Estompé et chemin mis en évidence écrits dans le DOM sans re-rendu ; seuls les liens qui
  // entrent sur le chemin ou en sortent sont re-rendus, pour leur libellé (voir useEdgeDecor).
  const { ref: group, extraRef: labelRef, onPath } = useEdgeDecor(id, source, target)
  const edge = data?.edge
  const params = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }
  const [path, labelX, labelY] =
    style === 'straight' ? getStraightPath(params) : style === 'smoothstep' ? getSmoothStepPath({ ...params, borderRadius: 10 }) : getBezierPath(params)
  const color = selected ? 'var(--accent)' : (edge?.style.color ?? 'var(--edge)')

  return (
    <>
      <g ref={group}>
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
      </g>
      {edge?.label && !low && (allLabels || siblings <= LABEL_MAX_SIBLINGS || bySelection || onPath) && (
        <EdgeLabelRenderer>
          <div
            ref={labelRef}
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
