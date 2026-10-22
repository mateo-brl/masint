// Preuves et journal d'activité : règles partagées par le processus principal, l'interface et
// le rapport.

import { getPlatform } from './platforms'
import type { ActivityAction, ActivityEntry, GraphNode } from './types'

/** Types d'entités dont la page peut être capturée depuis la fiche. */
export const CAPTURABLE_TYPES = ['url', 'account']

/**
 * Page à capturer pour un nœud : URL d'un nœud `url`, profil d'un compte (champ `url`, sinon
 * adresse du profil sur sa plateforme). `null` si le nœud n'en a pas.
 */
export function captureUrlOf(node: Pick<GraphNode, 'kind' | 'type' | 'label' | 'platform' | 'data'>): string | null {
  if (node.kind !== 'entity' || !CAPTURABLE_TYPES.includes(node.type)) return null
  const web = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null)
  const direct = web(node.data?.url) ?? (node.type === 'url' ? web(node.label) : null)
  if (direct) return direct
  if (node.type === 'account') {
    const template = getPlatform(node.platform)?.url
    const user = typeof node.data?.username === 'string' && node.data.username.trim() ? node.data.username.trim() : node.label.trim()
    if (template && user && !/\s/.test(user)) return template.replace('{u}', encodeURIComponent(user.replace(/^@/, '')))
  }
  return null
}

/** Familles d'actions du journal, pour les filtres de la vue Journal. */
export const ACTIVITY_GROUPS: Record<'nodes' | 'edges' | 'modules' | 'review' | 'evidence' | 'sharing', ActivityAction[]> = {
  nodes: ['node.create', 'node.update', 'node.delete', 'node.merge'],
  edges: ['edge.create', 'edge.update', 'edge.delete'],
  modules: ['module.run'],
  review: ['suggestion.accept', 'suggestion.reject', 'suggestion.checked', 'suggestion.reopen'],
  evidence: ['capture.create'],
  sharing: ['investigation.create', 'investigation.duplicate', 'export.file', 'export.report', 'archive.export', 'archive.import']
}

export type ActivityGroup = keyof typeof ACTIVITY_GROUPS

/** Champs dont la modification change l'identité d'un élément (valeur, type, extrémités). */
const IDENTITY_FIELDS = new Set(['label', 'type', 'platform', 'kind', 'source', 'target'])

/**
 * Action significative (chapitre « Journal » du rapport) : tout sauf les modifications de
 * présentation ou de détail (style, notes, propriétés, image), qui restent dans le journal.
 */
export function isSignificantActivity(e: Pick<ActivityEntry, 'action' | 'target'>): boolean {
  if (e.action !== 'node.update' && e.action !== 'edge.update') return true
  return (e.target.fields ?? []).some((f) => IDENTITY_FIELDS.has(f))
}

/** Mots traduits utilisés par `activityLine`. */
export interface ActivityWords {
  /** « {{count}} modules ». */
  modules: (count: number) => string
  /** « +{{count}} ». */
  more: (count: number) => string
  /** Libellé d'un champ modifié. */
  field: (key: string) => string
  /** Élément sans libellé. */
  untitled: string
  /** Module de suite lancé par le moteur. */
  followUp: string
  /** Modules lancés par enchaînement, à cette profondeur. */
  chain?: (depth: number) => string
  /** Liens supprimés avec des nœuds. */
  removedEdges: (count: number) => string
}

/**
 * Description d'une entrée en deux parties : `subject` (éléments visés, adresse, fichier) et
 * `detail` (champs, nombre de modules, empreinte...).
 */
export function activityLine(e: Pick<ActivityEntry, 'action' | 'target'>, w: ActivityWords): { subject: string; detail: string } {
  const t = e.target ?? {}
  const label = (s: string | undefined): string => (s && s.trim() ? s : w.untitled)
  const list = (labels: string[], count?: number): string => {
    const more = count && count > labels.length ? ` (${w.more(count - labels.length)})` : ''
    return labels.join(', ') + more
  }
  const nodes = t.nodes ? list(t.nodes.map((n) => label(n.label)), t.count) : ''
  const edges = t.edges ? list(t.edges.map((x) => `${label(x.from)} → ${label(x.to)}${x.label ? ` (${x.label})` : ''}`), t.count) : ''
  const shortHash = t.sha256 ? `SHA-256 ${t.sha256.slice(0, 16)}…` : ''
  const fields = t.fields?.length ? t.fields.map(w.field).join(', ') : ''
  switch (e.action) {
    case 'node.create':
    case 'node.delete':
      return { subject: nodes, detail: t.removedEdges ? w.removedEdges(t.removedEdges) : '' }
    case 'node.update':
      return { subject: nodes, detail: fields }
    case 'node.merge':
      return { subject: `${nodes} → ${label(t.into?.label)}`, detail: '' }
    case 'edge.create':
    case 'edge.delete':
      return { subject: edges, detail: '' }
    case 'edge.update':
      return { subject: edges, detail: fields }
    case 'module.run':
      return {
        subject: label(t.node?.label),
        detail: [w.modules(t.count ?? t.modules?.length ?? 0), t.followUp ? w.followUp : '', t.chain && w.chain ? w.chain(t.chain.depth) : ''].filter(Boolean).join(' · ')
      }
    case 'suggestion.accept':
    case 'suggestion.reject':
    case 'suggestion.checked':
    case 'suggestion.reopen':
      return { subject: `${label(t.value)}${t.found ? ` → ${t.found.label}` : ''}`, detail: [t.node ? label(t.node.label) : '', t.module ?? ''].filter(Boolean).join(' · ') }
    case 'capture.create':
      return { subject: t.finalUrl || t.url || '', detail: [t.node ? label(t.node.label) : '', shortHash].filter(Boolean).join(' · ') }
    case 'export.file':
    case 'export.report':
    case 'archive.export':
    case 'archive.import':
      return { subject: t.file || t.source?.name || '', detail: [t.kind ?? '', shortHash].filter(Boolean).join(' · ') }
    case 'investigation.create':
      return { subject: t.name ?? '', detail: '' }
    case 'investigation.duplicate':
      return { subject: t.copy?.name ?? t.source?.name ?? '', detail: '' }
  }
  return { subject: '', detail: '' }
}
