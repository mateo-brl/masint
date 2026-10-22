import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron'
import exifr from 'exifr'
import type { ApiChannel, ApiMap } from '@shared/api'
import { captureUrlOf, isSignificantActivity } from '@shared/evidence'
import type { ActivityAction, ExportMeta, GraphEdge, GraphNode, LinkContext, Settings } from '@shared/types'
import { changedEdgeFields, changedNodeFields, edgeRefs, isLayoutOnly, nodeRef, nodeRefs, systemUser, type ActivityLog } from './activity'
import { buildArchive, duplicateInvestigation, importArchive } from './archive'
import { mergeData } from './merge'
import { applyAssistIdentity, assistedSearch, assistSession, needlesFor } from './assist'
import { openInvestigationBrowser, openLink, type PageCapture } from './browser'
import type { CaptureService } from './capture'
import { compactLater } from './db/database'
import type { Repo } from './db/repo'
import { createFetch, resetDispatchers } from './engine/http'
import { allModules, knownKeyIds, moduleInfo } from './engine/registry'
import type { Engine } from './engine/runner'
import type { SettingsService } from './settings'
import { takePendingOpen } from './openQueue'
import { checkForUpdates, installUpdate } from './updater'
import { creditsOf, RosoClient } from './modules/roso/_client'
import { SitesService } from './sites'

type Handler<C extends ApiChannel> = (...args: Parameters<ApiMap[C]>) => ReturnType<ApiMap[C]> | Promise<ReturnType<ApiMap[C]>>

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

export interface IpcDeps {
  repo: Repo
  settings: SettingsService
  engine: Engine
  getWindow: () => BrowserWindow | null
  emitGraph: (change: import('@shared/types').GraphChange) => void
  applySessionProxy: (s: Settings) => Promise<void>
  /** Journal d'activité : les actions de l'enquêteur y sont inscrites ici, à la source. */
  activity: ActivityLog
  captures: CaptureService
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

/** Rapport ou fichier d'export : action du journal selon le format. */
const exportAction = (meta: ExportMeta): ActivityAction => (meta.kind.startsWith('report') ? 'export.report' : 'export.file')

export function registerIpc(deps: IpcDeps): void {
  const { repo, settings, engine, getWindow, activity, captures } = deps

  const handle = <C extends ApiChannel>(channel: C, fn: Handler<C>): void => {
    ipcMain.handle(channel, (_event, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
  }

  // Dossier proposé par les boîtes Ouvrir / Enregistrer : le dernier utilisé pour ce genre de
  // fichier, sinon Images pour les photos et Documents pour le reste.
  type DirKind = 'export' | 'image' | 'archive'
  const dirFor = (kind: DirKind): string => {
    const saved = repo.getSetting<Partial<Record<DirKind, string>>>('dialogDirs', {})[kind]
    if (saved && existsSync(saved)) return saved
    return app.getPath(kind === 'image' ? 'pictures' : 'documents')
  }
  const rememberDir = (kind: DirKind, file: string): void => {
    repo.setSetting('dialogDirs', { ...repo.getSetting<Record<string, string>>('dialogDirs', {}), [kind]: dirname(file) })
  }

  // Journal : création et modification de nœuds et de liens. Un déplacement ou un
  // redimensionnement n'est ni relu ni inscrit ; les modifications successives d'un même
  // élément sont regroupées (voir ActivityLog.group).
  const journalNodes = (invId: string, inputs: Parameters<ApiMap['graph:upsertNodes']>[1], before: Map<string, GraphNode | null>, saved: GraphNode[]): void => {
    const inputById = new Map(inputs.filter((i) => i.id).map((i) => [i.id!, i]))
    const created: GraphNode[] = []
    const updated: GraphNode[] = []
    const fields = new Set<string>()
    for (const n of saved) {
      const input = inputById.get(n.id)
      if (input && isLayoutOnly(input)) continue
      const prev = before.get(n.id)
      if (!prev || prev.investigationId !== invId) {
        created.push(n)
        continue
      }
      const changed = changedNodeFields(prev, input ?? {})
      if (!changed.length) continue
      updated.push(n)
      for (const f of changed) fields.add(f)
    }
    if (created.length === 1) activity.group(invId, 'node.create', nodeRefs(created), [], [created[0].id])
    else if (created.length) activity.log(invId, 'node.create', nodeRefs(created))
    if (updated.length) activity.group(invId, 'node.update', nodeRefs(updated), Array.from(fields), updated.map((n) => n.id))
  }
  const labelOf = (nodeId: string): string => repo.getNode(nodeId)?.label ?? ''
  const journalEdges = (invId: string, inputs: Parameters<ApiMap['graph:upsertEdges']>[1], before: Map<string, GraphEdge | null>, saved: GraphEdge[]): void => {
    const inputById = new Map(inputs.filter((i) => i.id).map((i) => [i.id!, i]))
    const created: GraphEdge[] = []
    const updated: GraphEdge[] = []
    const fields = new Set<string>()
    for (const e of saved) {
      const prev = before.get(e.id)
      if (!prev || prev.investigationId !== invId) {
        created.push(e)
        continue
      }
      const changed = changedEdgeFields(prev, inputById.get(e.id) ?? { source: e.source, target: e.target })
      if (!changed.length) continue
      updated.push(e)
      for (const f of changed) fields.add(f)
    }
    if (created.length === 1) activity.group(invId, 'edge.create', edgeRefs(created, labelOf), [], [created[0].id])
    else if (created.length) activity.log(invId, 'edge.create', edgeRefs(created, labelOf))
    if (updated.length) activity.group(invId, 'edge.update', edgeRefs(updated, labelOf), Array.from(fields), updated.map((e) => e.id))
  }

  /** Capture proposée par le navigateur d'enquête quand l'enquête d'origine est connue. */
  const pageCapture = (ctx?: LinkContext): PageCapture | undefined => {
    if (!ctx?.investigationId || !repo.getInvestigation(ctx.investigationId)) return undefined
    return async (wc) => {
      const c = await captures.capture(wc, { investigationId: ctx.investigationId, nodeId: ctx.nodeId ?? null, via: 'browser' })
      return { sha256: c.manifestSha256 }
    }
  }

  // Enquêtes -----------------------------------------------------------------
  handle('investigations:list', () => repo.listInvestigations())
  handle('investigations:create', (input) => {
    const inv = repo.createInvestigation(input)
    activity.log(inv.id, 'investigation.create', { name: inv.name })
    return inv
  })
  handle('investigations:update', (id, patch) => repo.updateInvestigation(id, patch))
  handle('investigations:delete', (id) => {
    repo.deleteInvestigation(id)
    // Journal WAL vidé et fichier reconstruit après la réponse : rien ne reste de l'enquête.
    compactLater(repo.db)
  })
  handle('investigations:open', (id) => repo.getBundle(id))
  handle('investigations:duplicate', async (id) => {
    // Modifications en attente écrites d'abord : la copie emporte le journal complet.
    activity.flush(id)
    const source = repo.getInvestigation(id)
    const copy = await duplicateInvestigation(repo, id)
    activity.log(copy.id, 'investigation.duplicate', { source: { id, name: source?.name ?? '' } })
    activity.log(id, 'investigation.duplicate', { copy: { id: copy.id, name: copy.name } })
    return copy
  })
  handle('investigations:exportArchive', async (id) => {
    const inv = repo.getInvestigation(id)
    if (!inv) return null
    const win = getWindow()
    const opts = {
      defaultPath: join(dirFor('archive'), `${safeName(inv.name)}.masint`),
      filters: [{ name: 'Enquête MASINT', extensions: ['masint'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    rememberDir('archive', res.filePath)
    activity.flush(id)
    const buf = await buildArchive(repo, id)
    await writeFile(res.filePath, buf)
    // Empreinte de l'archive partagée : le journal dit quel fichier exact a quitté le poste.
    activity.log(id, 'archive.export', { file: basename(res.filePath), size: buf.length, sha256: sha256(buf) })
    return res.filePath
  })
  handle('investigations:importArchive', async () => {
    const win = getWindow()
    const opts = {
      defaultPath: dirFor('archive'),
      properties: ['openFile' as const],
      filters: [{ name: 'Enquête MASINT', extensions: ['masint', 'zip'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    rememberDir('archive', res.filePaths[0])
    const buf = await readFile(res.filePaths[0])
    const inv = await importArchive(repo, buf)
    activity.log(inv.id, 'archive.import', { file: basename(res.filePaths[0]), size: buf.length, sha256: sha256(buf) })
    return inv
  })

  // Graphe -------------------------------------------------------------------
  handle('graph:upsertNodes', (invId, nodes, opts) => {
    // État d'avant, pour le journal ; un simple déplacement n'est pas relu.
    const before = new Map<string, GraphNode | null>()
    for (const n of nodes) if (n.id && !isLayoutOnly(n)) before.set(n.id, repo.getNode(n.id))
    const saved = repo.upsertNodes(invId, nodes, opts)
    journalNodes(invId, nodes, before, saved)
    return saved
  })
  handle('graph:deleteNodes', (invId, ids) => {
    const nodes = repo.getNodes(ids).filter((n) => n.investigationId === invId)
    const removed = repo.deleteNodes(invId, ids)
    if (nodes.length) activity.log(invId, 'node.delete', { ...nodeRefs(nodes), ...(removed.length ? { removedEdges: removed.length } : {}) })
  })
  handle('graph:upsertEdges', (invId, edges, opts) => {
    const before = new Map<string, GraphEdge | null>()
    for (const e of edges) if (e.id) before.set(e.id, repo.getEdge(e.id))
    const saved = repo.upsertEdges(invId, edges, opts)
    journalEdges(invId, edges, before, saved)
    return saved
  })
  handle('graph:deleteEdges', (invId, ids) => {
    const edges = ids.map((id) => repo.getEdge(id)).filter((e): e is GraphEdge => !!e && e.investigationId === invId)
    const refs = edges.length ? edgeRefs(edges, labelOf) : null
    repo.deleteEdges(invId, ids)
    if (refs) activity.log(invId, 'edge.delete', refs)
  })
  handle('graph:mergeNodes', (invId, targetId, otherIds) => {
    const target = repo.getNode(targetId)
    if (!target) throw new Error('Nœud cible introuvable')
    const others = repo.getNodes(otherIds.filter((id) => id !== targetId))
    activity.log(invId, 'node.merge', { into: nodeRef(target), ...nodeRefs(others) })
    const data = mergeData(target, others)
    const notes = [target.notes, ...others.map((o) => o.notes)].filter(Boolean).join('\n\n')
    const [merged] = repo.upsertNodes(invId, [
      { id: targetId, data, notes, imageId: target.imageId ?? others.find((o) => o.imageId)?.imageId ?? null }
    ])
    const edges: GraphEdge[] = []
    const otherSet = new Set(others.map((o) => o.id))
    for (const e of repo.listEdges(invId)) {
      if (!otherSet.has(e.source) && !otherSet.has(e.target)) continue
      const source = otherSet.has(e.source) ? targetId : e.source
      const target2 = otherSet.has(e.target) ? targetId : e.target
      if (source === target2) continue
      const existing = repo.findEdge(invId, source, target2)
      if (existing) {
        // Lien déjà présent : on garde les deux libellés (« empreinte SHA-256 · empreinte MD5 »).
        const labels = [existing.label, e.label].filter(Boolean)
        const label = Array.from(new Set(labels.flatMap((l) => l.split(' · ')))).join(' · ')
        if (label !== existing.label) edges.push(...repo.upsertEdges(invId, [{ ...existing, label }]))
        continue
      }
      edges.push(...repo.upsertEdges(invId, [{ ...e, id: undefined, source, target: target2 }]))
    }
    repo.reassignNodeHistory(invId, Array.from(otherSet), targetId)
    const deletedEdgeIds = repo.deleteNodes(invId, Array.from(otherSet))
    const change = { investigationId: invId, nodes: [merged] as GraphNode[], edges, deletedNodeIds: Array.from(otherSet), deletedEdgeIds }
    return change
  })

  // Pièces jointes -------------------------------------------------------------
  handle('attachments:add', (invId, file) =>
    repo.addAttachment(invId, { name: file.name, mime: file.mime, data: Buffer.from(file.base64, 'base64') })
  )
  handle('attachments:pick', async (invId) => {
    const win = getWindow()
    const opts = {
      defaultPath: dirFor('image'),
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [{ name: 'Images', extensions: Object.keys(MIME_BY_EXT).map((e) => e.slice(1)) }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return []
    if (res.filePaths[0]) rememberDir('image', res.filePaths[0])
    const out = []
    for (const p of res.filePaths) {
      const mime = MIME_BY_EXT[extname(p).toLowerCase()] ?? 'application/octet-stream'
      out.push(repo.addAttachment(invId, { name: basename(p), mime, data: await readFile(p) }))
    }
    return out
  })
  handle('attachments:paste', async (invId) => {
    const { images, paths } = await readClipboard()
    const out = []
    // Fichiers image copiés dans l'explorateur : on lit les fichiers eux-mêmes.
    for (const p of paths) {
      const mime = MIME_BY_EXT[extname(p).toLowerCase()]
      if (!mime) continue
      try {
        const data = await readFile(p)
        if (data.length <= 50 * 1024 * 1024) out.push(repo.addAttachment(invId, { name: basename(p), mime, data }))
      } catch {
        /* fichier déplacé ou illisible : ignoré */
      }
    }
    if (out.length) return out
    // Image copiée depuis un navigateur ou une capture d'écran.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    images.forEach((img, i) =>
      out.push(repo.addAttachment(invId, { name: `image-collee-${stamp}${i ? `-${i + 1}` : ''}.${img.mime.split('/')[1] ?? 'png'}`, mime: img.mime, data: img.data }))
    )
    return out
  })
  handle('attachments:get', (id) => repo.getAttachment(id))
  handle('attachments:save', async (id) => {
    const att = repo.getAttachment(id)
    const blob = repo.getAttachmentData(id)
    if (!att || !blob) return null
    const win = getWindow()
    const ext = extname(att.name).slice(1)
    const opts = { defaultPath: join(dirFor('export'), safeName(att.name)), filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    rememberDir('export', res.filePath)
    await writeFile(res.filePath, blob.data)
    activity.log(att.investigationId, 'export.file', { kind: 'attachment', file: basename(res.filePath), size: blob.data.length, sha256: att.sha256 })
    return res.filePath
  })

  // Preuves --------------------------------------------------------------------
  handle('captures:list', (invId, nodeId) => repo.listCaptures(invId, nodeId))
  handle('captures:capture', async (invId, nodeId) => {
    const node = repo.getNode(nodeId)
    if (!node || node.investigationId !== invId) throw new Error('Nœud introuvable')
    const url = captureUrlOf(node)
    if (!url) throw new Error('Ce nœud n’a pas d’adresse web à capturer')
    return captures.captureUrl({ investigationId: invId, nodeId, url, parent: getWindow(), title: `MASINT · ${node.label}` })
  })

  // Journal d'activité ---------------------------------------------------------
  handle('activity:list', (invId, opts) => {
    activity.flush(invId)
    return { ...repo.listActivity(invId, opts ?? {}), counts: repo.activityCounts(invId) }
  })
  handle('activity:verify', (invId) => activity.verify(invId))
  handle('activity:report', (invId) => {
    const check = activity.verify(invId)
    const all = repo.allActivity(invId)
    return { entries: all.filter(isSignificantActivity), total: all.length, check }
  })
  handle('attachments:readBase64', (id) => repo.getAttachmentData(id)?.data.toString('base64') ?? null)
  handle('attachments:exif', async (id) => {
    const blob = repo.getAttachmentData(id)
    if (!blob) return null
    try {
      const parsed = await exifr.parse(blob.data, { gps: true, tiff: true, exif: true, xmp: false, icc: false })
      if (!parsed) return null
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (v instanceof Date) out[k] = v.toISOString()
        else if (v instanceof Uint8Array || (typeof v === 'object' && v !== null && !Array.isArray(v))) continue
        else out[k] = v
      }
      return out
    } catch {
      return null
    }
  })

  // Modules ------------------------------------------------------------------
  handle('modules:list', () => allModules().map((m) => moduleInfo(m, settings)))
  handle('modules:enrich', (invId, nodeId, moduleIds) => engine.enrich(invId, nodeId, moduleIds))
  handle('modules:cancel', (jobId) => engine.cancel(jobId))
  handle('modules:runs', (invId, nodeId) => repo.listRuns(invId, nodeId))
  handle('modules:runStats', (invId) => repo.runStats(invId))
  handle('modules:jobs', () => engine.listJobs())
  handle('suggestions:list', (invId, nodeId) => repo.listSuggestions(invId, nodeId))
  handle('suggestions:resolve', (id, action, found) => engine.resolveSuggestion(id, action, found))
  handle('assist:run', async (id) => {
    const s = repo.getSuggestion(id)
    const node = s ? repo.getNode(s.nodeId) : null
    if (!s?.url || !node) return { status: 'error' as const, url: '', title: '', matches: [], error: 'Recherche introuvable' }
    // Réglage « Capturer les pages consultées » : la page de résultats est gardée comme preuve.
    const capture = settings.get().assistCapture
      ? async (wc: Electron.WebContents) =>
          (await captures.capture(wc, { investigationId: s.investigationId, nodeId: s.nodeId, via: 'assist', requestedUrl: s.url! })).id
      : undefined
    const result = await assistedSearch({
      url: s.url,
      needles: needlesFor(node.type, node.label),
      parent: getWindow(),
      userAgent: settings.get().userAgent,
      title: `MASINT · ${s.label}`,
      capture
    })
    // Dernier résultat gardé en base : il revient à la réouverture de l'enquête. Une recherche
    // annulée (fenêtre fermée) ne remplace pas le résultat précédent.
    if (result.status !== 'cancelled') repo.setSuggestionAssist(id, { result, added: [], at: Date.now() })
    return result
  })
  handle('assist:markAdded', (id, url) => {
    const stored = repo.getSuggestion(id)?.assist
    if (stored && !stored.added.includes(url)) repo.setSuggestionAssist(id, { ...stored, added: [...stored.added, url] })
  })
  handle('modules:applicable', (nodeId) => {
    const node = repo.getNode(nodeId)
    return node ? engine.applicable(node) : { auto: [], accepted: [] }
  })
  handle('modules:setEnabled', (moduleId, enabled) => {
    const disabled = new Set(settings.get().disabledModules)
    if (enabled) disabled.delete(moduleId)
    else disabled.add(moduleId)
    settings.set({ disabledModules: Array.from(disabled) })
  })
  handle('modules:runRaw', (runId) => repo.getRunRaw(runId))

  // Paramètres -----------------------------------------------------------------
  handle('settings:get', () => settings.get())
  handle('settings:set', async (patch) => {
    const next = settings.set(patch)
    if (patch.proxy) {
      resetDispatchers()
      await deps.applySessionProxy(next)
    }
    if (patch.userAgent !== undefined || patch.lang) applyAssistIdentity(next)
    if (patch.globalConcurrency !== undefined) engine.slots.drain()
    return next
  })
  handle('proxy:newTorIdentity', async () => {
    const next = settings.set({ torSalt: randomBytes(8).toString('hex') })
    // Connexions gardées ouvertes fermées : elles resteraient sur les anciens circuits.
    resetDispatchers()
    await Promise.all([assistSession().closeAllConnections(), session.defaultSession.closeAllConnections()]).catch(() => undefined)
    return next
  })
  handle('secrets:list', () => settings.listSecrets(knownKeyIds()))
  handle('secrets:set', (id, value) => settings.setSecret(id, value))
  handle('secrets:delete', (id) => settings.deleteSecret(id))
  handle('secrets:security', () => settings.security())
  handle('proxy:test', async () => {
    const fetchFn = createFetch({ settings: settings.get() })
    try {
      // Un premier échec réseau est fréquent (connexion à froid, circuit Tor) : un second essai.
      const res = await fetchFn('https://check.torproject.org/api/ip', { timeoutMs: 20000 }).catch(async (e: unknown) => {
        if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e
        await new Promise((r) => setTimeout(r, 800))
        return fetchFn('https://check.torproject.org/api/ip', { timeoutMs: 20000 })
      })
      const tor = (await res.json()) as { IsTor: boolean; IP: string }
      let country: string | undefined
      try {
        const geo = (await (await fetchFn(`https://ipwho.is/${tor.IP}`, { timeoutMs: 10000 })).json()) as { country?: string }
        country = geo.country
      } catch {
        /* pays facultatif */
      }
      return { ok: true, ip: tor.IP, isTor: tor.IsTor, country }
    } catch (e) {
      return { ok: false, error: proxyErrorMessage(e, settings.get()) }
    }
  })

  handle('roso:status', async () => {
    // Contexte d'un module roso : même route réseau (proxy / Tor) que les scans.
    const m = allModules().find((x) => x.id === 'roso.email')
    if (!m) return { ok: false, error: 'roso.info' }
    try {
      const data = await new RosoClient(engine.createContext(m, AbortSignal.timeout(20000)), 'auth').status()
      const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
      return {
        ok: true,
        credits: creditsOf(data),
        bonusCredits: num(data.bonusCredits),
        dailyUsed: num(data.dailyUsed),
        creditsPerDay: num(data.creditsPerDay),
        tier: typeof data.tier === 'string' ? data.tier : undefined,
        captcha: data.scanCaptchaRequired === true
      }
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      const fr = settings.get().lang === 'fr'
      const error = timeout ? (fr ? 'roso.info ne répond pas (délai dépassé)' : 'roso.info is not answering (timed out)') : e instanceof Error ? e.message : String(e)
      return { ok: false, error }
    }
  })

  // Sites de recherche de pseudo ------------------------------------------------
  const sites = new SitesService(settings, engine, (p) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('sites:progress', p)
  })
  handle('sites:status', () => sites.status())
  handle('sites:updateDb', () => sites.updateDb())
  handle('sites:check', (tier) => sites.check(tier))
  handle('sites:cancelCheck', () => sites.cancel())

  // Exports ------------------------------------------------------------------
  handle('export:pdf', async (html, defaultName, meta) => {
    const parent = getWindow()
    const opts = { defaultPath: join(dirFor('export'), `${safeName(defaultName)}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] }
    const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    rememberDir('export', res.filePath)
    const dir = await mkdtemp(join(tmpdir(), 'masint-report-'))
    const file = join(dir, 'report.html')
    await writeFile(file, html, 'utf8')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: true } })
    try {
      await win.loadFile(file)
      await new Promise((r) => setTimeout(r, 400))
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.4, bottom: 0.5, left: 0.4, right: 0.4 },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      })
      await writeFile(res.filePath, pdf)
      if (meta) activity.log(meta.investigationId, exportAction(meta), { kind: meta.kind, file: basename(res.filePath), size: pdf.length, sha256: sha256(pdf) })
      return res.filePath
    } finally {
      win.destroy()
      await rm(dir, { recursive: true, force: true })
    }
  })
  handle('export:save', async (defaultName, filters, content, encoding, meta) => {
    const win = getWindow()
    const opts = { defaultPath: join(dirFor('export'), defaultName), filters }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    rememberDir('export', res.filePath)
    const data = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
    await writeFile(res.filePath, data)
    if (meta) activity.log(meta.investigationId, exportAction(meta), { kind: meta.kind, file: basename(res.filePath), size: data.length, sha256: sha256(data) })
    return res.filePath
  })

  // Application ----------------------------------------------------------------
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataPath: app.getPath('userData'), user: systemUser() }))
  handle('app:openExternal', (url) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  handle('app:openLink', (url, ctx) => openLink(url, settings.get(), pageCapture(ctx)))
  handle('browser:open', (url, ctx) => {
    openInvestigationBrowser(url, settings.get(), pageCapture(ctx))
  })
  handle('app:showInFolder', (path) => shell.showItemInFolder(path))
  handle('app:takePendingOpen', () => takePendingOpen())
  handle('update:check', () => checkForUpdates())
  handle('update:install', () => installUpdate())
}

/** Message compréhensible quand le test de connexion échoue (proxy ou Tor absent...). */
function proxyErrorMessage(e: unknown, s: Settings): string {
  const fr = s.lang === 'fr'
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause
  const code = cause?.code ?? ''
  const detail = cause?.message ?? (e instanceof Error ? e.message : String(e))
  const p = s.proxy
  const refused = /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|Socks|socket/i.test(`${code} ${detail}`)
  if (p.mode === 'tor' && refused)
    return fr
      ? `Tor ne répond pas sur 127.0.0.1:${p.torPort}. Lancez Tor (service tor, port 9050) ou Tor Browser (port 9150), puis réessayez.`
      : `Tor is not answering on 127.0.0.1:${p.torPort}. Start Tor (tor service, port 9050) or Tor Browser (port 9150), then try again.`
  if ((p.mode === 'http' || p.mode === 'socks5') && refused)
    return fr ? `Le proxy ${p.url || '(adresse vide)'} ne répond pas (${code || detail}).` : `The proxy ${p.url || '(empty address)'} is not answering (${code || detail}).`
  if (/timeout|aborted/i.test(`${detail}`)) return fr ? 'Délai dépassé : le réseau ne répond pas.' : 'Timed out: the network is not answering.'
  return fr ? `Connexion impossible : ${code ? `${code}, ` : ''}${detail}` : `Connection failed: ${code ? `${code}, ` : ''}${detail}`
}

/**
 * Contenu image du presse-papiers : données d'image (navigateur, capture d'écran) et chemins de
 * fichiers copiés dans l'explorateur. Les formats varient selon le système (`text/uri-list`,
 * `x-special/gnome-copied-files` sous Linux, liste de fichiers sous Windows, `public.file-url`
 * sous macOS) : on lit tous les types proposés et on garde ce qui ressemble à un fichier.
 */
async function readClipboard(): Promise<{ images: Array<{ mime: string; data: Buffer }>; paths: string[] }> {
  const images: Array<{ mime: string; data: Buffer }> = []
  const paths = new Set<string>()
  const addPath = (raw: string): void => {
    const l = raw.trim().replace(/^"|"$/g, '')
    if (!l) return
    try {
      if (l.startsWith('file://')) paths.add(fileURLToPath(l))
      else if ((/^[a-zA-Z]:\\/.test(l) || l.startsWith('/')) && MIME_BY_EXT[extname(l).toLowerCase()] && existsSync(l)) paths.add(l)
    } catch {
      /* chemin invalide */
    }
  }
  let items: Electron.ClipboardItem[] = []
  try {
    items = await clipboard.read()
  } catch {
    return { images, paths: [] }
  }
  for (const item of items)
    for (const type of item.types) {
      try {
        const value = await item.getType(type)
        if (!(value instanceof Blob)) continue
        const data = Buffer.from(await value.arrayBuffer())
        if (type.startsWith('image/')) {
          images.push({ mime: type, data })
          continue
        }
        // Liste de fichiers : UTF-16 sous Windows, texte ailleurs.
        const text = data.includes(0) && data.length % 2 === 0 ? data.toString('utf16le') : data.toString('utf8')
        for (const part of text.split(/[\r\n\0]+/)) addPath(part)
      } catch {
        /* type illisible : ignoré */
      }
    }
  return { images, paths: Array.from(paths) }
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'enquete'
}
