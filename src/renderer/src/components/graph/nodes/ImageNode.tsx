import { memo } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { attachmentUrl } from '@shared/api'
import type { FlowNode } from '../../../store/graph'

// Version minimale : remplacée par l'implémentation complète du canevas avancé.
function ImageNodeImpl({ data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  return (
    <div className="h-full w-full overflow-hidden rounded-lg border border-line bg-panel">
      <NodeResizer isVisible={selected} minWidth={60} minHeight={40} keepAspectRatio />
      {n.imageId && <img src={attachmentUrl(n.imageId)} alt="" draggable={false} className="h-full w-full object-cover" />}
    </div>
  )
}

export const ImageNode = memo(ImageNodeImpl)
