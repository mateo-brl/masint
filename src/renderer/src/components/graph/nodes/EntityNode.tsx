import { memo, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import type { JobProgress } from '@shared/types'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import { nodeSubtitle } from '@shared/subtitle'
import { useLang } from '../../../lib/i18n'
import { EntityBadge, Icon } from '../../../lib/icons'
import { useApp } from '../../../store/app'
import { useCanvas, useLowZoom, useNodeDecor, useOnPath } from '../../../store/canvas'
import { useCrossRefCount } from '../../../store/correlation'
import { useGraph, type FlowNode } from '../../../store/graph'

const SIZES = { sm: 168, md: 196, lg: 240 }

/**
 * Nœuds dont un enrichissement est en cours, calculés une fois par état des tâches et partagés
 * par tous les nœuds (au lieu de parcourir les tâches pour chacun à chaque mise à jour).
 */
const runningCache = new WeakMap<Record<string, JobProgress>, Set<string>>()
function runningNodes(jobs: Record<string, JobProgress>): Set<string> {
  let ids = runningCache.get(jobs)
  if (!ids) {
    ids = new Set(Object.values(jobs).filter((j) => !j.finished).map((j) => j.nodeId))
    runningCache.set(jobs, ids)
  }
  return ids
}

function EntityNodeImpl({ data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  const { t } = useTranslation()
  const { tx } = useLang()
  const running = useApp((s) => runningNodes(s.jobs).has(n.id))
  const def = getEntityType(n.type)
  const platform = getPlatform(n.platform)
  const accent = n.style.color ?? platform?.color ?? def.color
  const width = SIZES[n.style.size ?? 'md']
  const kicker = (platform && def.keepTypeIcon ? `${tx(def.label)} · ${platform.name}` : (platform?.name ?? tx(def.label))).toUpperCase()
  const subtitle = n.style.hideSubtitle ? '' : nodeSubtitle(n)
  // Chaque nœud ne lit que ses propres valeurs : il n'est re-rendu que si elles changent.
  const childCount = useCanvas((s) => s.outDegree.get(n.id) ?? 0)
  const reviewCount = useCanvas((s) => s.reviewCount.get(n.id) ?? 0)
  const hiddenCount = useCanvas((s) => s.collapsedCount.get(n.id) ?? 0)
  const dense = useCanvas((s) => s.dense)
  const low = useLowZoom()
  // Analyse et filtre : chemin mis en évidence (re-rendu des seuls nœuds du chemin) ; estompé et
  // couleur de communauté écrits dans le DOM sans re-rendu (voir useNodeDecor). Autres
  // enquêtes où l'entité apparaît.
  const root = useRef<HTMLDivElement>(null)
  const onPath = useOnPath(n.id)
  useNodeDecor(n.id, root)
  const seenElsewhere = useCrossRefCount(n.id)
  const box: React.CSSProperties = {
    width,
    minHeight: 38,
    background: n.style.bg ?? 'var(--node)',
    borderColor: selected || onPath ? 'var(--accent)' : n.style.color && n.imageId ? n.style.color : 'var(--node-border)',
    // Contour plutôt qu'ombre : peu coûteux à dessiner, n'altère pas la taille mesurée.
    ...(onPath ? { outline: '2px solid var(--accent)' } : {}),
    outlineOffset: 2,
    // L'ombre floue coûte cher à dessiner : simple contour sur les grands graphes et à faible zoom.
    boxShadow:
      dense || low
        ? selected
          ? '0 0 0 1px var(--accent)'
          : 'none'
        : selected
          ? '0 0 0 1px var(--accent), 0 6px 24px rgb(0 0 0 / .35)'
          : '0 2px 10px rgb(0 0 0 / .25)'
  }

  // Faible zoom : icône et pastille à la place du texte, sans badges. Les lignes gardent leur
  // hauteur pour que le nœud garde sa taille (pas de nouvelle mesure, liens inchangés).
  if (low)
    return (
      <div ref={root} className="relative flex items-center gap-2 rounded-[7px] border px-1.5 py-1.5" style={box}>
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
          <div className="text-[7.5px]">&nbsp;</div>
          <div className="relative text-[11.5px]">
            &nbsp;
            <span className="absolute left-0 h-[6px] w-4/5 rounded-full" style={{ top: 'calc(50% - 3px)', background: `${accent}99` }} />
          </div>
          {subtitle && <div className="text-[8.5px]">&nbsp;</div>}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    )

  return (
    <div ref={root} className="relative flex items-center gap-2 rounded-[7px] border px-1.5 py-1.5" style={box}>
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
        {seenElsewhere > 0 ? (
          // Pastille « vu dans N autres enquêtes » à droite du type ; ligne simple sinon (moins d'éléments).
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1 truncate text-[7.5px] font-semibold tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
              {kicker}
            </div>
            <span
              className="flex shrink-0 items-center gap-0.5 text-[7.5px] font-semibold"
              style={{ color: 'var(--muted)' }}
              title={t('correlation.seenIn', { count: seenElsewhere })}
              aria-label={t('correlation.seenIn', { count: seenElsewhere })}
            >
              <Icon name="FolderSymlink" size={8} />
              {seenElsewhere}
            </span>
          </div>
        ) : (
          <div className="truncate text-[7.5px] font-semibold tracking-[0.08em]" style={{ color: 'var(--muted)' }}>
            {kicker}
          </div>
        )}
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
      {/* Seulement si utile : même invisible (opacité nulle), l'élément coûte au dessin. */}
      {n.style.color && <div className="absolute inset-y-1 left-0 w-[2px] rounded-full" style={{ background: accent }} />}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export const EntityNode = memo(EntityNodeImpl)
