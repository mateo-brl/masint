// Journal d'activité : qui a créé, modifié, supprimé, fusionné, validé, capturé, exporté ou
// partagé quoi, et quand. Chaque entrée est scellée par l'empreinte de la précédente
// (`hash = sha256(prev_hash + JSON canonique de l'entrée)`), chaîne propre à chaque enquête :
// modifier, retirer ou intercaler une entrée rompt la chaîne à cet endroit.
//
// L'empreinte ne couvre ni l'identifiant de la ligne ni celui de l'enquête : ils sont régénérés
// à l'import d'une archive, et le journal importé se vérifie alors tel quel.
//
// Pas de bruit : un déplacement de nœud ou un changement de vue n'est pas journalisé, et les
// modifications successives d'un même élément (saisie, curseur de couleur) sont regroupées en
// une entrée, écrite après quelques secondes de calme ou avant toute autre entrée de l'enquête.

import { createHash } from 'node:crypto'
import { userInfo } from 'node:os'
import type {
  ActivityAction,
  ActivityCheck,
  ActivityEdgeRef,
  ActivityEntry,
  ActivityNodeRef,
  ActivityTarget,
  EdgeInput,
  GraphEdge,
  GraphNode,
  NodeInput,
  Settings
} from '@shared/types'
import type { Repo } from './db/repo'

/** Empreinte précédant la première entrée d'une chaîne. */
export const GENESIS_HASH = '0'.repeat(64)

/** Éléments listés par entrée ; au-delà, seul leur nombre est gardé (`count`). */
const MAX_REFS = 10
const MAX_LABEL = 120
/** Calme après lequel des modifications regroupées sont écrites. */
const QUIET_MS = 4000
/** Une saisie continue est écrite au moins une fois par minute. */
const MAX_PENDING_MS = 60_000

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** JSON canonique : clés triées à toute profondeur, sans espaces, valeurs `undefined` omises. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k]
        if (x !== undefined) out[k] = sort(x)
      }
      return out
    }
    return v
  }
  return JSON.stringify(sort(value)) ?? 'null'
}

/** Contenu scellé d'une entrée. */
export type ActivitySealed = Pick<ActivityEntry, 'seq' | 'at' | 'actor' | 'action' | 'target'>

export function activityHash(prevHash: string, e: ActivitySealed): string {
  return sha256(prevHash + canonicalJson({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, target: e.target }))
}

/**
 * Recalcule la chaîne (entrées dans l'ordre des rangs) et renvoie la première entrée altérée :
 * rang manquant ou en double, maillon qui ne reprend pas l'empreinte précédente, empreinte
 * recalculée différente.
 */
export function verifyActivity(entries: ActivityEntry[]): ActivityCheck {
  let prev = GENESIS_HASH
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const broken = (reason: 'hash' | 'link' | 'order'): ActivityCheck => ({
      ok: false,
      count: entries.length,
      lastHash: entries[entries.length - 1].hash,
      broken: { seq: e.seq, id: e.id, at: e.at, action: e.action, reason }
    })
    if (e.seq !== i + 1) return broken('order')
    if (e.prevHash !== prev) return broken('link')
    if (activityHash(e.prevHash, e) !== e.hash) return broken('hash')
    prev = e.hash
  }
  return { ok: true, count: entries.length, lastHash: entries.length ? prev : null }
}

/** Enquêteur inscrit au journal : réglage « Nom de l'enquêteur », sinon nom de session du système. */
export function actorName(s: Pick<Settings, 'investigatorName'>): string {
  return s.investigatorName?.trim() || systemUser()
}

export function systemUser(): string {
  try {
    return userInfo().username || 'inconnu'
  } catch {
    return 'inconnu'
  }
}

const short = (s: string): string => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s)

export function nodeRef(n: Pick<GraphNode, 'id' | 'type' | 'label'>): ActivityNodeRef {
  return { id: n.id, type: n.type, label: short(n.label ?? '') }
}

/** Liste courte de nœuds : dix au plus, avec le nombre total. */
export function nodeRefs(nodes: Array<Pick<GraphNode, 'id' | 'type' | 'label'>>): Pick<ActivityTarget, 'nodes' | 'count'> {
  return { nodes: nodes.slice(0, MAX_REFS).map(nodeRef), count: nodes.length }
}

export function edgeRefs(edges: GraphEdge[], labelOf: (nodeId: string) => string): Pick<ActivityTarget, 'edges' | 'count'> {
  const refs: ActivityEdgeRef[] = edges.slice(0, MAX_REFS).map((e) => ({ id: e.id, from: short(labelOf(e.source)), to: short(labelOf(e.target)), label: short(e.label) }))
  return { edges: refs, count: edges.length }
}

/** Champs de mise en page : leur changement n'est pas une modification de l'enquête. */
const LAYOUT_FIELDS = new Set(['id', 'x', 'y', 'width', 'height'])

/** Patch qui ne fait que déplacer ou redimensionner (fin de glissement sur le canevas). */
export function isLayoutOnly(input: object): boolean {
  return Object.keys(input).every((k) => LAYOUT_FIELDS.has(k))
}

const differs = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) !== canonicalJson(b ?? null)

/** Champs réellement modifiés par un patch de nœud, hors position et taille. */
export function changedNodeFields(before: GraphNode, input: NodeInput): string[] {
  const fields: Array<keyof GraphNode> = ['kind', 'type', 'label', 'platform', 'data', 'notes', 'imageId', 'style', 'source']
  return fields.filter((k) => k in input && (input as Record<string, unknown>)[k] !== undefined && differs(before[k], (input as Record<string, unknown>)[k]))
}

/** Champs réellement modifiés par un patch de lien. */
export function changedEdgeFields(before: GraphEdge, input: EdgeInput): string[] {
  const fields: Array<keyof GraphEdge> = ['source', 'target', 'label', 'data', 'style', 'sourceModule']
  return fields.filter((k) => k in input && (input as Record<string, unknown>)[k] !== undefined && differs(before[k], (input as Record<string, unknown>)[k]))
}

/** Écriture dans le journal, telle que le moteur la voit. */
export interface ActivityWriter {
  log(investigationId: string, action: ActivityAction, target: ActivityTarget): void
}

interface Pending {
  investigationId: string
  action: ActivityAction
  target: ActivityTarget
  fields: Set<string>
  /** Date de la première modification regroupée (date de l'entrée). */
  first: Date
  timer: ReturnType<typeof setTimeout> | null
}

export class ActivityLog implements ActivityWriter {
  private pending = new Map<string, Pending>()

  constructor(
    private readonly repo: Repo,
    private readonly actor: () => string,
    private readonly now: () => Date = () => new Date()
  ) {}

  /**
   * Inscrit une entrée. Les modifications en attente de l'enquête sont écrites avant, pour que
   * le journal suive l'ordre des actions. Une erreur d'écriture n'interrompt pas l'action.
   */
  log(investigationId: string, action: ActivityAction, target: ActivityTarget): ActivityEntry | null {
    this.flush(investigationId)
    return this.write(investigationId, action, target, this.now())
  }

  /**
   * Création ou modification regroupée : les appels qui visent les mêmes éléments s'ajoutent à
   * la même entrée. La modification d'un élément tout juste créé complète l'entrée de création
   * (libellé saisi juste après l'ajout d'un nœud).
   */
  group(
    investigationId: string,
    action: 'node.create' | 'node.update' | 'edge.create' | 'edge.update',
    target: ActivityTarget,
    fields: string[] = [],
    /** Tous les éléments visés (la cible n'en liste que dix). */
    allIds: string[] = (target.nodes ?? target.edges ?? []).map((r) => r.id)
  ): void {
    const ids = allIds
    if (!ids.length) return
    const kind = action.split('.')[0]
    const sameKey = `${investigationId}|${action}|${[...ids].sort().join(',')}`
    const createKey = `${investigationId}|${kind}.create|${[...ids].sort().join(',')}`
    const key = action.endsWith('.update') && this.pending.has(createKey) ? createKey : sameKey
    const existing = this.pending.get(key)
    if (existing) {
      // Libellés à jour ; les champs ne comptent que pour une modification.
      existing.target = { ...existing.target, nodes: target.nodes ?? existing.target.nodes, edges: target.edges ?? existing.target.edges }
      if (existing.action.endsWith('.update')) for (const f of fields) existing.fields.add(f)
      this.arm(existing, key)
      return
    }
    const item: Pending = { investigationId, action, target, fields: new Set(fields), first: this.now(), timer: null }
    this.pending.set(sameKey, item)
    this.arm(item, sameKey)
  }

  /** Écrit les entrées regroupées en attente (d'une enquête, ou de toutes). */
  flush(investigationId?: string): void {
    const due = Array.from(this.pending.entries())
      .filter(([, p]) => !investigationId || p.investigationId === investigationId)
      .sort((a, b) => a[1].first.getTime() - b[1].first.getTime())
    for (const [key, p] of due) {
      if (p.timer) clearTimeout(p.timer)
      this.pending.delete(key)
      const target = p.action.endsWith('.update') ? { ...p.target, fields: Array.from(p.fields).sort() } : p.target
      this.write(p.investigationId, p.action, target, p.first)
    }
  }

  /** Recalcule la chaîne d'une enquête, modifications en attente comprises. */
  verify(investigationId: string): ActivityCheck {
    this.flush(investigationId)
    return verifyActivity(this.repo.allActivity(investigationId))
  }

  /** Arrêt de l'application : tout est écrit, plus aucun minuteur. */
  dispose(): void {
    this.flush()
  }

  private arm(p: Pending, key: string): void {
    if (p.timer) clearTimeout(p.timer)
    const age = this.now().getTime() - p.first.getTime()
    const delay = Math.max(0, Math.min(QUIET_MS, MAX_PENDING_MS - age))
    p.timer = setTimeout(() => {
      if (this.pending.get(key) !== p) return
      this.pending.delete(key)
      p.timer = null
      // Entrées plus anciennes de la même enquête d'abord : l'ordre des dates reste croissant.
      this.flushBefore(p)
      const target = p.action.endsWith('.update') ? { ...p.target, fields: Array.from(p.fields).sort() } : p.target
      this.write(p.investigationId, p.action, target, p.first)
    }, delay)
    p.timer.unref?.()
  }

  private flushBefore(p: Pending): void {
    const older = Array.from(this.pending.entries())
      .filter(([, o]) => o.investigationId === p.investigationId && o.first.getTime() <= p.first.getTime())
      .sort((a, b) => a[1].first.getTime() - b[1].first.getTime())
    for (const [key, o] of older) {
      if (o.timer) clearTimeout(o.timer)
      this.pending.delete(key)
      const target = o.action.endsWith('.update') ? { ...o.target, fields: Array.from(o.fields).sort() } : o.target
      this.write(o.investigationId, o.action, target, o.first)
    }
  }

  private write(investigationId: string, action: ActivityAction, target: ActivityTarget, at: Date): ActivityEntry | null {
    try {
      if (!this.repo.db.open) return null
      return this.repo.appendActivity(investigationId, { at: at.toISOString(), actor: this.actor(), action, target })
    } catch (e) {
      // Enquête supprimée entre-temps, base fermée : l'action a eu lieu, le journal ne la bloque pas.
      console.error('[journal]', e instanceof Error ? e.message : e)
      return null
    }
  }
}
