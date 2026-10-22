// Recherche assistée : une recherche que les modules ne peuvent pas faire seuls (moteur de
// recherche, annuaire inversé, service qui exige un compte) est ouverte dans une fenêtre de
// navigateur de MASINT. Elle part de la connexion de l'enquêteur, à travers son proxy ou Tor,
// avec une session persistante (une connexion à Truecaller ou Facebook est gardée). La fenêtre
// reste cachée tant que la page se charge seule ; elle s'affiche si un captcha, un bandeau de
// consentement récalcitrant ou une connexion demande une action, puis la recherche reprend.

import { app, BrowserWindow, session, type ProxyConfig, type WebContents } from 'electron'
import { browserLanguages } from '@shared/network'
import type { AssistResult, Settings } from '@shared/types'
export { needlesFor } from '@shared/needles'

/** Partition du navigateur intégré : recherche assistée et navigateur d'enquête. */
export const ASSIST_PARTITION = 'persist:masint-assist'

/**
 * WebRTC n'utilise que le proxy : sans cela, une page qui crée un `RTCPeerConnection` lit les
 * adresses IP locales (et l'IP publique par STUN en UDP) même derrière Tor.
 */
export function hardenWebContents(wc: WebContents): void {
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
}

export function proxyConfig(s: Settings): ProxyConfig {
  const p = s.proxy
  let proxyRules = ''
  if (p.mode === 'tor') proxyRules = `socks5://127.0.0.1:${p.torPort || 9050}`
  else if (p.mode !== 'none' && p.url.trim()) proxyRules = p.url.trim()
  return proxyRules ? { proxyRules, proxyBypassRules: '<local>' } : { mode: 'direct' }
}

export type AssistMatch = AssistResult['matches'][number]

/** Délai laissé à l'enquêteur pour un captcha ou une connexion. */
const ACTION_TIMEOUT = 4 * 60_000
/** Délai de chargement sans action de l'enquêteur. */
const LOAD_TIMEOUT = 45_000

let hardened = false
/**
 * Session dédiée : aucune permission (caméra, notifications, ouverture d'applications
 * externes...), aucun téléchargement, WebRTC limité au proxy pour toute page qui s'y ouvre.
 */
export function assistSession(): Electron.Session {
  const ses = session.fromPartition(ASSIST_PARTITION)
  if (!hardened) {
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', (e) => e.preventDefault())
    // Toute page de la partition, y compris une fenêtre qui ne passerait pas par nos fonctions.
    app.on('web-contents-created', (_e, wc) => {
      if (wc.session === ses) hardenWebContents(wc)
    })
    hardened = true
  }
  return ses
}

/**
 * En-tête navigateur et langues de la session : les mêmes que les requêtes des modules,
 * construits d'après le vrai système (voir `buildUserAgent`), pour une empreinte cohérente.
 */
export function applyAssistIdentity(s: Settings): void {
  assistSession().setUserAgent(s.userAgent, browserLanguages(s.lang))
}

// Script exécuté dans la page : accepte ou refuse un bandeau de consentement courant et dit
// si la page attend une action (captcha, vérification anti-robot, connexion).
const INSPECT = `(() => {
  const text = (document.body?.innerText || '').slice(0, 20000)
  const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit]')]
  const label = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase()
  const refuse = buttons.find((b) => /^(tout refuser|refuser tout|refuser|reject all|decline all|continuer sans accepter)$/.test(label(b)))
  const accept = buttons.find((b) => /^(tout accepter|accepter tout|accepter|accept all|j'accepte|i agree|agree)$/.test(label(b)))
  let consent = false
  if (refuse || accept) { (refuse || accept).click(); consent = true }
  const captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], #captcha, .g-recaptcha, [id*="captcha" i]')
    || /unusual traffic|trafic inhabituel|not a robot|pas un robot|verify you are human|vérifiez que vous êtes|checking your browser|vérification de votre navigateur|access denied|accès refusé|are you a human|êtes-vous un humain/i.test(text)
  const login = [...document.querySelectorAll('input[type=password]')].some((i) => i.offsetParent !== null)
  return { ready: document.readyState === 'complete', consent, captcha, login, title: document.title, length: text.length }
})()`

/** Script d'extraction : liens et blocs de la page qui contiennent l'une des valeurs cherchées. */
function extractScript(needles: { text: string[]; digits: string[] }): string {
  return `(() => {
  const needles = ${JSON.stringify(needles)}
  const fold = (s) => (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, ' ')
  const digits = (s) => (s || '').replace(/\\D+/g, '')
  const hit = (s) => {
    const f = fold(s)
    if (needles.text.some((n) => f.includes(n))) return true
    const d = digits(s)
    return needles.digits.some((n) => d.includes(n))
  }
  const engines = /(^|\\.)(google|bing|duckduckgo|yandex|qwant|startpage|ecosia|search\\.brave|yahoo)\\./i
  const host = location.hostname
  const out = []
  const seen = new Set()
  for (const a of document.querySelectorAll('a[href]')) {
    let href = a.href
    if (!/^https?:/i.test(href)) continue
    try {
      const u = new URL(href)
      // Liens de redirection des moteurs (google.com/url?q=...).
      const q = u.searchParams.get('q') || u.searchParams.get('url') || u.searchParams.get('uddg')
      if (engines.test(u.hostname) && q && /^https?:/i.test(q)) href = q
      const target = new URL(href)
      if (engines.test(target.hostname) || (engines.test(host) && target.hostname === host)) continue
    } catch { continue }
    const block = a.closest('li, article, tr, [data-hveid], [class*="result" i], [class*="card" i], div') || a
    const title = (a.innerText || a.title || '').trim().slice(0, 200)
    const snippet = (block.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 400)
    if (!hit(title + ' ' + snippet + ' ' + href)) continue
    const key = href.split('#')[0]
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title: title || key, url: key, snippet })
    if (out.length >= 20) break
  }
  // Page sans lien exploitable (fiche d'annuaire, résultat unique) : extrait autour de la valeur.
  if (!out.length) {
    const text = document.body?.innerText || ''
    const f = fold(text)
    let i = -1
    for (const n of needles.text) { i = f.indexOf(n); if (i >= 0) break }
    if (i >= 0) out.push({ title: document.title, url: location.href, snippet: text.slice(Math.max(0, i - 200), i + 300).replace(/\\s+/g, ' ').trim() })
  }
  return out
})()`
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function assistedSearch(opts: {
  url: string
  needles: { text: string[]; digits: string[] }
  parent: BrowserWindow | null
  userAgent: string
  title: string
}): Promise<AssistResult> {
  const win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 820,
    parent: opts.parent ?? undefined,
    title: opts.title,
    autoHideMenuBar: true,
    webPreferences: { session: assistSession(), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  let closed = false
  win.on('closed', () => (closed = true))
  hardenWebContents(win.webContents)
  win.webContents.setUserAgent(opts.userAgent)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void win.loadURL(url)
    return { action: 'deny' }
  })
  const done = (r: Omit<AssistResult, 'url' | 'title'>): AssistResult => {
    const res = { ...r, url: closed ? opts.url : win.webContents.getURL(), title: closed ? '' : win.webContents.getTitle() }
    if (!closed) win.destroy()
    return res
  }
  try {
    await win.loadURL(opts.url).catch(() => undefined)
    const start = Date.now()
    let stableSince = 0
    let lastUrl = ''
    let asked = false
    while (!closed) {
      if (Date.now() - start > (asked ? ACTION_TIMEOUT : LOAD_TIMEOUT)) return done({ status: 'timeout', matches: [] })
      const state = (await win.webContents.executeJavaScript(INSPECT).catch(() => null)) as {
        ready: boolean
        consent: boolean
        captcha: boolean
        login: boolean
      } | null
      if (closed) break
      if (state && (state.captcha || state.login)) {
        // Action de l'enquêteur nécessaire : la fenêtre s'affiche, la recherche reprendra seule.
        if (!win.isVisible()) {
          win.setTitle(`${opts.title} : terminez la vérification ou la connexion, la recherche reprendra seule`)
          win.show()
          win.focus()
        }
        asked = true
        stableSince = 0
      } else if (state?.ready && !state.consent) {
        const url = win.webContents.getURL()
        if (url !== lastUrl) {
          lastUrl = url
          stableSince = Date.now()
        } else if (Date.now() - stableSince > 1500) {
          const matches = (await win.webContents.executeJavaScript(extractScript(opts.needles)).catch(() => [])) as AssistMatch[]
          return done({ status: 'ok', matches: Array.isArray(matches) ? matches : [] })
        }
      }
      await wait(700)
    }
    return { status: 'cancelled', url: opts.url, title: '', matches: [] }
  } catch (e) {
    return done({ status: 'error', matches: [], error: e instanceof Error ? e.message : String(e) })
  }
}
