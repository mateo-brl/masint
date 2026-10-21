import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { FlowNode } from '../../../store/graph'

// Emplacement réservé : implémenté par le canevas avancé (mini-carte posée sur le canevas).
function MapNodeImpl({ data }: NodeProps<FlowNode>): React.JSX.Element {
  return <div className="h-full w-full rounded-lg border border-line bg-panel p-2 text-[11px] text-muted">{data.node.label}</div>
}

export const MapNode = memo(MapNodeImpl)
