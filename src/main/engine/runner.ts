import { randomUUID } from 'node:crypto'
import { emailProvider } from '@shared/platforms'
import type { InputEntity, ModuleContext, ModuleOutput, OsintModule } from '@shared/modules'
import type { GraphChange, GraphEdge, GraphNode, JobProgress, ModuleRun, PropValue } from '@shared/types'
import { dedupKey, type Repo } from '../db/repo'
import type { SettingsService } from '../settings'
import { createDohResolver, createFetch, jsonHelpers } from './http'
import { allModules, isConfigured } from './registry'

const MAX_RAW = 200_000
const MAX_IMAGE = 4 * 1024 * 1024
const MODULE_HARD_TIMEOUT = 180_000

export type Emit = <E extends 'graph:changed' | 'job:progress'>(
  event: E,
  payload: E extends 'graph:changed' ? GraphChange : JobProgress
) => void

interface Job {
  progress: JobProgress
  controller: AbortController
}

/** Modules applicables à un nœud. `explicit` inclut les modules « à la demande ». */
export function applicableModules(node: GraphNode, settings: SettingsService, explicit?: string[]): OsintModule[] {
  if (node.kind !== 'entity') return []
  const input = toInput(node)
  const disabled = new Set(settings.get().disabledModules)
  return allModules().filter((m) => {
    if (!m.inputTypes.includes(node.type) && !m.inputTypes.includes('*')) return false
    if (m.accepts && !m.accepts(input)) return false
    if (explicit) return explicit.includes(m.id) && isConfigured(m, settings)
    return !m.ondemand && !disabled.has(m.id) && isConfigured(m, settings)
  })
}

export function toInput(node: GraphNode): InputEntity {
  return { id: node.id, type: node.type, label: node.label, platform: node.platform, data: node.data, imageId: node.imageId }
}

function truncateRaw(raw: unknown): string | null {
  if (raw === undefined) return null
  try {
    const s = JSON.stringify(raw)
    return s.length > MAX_RAW ? JSON.stringify({ truncated: true, preview: s.slice(0, MAX_RAW) }) : s
  } catch {
    return null
  }
}

export class Engine {
  private jobs = new Map<string, Job>()

  constructor(
    private readonly repo: Repo,
    private readonly settings: SettingsService,
    private readonly emit: Emit
  ) {}

  listJobs(): JobProgress[] {
    return Array.from(this.jobs.values()).map((j) => j.progress)
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.progress.cancelled = true
    job.controller.abort()
  }

  enrich(investigationId: string, nodeId: string, moduleIds?: string[]): { jobId: string } {
    const node = this.repo.getNode(nodeId)
    if (!node || node.investigationId !== investigationId) throw new Error('Nœud introuvable')
    const modules = applicableModules(node, this.settings, moduleIds)
    const jobId = randomUUID()
    const job: Job = {
      controller: new AbortController(),
      progress: {
        jobId,
        investigationId,
        nodeId,
        nodeLabel: node.label,
        total: modules.length,
        done: 0,
        results: 0,
        errors: 0,
        running: [],
        finished: modules.length === 0,
        cancelled: false
      }
    }
    this.jobs.set(jobId, job)
    this.emit('job:progress', { ...job.progress })
    if (modules.length === 0) {
      this.jobs.delete(jobId)
      return { jobId }
    }
    void this.runJob(job, node, modules)
    return { jobId }
  }

  private async runJob(job: Job, node: GraphNode, modules: OsintModule[]): Promise<void> {
    const queue = [...modules]
    const concurrency = this.settings.get().concurrency
    const worker = async (): Promise<void> => {
      while (queue.length && !job.controller.signal.aborted) {
        const m = queue.shift()!
        await this.runModule(job, node, m)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, modules.length) }, worker))
    // Les modules restés en file après une annulation sont tracés comme annulés.
    for (const m of queue) {
      this.repo.insertRun({
        id: randomUUID(),
        investigationId: node.investigationId,
        nodeId: node.id,
        moduleId: m.id,
        jobId: job.progress.jobId,
        status: 'cancelled',
        found: null,
        resultCount: 0,
        error: null,
        startedAt: null,
        finishedAt: Date.now()
      })
    }
    job.progress.finished = true
    job.progress.running = []
    this.emit('job:progress', { ...job.progress })
    this.jobs.delete(job.progress.jobId)
  }

  private async runModule(job: Job, node: GraphNode, m: OsintModule): Promise<void> {
    const run: ModuleRun = {
      id: randomUUID(),
      investigationId: node.investigationId,
      nodeId: node.id,
      moduleId: m.id,
      jobId: job.progress.jobId,
      status: 'running',
      found: null,
      resultCount: 0,
      error: null,
      startedAt: Date.now(),
      finishedAt: null
    }
    this.repo.insertRun(run)
    job.progress.running.push(m.id)
    this.emit('job:progress', { ...job.progress, running: [...job.progress.running] })

    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    job.controller.signal.addEventListener('abort', onAbort)
    const hardTimeout = setTimeout(() => controller.abort(), Math.max(m.timeoutMs ?? 0, MODULE_HARD_TIMEOUT))

    try {
      const ctx = this.createContext(m, controller.signal)
      // Relire le nœud : un module précédent a pu enrichir ses propriétés.
      const fresh = this.repo.getNode(node.id) ?? node
      const output = await m.run(toInput(fresh), ctx)
      const count = await this.applyOutput(fresh, m, output, ctx)
      this.repo.updateRun(run.id, {
        status: 'done',
        found: output.found ?? null,
        resultCount: count,
        finishedAt: Date.now(),
        raw: truncateRaw(output.raw)
      })
      if (count > 0 || output.found) job.progress.results += 1
    } catch (e) {
      const aborted = controller.signal.aborted
      const message = e instanceof Error ? e.message : String(e)
      this.repo.updateRun(run.id, {
        status: job.progress.cancelled ? 'cancelled' : 'error',
        error: aborted && !job.progress.cancelled ? 'Délai dépassé' : message.slice(0, 1000),
        finishedAt: Date.now()
      })
      if (!job.progress.cancelled) job.progress.errors += 1
    } finally {
      clearTimeout(hardTimeout)
      job.controller.signal.removeEventListener('abort', onAbort)
      job.progress.done += 1
      job.progress.running = job.progress.running.filter((id) => id !== m.id)
      this.emit('job:progress', { ...job.progress, running: [...job.progress.running] })
    }
  }

  createContext(m: OsintModule, signal: AbortSignal): ModuleContext {
    const settings = this.settings.get()
    const fetchFn = createFetch({ settings, moduleId: m.id, signal })
    const helpers = jsonHelpers(fetchFn)
    const resolve = createDohResolver(fetchFn)
    return {
      fetch: fetchFn,
      fetchJson: helpers.fetchJson,
      fetchText: helpers.fetchText,
      resolveDns: (name, type) => resolve(name, type),
      key: (id) => this.settings.getSecret(id),
      attachment: async (id) => {
        const meta = this.repo.getAttachment(id)
        const blob = this.repo.getAttachmentData(id)
        return meta && blob ? { mime: blob.mime, name: meta.name, data: blob.data } : null
      },
      signal,
      userAgent: settings.userAgent,
      lang: settings.lang,
      log: (msg) => console.log(`[${m.id}] ${msg}`)
    }
  }

  /** Persiste le résultat d'un module : propriétés, entités dédoublonnées, liens, images. */
  async applyOutput(input: GraphNode, m: OsintModule, output: ModuleOutput, ctx: ModuleContext): Promise<number> {
    const invId = input.investigationId
    const changedNodes = new Map<string, GraphNode>()
    const changedEdges: GraphEdge[] = []

    if (output.properties && Object.keys(output.properties).length) {
      const updated = this.repo.mergeNodeData(input.id, output.properties, false)
      if (updated) changedNodes.set(updated.id, updated)
    }

    const refs = new Map<string, GraphNode>([['$input', this.repo.getNode(input.id) ?? input]])
    const pending: Array<{ node: GraphNode; image?: string }> = []

    for (const ent of output.entities ?? []) {
      const label = String(ent.label ?? '').trim()
      if (!label) continue
      const platform = ent.platform ?? (ent.type === 'email' ? (emailProvider(label)?.id ?? null) : null)
      const parent = refs.get(ent.from ?? '$input') ?? refs.get('$input')!
      const key = dedupKey(ent.type, label, platform)
      let node = this.repo.findNodeByDedup(invId, key)
      if (node) {
        if (ent.data && Object.keys(ent.data).length) node = this.repo.mergeNodeData(node.id, ent.data, false) ?? node
      } else {
        const pos = this.placeChild(parent)
        node = this.repo.upsertNodes(invId, [
          {
            kind: 'entity',
            type: ent.type,
            label,
            platform,
            data: cleanData(ent.data ?? {}),
            x: pos.x,
            y: pos.y,
            source: m.id
          }
        ])[0]
      }
      if (ent.ref) refs.set(ent.ref, node)
      changedNodes.set(node.id, node)
      if (node.id !== parent.id && !this.repo.findEdge(invId, parent.id, node.id)) {
        const [edge] = this.repo.upsertEdges(invId, [
          { source: parent.id, target: node.id, label: ent.linkLabel ?? '', sourceModule: m.id }
        ])
        changedEdges.push(edge)
      }
      if (ent.image && !node.imageId) pending.push({ node, image: ent.image })
    }

    for (const link of output.links ?? []) {
      const a = refs.get(link.from)
      const b = refs.get(link.to)
      if (!a || !b || a.id === b.id || this.repo.findEdge(invId, a.id, b.id)) continue
      const [edge] = this.repo.upsertEdges(invId, [{ source: a.id, target: b.id, label: link.label ?? '', sourceModule: m.id }])
      changedEdges.push(edge)
    }

    for (const p of pending) {
      const updated = await this.attachImage(p.node, p.image!, ctx).catch(() => null)
      if (updated) changedNodes.set(updated.id, updated)
    }

    if (changedNodes.size || changedEdges.length) {
      this.emit('graph:changed', { investigationId: invId, nodes: Array.from(changedNodes.values()), edges: changedEdges })
    }
    return (output.entities?.length ?? 0) + Object.keys(output.properties ?? {}).length
  }

  private async attachImage(node: GraphNode, url: string, ctx: ModuleContext): Promise<GraphNode | null> {
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) return null
      const att = this.repo.addAttachment(node.investigationId, {
        name: 'image',
        mime: match[1],
        data: Buffer.from(match[2], 'base64'),
        origin: null
      })
      return this.repo.upsertNodes(node.investigationId, [{ id: node.id, imageId: att.id }])[0]
    }
    const res = await ctx.fetch(url, { timeoutMs: 15000 })
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!mime.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > MAX_IMAGE) return null
    const att = this.repo.addAttachment(node.investigationId, {
      name: new URL(url).pathname.split('/').pop() || 'image',
      mime,
      data: buf,
      origin: url
    })
    return this.repo.upsertNodes(node.investigationId, [{ id: node.id, imageId: att.id }])[0]
  }

  /** Position d'un nouvel enfant : rangées centrées sous le parent (0, +1, -1, +2, -2...). */
  private placeChild(parent: GraphNode): { x: number; y: number } {
    const count = this.repo.db
      .prepare('SELECT COUNT(*) AS c FROM edges WHERE investigation_id = ? AND source = ?')
      .get(parent.investigationId, parent.id) as { c: number }
    const perRow = 7
    const i = count.c % perRow
    const row = Math.floor(count.c / perRow)
    const offset = i === 0 ? 0 : i % 2 === 1 ? (i + 1) / 2 : -i / 2
    return { x: parent.x + offset * 220, y: parent.y + 130 + row * 70 }
  }
}

function cleanData(data: Record<string, PropValue>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    out[k] = v
  }
  return out
}
