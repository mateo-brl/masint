import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { FlowNode } from '../../../store/graph'

// Emplacement réservé : implémenté par le canevas avancé (dessin libre).
function DrawingNodeImpl(_props: NodeProps<FlowNode>): React.JSX.Element {
  return <div />
}

export const DrawingNode = memo(DrawingNodeImpl)
