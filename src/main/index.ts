import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, protocol, safeStorage, session, shell } from 'electron'
import { ATTACHMENT_PROTOCOL } from '@shared/api'
import type { EventChannel, EventMap } from '@shared/api'
import type { Settings } from '@shared/types'
import { importArchive } from './archive'
import { openDatabase } from './db/database'
import { Repo } from './db/repo'
import { Engine } from './engine/runner'
import { registerIpc } from './ipc'
import { queueOpen } from './openQueue'
import { SettingsService, type Cipher } from './settings'
import { initUpdater } from './updater'

protocol.registerSchemesAsPrivileged([
  { scheme: ATTACHMENT_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

if (!app.requestSingleInstanceLock()) app.quit()

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
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b)
}

/** Applique le proxy à la session de l'interface (tuiles de carte, images distantes). */
async function applySessionProxy(s: Settings): Promise<void> {
  const p = s.proxy
  let proxyRules = ''
  if (p.mode === 'tor') proxyRules = `socks5://127.0.0.1:${p.torPort || 9050}`
  else if (p.mode !== 'none' && p.url.trim()) proxyRules = p.url.trim()
  await session.defaultSession.setProxy(proxyRules ? { proxyRules, proxyBypassRules: '<local>' } : { mode: 'direct' })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
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
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
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
  const settings = new SettingsService(repo, electronCipher)
  const engine = new Engine(repo, settings, (event, payload) => send(event, payload as never))

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

  registerIpc({
    repo,
    settings,
    engine,
    getWindow: () => mainWindow,
    emitGraph: (change) => send('graph:changed', change),
    applySessionProxy
  })

  initUpdater((s) => send('update:status', s), settings.get().autoUpdate)

  mainWindow = createWindow()
  mainWindow.on('closed', () => (mainWindow = null))

  openFile = (path) => {
    void readFile(path)
      .then((buf) => importArchive(repo, buf))
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
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
  app.on('before-quit', () => db.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
