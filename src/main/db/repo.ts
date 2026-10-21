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
  PropValue
} from '@shared/types'
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

/** Clé de dédoublonnage : deux entités de même type, plateforme et libellé normalisé sont identiques. */
export function dedupKey(type: string, label: string, platform?: string | null): string {
  let l = label.trim().toLowerCase()
  if (type === 'phone') l = l.replace(/[^\d+]/g, '')
  if (type === 'domain' || type === 'website' || type === 'url') l = l.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  if (type === 'username' || type === 'account') l = l.replace(/^@/, '')
  return `${type}|${platform ?? ''}|${l}`
}

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

  getNode(id: string): GraphNode | null {
    const r = this.db.prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL').get(id) as NodeRow | undefined
    return r ? toNode(r) : null
  }

  getNodes(ids: string[]): GraphNode[] {
    return ids.map((id) => this.getNode(id)).filter((n): n is GraphNode => n !== null)
  }

  findNodeByDedup(investigationId: string, key: string): GraphNode | null {
    const r = this.db
      .prepare('SELECT * FROM nodes WHERE investigation_id = ? AND dedup_key = ? AND deleted_at IS NULL LIMIT 1')
      .get(investigationId, key) as NodeRow | undefined
    return r ? toNode(r) : null
  }

  upsertNodes(investigationId: string, inputs: NodeInput[]): GraphNode[] {
    const t = now()
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
    const out: GraphNode[] = []
    this.db.transaction(() => {
      for (const input of inputs) {
        const existing = input.id ? this.getNode(input.id) : null
        const merged: GraphNode = {
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
          dedup_key: merged.kind === 'entity' ? dedupKey(merged.type, merged.label, merged.platform) : null,
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

  upsertEdges(investigationId: string, inputs: EdgeInput[]): GraphEdge[] {
    const t = now()
    const out: GraphEdge[] = []
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
        const existing = input.id ? this.getEdge(input.id) : null
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
    const rows = (
      nodeId
        ? this.db
            .prepare(
              'SELECT * FROM module_runs WHERE investigation_id = ? AND node_id = ? ORDER BY started_at DESC, rowid DESC'
            )
            .all(investigationId, nodeId)
        : this.db
            .prepare('SELECT * FROM module_runs WHERE investigation_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 2000')
            .all(investigationId)
    ) as Array<{
      id: string
      investigation_id: string
      node_id: string
      module_id: string
      job_id: string
      status: string
      found: number | null
      result_count: number
      error: string | null
      started_at: number | null
      finished_at: number | null
    }>
    return rows.map((r) => ({
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
    }))
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
