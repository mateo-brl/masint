import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { getEntityType } from '@shared/entityTypes'
import { useLang } from '../../../lib/i18n'
import { EntityBadge, Icon } from '../../../lib/icons'
import { useCanvas } from '../../../store/canvas'
import { useGraph, type FlowNode } from '../../../store/graph'
import { useView } from '../../../store/view'

/**
 * Index des nœuds par identifiant, construit une fois par version de la liste et partagé par
 * tous les groupes (au lieu de parcourir tous les nœuds pour chaque groupe à chaque image).
 */
const indexes = new WeakMap<FlowNode[], Map<string, FlowNode>>()
function nodeIndex(nodes: FlowNode[]): Map<string, FlowNode> {
  let m = indexes.get(nodes)
  if (!m) indexes.set(nodes, (m = new Map(nodes.map((n) => [n.id, n]))))
  return m
}

/** Groupe de feuilles semblables (« 28 sous-domaines ») : un clic sur « Déplier » les montre. */
function BundleNodeImpl({ data, selected }: NodeProps<FlowNode>): React.JSX.Element | null {
  const { t } = useTranslation()
  const { tx } = useLang()
  const bundle = data.bundle
  const preview = useGraph((s) => {
    if (!bundle) return ''
    const byId = nodeIndex(s.nodes)
    const labels: string[] = []
    for (const id of bundle.members) {
      if (labels.length >= 3) break
      const n = byId.get(id)
      if (n) labels.push(n.data.node.label)
    }
    return labels.join(', ')
  })
  // Estompé hors du chemin mis en évidence, ou quand le filtre estompe tous ses membres.
  const dimmed = useCanvas((s) => !!bundle && (s.focus ? true : s.dimmed.size > 0 && bundle.members.every((m) => s.dimmed.has(m))))
  if (!bundle) return null
  const def = getEntityType(bundle.type)
  return (
    <div
      className="relative flex w-[212px] items-center gap-2 rounded-[9px] border border-dashed px-2 py-1.5"
      style={{
        opacity: dimmed ? 0.2 : undefined,
        background: 'var(--node)',
        borderColor: selected ? 'var(--accent)' : 'var(--node-border)',
        boxShadow: selected ? '0 0 0 1px var(--accent), 0 6px 24px rgb(0 0 0 / .35)' : '0 2px 10px rgb(0 0 0 / .25), 4px 4px 0 -1px var(--node), 4px 4px 0 0 var(--node-border)'
      }}
    >
      <Handle type="target" position={Position.Top} />
      <EntityBadge type={bundle.type} platform={bundle.platform} size={26} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[7.5px] font-semibold tracking-[0.08em] uppercase" style={{ color: 'var(--muted)' }}>
          {bundle.linkLabel || tx(def.label)}
        </div>
        <div className="truncate text-[11.5px] font-semibold">
          {t('bundle.count', { count: bundle.members.length, type: tx(def.label) })}
        </div>
        <div className="truncate text-[8.5px] text-muted">{preview}…</div>
      </div>
      <button
        className="nodrag flex h-6 items-center gap-1 rounded-md bg-panel-3 px-1.5 text-[10px] font-medium text-fg hover:bg-accent hover:text-white"
        onClick={(e) => {
          e.stopPropagation()
          void useView.getState().expandBundle(bundle.id)
        }}
        title={t('bundle.expand')}
        aria-label={t('bundle.expand')}
      >
        <Icon name="UnfoldVertical" size={11} />
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export const BundleNode = memo(BundleNodeImpl)
