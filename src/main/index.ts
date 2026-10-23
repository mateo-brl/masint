import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, BrowserWindow, Menu, protocol, safeStorage, screen, session } from 'electron'
import { ATTACHMENT_PROTOCOL } from '@shared/api'
import { chromiumLocale } from '@shared/network'
import type { EventChannel, EventMap } from '@shared/api'
import type { Settings } from '@shared/types'
import { ActivityLog, actorName } from './activity'
import { openArchiveOnce } from './archive'
import { openDatabase, readStoredLang, vacuumIfPending } from './db/database'
import { Repo } from './db/repo'
import { moveNoiseToReview } from './cleanup'
import { applyAssistIdentity, ASSIST_PARTITION, assistSession, proxyConfig } from './assist'
import { closeInvestigationBrowsers, openLink } from './browser'
import { CaptureService, trackNavigation } from './capture'
import { Engine } from './engine/runner'
import { registerIpc } from './ipc'
import { queueOpen } from './openQueue'
import { configureSiteData } from './modules/username/_siteDb'
import { DEFAULT_SETTINGS, SettingsService, type Cipher } from './settings'
import { initUpdater } from './updater'

protocol.registerSchemesAsPrivileged([
  { scheme: ATTACHMENT_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

if (!app.requestSingleInstanceLock()) app.quit()

// Langue de Chromium alignée sur celle de MASINT : `navigator.language` du navigateur intégré
// reste cohérent avec son en-tête Accept-Language. Fixée au lancement (changement de langue
// pris en compte au redémarrage suivant).
app.commandLine.appendSwitch('lang', chromiumLocale(readStoredLang(join(app.getPath('userData'), 'masint.db')) ?? DEFAULT_SETTINGS.lang))

let mainWindow: BrowserWindow | null = null
let openFile: (path: string) => void = () => undefined
const pendingFiles: string[] = []

/** Archives `.masint` passées en argument (double-clic dans l'explorateur). */
function archivesFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => /\.masint$/i.test(a))
}
pendingFiles.push(...archivesFromArgv(process.argv))

function send<E extends EventChannel>(event: E, payload: EventMap[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload)
  }
}

const electronCipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  backend: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'system'),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b)
}

/**
 * Applique le proxy à la session de l'interface (tuiles de carte, images distantes) et à celle
 * du navigateur de recherche assistée.
 */
async function applySessionProxy(s: Settings): Promise<void> {
  const config = proxyConfig(s)
  await session.defaultSession.setProxy(config)
  await session.fromPartition(ASSIST_PARTITION).setProxy(config)
}

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** Taille et position de la dernière session, si elles tiennent encore sur un écran branché. */
function restoredState(repo: Repo): WindowState {
  const fallback: WindowState = { width: 1600, height: 960, maximized: false }
  const saved = repo.getSetting<WindowState | null>('windowState', null)
  if (!saved || !(saved.width > 0 && saved.height > 0)) return fallback
  if (saved.x === undefined || saved.y === undefined) return { ...fallback, ...saved }
  const area = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }).workArea
  const visible = saved.x < area.x + area.width - 100 && saved.x + saved.width > area.x + 100 && saved.y >= area.y - 20 && saved.y < area.y + area.height - 100
  return visible ? saved : { ...fallback, maximized: saved.maximized }
}

function saveWindowState(win: BrowserWindow, repo: Repo): void {
  try {
    const b = win.getNormalBounds()
    repo.setSetting('windowState', { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() || win.isFullScreen() })
  } catch {
    /* base déjà fermée ou fenêtre détruite : la taille ne sera pas retenue cette fois */
  }
}

function createWindow(repo: Repo, settings: SettingsService): BrowserWindow {
  const state = restoredState(repo)
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#050505',
    autoHideMenuBar: true,
    title: 'MASINT',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize()
    win.show()
  })
  win.on('close', () => saveWindowState(win, repo))
  // Avertissements et erreurs de l'interface recopiés dans la sortie standard (diagnostic).
  win.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') console.log(`[interface:${details.level}] ${details.message}`)
  })
  // Lien cliqué dans l'interface : navigateur d'enquête ou navigateur personnel (réglage `linkOpening`).
  win.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url, settings.get())
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
    openLink(url, settings.get())
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.on('second-instance', (_e, argv) => {
  for (const f of archivesFromArgv(argv)) openFile(f)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const db = openDatabase(join(app.getPath('userData'), 'masint.db'))
  const repo = new Repo(db)
  // Une seule fois : les liens de recherche et pseudos générés des anciennes enquêtes passent dans « À vérifier ».
  if (!repo.getSetting('noiseMovedToReview', false)) {
    try {
      const moved = moveNoiseToReview(repo)
      if (moved) console.log(`[masint] ${moved} résultats non vérifiés déplacés dans « À vérifier »`)
      repo.setSetting('noiseMovedToReview', true)
    } catch (e) {
      console.error('[masint] rangement des résultats non vérifiés', e)
    }
  }
  // Base des sites de pseudo : copie embarquée dans resources/, copie mise à jour dans le dossier utilisateur.
  configureSiteData({ bundledDir: join(__dirname, '../../resources/data'), userDir: join(app.getPath('userData'), 'sites') })
  const settings = new SettingsService(repo, electronCipher)
  // Journal d'activité : l'enquêteur est celui des paramètres, sinon la session du système.
  const activity = new ActivityLog(repo, () => actorName(settings.get()))
  const engine = new Engine(repo, settings, (event, payload) => send(event, payload as never), activity)
  const captures = new CaptureService({
    repo,
    settings,
    activity,
    notify: (investigationId, nodeId) => send('captures:changed', { investigationId, nodeId })
  })

  protocol.handle(ATTACHMENT_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const id = url.pathname.replace(/^\//, '')
    const blob = url.host === 'att' ? repo.getAttachmentData(id) : null
    if (!blob) return new Response('Not found', { status: 404 })
    return new Response(new Uint8Array(blob.data), {
      headers: { 'content-type': blob.mime, 'cache-control': 'max-age=31536000, immutable' }
    })
  })

  await applySessionProxy(settings.get())
  applyAssistIdentity(settings.get())
  // Redirections, statut et en-têtes des pages de la partition d'enquête (contexte des captures).
  trackNavigation(assistSession())

  registerIpc({
    repo,
    settings,
    engine,
    getWindow: () => mainWindow,
    emitGraph: (change) => send('graph:changed', change),
    applySessionProxy,
    activity,
    captures
  })

  initUpdater((s) => send('update:status', s), () => settings.get().autoUpdate)

  mainWindow = createWindow(repo, settings)
  mainWindow.on('closed', () => {
    mainWindow = null
    // Fermer MASINT ferme aussi les fenêtres du navigateur d'enquête.
    closeInvestigationBrowsers()
  })

  openFile = (path) => {
    void readFile(path)
      .then((buf) =>
        openArchiveOnce(repo, buf, (inv) =>
          activity.log(inv.id, 'archive.import', { file: basename(path), size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
        )
      )
      .then((inv) => {
        queueOpen(inv.id)
        send('app:openInvestigation', { id: inv.id })
      })
      .catch((e) => console.error('[archive]', e))
  }
  mainWindow.webContents.once('did-finish-load', () => {
    for (const f of pendingFiles.splice(0)) openFile(f)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(repo, settings)
  })
  // `before-quit` précède la fermeture des fenêtres : on enregistre leur taille avant de fermer la base.
  app.on('before-quit', () => {
    if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow, repo)
    // Modifications regroupées encore en attente : écrites avant la fermeture de la base.
    activity.dispose()
    // Compactage reporté d'une grosse base après la suppression d'une enquête.
    vacuumIfPending(db)
    db.close()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
