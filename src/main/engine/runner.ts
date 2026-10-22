import { randomUUID } from 'node:crypto'
import { emailProvider } from '@shared/platforms'
import { childSlot, nodeBox } from '@shared/placement'
import type { EventMap } from '@shared/api'
import type { InputEntity, ModuleContext, ModuleOutput, OsintModule, OutEntity } from '@shared/modules'
import type { GraphEdge, GraphNode, JobProgress, ModuleRun, PropValue, Suggestion } from '@shared/types'
import { dedupKey, type Repo } from '../db/repo'
import type { SettingsService } from '../settings'
import { createDohResolver, createFetch, jsonHelpers, type FetchFn } from './http'
import { allModules, isConfigured } from './registry'

const MAX_RAW = 200_000
const MAX_IMAGE = 4 * 1024 * 1024
const MODULE_HARD_TIMEOUT = 180_000

export type Emit = <E extends 'graph:changed' | 'job:progress' | 'suggestions:changed'>(event: E, payload: EventMap[E]) => void

/** Réponse HTTP en échec gardée pour le diagnostic d'un module en erreur. */
interface HttpTrace {
  url: string
  status?: number
  contentType?: string | null
  body?: string
  error?: string
}

const MAX_TRACE = 8

/** Masque les clés d'API éventuellement passées dans l'URL. */
function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|api_?key|apikey|token|access_token|secret)=)[^&]+/gi, '$1***')
}

function traceFetch(fetchFn: FetchFn, trace: HttpTrace[]): FetchFn {
  return async (url, init) => {
    try {
      const res = await fetchFn(url, init)
      if (!res.ok && trace.length < MAX_TRACE) {
        const body = await res
          .clone()
          .text()
          .catch(() => '')
        trace.push({ url: redactUrl(url), status: res.status, contentType: res.headers.get('content-type'), body: body.slice(0, 1500) })
      }
      return res
    } catch (e) {
      if (trace.length < MAX_TRACE) trace.push({ url: redactUrl(url), error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }
}

interface Job {
  progress: JobProgress
  controller: AbortController
}

/** Modules applicables à un nœud. `explicit` inclut les modules « à la demande ». */
export function applicableModules(
  node: GraphNode,
  settings: SettingsService,
  explicit?: string[],
  imageOrigin?: string | null
): OsintModule[] {
  if (node.kind !== 'entity') return []
  const input = toInput(node, imageOrigin)
  const disabled = new Set(settings.get().disabledModules)
  return allModules().filter((m) => {
    if (!m.inputTypes.includes(node.type) && !m.inputTypes.includes('*')) return false
    if (m.accepts && !m.accepts(input)) return false
    if (explicit) return explicit.includes(m.id) && isConfigured(m, settings)
    return !m.ondemand && !disabled.has(m.id) && isConfigured(m, settings)
  })
}

export function toInput(node: GraphNode, imageOrigin?: string | null): InputEntity {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    platform: node.platform,
    data: node.data,
    imageId: node.imageId,
    imageOrigin: imageOrigin ?? null
  }
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

  /**
   * Modules qui tourneraient pour ce nœud (`auto`) et modules dont le filtre accepte sa valeur
   * (`accepted`, quel que soit leur état), pour annoncer le bon nombre avant de lancer.
   */
  applicable(node: GraphNode): { auto: string[]; accepted: string[] } {
    if (node.kind !== 'entity') return { auto: [], accepted: [] }
    const origin = this.imageOrigin(node)
    const input = toInput(node, origin)
    const accepted = allModules()
      .filter((m) => (m.inputTypes.includes(node.type) || m.inputTypes.includes('*')) && (!m.accepts || m.accepts(input)))
      .map((m) => m.id)
    return { auto: applicableModules(node, this.settings, undefined, origin).map((m) => m.id), accepted }
  }

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
    const modules = applicableModules(node, this.settings, moduleIds, this.imageOrigin(node))
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
    const trace: HttpTrace[] = []
    const onAbort = (): void => controller.abort()
    job.controller.signal.addEventListener('abort', onAbort)
    const hardTimeout = setTimeout(() => controller.abort(), Math.max(m.timeoutMs ?? 0, MODULE_HARD_TIMEOUT))

    // Avancement interne du module, envoyé au plus toutes les 250 ms.
    let lastEmit = 0
    const onProgress = (done: number, total: number, detail?: string): void => {
      job.progress.steps = { ...job.progress.steps, [m.id]: { done, total, detail } }
      const t = Date.now()
      if (t - lastEmit < 250 && done < total) return
      lastEmit = t
      this.emit('job:progress', { ...job.progress, running: [...job.progress.running] })
    }

    try {
      const ctx = this.createContext(m, controller.signal, trace, onProgress)
      // Relire le nœud : un module précédent a pu enrichir ses propriétés.
      const fresh = this.repo.getNode(node.id) ?? node
      const output = await m.run(toInput(fresh, this.imageOrigin(fresh)), ctx)
      const stats = { review: 0 }
      const count = await this.applyOutput(fresh, m, output, ctx, stats)
      job.progress.review = (job.progress.review ?? 0) + stats.review
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
      const raw = e instanceof Error ? e.message : String(e)
      const timedOut = (e instanceof Error && e.name === 'TimeoutError') || /aborted due to timeout|timed? ?out/i.test(raw)
      const message = timedOut ? 'Délai dépassé : service trop lent ou injoignable' : raw
      const err = e as { code?: string; status?: number; body?: string }
      this.repo.updateRun(run.id, {
        status: job.progress.cancelled ? 'cancelled' : 'error',
        error: aborted && !job.progress.cancelled ? 'Délai dépassé' : message.slice(0, 1000),
        finishedAt: Date.now(),
        raw: truncateRaw({ error: raw, code: err.code, status: err.status, body: err.body, http: trace })
      })
      if (!job.progress.cancelled) job.progress.errors += 1
    } finally {
      clearTimeout(hardTimeout)
      job.controller.signal.removeEventListener('abort', onAbort)
      job.progress.done += 1
      job.progress.running = job.progress.running.filter((id) => id !== m.id)
      if (job.progress.steps?.[m.id]) {
        const rest = { ...job.progress.steps }
        delete rest[m.id]
        job.progress.steps = rest
      }
      this.emit('job:progress', { ...job.progress, running: [...job.progress.running] })
    }
  }

  private imageOrigin(node: GraphNode): string | null {
    return node.imageId ? (this.repo.getAttachment(node.imageId)?.origin ?? null) : null
  }

  createContext(
    m: Pick<OsintModule, 'id'>,
    signal: AbortSignal,
    trace: HttpTrace[] = [],
    onProgress: ModuleContext['progress'] = () => undefined
  ): ModuleContext {
    const settings = this.settings.get()
    const baseFetch = createFetch({ settings, moduleId: m.id, signal })
    const fetchFn = traceFetch(baseFetch, trace)
    const helpers = jsonHelpers(fetchFn)
    const resolve = createDohResolver(baseFetch)
    return {
      fetch: fetchFn,
      fetchJson: helpers.fetchJson,
      fetchText: helpers.fetchText,
      resolveDns: (name, type) => resolve(name, type),
      key: (id) => this.settings.getSecret(id),
      attachment: async (id) => {
        const meta = this.repo.getAttachment(id)
        const blob = this.repo.getAttachmentData(id)
        return meta && blob ? { mime: blob.mime, name: meta.name, data: blob.data, origin: meta.origin } : null
      },
      signal,
      userAgent: settings.userAgent,
      lang: settings.lang,
      log: (msg) => console.log(`[${m.id}] ${msg}`),
      progress: onProgress
    }
  }

  /** Persiste le résultat d'un module : propriétés, entités dédoublonnées, liens, images. */
  async applyOutput(
    input: GraphNode,
    m: Pick<OsintModule, 'id'>,
    output: ModuleOutput,
    ctx: ModuleContext,
    stats: { review: number } = { review: 0 }
  ): Promise<number> {
    const invId = input.investigationId
    const changedNodes = new Map<string, GraphNode>()
    const changedEdges: GraphEdge[] = []
    // Références des entités mises de côté : leurs enfants le sont aussi.
    const reviewRefs = new Set<string>()
    let inGraph = 0
    const suggest = (s: Omit<Suggestion, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'investigationId' | 'nodeId' | 'moduleId'>): void => {
      if (this.repo.addSuggestion({ ...s, investigationId: invId, nodeId: input.id, moduleId: m.id })) stats.review++
    }

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
      const key = dedupKey(ent.type, label, platform)
      let node = this.repo.findNodeByDedup(invId, key)
      // Résultat non vérifié et absent du graphe : il attend dans « À vérifier ».
      if (!node && (ent.review || (ent.from !== undefined && reviewRefs.has(ent.from)))) {
        if (ent.ref) reviewRefs.add(ent.ref)
        suggest({
          kind: 'entity',
          type: ent.type,
          label,
          platform,
          data: cleanData({ ...(ent.data ?? {}), ...(ent.image ? { __image: ent.image } : {}) }),
          linkLabel: ent.linkLabel ?? '',
          url: typeof ent.data?.url === 'string' ? ent.data.url : null,
          reason: ent.reviewReason ?? ''
        })
        continue
      }
      const parent = refs.get(ent.from ?? '$input') ?? refs.get('$input')!
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
      inGraph++
      if (node.id !== parent.id) {
        const existing = this.repo.findEdge(invId, parent.id, node.id)
        if (!existing) {
          const [edge] = this.repo.upsertEdges(invId, [
            { source: parent.id, target: node.id, label: ent.linkLabel ?? '', sourceModule: m.id }
          ])
          changedEdges.push(edge)
        } else {
          // Lien déjà posé par un autre module : on ajoute ce libellé (« registrar · hébergé chez »).
          const label = joinLabels(existing.label, ent.linkLabel)
          if (label !== existing.label) changedEdges.push(...this.repo.upsertEdges(invId, [{ ...existing, label }]))
        }
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

    for (const check of output.manual ?? []) {
      if (!check.url || !check.label) continue
      suggest({ kind: 'manual', type: 'search_link', label: check.label, platform: null, data: {}, linkLabel: check.label, url: check.url, reason: check.hint ?? '' })
    }
    if (stats.review) this.emit('suggestions:changed', { investigationId: invId, nodeId: input.id })

    for (const p of pending) {
      const updated = await this.attachImage(p.node, p.image!, ctx).catch(() => null)
      if (updated) changedNodes.set(updated.id, updated)
    }

    if (changedNodes.size || changedEdges.length) {
      this.emit('graph:changed', { investigationId: invId, nodes: Array.from(changedNodes.values()), edges: changedEdges })
    }
    return inGraph + Object.keys(output.properties ?? {}).length
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

  /**
   * Décision de l'enquêteur sur un résultat à vérifier :
   * - `accept` : l'entité entre dans le graphe, reliée au nœud d'origine. Pour une recherche
   *   manuelle, `found` décrit ce qui a été trouvé ; sans `found`, le lien est gardé dans le graphe ;
   * - `reject` : écartée, elle ne sera plus proposée ;
   * - `checked` : recherche manuelle faite, rien trouvé ;
   * - `reopen` : de nouveau à vérifier.
   */
  async resolveSuggestion(
    id: string,
    action: 'accept' | 'reject' | 'checked' | 'reopen',
    found?: { type: string; label: string; platform?: string | null }
  ): Promise<void> {
    const s = this.repo.getSuggestion(id)
    if (!s) return
    const parent = this.repo.getNode(s.nodeId)
    const done = (status: Suggestion['status']): void => {
      this.repo.setSuggestionStatus(id, status)
      this.emit('suggestions:changed', { investigationId: s.investigationId, nodeId: s.nodeId })
    }
    if (action !== 'accept' || !parent) {
      done(action === 'reopen' ? 'pending' : action === 'checked' ? 'checked' : 'rejected')
      return
    }
    const { __image, ...data } = s.data
    const entity: OutEntity =
      s.kind === 'entity'
        ? { type: s.type, label: s.label, platform: s.platform ?? undefined, data, linkLabel: s.linkLabel, image: typeof __image === 'string' ? __image : undefined }
        : found
          ? { type: found.type, label: found.label, platform: found.platform ?? undefined, data: { source_url: s.url }, linkLabel: s.label }
          : { type: 'search_link', label: `${s.label} : ${parent.label}`, data: { url: s.url, engine: s.label }, linkLabel: s.linkLabel }
    // Même chemin qu'un résultat de module : dédoublonnage, placement libre, image, événement.
    const ctx = this.createContext({ id: s.moduleId }, AbortSignal.timeout(30_000))
    await this.applyOutput(parent, { id: s.moduleId }, { entities: [entity] }, ctx)
    done('accepted')
  }

  /** Position d'un nouvel enfant : rangées centrées sous le parent, sur des cases libres. */
  private placeChild(parent: GraphNode): { x: number; y: number } {
    const occupied = this.repo
      .listNodeBoxes(parent.investigationId)
      .filter((n) => n.id !== parent.id)
      .map(nodeBox)
    return childSlot(nodeBox(parent), occupied)
  }
}

function joinLabels(current: string, added: string | undefined): string {
  if (!added || !added.trim()) return current
  const parts = current.split(' · ').filter(Boolean)
  return parts.includes(added) ? current : [...parts, added].join(' · ')
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
