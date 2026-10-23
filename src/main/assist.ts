// Recherche assistée : une recherche que les modules ne peuvent pas faire seuls (moteur de
// recherche, annuaire inversé, service qui exige un compte) est ouverte dans une fenêtre de
// navigateur de MASINT. Elle part de la connexion de l'enquêteur, à travers son proxy ou Tor,
// avec une session persistante (une connexion à Truecaller ou Facebook est gardée). La fenêtre
// reste cachée tant que la page se charge seule ; elle s'affiche si un captcha, un bandeau de
// consentement récalcitrant ou une connexion demande une action, puis la recherche reprend.

import { app, BrowserWindow, session, type ProxyConfig, type WebContents } from 'electron'
import { browserLanguages } from '@shared/network'
import type { AssistFlow, AssistResult, Settings } from '@shared/types'
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import { FACEBOOK_IDENTIFY_URL, facebookExtract, runFacebookIdentify, type FlowPage } from './flows/facebook'
import { tellowsExtract } from './modules/phone/_tellows'
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

/**
 * Script exécuté dans la page : dit si elle attend une action (captcha, vérification anti-robot,
 * connexion) et, avec `consent`, refuse (à défaut accepte) un bandeau de consentement courant,
 * dont celui de Facebook (« Refuser les cookies optionnels »). Sans `consent`, aucun clic.
 */
export function inspectScript(consent: boolean): string {
  return `(() => {
  const text = (document.body?.innerText || '').slice(0, 20000)
  let consent = false
  if (${consent}) {
    const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit]')]
    const label = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase()
    const refuse = buttons.find((b) => /^(tout refuser|refuser tout|refuser|reject all|decline all|continuer sans accepter|refuser les cookies optionnels|decline optional cookies|autoriser uniquement les cookies essentiels|only allow essential cookies)$/.test(label(b)))
    const accept = buttons.find((b) => /^(tout accepter|accepter tout|accepter|accept all|j'accepte|i agree|agree)$/.test(label(b)))
    if (refuse || accept) { (refuse || accept).click(); consent = true }
  }
  const captcha = !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], #captcha, .g-recaptcha, [id*="captcha" i]')
    || /unusual traffic|trafic inhabituel|not a robot|pas un robot|verify you are human|vérifiez que vous êtes|checking your browser|vérification de votre navigateur|access denied|accès refusé|are you a human|êtes-vous un humain|vérification de sécurité en cours|performing security verification|n[’']êtes pas un bot|you are not a bot|checking if the site connection is secure/i.test(text)
    || /^(just a moment|un instant|einen moment|un momento)/i.test(document.title || '')
  const login = [...document.querySelectorAll('input[type=password]')].some((i) => i.offsetParent !== null)
  return { ready: document.readyState === 'complete', consent, captcha, login, title: document.title, length: text.length, links: document.querySelectorAll('a[href]').length }
})()`
}

export const INSPECT = inspectScript(true)
/** Inspection sans aucun clic, pour les parcours scriptés une fois la valeur saisie. */
export const INSPECT_PASSIVE = inspectScript(false)

/** Script d'extraction : liens et blocs de la page qui contiennent l'une des valeurs cherchées. */
export function extractScript(needles: { text: string[]; digits: string[] }): string {
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
  const seen = new Map()
  for (const a of document.querySelectorAll('a[href]')) {
    let href = a.href
    if (!/^https?:/i.test(href)) continue
    try {
      const u = new URL(href)
      // Liens de redirection des moteurs (google.com/url?q=...).
      const q = u.searchParams.get('q') || u.searchParams.get('url') || u.searchParams.get('uddg')
      if (engines.test(u.hostname) && q && /^https?:/i.test(q)) href = q
      // Résultat Google à adresse opaque (/goto) : le lien est gardé tel quel, il redirige.
      const opaque = /(^|\\.)google\\./i.test(u.hostname) && u.pathname === '/goto'
      const target = new URL(href)
      if (!opaque && (engines.test(target.hostname) || (engines.test(host) && target.hostname === host))) continue
    } catch { continue }
    // Bloc cherché à partir du parent : un lien titre de classe « result » (Startpage) n'est pas
    // son propre bloc, l'extrait garde la description du résultat.
    const block = (a.parentElement || a).closest('li, article, tr, [data-hveid], [class*="result" i], [class*="card" i], div') || a
    const title = (a.querySelector('h3, h2')?.innerText || a.innerText || a.title || '').trim().split('\\n')[0].slice(0, 200)
    const snippet = (block.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 400)
    if (!hit(title + ' ' + snippet + ' ' + href)) continue
    const key = href.split('#')[0]
    // Même adresse déjà vue (icône ou adresse affichée du même résultat) : titre complété au besoin.
    const prev = seen.get(key)
    if (prev) {
      if (prev.title === key && title) prev.title = title
      continue
    }
    const entry = { title: title || key, url: key, snippet }
    seen.set(key, entry)
    out.push(entry)
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

/** Fenêtre cachée de la partition d'enquête, durcie, avec l'en-tête navigateur des modules. */
export function createAssistWindow(opts: { parent: BrowserWindow | null; userAgent: string; title: string }): {
  win: BrowserWindow
  isClosed: () => boolean
} {
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
  return { win, isClosed: () => closed || win.isDestroyed() }
}

/** Moteurs qui ont demandé une vérification : sautés (sauf en dernier recours) jusqu'à cette date. */
const blockedUntil = new Map<string, number>()
export const engineBlocked = (engine: string): boolean => Date.now() < (blockedUntil.get(engine) ?? 0)
export function markEngineBlocked(engine: string, ms = 60 * 60_000): void {
  blockedUntil.set(engine, Date.now() + ms)
}

/** Dernier chargement par moteur de recherche. */
const lastSearch = new Map<string, number>()
const SEARCH_HOSTS = /(^|\.)(google|startpage|bing|duckduckgo|qwant|ecosia|yandex)\.[a-z.]+$|(^|\.)search\.brave\.com$/i

/**
 * Espace les recherches sur un même moteur (5 à 10 s) : enchaînées sans pause, elles sont prises
 * pour un robot et déclenchent un captcha.
 */
async function paceHost(url: string): Promise<void> {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return
  }
  if (!SEARCH_HOSTS.test(host)) return
  const key = host.replace(/^www\./, '')
  const gap = 5000 + Math.random() * 5000
  const delay = (lastSearch.get(key) ?? 0) + gap - Date.now()
  lastSearch.set(key, Date.now() + Math.max(0, delay))
  if (delay > 0) await wait(delay)
}

/**
 * Charge une page et attend qu'elle soit prête : chargement terminé, adresse et nombre de liens
 * stables depuis 1,5 s, bandeau de consentement traité. Si un captcha ou une connexion demande
 * une action, la fenêtre s'affiche et l'attente reprend d'elle-même une fois la page libérée.
 */
export async function settlePage(
  win: BrowserWindow,
  isClosed: () => boolean,
  url: string,
  title: string,
  /** `abort` : un captcha met fin à l'attente sans afficher la fenêtre (un autre moteur prend le relais). */
  onChallenge: 'show' | 'abort' = 'show'
): Promise<'ready' | 'timeout' | 'cancelled' | 'challenged'> {
  await paceHost(url)
  await win.loadURL(url).catch(() => undefined)
  const start = Date.now()
  let stableSince = 0
  let lastUrl = ''
  let asked = false
  while (!isClosed()) {
    if (Date.now() - start > (asked ? ACTION_TIMEOUT : LOAD_TIMEOUT)) return 'timeout'
    const state = (await win.webContents.executeJavaScript(INSPECT).catch(() => null)) as {
      ready: boolean
      consent: boolean
      captcha: boolean
      login: boolean
      links: number
    } | null
    if (isClosed()) break
    if (state?.captcha && onChallenge === 'abort') return 'challenged'
    if (state && (state.captcha || state.login)) {
      // Action de l'enquêteur nécessaire : la fenêtre s'affiche, la recherche reprendra seule.
      if (!win.isVisible()) {
        win.setTitle(`${title} : terminez la vérification ou la connexion, la recherche reprendra seule`)
        win.show()
        win.focus()
      }
      asked = true
      stableSince = 0
    } else if (state?.ready && !state.consent) {
      // Page stable : même adresse et même nombre de liens depuis 1,5 s (les moteurs affichent
      // leurs résultats après le chargement).
      const current = `${win.webContents.getURL()}|${state.links}`
      if (current !== lastUrl) {
        lastUrl = current
        stableSince = Date.now()
      } else if (Date.now() - stableSince > 1500) {
        return 'ready'
      }
    }
    await wait(700)
  }
  return 'cancelled'
}

export async function assistedSearch(opts: {
  url: string
  needles: { text: string[]; digits: string[] }
  parent: BrowserWindow | null
  userAgent: string
  title: string
  /** Capture de la page de résultats avant la fermeture de la fenêtre ; renvoie l'identifiant de la capture. */
  capture?: (wc: WebContents) => Promise<string | null>
  /** `abort` : un captcha arrête la recherche sans afficher la fenêtre (résultat null). */
  onChallenge?: 'show' | 'abort'
}): Promise<AssistResult | null> {
  const { win, isClosed } = createAssistWindow(opts)
  const done = (r: Omit<AssistResult, 'url' | 'title'>): AssistResult => {
    const closed = isClosed()
    const res = { ...r, url: closed ? opts.url : win.webContents.getURL(), title: closed ? '' : win.webContents.getTitle() }
    if (!closed) win.destroy()
    return res
  }
  try {
    const state = await settlePage(win, isClosed, opts.url, opts.title, opts.onChallenge)
    if (state === 'challenged') {
      if (!isClosed()) win.destroy()
      return null
    }
    if (state === 'cancelled') return { status: 'cancelled', url: opts.url, title: '', matches: [] }
    if (state === 'timeout') return done({ status: 'timeout', matches: [] })
    const matches = (await win.webContents.executeJavaScript(extractScript(opts.needles)).catch(() => [])) as AssistMatch[]
    // Page de résultats conservée comme preuve (réglage « Capturer les pages consultées »).
    const captureId = opts.capture && !isClosed() ? await opts.capture(win.webContents).catch(() => null) : null
    if (isClosed()) return { status: 'cancelled', url: opts.url, title: '', matches: [] }
    return done({ status: 'ok', matches: Array.isArray(matches) ? matches : [], ...(captureId ? { captureId } : {}) })
  } catch (e) {
    return done({ status: 'error', matches: [], error: e instanceof Error ? e.message : String(e) })
  }
}

/** Page de la fenêtre d'assistance pour un parcours scripté (voir `FlowPage`). */
function flowPage(win: BrowserWindow, isClosed: () => boolean, title: string): FlowPage {
  return {
    run: async <T>(script: string): Promise<T | null> => {
      if (isClosed()) return null
      try {
        return (await win.webContents.executeJavaScript(script)) as T
      } catch {
        return null
      }
    },
    type: async (text) => {
      if (isClosed()) return
      await win.webContents.insertText(text)
      await wait(300)
    },
    enter: async () => {
      if (isClosed()) return
      for (const type of ['keyDown', 'char', 'keyUp'] as const) win.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter' })
    },
    show: () => {
      if (isClosed() || win.isVisible()) return
      win.setTitle(`${title} : terminez la vérification, la lecture reprendra seule`)
      win.show()
      win.focus()
    },
    closed: isClosed,
    sleep: wait
  }
}

/** Code de la page, sans action, pour l'analyse de la fiche Tellows. */
const TELLOWS_READ = `(() => (document.documentElement ? document.documentElement.outerHTML.slice(0, 2000000) : ''))()`

const FLOW_ERRORS: Record<string, { fr: string; en: string }> = {
  facebook_form: { fr: 'Formulaire de recherche de Facebook introuvable', en: 'Facebook search form not found' },
  facebook_typing: { fr: 'Saisie impossible dans le formulaire de Facebook', en: 'Could not type into the Facebook form' }
}

/**
 * Recherche assistée scriptée (`flow` d'une recherche manuelle) : la page est chargée dans la
 * fenêtre d'assistance (proxy ou Tor, session persistante, fenêtre affichée pour un captcha),
 * puis le parcours lit ce qui sert l'enquête, sans aucune action qui préviendrait la cible.
 */
export async function assistedFlow(opts: {
  flow: AssistFlow
  /** Valeur cherchée : numéro E.164 ou email. */
  value: string
  url: string
  parent: BrowserWindow | null
  userAgent: string
  title: string
  lang: 'fr' | 'en'
  capture?: (wc: WebContents) => Promise<string | null>
}): Promise<AssistResult> {
  const start = opts.flow === 'facebook_identify' ? FACEBOOK_IDENTIFY_URL : opts.url
  const { win, isClosed } = createAssistWindow(opts)
  const cancelled: AssistResult = { status: 'cancelled', url: start, title: '', matches: [] }
  const done = async (r: Omit<AssistResult, 'url' | 'title'>): Promise<AssistResult> => {
    if (isClosed()) return cancelled
    // Page lue conservée comme preuve (réglage « Capturer les pages consultées »).
    const captureId = opts.capture ? await opts.capture(win.webContents).catch(() => null) : null
    if (isClosed()) return cancelled
    const res: AssistResult = { ...r, url: win.webContents.getURL(), title: win.webContents.getTitle(), ...(captureId ? { captureId } : {}) }
    win.destroy()
    return res
  }
  try {
    const loaded = await settlePage(win, isClosed, start, opts.title)
    if (loaded === 'cancelled') return cancelled
    if (loaded === 'timeout') return await done({ status: 'timeout', matches: [] })
    if (opts.flow === 'facebook_identify') {
      const outcome = await runFacebookIdentify(flowPage(win, isClosed, opts.title), opts.value, (page) =>
        page.run<{ captcha: boolean }>(INSPECT_PASSIVE)
      )
      if (outcome.status === 'cancelled') return cancelled
      const extracted = facebookExtract(outcome.read, opts.value)
      const code = outcome.error?.split(':')[0]
      const error = code ? (FLOW_ERRORS[code]?.[opts.lang] ?? outcome.error) : undefined
      return await done({ status: outcome.status, matches: [], extracted, ...(error ? { error } : {}) })
    }
    // Fiche Tellows : page lue telle quelle (aucune action), analysée comme par `phone.tellows`.
    const phone = parsePhoneNumberFromString(opts.value)
    if (opts.flow === 'tellows' && phone) {
      const html = await flowPage(win, isClosed, opts.title).run<string>(TELLOWS_READ)
      if (isClosed()) return cancelled
      return await done({ status: 'ok', matches: [], extracted: tellowsExtract(html, phone, win.webContents.getURL(), opts.lang) })
    }
    return await done({ status: 'error', matches: [], error: `flow ${opts.flow}` })
  } catch (e) {
    if (isClosed()) return cancelled
    const res: AssistResult = { status: 'error', url: start, title: '', matches: [], error: e instanceof Error ? e.message : String(e) }
    win.destroy()
    return res
  }
}
