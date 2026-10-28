import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { attachmentUrl } from '@shared/api'
import type { JobProgress } from '@shared/types'
import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import { CORROBORATION_BADGE_MIN } from '@shared/provenance'
import { nodeSubtitle } from '@shared/subtitle'
import { useLang } from '../../../lib/i18n'
import { EntityBadge, Icon } from '../../../lib/icons'
import { useApp } from '../../../store/app'
import { useCanvas, useLowZoom, useNodeDecor } from '../../../store/canvas'
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
    // Tâche en chaîne : les nœuds atteints qu'elle enrichit en ce moment aussi.
    ids = new Set(Object.values(jobs).filter((j) => !j.finished).flatMap((j) => [j.nodeId, ...(j.chain?.active ?? [])]))
    runningCache.set(jobs, ids)
  }
  return ids
}

function EntityNodeImpl({ data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  const n = data.node
  const { t } = useTranslation()
  const { tx } = useLang()
  const running = useApp((s) => runningNodes(s.jobs).has(n.id))
  // Sélecteur par nœud : seul ce nœud est redessiné quand son score de corroboration change.
  const sources = useGraph((s) => s.corroboration.nodes[n.id] ?? 0)
  const def = getEntityType(n.type)
  const platform = getPlatform(n.platform)
  const accent = n.style.color ?? platform?.color ?? def.color
  const width = SIZES[n.style.size ?? 'md']
  const kicker = platform && def.keepTypeIcon ? `${tx(def.label)} · ${platform.name}` : (platform?.name ?? tx(def.label))
  const subtitle = n.style.hideSubtitle ? '' : nodeSubtitle(n)
  // Chaque nœud ne lit que ses propres valeurs : il n'est re-rendu que si elles changent.
  const childCount = useCanvas((s) => s.outDegree.get(n.id) ?? 0)
  const reviewCount = useCanvas((s) => s.reviewCount.get(n.id) ?? 0)
  const hiddenCount = useCanvas((s) => s.collapsedCount.get(n.id) ?? 0)
  const dense = useCanvas((s) => s.dense)
  const low = useLowZoom()
  // Analyse et filtre (estompé, communauté, chemin mis en évidence) écrits dans le DOM sans
  // re-rendu ; autres enquêtes où l'entité apparaît (voir useNodeDecor).
  const { ref: root, seenElsewhere } = useNodeDecor(n.id)
  const box: React.CSSProperties = {
    width,
    minHeight: 38,
    background: n.style.bg ?? 'var(--node)',
    borderColor: selected ? 'var(--accent)' : n.style.color && n.imageId ? n.style.color : 'var(--node-border)',
    // Contour (communauté, chemin) plutôt qu'ombre : peu coûteux à dessiner, taille inchangée.
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
          <div className="text-[10px]">&nbsp;</div>
          <div className="relative text-[11.5px]">
            &nbsp;
            <span className="absolute left-0 h-[6px] w-4/5 rounded-full" style={{ top: 'calc(50% - 3px)', background: `${accent}99` }} />
          </div>
          {subtitle && <div className="text-[10px]">&nbsp;</div>}
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
        <div className="flex items-center gap-1">
          {/* 10 px au moins : en dessous, illisible au zoom 1 (plus petit, le nœud passe en mode réduit). */}
          <div className="min-w-0 flex-1 truncate text-[10px] font-medium" style={{ color: 'var(--muted)' }}>
            {kicker}
          </div>
          {sources >= CORROBORATION_BADGE_MIN && (
            <span
              className="shrink-0 rounded-[3px] border px-[3px] text-[10px] leading-[13px] font-semibold"
              style={{ borderColor: 'var(--node-border)', color: 'var(--muted)' }}
              title={t('provenance.seenBy', { count: sources })}
            >
              ×{sources}
            </span>
          )}
          {/* Autres enquêtes où l'entité apparaît (corrélation). */}
          {seenElsewhere > 0 && (
            <span
              className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold"
              style={{ color: 'var(--muted)' }}
              title={t('correlation.seenIn', { count: seenElsewhere })}
              aria-label={t('correlation.seenIn', { count: seenElsewhere })}
            >
              <Icon name="FolderSymlink" size={10} />
              {seenElsewhere}
            </span>
          )}
        </div>
        <div className={`truncate text-[11.5px] font-semibold ${n.label ? 'text-fg' : 'italic text-faint'}`}>{n.label || t('node.untitled')}</div>
        {subtitle && <div className="truncate text-[10px] text-muted">{subtitle}</div>}
      </div>
      {running && <span className="absolute -top-1 -left-1 h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: 'var(--warning)' }} />}
      {childCount > 0 && (
        <span
          className="absolute -top-2 -right-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-on-accent"
          style={{ background: 'var(--accent)' }}
        >
          {childCount}
        </span>
      )}
      {hiddenCount > 0 && (
        <button
          className="nodrag absolute -bottom-2.5 left-3 z-10 flex h-[18px] items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold text-fg hover:border-accent hover:text-accent"
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
          className="absolute -right-2 -bottom-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-on-warning"
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
