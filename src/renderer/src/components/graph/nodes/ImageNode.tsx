import { memo, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import { Icon } from '../../../lib/icons'
import { useGraph, type FlowNode } from '../../../store/graph'

/** Hauteur de la légende (texte + marges), utilisée pour ajuster les proportions. */
const CAPTION_H = 22
const PAD = 4

/** Photo posée sur le canevas, avec sa légende. */
function ImageNodeImpl({ id, data, selected, width }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  const { t } = useTranslation()
  const [failedId, setFailedId] = useState<string | null>(null)
  const failed = !!n.imageId && failedId === n.imageId
  const caption = n.label.trim()

  // Au premier chargement, la boîte prend les proportions réelles de l'image.
  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    if (typeof n.data.aspect === 'number') return
    const img = e.currentTarget
    if (!img.naturalWidth || !img.naturalHeight) return
    const aspect = Math.round((img.naturalWidth / img.naturalHeight) * 1000) / 1000
    const w = n.width ?? width ?? 260
    const frame = 2 * (PAD + 1)
    const h = Math.round((w - frame) / aspect + frame + (caption ? CAPTION_H : 0))
    void useGraph.getState().updateNode(id, { data: { ...n.data, aspect }, width: w, height: h })
  }

  return (
    <>
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-[10px] border transition-shadow"
        style={{
          padding: PAD,
          background: 'var(--node)',
          borderColor: selected ? 'var(--accent)' : (n.style.color ?? 'var(--node-border)'),
          borderWidth: n.style.color && !selected ? 2 : 1,
          boxShadow: selected ? '0 0 0 1px var(--accent), 0 8px 26px rgb(0 0 0 / .35)' : '0 4px 16px rgb(0 0 0 / .22)'
        }}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-[7px] bg-panel-2">
          {n.imageId && !failed ? (
            <img
              src={attachmentUrl(n.imageId)}
              alt={caption}
              draggable={false}
              onLoad={onLoad}
              onError={() => setFailedId(n.imageId)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-faint">
              <Icon name="ImageOff" size={22} />
              <span className="text-[10.5px]">{t('canvas2.imageMissing')}</span>
            </div>
          )}
        </div>
        {caption && (
          <div className="shrink-0 truncate px-1 text-[11px] text-muted" style={{ height: CAPTION_H, lineHeight: `${CAPTION_H}px` }} title={caption}>
            {caption}
          </div>
        )}
      </div>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={60} keepAspectRatio />
    </>
  )
}

export const ImageNode = memo(ImageNodeImpl)
