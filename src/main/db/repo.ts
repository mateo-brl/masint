import { createHash, randomUUID } from 'node:crypto'
import type {
  Attachment,
  EdgeInput,
  GraphEdge,
  GraphNode,
  Investigation,
  InvestigationBundle,
  ModuleRun,
  NodeInput,
  ModuleRunStats,
  PropValue,
  SavedNode,
  Suggestion,
  UpsertOptions
} from '@shared/types'
import { canonicalKey } from '@shared/canonical'
import type { DB } from './database'

const now = (): number => Date.now()
const parse = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

/**
 * Clé de dédoublonnage : deux entités de même type et de même valeur canonique sont identiques
 * (la plateforme ne compte que pour les comptes, pseudos et types sans règle). Voir `@shared/canonical`.
 */
export function dedupKey(type: string, label: string, platform?: string | null): string {
  return canonicalKey(type, label, platform)
}

/** Exécution archivée avec la réponse brute du service (JSON sérialisé). */
export type RunWithRaw = ModuleRun & { raw: string | null }

interface RunRow {
  id: string
  investigation_id: string
  node_id: string
  module_id: string
  job_id: string
  status: string
  found: number | null
  result_count: number
  error: string | null
  raw?: string | null
  started_at: number | null
  finished_at: number | null
}

const toRun = (r: RunRow): ModuleRun => ({
  id: r.id,
  investigationId: r.investigation_id,
  nodeId: r.node_id,
  moduleId: r.module_id,
  jobId: r.job_id,
  status: r.status as ModuleRun['status'],
  found: r.found === null ? null : r.found === 1,
  resultCount: r.result_count,
  error: r.error,
  startedAt: r.started_at,
  finishedAt: r.finished_at
})

interface NodeRow {
  id: string
  investigation_id: string
  kind: string
  type: string
  label: string
  platform: string | null
  data: string
  notes: string
  image_id: string | null
  x: number
  y: number
  width: number | null
  height: number | null
  style: string
  source: string
  created_at: number
  updated_at: number
}

interface EdgeRow {
  id: string
  investigation_id: string
  source: string
  target: string
  label: string
  data: string
  style: string
  source_module: string
  created_at: number
  updated_at: number
}

interface InvestigationRow {
  id: string
  name: string
  description: string
  color: string
  notes: string
  viewport: string | null
  created_at: number
  updated_at: number
  node_count?: number
  edge_count?: number
}

const toNode = (r: NodeRow): GraphNode => ({
  id: r.id,
  investigationId: r.investigation_id,
  kind: r.kind as GraphNode['kind'],
  type: r.type,
  label: r.label,
  platform: r.platform,
  data: parse(r.data, {}),
  notes: r.notes,
  imageId: r.image_id,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  style: parse(r.style, {}),
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toEdge = (r: EdgeRow): GraphEdge => ({
  id: r.id,
  investigationId: r.investigation_id,
  source: r.source,
  target: r.target,
  label: r.label,
  data: parse(r.data, {}),
  style: parse(r.style, {}),
  sourceModule: r.source_module,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toInvestigation = (r: InvestigationRow): Investigation => ({
  id: r.id,
  name: r.name,
  description: r.description,
  color: r.color,
  notes: r.notes,
  viewport: parse(r.viewport, null),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  nodeCount: r.node_count,
  edgeCount: r.edge_count
})

export class Repo {
  constructor(readonly db: DB) {}

  // -------------------------------------------------------------------------
  // Enquêtes

  listInvestigations(): Investigation[] {
    const rows = this.db
      .prepare(
        `SELECT i.*,
          (SELECT COUNT(*) FROM nodes n WHERE n.investigation_id = i.id AND n.deleted_at IS NULL) AS node_count,
          (SELECT COUNT(*) FROM edges e WHERE e.investigation_id = i.id AND e.deleted_at IS NULL) AS edge_count
        FROM investigations i WHERE i.deleted_at IS NULL ORDER BY i.updated_at DESC`
      )
      .all() as InvestigationRow[]
    return rows.map(toInvestigation)
  }

  getInvestigation(id: string): Investigation | null {
    const r = this.db.prepare('SELECT * FROM investigations WHERE id = ? AND deleted_at IS NULL').get(id) as
      | InvestigationRow
      | undefined
    return r ? toInvestigation(r) : null
  }

  createInvestigation(input: { id?: string; name: string; description?: string; color?: string; notes?: string; createdAt?: number }): Investigation {
    const t = now()
    const id = input.id ?? randomUUID()
    this.db
      .prepare(
        `INSERT INTO investigations (id, name, description, color, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.description ?? '', input.color ?? '#e5484d', input.notes ?? '', input.createdAt ?? t, t)
    return this.getInvestigation(id)!
  }

  updateInvestigation(
    id: string,
    patch: Partial<Pick<Investigation, 'name' | 'description' | 'color' | 'notes' | 'viewport'>>
  ): Investigation {
    const current = this.getInvestigation(id)
    if (!current) throw new Error(`Enquête introuvable : ${id}`)
    const next = { ...current, ...patch }
    this.db
      .prepare(
        `UPDATE investigations SET name = ?, description = ?, color = ?, notes = ?, viewport = ?, updated_at = ? WHERE id = ?`
      )
      .run(next.name, next.description, next.color, next.notes, next.viewport ? JSON.stringify(next.viewport) : null, now(), id)
    return this.getInvestigation(id)!
  }

  touchInvestigation(id: string): void {
    this.db.prepare('UPDATE investigations SET updated_at = ? WHERE id = ?').run(now(), id)
  }

  deleteInvestigation(id: string): void {
    this.db.prepare('DELETE FROM investigations WHERE id = ?').run(id)
  }

  getBundle(id: string): InvestigationBundle {
    const investigation = this.getInvestigation(id)
    if (!investigation) throw new Error(`Enquête introuvable : ${id}`)
    return { investigation, nodes: this.listNodes(id), edges: this.listEdges(id) }
  }

  // -------------------------------------------------------------------------
  // Nœuds

  listNodes(investigationId: string): GraphNode[] {
    return (
      this.db
        .prepare('SELECT * FROM nodes WHERE investigation_id = ? AND deleted_at IS NULL ORDER BY created_at')
        .all(investigationId) as NodeRow[]
    ).map(toNode)
  }

  /**
   * Emprises des nœuds d'une enquête (placement sans chevauchement), sans décoder les données.
   * Les dessins à main levée sont ignorés : un trait qui entoure un groupe ne bloque pas la place.
   */
  listNodeBoxes(investigationId: string): Array<{ id: string; x: number; y: number; width: number | null; height: number | null; style: GraphNode['style'] }> {
    const rows = this.db
      .prepare("SELECT id, x, y, width, height, style FROM nodes WHERE investigation_id = ? AND deleted_at IS NULL AND kind != 'drawing'")
      .all(investigationId) as Array<{ id: string; x: number; y: number; width: number | null; height: number | null; style: string }>
    return rows.map((r) => {
      let style: GraphNode['style'] = {}
      try {
        style = JSON.parse(r.style) as GraphNode['style']
      } catch {
        /* style illisible : taille par défaut */
      }
      return { ...r, style }
    })
  }

  getNode(id: string): GraphNode | null {
    const r = this.db.prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL').get(id) as NodeRow | undefined
    return r ? toNode(r) : null
  }

  getNodes(ids: string[]): GraphNode[] {
    return ids.map((id) => this.getNode(id)).filter((n): n is GraphNode => n !== null)
  }

  /** Entité de même clé ; la plus ancienne si plusieurs nœuds la partagent (doublons d'avant la migration). */
  findNodeByDedup(investigationId: string, key: string): GraphNode | null {
    const r = this.db
      .prepare('SELECT * FROM nodes WHERE investigation_id = ? AND dedup_key = ? AND deleted_at IS NULL ORDER BY created_at, rowid LIMIT 1')
      .get(investigationId, key) as NodeRow | undefined
    return r ? toNode(r) : null
  }

  /**
   * Enregistre des nœuds (création ou mise à jour). Une entité dont la valeur vient d'être
   * saisie ou modifiée et qui existe déjà dans l'enquête porte `duplicateOf` (identifiant de
   * l'entité déjà présente) : l'interface propose alors d'y aller ou de fusionner.
   */
  upsertNodes(investigationId: string, inputs: NodeInput[], opts: UpsertOptions = {}): SavedNode[] {
    const t = now()
    const findDuplicate = this.db.prepare(
      'SELECT id FROM nodes WHERE investigation_id = ? AND dedup_key = ? AND id != ? AND deleted_at IS NULL ORDER BY created_at, rowid LIMIT 1'
    )
    const insert = this.db.prepare(
      `INSERT INTO nodes (id, investigation_id, kind, type, label, platform, data, notes, image_id, x, y, width, height, style, source, dedup_key, created_at, updated_at)
       VALUES (@id, @investigation_id, @kind, @type, @label, @platform, @data, @notes, @image_id, @x, @y, @width, @height, @style, @source, @dedup_key, @created_at, @updated_at)`
    )
    const update = this.db.prepare(
      `UPDATE nodes SET kind = @kind, type = @type, label = @label, platform = @platform, data = @data, notes = @notes,
         image_id = @image_id, x = @x, y = @y, width = @width, height = @height, style = @style, source = @source,
         dedup_key = @dedup_key, updated_at = @updated_at
       WHERE id = @id AND investigation_id = @investigation_id`
    )
    const out: SavedNode[] = []
    this.db.transaction(() => {
      for (const input of inputs) {
        const found = input.id ? this.getNode(input.id) : null
        const existing = found && found.investigationId === investigationId ? found : null
        // Patch vers un nœud supprimé ou fusionné (annulation tardive...) : ignoré, sans recréer de nœud.
        if (opts.updateOnly && !existing) continue
        const merged: SavedNode = {
          id: existing?.id ?? input.id ?? randomUUID(),
          investigationId,
          kind: input.kind ?? existing?.kind ?? 'entity',
          type: input.type ?? existing?.type ?? 'keyword',
          label: input.label ?? existing?.label ?? '',
          platform: input.platform !== undefined ? input.platform : (existing?.platform ?? null),
          data: input.data ?? existing?.data ?? {},
          notes: input.notes ?? existing?.notes ?? '',
          imageId: input.imageId !== undefined ? input.imageId : (existing?.imageId ?? null),
          x: input.x ?? existing?.x ?? 0,
          y: input.y ?? existing?.y ?? 0,
          width: input.width !== undefined ? input.width : (existing?.width ?? null),
          height: input.height !== undefined ? input.height : (existing?.height ?? null),
          style: input.style ?? existing?.style ?? {},
          source: input.source ?? existing?.source ?? 'manual',
          createdAt: existing?.createdAt ?? t,
          updatedAt: t
        }
        const key = merged.kind === 'entity' ? dedupKey(merged.type, merged.label, merged.platform) : null
        const row = {
          id: merged.id,
          investigation_id: investigationId,
          kind: merged.kind,
          type: merged.type,
          label: merged.label,
          platform: merged.platform,
          data: JSON.stringify(merged.data),
          notes: merged.notes,
          image_id: merged.imageId,
          x: merged.x,
          y: merged.y,
          width: merged.width,
          height: merged.height,
          style: JSON.stringify(merged.style),
          source: merged.source,
          dedup_key: key,
          created_at: merged.createdAt,
          updated_at: t
        }
        if (existing) update.run(row)
        else insert.run(row)
        // Valeur nouvelle ou modifiée déjà présente sous un autre nœud : signalée, jamais fusionnée d'office.
        const identityChanged = !existing || dedupKey(existing.type, existing.label, existing.platform) !== key || existing.kind !== 'entity'
        if (key && merged.label.trim() && identityChanged) {
          const dup = findDuplicate.get(investigationId, key, merged.id) as { id: string } | undefined
          if (dup) merged.duplicateOf = dup.id
        }
        out.push(merged)
      }
      this.touchInvestigation(investigationId)
    })()
    return out
  }

  /** Fusionne des propriétés dans un nœud sans écraser les valeurs existantes non vides. */
  mergeNodeData(id: string, props: Record<string, PropValue>, overwrite = true): GraphNode | null {
    const node = this.getNode(id)
    if (!node) return null
    const data = { ...node.data }
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v) && Array.isArray(data[k])) {
        data[k] = Array.from(new Set([...(data[k] as string[]), ...(v as string[])]))
      } else if (overwrite || data[k] === undefined || data[k] === null || data[k] === '') {
        data[k] = v
      }
    }
    return this.upsertNodes(node.investigationId, [{ id, data }])[0]
  }

  deleteNodes(investigationId: string, ids: string[]): string[] {
    if (!ids.length) return []
    const deletedEdges: string[] = []
    this.db.transaction(() => {
      const delNode = this.db.prepare('DELETE FROM nodes WHERE id = ? AND investigation_id = ?')
      const findEdges = this.db.prepare('SELECT id FROM edges WHERE investigation_id = ? AND (source = ? OR target = ?)')
      const delEdge = this.db.prepare('DELETE FROM edges WHERE id = ?')
      for (const id of ids) {
        for (const e of findEdges.all(investigationId, id, id) as { id: string }[]) {
          delEdge.run(e.id)
          deletedEdges.push(e.id)
        }
        delNode.run(id, investigationId)
      }
      this.touchInvestigation(investigationId)
    })()
    return deletedEdges
  }

  // -------------------------------------------------------------------------
  // Liens

  listEdges(investigationId: string): GraphEdge[] {
    return (
      this.db
        .prepare('SELECT * FROM edges WHERE investigation_id = ? AND deleted_at IS NULL ORDER BY created_at')
        .all(investigationId) as EdgeRow[]
    ).map(toEdge)
  }

  getEdge(id: string): GraphEdge | null {
    const r = this.db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as EdgeRow | undefined
    return r ? toEdge(r) : null
  }

  findEdge(investigationId: string, source: string, target: string): GraphEdge | null {
    const r = this.db
      .prepare(
        'SELECT * FROM edges WHERE investigation_id = ? AND ((source = ? AND target = ?) OR (source = ? AND target = ?)) LIMIT 1'
      )
      .get(investigationId, source, target, target, source) as EdgeRow | undefined
    return r ? toEdge(r) : null
  }

  /**
   * Enregistre des liens. Un lien n'est jamais créé vers un nœud absent ou supprimé (il resterait
   * invisible et orphelin) ; en mise à jour seule, un lien absent est ignoré.
   */
  upsertEdges(investigationId: string, inputs: EdgeInput[], opts: UpsertOptions = {}): GraphEdge[] {
    const t = now()
    const out: GraphEdge[] = []
    const nodeExists = this.db.prepare('SELECT 1 FROM nodes WHERE id = ? AND investigation_id = ? AND deleted_at IS NULL')
    const insert = this.db.prepare(
      `INSERT INTO edges (id, investigation_id, source, target, label, data, style, source_module, created_at, updated_at)
       VALUES (@id, @investigation_id, @source, @target, @label, @data, @style, @source_module, @created_at, @updated_at)`
    )
    const update = this.db.prepare(
      `UPDATE edges SET source = @source, target = @target, label = @label, data = @data, style = @style,
         source_module = @source_module, updated_at = @updated_at WHERE id = @id AND investigation_id = @investigation_id`
    )
    this.db.transaction(() => {
      for (const input of inputs) {
        const found = input.id ? this.getEdge(input.id) : null
        const existing = found && found.investigationId === investigationId ? found : null
        if (opts.updateOnly && !existing) continue
        const merged: GraphEdge = {
          id: existing?.id ?? input.id ?? randomUUID(),
          investigationId,
          source: input.source ?? existing?.source,
          target: input.target ?? existing?.target,
          label: input.label ?? existing?.label ?? '',
          data: input.data ?? existing?.data ?? {},
          style: input.style ?? existing?.style ?? {},
          sourceModule: input.sourceModule ?? existing?.sourceModule ?? 'manual',
          createdAt: existing?.createdAt ?? t,
          updatedAt: t
        }
        if (!nodeExists.get(merged.source, investigationId) || !nodeExists.get(merged.target, investigationId)) continue
        const row = {
          id: merged.id,
          investigation_id: investigationId,
          source: merged.source,
          target: merged.target,
          label: merged.label,
          data: JSON.stringify(merged.data),
          style: JSON.stringify(merged.style),
          source_module: merged.sourceModule,
          created_at: merged.createdAt,
          updated_at: t
        }
        if (existing) update.run(row)
        else insert.run(row)
        out.push(merged)
      }
      this.touchInvestigation(investigationId)
    })()
    return out
  }

  deleteEdges(investigationId: string, ids: string[]): void {
    const del = this.db.prepare('DELETE FROM edges WHERE id = ? AND investigation_id = ?')
    this.db.transaction(() => {
      for (const id of ids) del.run(id, investigationId)
      this.touchInvestigation(investigationId)
    })()
  }

  // -------------------------------------------------------------------------
  // Pièces jointes

  addAttachment(
    investigationId: string,
    file: { name: string; mime: string; data: Buffer; origin?: string | null; id?: string; createdAt?: number }
  ): Attachment {
    const sha256 = createHash('sha256').update(file.data).digest('hex')
    const dup = this.db
      .prepare('SELECT id FROM attachments WHERE investigation_id = ? AND sha256 = ? LIMIT 1')
      .get(investigationId, sha256) as { id: string } | undefined
    if (dup) return this.getAttachment(dup.id)!
    const id = file.id ?? randomUUID()
    this.db
      .prepare(
        `INSERT INTO attachments (id, investigation_id, name, mime, size, sha256, origin, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, investigationId, file.name, file.mime, file.data.length, sha256, file.origin ?? null, file.data, file.createdAt ?? now())
    return this.getAttachment(id)!
  }

  getAttachment(id: string): Attachment | null {
    const r = this.db
      .prepare('SELECT id, investigation_id, name, mime, size, sha256, origin, created_at FROM attachments WHERE id = ?')
      .get(id) as
      | {
          id: string
          investigation_id: string
          name: string
          mime: string
          size: number
          sha256: string
          origin: string | null
          created_at: number
        }
      | undefined
    if (!r) return null
    return {
      id: r.id,
      investigationId: r.investigation_id,
      name: r.name,
      mime: r.mime,
      size: r.size,
      sha256: r.sha256,
      origin: r.origin,
      createdAt: r.created_at
    }
  }

  listAttachments(investigationId: string): Attachment[] {
    const ids = this.db.prepare('SELECT id FROM attachments WHERE investigation_id = ?').all(investigationId) as { id: string }[]
    return ids.map((r) => this.getAttachment(r.id)!).filter(Boolean)
  }

  getAttachmentData(id: string): { mime: string; data: Buffer } | null {
    const r = this.db.prepare('SELECT mime, data FROM attachments WHERE id = ?').get(id) as
      | { mime: string; data: Buffer }
      | undefined
    return r ?? null
  }

  // -------------------------------------------------------------------------
  // Résultats à vérifier

  /**
   * Ajoute une suggestion, sauf si la même (même nœud, même valeur) existe déjà, quel que soit
   * son état : une suggestion rejetée n'est pas reproposée au prochain enrichissement.
   * Renvoie la suggestion créée, ou `null` si elle était déjà connue.
   */
  addSuggestion(
    s: Omit<Suggestion, 'id' | 'status' | 'createdAt' | 'updatedAt'>
  ): Suggestion | null {
    const key = s.kind === 'manual' ? (s.url ?? s.label).trim() : dedupKey(s.type, s.label, s.platform)
    const t = now()
    const id = randomUUID()
    const res = this.db
      .prepare(
        `INSERT OR IGNORE INTO suggestions (id, investigation_id, node_id, module_id, kind, type, label, platform, data, link_label, url, reason, status, dedup_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(id, s.investigationId, s.nodeId, s.moduleId, s.kind, s.type, s.label, s.platform, JSON.stringify(s.data ?? {}), s.linkLabel, s.url, s.reason, key, t, t)
    return res.changes ? this.getSuggestion(id) : null
  }

  getSuggestion(id: string): Suggestion | null {
    const r = this.db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as SuggestionRow | undefined
    return r ? toSuggestion(r) : null
  }

  /** Suggestions d'une enquête (ou d'un nœud), dont le nœud d'origine existe encore. */
  listSuggestions(investigationId: string, nodeId?: string): Suggestion[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM suggestions s JOIN nodes n ON n.id = s.node_id AND n.deleted_at IS NULL
         WHERE s.investigation_id = ? ${nodeId ? 'AND s.node_id = ?' : ''} ORDER BY s.created_at`
      )
      .all(...(nodeId ? [investigationId, nodeId] : [investigationId])) as SuggestionRow[]
    return rows.map(toSuggestion)
  }

  setSuggestionStatus(id: string, status: Suggestion['status']): Suggestion | null {
    this.db.prepare('UPDATE suggestions SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
    return this.getSuggestion(id)
  }

  /** Remet à l'état « à vérifier » les suggestions écartées d'un nœud (nouvel examen). */
  resetSuggestions(investigationId: string, nodeId: string): void {
    this.db
      .prepare("UPDATE suggestions SET status = 'pending', updated_at = ? WHERE investigation_id = ? AND node_id = ? AND status IN ('rejected', 'checked')")
      .run(now(), investigationId, nodeId)
  }

  // Exécutions de modules

  insertRun(run: ModuleRun): void {
    this.db
      .prepare(
        `INSERT INTO module_runs (id, investigation_id, node_id, module_id, job_id, status, found, result_count, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        run.id,
        run.investigationId,
        run.nodeId,
        run.moduleId,
        run.jobId,
        run.status,
        run.found === null ? null : run.found ? 1 : 0,
        run.resultCount,
        run.error,
        run.startedAt,
        run.finishedAt
      )
  }

  updateRun(id: string, patch: Partial<ModuleRun> & { raw?: string | null }): void {
    const sets: string[] = []
    const values: unknown[] = []
    const map: Record<string, string> = {
      status: 'status',
      found: 'found',
      resultCount: 'result_count',
      error: 'error',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
      raw: 'raw'
    }
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`)
        const v = (patch as Record<string, unknown>)[k]
        values.push(k === 'found' ? (v === null || v === undefined ? null : v ? 1 : 0) : v)
      }
    }
    if (!sets.length) return
    this.db.prepare(`UPDATE module_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  listRuns(investigationId: string, nodeId?: string): ModuleRun[] {
    // La réponse brute (`raw`, jusqu'à 200 ko par exécution) n'est pas lue ici.
    const cols = 'id, investigation_id, node_id, module_id, job_id, status, found, result_count, error, started_at, finished_at'
    const rows = (
      nodeId
        ? this.db
            .prepare(`SELECT ${cols} FROM module_runs WHERE investigation_id = ? AND node_id = ? ORDER BY started_at DESC, rowid DESC`)
            .all(investigationId, nodeId)
        : this.db
            .prepare(`SELECT ${cols} FROM module_runs WHERE investigation_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 2000`)
            .all(investigationId)
    ) as RunRow[]
    return rows.map(toRun)
  }

  /**
   * Exécutions à archiver, réponse brute comprise : seulement celles des nœuds encore présents
   * (les réponses obtenues sur un nœud supprimé ne doivent pas quitter le poste).
   */
  listRunsForArchive(investigationId: string): RunWithRaw[] {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM module_runs r JOIN nodes n ON n.id = r.node_id AND n.investigation_id = r.investigation_id AND n.deleted_at IS NULL
         WHERE r.investigation_id = ? ORDER BY r.started_at, r.rowid`
      )
      .all(investigationId) as RunRow[]
    return rows.map((r) => ({ ...toRun(r), raw: r.raw ?? null }))
  }

  /**
   * Statistiques par module (exécutions, résultats, erreurs) calculées en base, sans la limite
   * de `listRuns` : seules les exécutions des nœuds encore présents comptent, comme dans l'archive.
   */
  runStats(investigationId: string): ModuleRunStats[] {
    const rows = this.db
      .prepare(
        `SELECT r.module_id AS moduleId, COUNT(*) AS runs, COALESCE(SUM(r.result_count), 0) AS results,
           SUM(CASE WHEN r.status = 'error' THEN 1 ELSE 0 END) AS errors
         FROM module_runs r JOIN nodes n ON n.id = r.node_id AND n.investigation_id = r.investigation_id AND n.deleted_at IS NULL
         WHERE r.investigation_id = ? GROUP BY r.module_id ORDER BY r.module_id`
      )
      .all(investigationId) as ModuleRunStats[]
    return rows
  }

  /**
   * Fusion : les exécutions et résultats à vérifier des nœuds absorbés passent sur la cible,
   * pour que les sources du rapport et les suggestions en attente ne se perdent pas.
   */
  reassignNodeHistory(investigationId: string, fromIds: string[], toId: string): void {
    const runs = this.db.prepare('UPDATE module_runs SET node_id = ? WHERE investigation_id = ? AND node_id = ?')
    // Suggestion déjà connue sur la cible (même valeur) : la plus ancienne est gardée.
    const sugg = this.db.prepare('UPDATE OR IGNORE suggestions SET node_id = ? WHERE investigation_id = ? AND node_id = ?')
    this.db.transaction(() => {
      for (const id of fromIds) {
        if (id === toId) continue
        runs.run(toId, investigationId, id)
        sugg.run(toId, investigationId, id)
      }
    })()
  }

  /** Ajoute une exécution reprise d'une archive, avec sa réponse brute. */
  importRun(run: ModuleRun, raw: string | null): void {
    this.insertRun(run)
    if (raw !== null) this.updateRun(run.id, { raw })
  }

  getRunRaw(id: string): unknown {
    const r = this.db.prepare('SELECT raw FROM module_runs WHERE id = ?').get(id) as { raw: string | null } | undefined
    return parse(r?.raw, null)
  }

  // -------------------------------------------------------------------------
  // Paramètres et secrets

  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return r ? parse<T>(r.value, fallback) : fallback
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  getSecret(id: string): { value: Buffer; encrypted: boolean } | null {
    const r = this.db.prepare('SELECT value, encrypted FROM secrets WHERE id = ?').get(id) as
      | { value: Buffer; encrypted: number }
      | undefined
    return r ? { value: r.value, encrypted: r.encrypted === 1 } : null
  }

  setSecret(id: string, value: Buffer, encrypted: boolean): void {
    this.db
      .prepare(
        `INSERT INTO secrets (id, value, encrypted, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, updated_at = excluded.updated_at`
      )
      .run(id, value, encrypted ? 1 : 0, now())
  }

  deleteSecret(id: string): void {
    this.db.prepare('DELETE FROM secrets WHERE id = ?').run(id)
  }

  listSecretIds(): string[] {
    return (this.db.prepare('SELECT id FROM secrets').all() as { id: string }[]).map((r) => r.id)
  }
}

interface SuggestionRow {
  id: string
  investigation_id: string
  node_id: string
  module_id: string
  kind: string
  type: string
  label: string
  platform: string | null
  data: string
  link_label: string
  url: string | null
  reason: string
  status: string
  created_at: number
  updated_at: number
}

function toSuggestion(r: SuggestionRow): Suggestion {
  return {
    id: r.id,
    investigationId: r.investigation_id,
    nodeId: r.node_id,
    moduleId: r.module_id,
    kind: r.kind === 'manual' ? 'manual' : 'entity',
    type: r.type,
    label: r.label,
    platform: r.platform,
    data: parse(r.data, {}),
    linkLabel: r.link_label,
    url: r.url,
    reason: r.reason,
    status: r.status as Suggestion['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}
