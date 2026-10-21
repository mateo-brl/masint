import { memo } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../../../store/graph'

// Version minimale : remplacée par l'implémentation complète du canevas avancé.
function TextNodeImpl({ data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  return (
    <div className="h-full w-full whitespace-pre-wrap p-1" style={{ color: n.style.color ?? 'var(--text)', fontSize: n.style.fontSize ?? 14 }}>
      <NodeResizer isVisible={selected} minWidth={60} minHeight={24} />
      {n.label}
    </div>
  )
}

export const TextNode = memo(TextNodeImpl)
