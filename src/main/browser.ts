// Navigateur d'enquête : les liens d'une enquête (profil trouvé, résultat à vérifier, lien de
// recherche) s'ouvrent dans une fenêtre de MASINT plutôt que dans le navigateur personnel de
// l'enquêteur. Même partition, même proxy ou Tor et même durcissement que la recherche
// assistée : ni l'adresse IP réelle quand un proxy est actif, ni les sessions ouvertes de
// l'enquêteur (LinkedIn, par exemple, signale au titulaire qui a consulté son profil).
//
// La fenêtre a deux vues : une barre minimale (précédent, suivant, recharger, adresse en
// lecture seule, réseau utilisé, capture de la page, ouverture dans le navigateur personnel)
// et la page. La barre est une page locale sans accès au réseau ni à Node ; ses boutons parlent
// au processus principal par la console, qu'il écoute.

import { join } from 'node:path'
import { BaseWindow, nativeTheme, shell, WebContentsView, type WebContents } from 'electron'
import { opensInternally, proxyActive } from '@shared/network'
import type { Settings } from '@shared/types'
import { assistSession, hardenWebContents } from './assist'

const BAR_HEIGHT = 44
/** Préfixe des commandes envoyées par la barre (`console.log`). */
const COMMAND = 'masint-browser:'

const TEXT = {
  fr: {
    back: 'Précédent (Alt+Gauche)',
    forward: 'Suivant (Alt+Droite)',
    reload: 'Recharger (F5)',
    capture: 'Capturer la page',
    captureHint: 'Enregistre la page comme preuve : image pleine page, archive MHTML et contexte, avec leurs empreintes SHA-256 (Ctrl+Maj+S).',
    capturing: 'Capture…',
    captured: 'Page capturée',
    captureFailed: 'Échec de la capture',
    external: 'Ouvrir dans mon navigateur',
    externalHint: 'Quitte le proxy ou Tor et utilise vos sessions ouvertes : la cible peut voir votre visite.',
    tor: 'via Tor',
    proxy: 'via proxy',
    direct: 'connexion directe'
  },
  en: {
    back: 'Back (Alt+Left)',
    forward: 'Forward (Alt+Right)',
    reload: 'Reload (F5)',
    capture: 'Capture page',
    captureHint: 'Saves the page as evidence: full-page image, MHTML archive and context, with their SHA-256 hashes (Ctrl+Shift+S).',
    capturing: 'Capturing…',
    captured: 'Page captured',
    captureFailed: 'Capture failed',
    external: 'Open in my browser',
    externalHint: 'Leaves the proxy or Tor and uses your open sessions: the target may see your visit.',
    tor: 'via Tor',
    proxy: 'via proxy',
    direct: 'direct connection'
  }
}

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

/** Réseau utilisé par la fenêtre, affiché dans la barre. */
function routeOf(s: Settings): 'tor' | 'proxy' | 'direct' {
  if (s.proxy.mode === 'tor') return 'tor'
  return proxyActive(s.proxy) ? 'proxy' : 'direct'
}

/** Thème sombre affiché ? « system » suit le réglage du système. */
function isDark(s: Settings): boolean {
  return s.theme === 'system' ? nativeTheme.shouldUseDarkColors : s.theme !== 'light'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// Icônes au trait (même dessin que lucide).
const ICONS = {
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  capture:
    '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
}
const svg = (body: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

/** Page de la barre d'outils (adresse de type `data:`, aucun accès au réseau). */
export function toolbarHtml(s: Settings, opts: { capture?: boolean } = {}): string {
  const t = TEXT[s.lang] ?? TEXT.fr
  const dark = isDark(s)
  const route = routeOf(s)
  const c = dark
    ? { bg: '#0e0e10', border: '#232327', text: '#ededef', muted: '#8d8d93', hover: '#1b1b1f', field: '#141417', ok: '#30a46c', warn: '#f5a524' }
    : { bg: '#ffffff', border: '#e4e4e7', text: '#18181b', muted: '#63636b', hover: '#e9e9ec', field: '#f4f4f5', ok: '#15803d', warn: '#b45309' }
  return `<!doctype html><html lang="${s.lang}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}
body{display:flex;align-items:center;gap:4px;padding:0 8px;background:${c.bg};color:${c.text};border-bottom:1px solid ${c.border};
font:12.5px system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none}
button{display:flex;align-items:center;gap:6px;height:30px;min-width:30px;justify-content:center;padding:0 8px;border:0;border-radius:8px;
background:transparent;color:${c.muted};font:inherit;cursor:pointer}
button:hover:not(:disabled){background:${c.hover};color:${c.text}}button:disabled{opacity:.35;cursor:default}
#url{flex:1;min-width:0;height:30px;line-height:30px;padding:0 10px;border-radius:8px;background:${c.field};
font:11.5px ui-monospace,"JetBrains Mono",monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:text;cursor:text}
#route{padding:2px 8px;border-radius:999px;border:1px solid ${route === 'direct' ? c.warn : c.ok};color:${route === 'direct' ? c.warn : c.ok};
font-size:11px;white-space:nowrap}
.loading #reload svg{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
#capture{color:${c.text}}#status{font-size:11px;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
#status.ok{color:${c.ok}}#status.error{color:${c.warn}}
</style></head><body>
<button id="back" title="${escapeHtml(t.back)}" disabled>${svg(ICONS.back)}</button>
<button id="forward" title="${escapeHtml(t.forward)}" disabled>${svg(ICONS.forward)}</button>
<button id="reload" title="${escapeHtml(t.reload)}">${svg(ICONS.reload)}</button>
<div id="url"></div>
<span id="route">${escapeHtml(t[route])}</span>
${opts.capture ? `<span id="status"></span><button id="capture" title="${escapeHtml(t.captureHint)}">${svg(ICONS.capture)}<span>${escapeHtml(t.capture)}</span></button>` : ''}
<button id="external" title="${escapeHtml(t.externalHint)}">${svg(ICONS.external)}<span>${escapeHtml(t.external)}</span></button>
<script>
for (const id of ['back', 'forward', 'reload', 'capture', 'external'])
  document.getElementById(id)?.addEventListener('click', () => console.log(${JSON.stringify(COMMAND)} + id))
const CAPTURE_TEXT = ${JSON.stringify({ busy: t.capturing, ok: t.captured, error: t.captureFailed })}
window.setCapture = (s) => {
  const button = document.getElementById('capture')
  const status = document.getElementById('status')
  if (!button || !status) return
  button.disabled = s.state === 'busy'
  status.className = s.state
  status.textContent = s.state === 'idle' ? '' : CAPTURE_TEXT[s.state] + (s.detail ? ' · ' + s.detail : '')
  status.title = s.title || ''
}
window.setState = (s) => {
  const url = document.getElementById('url')
  url.textContent = s.url
  url.title = s.title ? s.title + '\\n' + s.url : s.url
  document.getElementById('back').disabled = !s.back
  document.getElementById('forward').disabled = !s.forward
  document.body.classList.toggle('loading', !!s.loading)
}
</script></body></html>`
}

/** Fenêtres ouvertes, gardées pour ne pas être collectées. */
const windows = new Set<BaseWindow>()

/** Capture de la page affichée, fournie par l'appelant quand le contexte d'enquête est connu. */
export type PageCapture = (wc: WebContents) => Promise<{ sha256: string }>

/**
 * Ouvre une page dans une fenêtre visible du navigateur d'enquête. Avec `capture`, la barre
 * propose « Capturer la page » (preuve rattachée à l'enquête et au nœud d'origine).
 */
export function openInvestigationBrowser(url: string, settings: Settings, capture?: PageCapture): BaseWindow | null {
  if (!isWeb(url)) return null
  const win = new BaseWindow({
    width: 1200,
    height: 860,
    minWidth: 520,
    minHeight: 320,
    title: `MASINT · ${url}`,
    icon: join(__dirname, '../../resources/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: isDark(settings) ? '#0e0e10' : '#ffffff'
  })
  windows.add(win)

  // Barre : partition en mémoire, sans réseau ni Node ; elle ne peut pas naviguer.
  const bar = new WebContentsView({
    webPreferences: { partition: 'masint-browser-bar', sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })
  // Page : session du navigateur intégré (proxy ou Tor, aucune permission, WebRTC limité au proxy).
  const page = new WebContentsView({
    webPreferences: { session: assistSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })
  const pw = page.webContents
  hardenWebContents(pw)
  pw.setUserAgent(settings.userAgent)
  win.contentView.addChildView(bar)
  win.contentView.addChildView(page)

  const layout = (): void => {
    const { width, height } = win.getContentBounds()
    bar.setBounds({ x: 0, y: 0, width, height: BAR_HEIGHT })
    page.setBounds({ x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) })
  }
  layout()
  win.on('resize', layout)
  win.on('maximize', layout)
  win.on('unmaximize', layout)
  win.on('enter-full-screen', layout)
  win.on('leave-full-screen', layout)

  // État affiché : adresse dans le titre de la fenêtre et dans la barre (lecture seule).
  let barReady = false
  const sync = (): void => {
    if (win.isDestroyed() || pw.isDestroyed()) return
    const current = pw.getURL() || url
    const title = pw.getTitle()
    win.setTitle(`MASINT · ${current}`)
    if (!barReady || bar.webContents.isDestroyed()) return
    const state = {
      url: current,
      title: title && title !== current ? title : '',
      back: pw.navigationHistory.canGoBack(),
      forward: pw.navigationHistory.canGoForward(),
      loading: pw.isLoading()
    }
    void bar.webContents.executeJavaScript(`setState(${JSON.stringify(state)})`).catch(() => undefined)
  }
  bar.webContents.once('did-finish-load', () => {
    barReady = true
    sync()
  })
  for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading'] as const)
    pw.on(event as 'did-start-loading', sync)

  // Capture : une à la fois, résultat affiché quelques secondes dans la barre.
  let capturing = false
  let clearStatus: ReturnType<typeof setTimeout> | null = null
  const setCapture = (state: { state: 'idle' | 'busy' | 'ok' | 'error'; detail?: string; title?: string }): void => {
    if (!barReady || bar.webContents.isDestroyed()) return
    void bar.webContents.executeJavaScript(`setCapture(${JSON.stringify(state)})`).catch(() => undefined)
  }
  const runCapture = async (): Promise<void> => {
    if (!capture || capturing || pw.isDestroyed()) return
    capturing = true
    if (clearStatus) clearTimeout(clearStatus)
    setCapture({ state: 'busy' })
    try {
      const { sha256 } = await capture(pw)
      setCapture({ state: 'ok', detail: `SHA-256 ${sha256.slice(0, 12)}…`, title: sha256 })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setCapture({ state: 'error', detail: message, title: message })
    } finally {
      capturing = false
      clearStatus = setTimeout(() => setCapture({ state: 'idle' }), 8000)
    }
  }

  const command = (cmd: string): void => {
    if (pw.isDestroyed()) return
    if (cmd === 'capture') void runCapture()
    else if (cmd === 'back' && pw.navigationHistory.canGoBack()) pw.navigationHistory.goBack()
    else if (cmd === 'forward' && pw.navigationHistory.canGoForward()) pw.navigationHistory.goForward()
    else if (cmd === 'reload') pw.reload()
    else if (cmd === 'external') {
      const current = pw.getURL() || url
      if (isWeb(current)) void shell.openExternal(current)
    }
  }
  bar.webContents.on('console-message', (details) => {
    const message = details.message
    if (message.startsWith(COMMAND)) command(message.slice(COMMAND.length))
  })
  lockToolbar(bar.webContents)

  // Raccourcis habituels d'un navigateur dans la page.
  pw.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key
    if (key === 'F5' || ((input.control || input.meta) && key.toLowerCase() === 'r')) command('reload')
    else if ((input.control || input.meta) && input.shift && key.toLowerCase() === 's' && capture) command('capture')
    else if (input.alt && key === 'ArrowLeft') command('back')
    else if (input.alt && key === 'ArrowRight') command('forward')
    else return
    e.preventDefault()
  })
  // Fenêtres surgissantes : chargées dans la même vue, avec le même réseau.
  pw.setWindowOpenHandler(({ url: next }) => {
    if (isWeb(next)) void pw.loadURL(next).catch(() => undefined)
    return { action: 'deny' }
  })
  // Seules les adresses web s'ouvrent ici (pas de fichier local ni d'application externe).
  pw.on('will-navigate', (e, next) => {
    if (!isWeb(next)) e.preventDefault()
  })

  win.on('closed', () => {
    windows.delete(win)
    if (clearStatus) clearTimeout(clearStatus)
    for (const wc of [pw, bar.webContents]) if (!wc.isDestroyed()) wc.close()
  })

  void bar.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHtml(settings, { capture: !!capture }))}`)
  void pw.loadURL(url).catch(() => undefined)
  return win
}

/** Ferme les fenêtres du navigateur d'enquête (fermeture de la fenêtre principale). */
export function closeInvestigationBrowsers(): void {
  for (const win of windows) if (!win.isDestroyed()) win.close()
}

/** La barre ne navigue jamais et n'ouvre aucune fenêtre. */
function lockToolbar(wc: WebContents): void {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e) => e.preventDefault())
}

/**
 * Ouvre un lien d'enquête selon le réglage `linkOpening` : navigateur d'enquête (proxy ou
 * Tor, session isolée) ou navigateur personnel de l'enquêteur.
 */
export function openLink(url: string, settings: Settings, capture?: PageCapture): void {
  if (!isWeb(url)) return
  if (opensInternally(settings)) openInvestigationBrowser(url, settings, capture)
  else void shell.openExternal(url)
}
