import { createContext, memo, useContext } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import { nodeSubtitle } from '@shared/subtitle'
import { useLang } from '../../../lib/i18n'
import { EntityBadge } from '../../../lib/icons'
import { useApp } from '../../../store/app'
import { useGraph, type FlowNode } from '../../../store/graph'

const SIZES = { sm: 168, md: 196, lg: 240 }

/** Nombre de liens sortants par nœud, fourni par le canevas (pastille rouge). */
export const OutDegreeContext = createContext<Map<string, number>>(new Map())

/** Nombre de nœuds masqués sous chaque nœud replié (« Réduire »). */
export const CollapsedCountContext = createContext<Map<string, number>>(new Map())

/** Nombre de résultats à vérifier par nœud d'origine (pastille orange). */
export const ReviewCountContext = createContext<Map<string, number>>(new Map())

/** Nœuds sélectionnés : leurs liens affichent toujours leur libellé. */
export const SelectedNodesContext = createContext<Set<string>>(new Set())


function EntityNodeImpl({ data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  const { t } = useTranslation()
  const { tx } = useLang()
  const running = useApp((s) => Object.values(s.jobs).some((j) => j.nodeId === n.id && !j.finished))
  const def = getEntityType(n.type)
  const platform = getPlatform(n.platform)
  const accent = n.style.color ?? platform?.color ?? def.color
  const width = SIZES[n.style.size ?? 'md']
  const kicker = (platform && def.keepTypeIcon ? `${tx(def.label)} · ${platform.name}` : (platform?.name ?? tx(def.label))).toUpperCase()
  const subtitle = n.style.hideSubtitle ? '' : nodeSubtitle(n)
  const childCount = useContext(OutDegreeContext).get(n.id) ?? 0
  const reviewCount = useContext(ReviewCountContext).get(n.id) ?? 0
  const hiddenCount = useContext(CollapsedCountContext).get(n.id) ?? 0

  return (
    <div
      className="relative flex items-center gap-2 rounded-[7px] border px-1.5 py-1.5 transition-shadow"
      style={{
        width,
        minHeight: 38,
        background: n.style.bg ?? 'var(--node)',
        borderColor: selected ? 'var(--accent)' : n.style.color && n.imageId ? n.style.color : 'var(--node-border)',
        boxShadow: selected ? '0 0 0 1px var(--accent), 0 6px 24px rgb(0 0 0 / .35)' : '0 2px 10px rgb(0 0 0 / .25)'
      }}
    >
      <Handle type="target" position={Position.Top} />
      <EntityBadge
        type={n.type}
        platform={n.platform}
        imageUrl={n.imageId ? attachmentUrl(n.imageId) : null}
        size={n.style.size === 'lg' ? 30 : 26}
        color={n.style.color}
        icon={n.style.icon}
      />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[7.5px] font-semibold tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
          {kicker}
        </div>
        <div className={`truncate text-[11.5px] font-semibold ${n.label ? 'text-fg' : 'italic text-faint'}`}>{n.label || t('node.untitled')}</div>
        {subtitle && <div className="truncate text-[8.5px] text-muted">{subtitle}</div>}
      </div>
      {running && <span className="absolute -top-1 -left-1 h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: 'var(--warning)' }} />}
      {childCount > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[8.5px] font-bold text-white"
          style={{ background: 'var(--accent)' }}
        >
          {childCount}
        </span>
      )}
      {hiddenCount > 0 && (
        <button
          className="nodrag absolute -bottom-2.5 left-3 z-10 flex h-[17px] items-center gap-0.5 rounded-full border px-1.5 text-[9px] font-semibold text-fg hover:border-accent hover:text-accent"
          style={{ background: 'var(--panel)', borderColor: 'var(--node-border)' }}
          title={t('collapse.expand')}
          onClick={(e) => {
            e.stopPropagation()
            void useGraph.getState().updateNode(n.id, { style: { ...n.style, collapsed: false } })
          }}
        >
          +{hiddenCount}
        </button>
      )}
      {reviewCount > 0 && (
        <span
          className="absolute -right-1.5 -bottom-1.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[8.5px] font-bold text-black"
          style={{ background: 'var(--warning)' }}
          title={t('review.count', { count: reviewCount })}
        >
          {reviewCount}
        </span>
      )}
      <div className="absolute inset-y-1 left-0 w-[2px] rounded-full" style={{ background: accent, opacity: n.style.color ? 1 : 0 }} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export const EntityNode = memo(EntityNodeImpl)
