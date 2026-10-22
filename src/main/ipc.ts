import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import exifr from 'exifr'
import type { ApiChannel, ApiMap } from '@shared/api'
import type { GraphEdge, GraphNode, Settings } from '@shared/types'
import { buildArchive, duplicateInvestigation, importArchive } from './archive'
import { mergeData } from './merge'
import type { Repo } from './db/repo'
import { createFetch, resetDispatchers } from './engine/http'
import { allModules, knownKeyIds, moduleInfo } from './engine/registry'
import type { Engine } from './engine/runner'
import type { SettingsService } from './settings'
import { takePendingOpen } from './openQueue'
import { checkForUpdates, installUpdate } from './updater'
import { creditsOf, RosoClient } from './modules/roso/_client'

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
}

export function registerIpc(deps: IpcDeps): void {
  const { repo, settings, engine, getWindow } = deps

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

  // Enquêtes -----------------------------------------------------------------
  handle('investigations:list', () => repo.listInvestigations())
  handle('investigations:create', (input) => repo.createInvestigation(input))
  handle('investigations:update', (id, patch) => repo.updateInvestigation(id, patch))
  handle('investigations:delete', (id) => repo.deleteInvestigation(id))
  handle('investigations:open', (id) => repo.getBundle(id))
  handle('investigations:duplicate', (id) => duplicateInvestigation(repo, id))
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
    await writeFile(res.filePath, await buildArchive(repo, id))
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
    return importArchive(repo, await readFile(res.filePaths[0]))
  })

  // Graphe -------------------------------------------------------------------
  handle('graph:upsertNodes', (invId, nodes) => repo.upsertNodes(invId, nodes))
  handle('graph:deleteNodes', (invId, ids) => {
    repo.deleteNodes(invId, ids)
  })
  handle('graph:upsertEdges', (invId, edges) => repo.upsertEdges(invId, edges))
  handle('graph:deleteEdges', (invId, ids) => repo.deleteEdges(invId, ids))
  handle('graph:mergeNodes', (invId, targetId, otherIds) => {
    const target = repo.getNode(targetId)
    if (!target) throw new Error('Nœud cible introuvable')
    const others = repo.getNodes(otherIds.filter((id) => id !== targetId))
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
  handle('attachments:get', (id) => repo.getAttachment(id))
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
  handle('modules:jobs', () => engine.listJobs())
  handle('suggestions:list', (invId, nodeId) => repo.listSuggestions(invId, nodeId))
  handle('suggestions:resolve', (id, action, found) => engine.resolveSuggestion(id, action, found))
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

  // Exports ------------------------------------------------------------------
  handle('export:pdf', async (html, defaultName) => {
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
      return res.filePath
    } finally {
      win.destroy()
      await rm(dir, { recursive: true, force: true })
    }
  })
  handle('export:save', async (defaultName, filters, content, encoding) => {
    const win = getWindow()
    const opts = { defaultPath: join(dirFor('export'), defaultName), filters }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    rememberDir('export', res.filePath)
    await writeFile(res.filePath, encoding === 'base64' ? Buffer.from(content, 'base64') : content)
    return res.filePath
  })

  // Application ----------------------------------------------------------------
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, dataPath: app.getPath('userData') }))
  handle('app:openExternal', (url) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
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

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'enquete'
}
