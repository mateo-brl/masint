import { randomUUID } from 'node:crypto'
import { emailProvider } from '@shared/platforms'
import { childSlot, nodeBox } from '@shared/placement'
import type { EventMap } from '@shared/api'
import type { InputEntity, ModuleContext, ModuleOutput, OsintModule, OutEntity } from '@shared/modules'
import type { GraphEdge, GraphNode, JobProgress, LinkStrength, ModuleRun, PropValue, Suggestion } from '@shared/types'
import { dedupKey, type ObservationInput, type Repo } from '../db/repo'
import type { SettingsService } from '../settings'
import { CHAIN_BUDGET, RECENT_ENRICH_MS, chainExcluded, chainable, defaultStrength, stopReason } from './chain'
import { createDohResolver, createFetch, egressKey, jsonHelpers, type FetchFn } from './http'
import { Semaphore } from './limits'
import { allModules, getModule, isConfigured } from './registry'

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

/** Enchaînement demandé : profondeur maximale, comptée à partir de la profondeur `baseHop`. */
export interface ChainSpec {
  maxDepth: number
  baseHop: number
}

/** Nœud enrichi par une tâche : sa profondeur dans la chaîne, le chemin qui y mène, ses modules. */
interface JobNode {
  node: GraphNode
  /** 0 pour le nœud de départ, sinon `hop - baseHop`. */
  depth: number
  /** Modules qui ont mené à ce nœud depuis le nœud de départ. */
  path: string[]
  /** Modules déjà programmés pour ce nœud dans la tâche. */
  ran: Set<string>
  /** Modules programmés et pas encore terminés. */
  pending: number
  /** Modules de suite (`followUp`) déjà examinés. */
  followed: boolean
}

interface QueueItem {
  entry: JobNode
  module: OsintModule
}

interface ChainState extends ChainSpec {
  startedAt: number
  /** Exécutions programmées, nœud de départ compris. */
  runs: number
  /** Nouveaux nœuds créés par l'enchaînement, par profondeur. */
  createdByDepth: Map<number, number>
}

interface Job {
  progress: JobProgress
  controller: AbortController
  queue: QueueItem[]
  /** Exécutants en cours (voir `worker`). */
  workers: number
  /** Appelé quand le dernier exécutant s'arrête. */
  idle: (() => void) | null
  /** Modules en cours par nœud. */
  busy: Map<string, number>
  chain: ChainState | null
}

/** Bilan d'`applyOutput` : éléments mis de côté, nouveaux nœuds et force de leur lien. */
export interface ApplyStats {
  review: number
  created?: Array<{ node: GraphNode; strength: LinkStrength }>
}

export interface ApplyOptions {
  /** Exécution d'origine des observations (sinon, la dernière du module sur ce nœud). */
  runId?: string
  /**
   * Enchaînement : examen de chaque nouvelle entité, avec la force de son lien et la profondeur
   * qu'elle aurait. Renvoie le motif pour la mettre dans « À vérifier », ou `null` pour la créer.
   */
  admit?: (strength: LinkStrength, hop: number) => { reason: string; chain: ChainSpec } | null
}

/**
 * Modules applicables à un nœud. `explicit` inclut les modules « à la demande » et, en mode
 * passif, ceux qui contactent la cible (`noisy`) : ils ne partent que choisis un par un.
 */
export function applicableModules(
  node: GraphNode,
  settings: SettingsService,
  explicit?: string[],
  imageOrigin?: string | null
): OsintModule[] {
  if (node.kind !== 'entity') return []
  const input = toInput(node, imageOrigin)
  const { disabledModules, passiveMode } = settings.get()
  const disabled = new Set(disabledModules)
  return allModules().filter((m) => {
    if (!m.inputTypes.includes(node.type) && !m.inputTypes.includes('*')) return false
    if (m.accepts && !m.accepts(input)) return false
    if (explicit) return explicit.includes(m.id) && isConfigured(m, settings)
    return !m.ondemand && !(passiveMode && m.noisy) && !disabled.has(m.id) && isConfigured(m, settings)
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

/** Lit l'enchaînement à reprendre, rangé dans les données d'une suggestion (`__chain`). */
function chainSpecOf(v: unknown): ChainSpec | null {
  const c = v as Partial<ChainSpec> | null | undefined
  return c && typeof c.maxDepth === 'number' && typeof c.baseHop === 'number' ? { maxDepth: c.maxDepth, baseHop: c.baseHop } : null
}

export class Engine {
  private jobs = new Map<string, Job>()
  /**
   * Places d'exécution communes à toutes les tâches : chaque nœud a sa file (`concurrency`),
   * mais cent nœuds enrichis ensemble ne lancent pas huit cents modules à la fois.
   */
  readonly slots: Semaphore

  constructor(
    private readonly repo: Repo,
    private readonly settings: SettingsService,
    private readonly emit: Emit
  ) {
    this.slots = new Semaphore(() => this.settings.get().globalConcurrency)
  }

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

  /**
   * Enrichit un nœud. L'enchaînement (les nouveaux nœuds sûrs sont enrichis à leur tour) suit
   * `opts.chain` : `true` pour « Enrichir en chaîne » (profondeur réglée, au moins 1), `false`
   * pour ne jamais enchaîner, une profondeur précise pour reprendre une chaîne ; absent, il
   * s'applique avec l'enrichissement automatique quand une profondeur est réglée.
   */
  enrich(investigationId: string, nodeId: string, moduleIds?: string[], opts: { chain?: boolean | ChainSpec } = {}): { jobId: string } {
    const node = this.repo.getNode(nodeId)
    if (!node || node.investigationId !== investigationId) throw new Error('Nœud introuvable')
    const modules = applicableModules(node, this.settings, moduleIds, this.imageOrigin(node))
    const spec = this.chainSpec(node, moduleIds, opts.chain)
    const jobId = randomUUID()
    const job: Job = {
      controller: new AbortController(),
      queue: [],
      workers: 0,
      idle: null,
      busy: new Map(),
      chain: spec ? { ...spec, startedAt: Date.now(), runs: 0, createdByDepth: new Map() } : null,
      progress: {
        jobId,
        investigationId,
        nodeId,
        nodeLabel: node.label,
        total: 0,
        done: 0,
        results: 0,
        errors: 0,
        running: [],
        ...(spec ? { chain: { maxDepth: spec.maxDepth, depth: 0, created: 0, enriched: 0, active: [], budget: false } } : {}),
        finished: modules.length === 0,
        cancelled: false
      }
    }
    this.jobs.set(jobId, job)
    if (modules.length === 0) {
      this.emit('job:progress', this.snapshot(job))
      this.jobs.delete(jobId)
      return { jobId }
    }
    this.enqueue(job, { node, depth: 0, path: [], ran: new Set(), pending: 0, followed: false }, modules)
    this.emit('job:progress', this.snapshot(job))
    void this.runJob(job)
    return { jobId }
  }

  /** Enchaînement d'une nouvelle tâche, ou `null`. */
  private chainSpec(node: GraphNode, moduleIds: string[] | undefined, chain: boolean | ChainSpec | undefined): ChainSpec | null {
    if (chain === false) return null
    if (chain && typeof chain === 'object') return chain
    const s = this.settings.get()
    const baseHop = node.hop ?? 0
    if (chain === true) return { maxDepth: Math.max(1, s.chainDepth), baseHop }
    return !moduleIds && s.autoEnrich && s.chainDepth > 0 ? { maxDepth: s.chainDepth, baseHop } : null
  }

  /** Copie envoyée à l'interface (les listes changent ensuite). */
  private snapshot(job: Job): JobProgress {
    const p = job.progress
    return { ...p, running: [...p.running], ...(p.chain ? { chain: { ...p.chain, active: [...p.chain.active] } } : {}) }
  }

  /** Programme des modules pour un nœud de la tâche (sans les lancer). */
  private enqueue(job: Job, entry: JobNode, modules: OsintModule[]): void {
    for (const m of modules) {
      entry.ran.add(m.id)
      job.queue.push({ entry, module: m })
    }
    entry.pending += modules.length
    job.progress.total += modules.length
    if (job.chain) job.chain.runs += modules.length
    this.refreshActive(job)
  }

  /** Nœuds d'une tâche en chaîne qui ont des modules en file ou en cours (pastille du canevas). */
  private refreshActive(job: Job): void {
    if (!job.progress.chain) return
    const ids = new Set(job.busy.keys())
    for (const q of job.queue) ids.add(q.entry.node.id)
    job.progress.chain.active = Array.from(ids)
  }

  /** Compte des modules en cours par nœud. */
  private setBusy(job: Job, nodeId: string, delta: number): void {
    const n = (job.busy.get(nodeId) ?? 0) + delta
    if (n > 0) job.busy.set(nodeId, n)
    else job.busy.delete(nodeId)
    this.refreshActive(job)
  }

  /** Lance des exécutants jusqu'à la concurrence d'un nœud (`concurrency`). */
  private spawn(job: Job): void {
    const concurrency = this.settings.get().concurrency
    const n = Math.min(concurrency - job.workers, job.queue.length)
    for (let i = 0; i < n; i++) void this.worker(job)
  }

  /**
   * Exécutant : prend une place globale, puis le module suivant de la file. Le module reste en
   * file (et sera tracé comme annulé) tant qu'il attend ; l'annulation interrompt l'attente.
   */
  private async worker(job: Job): Promise<void> {
    job.workers++
    const signal = job.controller.signal
    try {
      while (job.queue.length && !signal.aborted) {
        const release = await this.slots.acquire(signal).catch(() => null)
        if (!release) break
        const item = signal.aborted ? undefined : job.queue.shift()
        try {
          if (item) await this.runItem(job, item)
        } finally {
          release()
        }
        if (!item) break
      }
    } finally {
      job.workers--
      if (job.workers === 0) job.idle?.()
    }
  }

  private async runJob(job: Job): Promise<void> {
    await new Promise<void>((resolve) => {
      job.idle = resolve
      this.spawn(job)
      if (job.workers === 0) resolve()
    })
    // Les modules restés en file après une annulation sont tracés comme annulés.
    for (const { entry, module: m } of job.queue) {
      this.repo.insertRun({
        id: randomUUID(),
        investigationId: entry.node.investigationId,
        nodeId: entry.node.id,
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
    job.queue = []
    job.progress.finished = true
    job.progress.running = []
    if (job.progress.chain) job.progress.chain.active = []
    this.emit('job:progress', this.snapshot(job))
    this.jobs.delete(job.progress.jobId)
  }

  /** Un module d'un nœud, puis ses suites : modules `followUp`, nœuds trouvés à enchaîner. */
  private async runItem(job: Job, { entry, module: m }: QueueItem): Promise<void> {
    const created = await this.runModule(job, entry, m)
    entry.pending--
    if (job.controller.signal.aborted) return
    let more = this.considerChain(job, entry, m, created)
    // Modules de suite que les résultats rendent maintenant applicables, une fois les modules
    // du nœud terminés (même si la tâche ne lançait qu'un module choisi à la main).
    if (entry.pending === 0 && !entry.followed) {
      entry.followed = true
      const fresh = this.repo.getNode(entry.node.id)
      if (fresh) {
        const candidates = entry.depth === 0 ? applicableModules(fresh, this.settings, undefined, this.imageOrigin(fresh)) : this.chainModules(fresh, entry.depth)
        const follow = candidates.filter((x) => x.followUp && !entry.ran.has(x.id))
        if (follow.length) {
          this.enqueue(job, entry, follow)
          more = true
        }
      }
    }
    if (more) {
      this.emit('job:progress', this.snapshot(job))
      this.spawn(job)
    }
  }

  /** Modules lancés sur un nœud atteint par enchaînement (voir `chainExcluded`). */
  private chainModules(node: GraphNode, depth: number): OsintModule[] {
    return applicableModules(node, this.settings, undefined, this.imageOrigin(node)).filter((m) => !chainExcluded(m, node, depth))
  }

  /**
   * Enchaînement : les nouveaux nœuds de lien `same` ou `declared`, dans la profondeur permise,
   * hors liste d'arrêt et dans le budget, sont enrichis à leur tour. Renvoie `true` si des
   * modules ont été programmés.
   */
  private considerChain(job: Job, parent: JobNode, m: OsintModule, created: Array<{ node: GraphNode; strength: LinkStrength }>): boolean {
    const chain = job.chain
    const progress = job.progress.chain
    if (!chain || !progress || !created.length) return false
    // Le nœud enrichi doit rester un bon point de départ (compte de marque révélé par son profil...).
    const parentNow = this.repo.getNode(parent.node.id) ?? parent.node
    if (stopReason(parentNow, parent.depth === 0)) return false
    let scheduled = false
    for (const { node, strength } of created) {
      const depth = (node.hop ?? parent.node.hop ?? 0) - chain.baseHop
      if (depth < 1 || depth > chain.maxDepth || !chainable(strength) || node.kind !== 'entity') continue
      if (stopReason(node)) continue
      if (this.repo.recentlyEnriched(dedupKey(node.type, node.label, node.platform), Date.now() - RECENT_ENRICH_MS, node.id)) continue
      if (Date.now() - chain.startedAt > CHAIN_BUDGET.durationMs) {
        progress.budget = true
        break
      }
      const mods = this.chainModules(node, depth)
      if (!mods.length) continue
      if (chain.runs + mods.length > CHAIN_BUDGET.runs) {
        progress.budget = true
        continue
      }
      this.enqueue(job, { node, depth, path: [...parent.path, m.id], ran: new Set(), pending: 0, followed: false }, mods)
      progress.enriched++
      progress.depth = Math.max(progress.depth, depth)
      scheduled = true
    }
    return scheduled
  }

  /** Motif d'un résultat mis de côté par l'enchaînement : « trouvé via A puis B, profondeur N ». */
  private chainReason(path: string[], depth: number, budget: boolean): string {
    const lang = this.settings.get().lang
    const names = path.map((id) => getModule(id)?.name[lang] ?? id)
    const via = lang === 'fr' ? `trouvé via ${names.join(' puis ')}, profondeur ${depth}` : `found via ${names.join(' then ')}, depth ${depth}`
    if (!budget) return via
    return lang === 'fr' ? `budget atteint (${via})` : `budget reached (${via})`
  }

  private async runModule(job: Job, entry: JobNode, m: OsintModule): Promise<Array<{ node: GraphNode; strength: LinkStrength }>> {
    const node = entry.node
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
    this.setBusy(job, node.id, 1)
    this.emit('job:progress', this.snapshot(job))

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
      this.emit('job:progress', this.snapshot(job))
    }

    const stats: ApplyStats = { review: 0, created: [] }
    try {
      const ctx = this.createContext(m, controller.signal, trace, onProgress, node.investigationId)
      // Relire le nœud : un module précédent a pu enrichir ses propriétés.
      const fresh = this.repo.getNode(node.id) ?? node
      const output = await m.run(toInput(fresh, this.imageOrigin(fresh)), ctx)
      const count = await this.applyOutput(fresh, m, output, ctx, stats, { runId: run.id, admit: this.admitFor(job, entry, m) })
      job.progress.review = (job.progress.review ?? 0) + stats.review
      if (job.progress.chain) job.progress.chain.created += stats.created!.length
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
      const i = job.progress.running.indexOf(m.id)
      if (i >= 0) job.progress.running.splice(i, 1)
      if (job.progress.steps?.[m.id] && !job.progress.running.includes(m.id)) {
        const rest = { ...job.progress.steps }
        delete rest[m.id]
        job.progress.steps = rest
      }
      this.setBusy(job, node.id, -1)
      this.emit('job:progress', this.snapshot(job))
    }
    return stats.created ?? []
  }

  /**
   * Examen des nouvelles entités d'un nœud atteint par enchaînement : les liens `mention` et
   * `weak` vont dans « À vérifier » ; au-delà du budget (nœuds par saut, durée), tout le
   * surplus y va aussi. Rien pour le nœud de départ : son enrichissement reste ordinaire.
   */
  private admitFor(job: Job, entry: JobNode, m: OsintModule): ApplyOptions['admit'] {
    const chain = job.chain
    if (!chain || entry.depth < 1) return undefined
    const spec: ChainSpec = { maxDepth: chain.maxDepth, baseHop: chain.baseHop }
    return (strength, hop) => {
      const depth = hop - chain.baseHop
      const path = [...entry.path, m.id]
      if (!chainable(strength)) return { reason: this.chainReason(path, depth, false), chain: spec }
      const count = chain.createdByDepth.get(depth) ?? 0
      if (count >= CHAIN_BUDGET.nodesPerHop || Date.now() - chain.startedAt > CHAIN_BUDGET.durationMs) {
        if (job.progress.chain) job.progress.chain.budget = true
        return { reason: this.chainReason(path, depth, true), chain: spec }
      }
      chain.createdByDepth.set(depth, count + 1)
      return null
    }
  }

  private imageOrigin(node: GraphNode): string | null {
    return node.imageId ? (this.repo.getAttachment(node.imageId)?.origin ?? null) : null
  }

  createContext(
    m: Pick<OsintModule, 'id'>,
    signal: AbortSignal,
    trace: HttpTrace[] = [],
    onProgress: ModuleContext['progress'] = () => undefined,
    /** Enquête concernée : sous Tor, ses requêtes passent par ses propres circuits. */
    investigationId?: string
  ): ModuleContext {
    const settings = this.settings.get()
    const baseFetch = createFetch({ settings, moduleId: m.id, signal, investigationId })
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
      progress: onProgress,
      egress: egressKey(settings.proxy, settings.proxy.perModule[m.id] ?? 'default')
    }
  }

  /**
   * Persiste le résultat d'un module : propriétés, entités dédoublonnées, liens, images. Chaque
   * élément vu par le module est consigné dans `observations`, y compris quand l'entité ou le
   * lien existait déjà : c'est la corroboration.
   */
  async applyOutput(
    input: GraphNode,
    m: Pick<OsintModule, 'id'>,
    output: ModuleOutput,
    ctx: ModuleContext,
    stats: ApplyStats = { review: 0 },
    opts: ApplyOptions = {}
  ): Promise<number> {
    const invId = input.investigationId
    const changedNodes = new Map<string, GraphNode>()
    const changedEdges: GraphEdge[] = []
    // Références des entités mises de côté (avec leur motif) : leurs enfants le sont aussi.
    const reviewRefs = new Map<string, { reason: string; chain?: ChainSpec }>()
    let inGraph = 0
    const suggest = (s: Omit<Suggestion, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'investigationId' | 'nodeId' | 'moduleId'>): void => {
      if (this.repo.addSuggestion({ ...s, investigationId: invId, nodeId: input.id, moduleId: m.id })) stats.review++
    }

    // Observations : nœuds, liens et propriétés vus par ce module lors de cette exécution.
    const runId = opts.runId ?? this.repo.lastRunId(invId, input.id, m.id) ?? ''
    const observedAt = Date.now()
    const observations: ObservationInput[] = []
    const observedEdges = new Set<string>()
    const observe = (nodeId: string, edgeId: string | null, property: string | null, sourceUrl: string | null): void => {
      observations.push({ investigationId: invId, nodeId, edgeId, property, runId, moduleId: m.id, sourceUrl, observedAt })
      if (edgeId) observedEdges.add(edgeId)
    }
    // Page où le module a vu le résultat : celle qu'il donne pour l'entrée, sinon l'URL de l'entrée.
    const pageUrl = sourceUrlOf(output.properties) ?? sourceUrlOf(input.data)

    if (output.properties && Object.keys(output.properties).length) {
      const merged = this.repo.mergeProps(input.id, output.properties, false)
      if (merged) {
        changedNodes.set(merged.node.id, merged.node)
        for (const key of merged.keys) observe(input.id, null, key, pageUrl)
      }
    }

    const refs = new Map<string, GraphNode>([['$input', this.repo.getNode(input.id) ?? input]])
    // Page source par référence : une entité rattachée à une autre (`from`) a été vue sur sa page.
    const refUrls = new Map<string, string | null>([['$input', pageUrl]])
    const pending: Array<{ node: GraphNode; image?: string }> = []

    for (const ent of output.entities ?? []) {
      const label = String(ent.label ?? '').trim()
      if (!label) continue
      const platform = ent.platform ?? (ent.type === 'email' ? (emailProvider(label)?.id ?? null) : null)
      const key = dedupKey(ent.type, label, platform)
      let node = this.repo.findNodeByDedup(invId, key)
      const strength = ent.strength ?? defaultStrength(ent.type)
      const parent = refs.get(ent.from ?? '$input') ?? refs.get('$input')!
      const putAside = (reason: string, chain?: ChainSpec): void => {
        if (ent.ref) reviewRefs.set(ent.ref, { reason, chain })
        suggest({
          kind: 'entity',
          type: ent.type,
          label,
          platform,
          data: cleanData({ ...(ent.data ?? {}), ...(ent.image ? { __image: ent.image } : {}), ...(chain ? { __chain: { ...chain } } : {}) }),
          linkLabel: ent.linkLabel ?? '',
          url: typeof ent.data?.url === 'string' ? ent.data.url : null,
          reason
        })
      }
      // Résultat non vérifié et absent du graphe : il attend dans « À vérifier », comme les
      // entités rattachées à un résultat mis de côté (même motif).
      const aside = ent.from !== undefined ? reviewRefs.get(ent.from) : undefined
      if (!node && (ent.review || aside)) {
        putAside(ent.reviewReason ?? aside?.reason ?? '', aside?.chain)
        continue
      }
      // Enchaînement : lien fragile ou budget épuisé, l'entité attend aussi dans « À vérifier ».
      const verdict = !node && opts.admit ? opts.admit(strength, (parent.hop ?? 0) + 1) : null
      if (verdict) {
        putAside(verdict.reason, verdict.chain)
        continue
      }
      const source = sourceUrlOf(ent.data, true) ?? refUrls.get(ent.from ?? '$input') ?? sourceUrlOf(ent.data)
      let dataKeys: string[] = []
      if (node) {
        if (ent.data && Object.keys(ent.data).length) {
          const merged = this.repo.mergeProps(node.id, ent.data, false)
          if (merged) {
            node = merged.node
            dataKeys = merged.keys
          }
        }
      } else {
        const pos = this.placeChild(parent)
        const data = cleanData(ent.data ?? {})
        node = this.repo.upsertNodes(invId, [
          {
            kind: 'entity',
            type: ent.type,
            label,
            platform,
            data,
            x: pos.x,
            y: pos.y,
            source: m.id,
            hop: (parent.hop ?? 0) + 1
          }
        ])[0]
        dataKeys = Object.keys(data)
        stats.created?.push({ node, strength })
      }
      if (ent.ref) {
        refs.set(ent.ref, node)
        refUrls.set(ent.ref, sourceUrlOf(ent.data) ?? source)
      }
      changedNodes.set(node.id, node)
      inGraph++
      let edgeId: string | null = null
      if (node.id !== parent.id) {
        const existing = this.repo.findEdge(invId, parent.id, node.id)
        if (!existing) {
          // Aucun lien si le parent a été supprimé pendant l'exécution (voir Repo.upsertEdges).
          const saved = this.repo.upsertEdges(invId, [{ source: parent.id, target: node.id, label: ent.linkLabel ?? '', sourceModule: m.id }])
          changedEdges.push(...saved)
          edgeId = saved[0]?.id ?? null
        } else {
          edgeId = existing.id
          // Lien déjà posé par un autre module : on ajoute ce libellé (« registrar · hébergé chez »).
          const label = joinLabels(existing.label, ent.linkLabel)
          if (label !== existing.label) changedEdges.push(...this.repo.upsertEdges(invId, [{ ...existing, label }]))
        }
      }
      observe(node.id, edgeId, null, source)
      for (const k of dataKeys) observe(node.id, null, k, source)
      if (ent.image && !node.imageId) pending.push({ node, image: ent.image })
    }

    for (const link of output.links ?? []) {
      const a = refs.get(link.from)
      const b = refs.get(link.to)
      if (!a || !b || a.id === b.id) continue
      const existing = this.repo.findEdge(invId, a.id, b.id)
      const edge = existing ?? this.repo.upsertEdges(invId, [{ source: a.id, target: b.id, label: link.label ?? '', sourceModule: m.id }])[0]
      if (!edge) continue
      if (!existing) changedEdges.push(edge)
      observe(b.id, edge.id, null, refUrls.get(link.from) ?? pageUrl)
    }

    for (const check of output.manual ?? []) {
      if (!check.url || !check.label) continue
      suggest({ kind: 'manual', type: 'search_link', label: check.label, platform: null, data: {}, linkLabel: check.label, url: check.url, reason: check.hint ?? '' })
    }
    if (stats.review) this.emit('suggestions:changed', { investigationId: invId, nodeId: input.id })

    this.repo.addObservations(observations)

    for (const p of pending) {
      const updated = await this.attachImage(p.node, p.image!, ctx).catch(() => null)
      if (updated) changedNodes.set(updated.id, updated)
    }

    if (changedNodes.size || changedEdges.length || observations.length) {
      const corroboration = this.repo.corroboration(invId, {
        nodeIds: Array.from(new Set([...changedNodes.keys(), ...observations.map((o) => o.nodeId)])),
        edgeIds: Array.from(new Set([...observedEdges, ...changedEdges.map((e) => e.id)]))
      })
      this.emit('graph:changed', { investigationId: invId, nodes: Array.from(changedNodes.values()), edges: changedEdges, corroboration })
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
    found?: { type: string; label: string; platform?: string | null; data?: Record<string, PropValue> }
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
    const { __image, __chain, ...data } = s.data
    const entity: OutEntity =
      s.kind === 'entity'
        ? { type: s.type, label: s.label, platform: s.platform ?? undefined, data, linkLabel: s.linkLabel, image: typeof __image === 'string' ? __image : undefined }
        : found
          ? { type: found.type, label: found.label, platform: found.platform ?? undefined, data: { source_url: s.url, ...found.data }, linkLabel: s.label }
          : { type: 'search_link', label: `${s.label} : ${parent.label}`, data: { url: s.url, engine: s.label }, linkLabel: s.linkLabel }
    // Même chemin qu'un résultat de module : dédoublonnage, placement libre, image, événement,
    // observation rattachée à la dernière exécution du module sur le nœud d'origine.
    const ctx = this.createContext({ id: s.moduleId }, AbortSignal.timeout(30_000), [], undefined, s.investigationId)
    await this.applyOutput(parent, { id: s.moduleId }, { entities: [entity] }, ctx)
    done('accepted')
    // Résultat mis de côté par une chaîne : sa validation relance la chaîne, dans ses limites.
    // Sinon, avec l'enrichissement automatique, l'entité validée est enrichie à son tour.
    const resume = chainSpecOf(__chain)
    if (resume || this.settings.get().autoEnrich) {
      // Même plateforme que celle déduite par applyOutput (fournisseur pour un email).
      const platform = entity.platform ?? (entity.type === 'email' ? (emailProvider(entity.label)?.id ?? null) : null)
      const created = this.repo.findNodeByDedup(s.investigationId, dedupKey(entity.type, entity.label.trim(), platform))
      if (created && created.kind === 'entity') this.enrich(s.investigationId, created.id, undefined, resume ? { chain: resume } : {})
    }
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

/**
 * Page où l'information a été vue : `source_url`, sinon (hors `explicit`) l'URL du profil
 * (`url`, `profile_url`). Seules les adresses http(s) sont gardées.
 */
function sourceUrlOf(data: Record<string, PropValue> | undefined, explicit = false): string | null {
  if (!data) return null
  const keys = explicit ? ['source_url'] : ['source_url', 'url', 'profile_url']
  for (const k of keys) {
    const v = data[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim().slice(0, 2000)
  }
  return null
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
