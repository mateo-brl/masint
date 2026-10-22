// Capture de preuves, à la manière de Hunchly : une page affichée dans la partition d'enquête
// (navigateur d'enquête, recherche assistée, fenêtre cachée ouverte pour un nœud) est
// enregistrée telle que l'enquêteur la voit, avec de quoi prouver ce qui a été vu, où et quand :
// - image pleine page par le protocole DevTools (`Page.captureScreenshot` au-delà de la partie
//   visible), limitée à 16 000 pixels de haut ;
// - archive MHTML de la page (`webContents.savePage`) ;
// - contexte JSON : adresses demandée et finale, redirections, statut et en-têtes de la
//   réponse (relevés par `webRequest` sur la session d'enquête), date UTC, en-tête navigateur,
//   réseau utilisé, version de MASINT ;
// - SHA-256 de chaque fichier et du manifeste qui les réunit (voir `evidence.ts`).

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, type BrowserWindow, type Session, type WebContents } from 'electron'
import type { Capture } from '@shared/types'
import { createAssistWindow, settlePage } from './assist'
import type { ActivityWriter } from './activity'
import type { Repo } from './db/repo'
import { redactHeaders, storeCapture, type CaptureContext, type CaptureShot, type NavigationTrace } from './evidence'
import type { SettingsService } from './settings'

/** Hauteur maximale de l'image, en pixels (au-delà, Chromium ne rend plus la surface). */
const MAX_IMAGE_PX = 16_000
/** Délai laissé à la prise de vue et à l'archive MHTML. */
const SHOT_TIMEOUT = 30_000
/** Navigations gardées (une par onglet ou fenêtre de la partition). */
const MAX_TRACES = 64

// ---------------------------------------------------------------------------
// Navigations principales de la session d'enquête

/** Redirections en cours, par requête (l'identifiant reste le même d'une redirection à l'autre). */
const chains = new Map<number, NavigationTrace['redirects']>()
/** Dernière navigation principale terminée, par page. */
const traces = new Map<number, NavigationTrace>()

let tracked: Session | null = null

/**
 * Relève les navigations principales de la session d'enquête : chaîne de redirections, statut,
 * en-têtes et adresse IP de la réponse. Une session n'a qu'un écouteur par événement.
 */
export function trackNavigation(ses: Session): void {
  if (tracked === ses) return
  tracked = ses
  ses.webRequest.onBeforeRedirect((d) => {
    if (d.resourceType !== 'mainFrame') return
    const list = chains.get(d.id) ?? []
    list.push({ url: d.url, to: d.redirectURL, status: d.statusCode })
    chains.set(d.id, list)
  })
  ses.webRequest.onCompleted((d) => {
    if (d.resourceType !== 'mainFrame') return
    const redirects = chains.get(d.id) ?? []
    chains.delete(d.id)
    if (d.webContentsId === undefined) return
    traces.delete(d.webContentsId)
    traces.set(d.webContentsId, {
      requestedUrl: redirects[0]?.url ?? d.url,
      redirects,
      url: d.url,
      method: d.method,
      status: d.statusCode,
      statusLine: d.statusLine || undefined,
      ip: (d as { ip?: string }).ip || undefined,
      fromCache: d.fromCache,
      headers: redactHeaders(d.responseHeaders),
      at: new Date(d.timestamp || Date.now()).toISOString()
    })
    while (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value!)
  })
  ses.webRequest.onErrorOccurred((d) => {
    if (d.resourceType === 'mainFrame') chains.delete(d.id)
  })
}

/** Dernière navigation principale d'une page de la session d'enquête. */
export function navigationOf(wc: WebContents): NavigationTrace | null {
  return traces.get(wc.id) ?? null
}

// ---------------------------------------------------------------------------
// Prise de vue

const timeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} : délai dépassé`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    )
  })

/**
 * Une page cachée (fenêtre de recherche assistée ou ouverte pour une fiche, fenêtre réduite) ne
 * produit pas d'image : la prise de vue DevTools attendrait sans fin. Tant qu'elle attend, de
 * petites captures `capturePage` (1 pixel) la font tenir pour visible, sans afficher la fenêtre.
 */
async function whileRendered<T>(wc: WebContents, task: Promise<T>): Promise<T> {
  let done = false
  void (async () => {
    while (!done && !wc.isDestroyed()) {
      const start = Date.now()
      await wc.capturePage({ x: 0, y: 0, width: 1, height: 1 }).catch(() => undefined)
      if (Date.now() - start < 5) await new Promise((r) => setTimeout(r, 16))
    }
  })()
  try {
    return await task
  } finally {
    done = true
  }
}

/**
 * Image pleine page : dimensions du contenu (`Page.getLayoutMetrics`), puis capture au-delà
 * de la partie visible sur toute la page, bornée à `MAX_IMAGE_PX` de haut. Sans débogueur (déjà
 * pris par un outil de développement), seule la partie visible est capturée.
 */
async function screenshot(wc: WebContents): Promise<{ png: Buffer; page: CaptureShot['page'] }> {
  const dpr = Number(await wc.executeJavaScript('window.devicePixelRatio').catch(() => 1)) || 1
  const dbg = wc.debugger
  let attached = false
  try {
    if (!dbg.isAttached()) {
      dbg.attach('1.3')
      attached = true
    }
  } catch {
    const img = await wc.capturePage()
    const size = img.getSize()
    const css = { width: Math.round(size.width / dpr), height: Math.round(size.height / dpr) }
    return { png: img.toPNG(), page: { ...css, captured: css, truncated: false, devicePixelRatio: dpr, fullPage: false } }
  }
  try {
    const m = (await dbg.sendCommand('Page.getLayoutMetrics')) as {
      cssContentSize?: { width: number; height: number }
      contentSize?: { width: number; height: number }
    }
    const content = m.cssContentSize ?? m.contentSize ?? { width: 1, height: 1 }
    const limit = Math.floor(MAX_IMAGE_PX / dpr)
    const width = Math.max(1, Math.min(Math.ceil(content.width), limit))
    const height = Math.max(1, Math.min(Math.ceil(content.height), limit))
    const shot = (await whileRendered(
      wc,
      dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: 0, y: 0, width, height, scale: 1 }
      })
    )) as { data: string }
    return {
      png: Buffer.from(shot.data, 'base64'),
      page: {
        width: Math.ceil(content.width),
        height: Math.ceil(content.height),
        captured: { width, height },
        truncated: Math.ceil(content.height) > height || Math.ceil(content.width) > width,
        devicePixelRatio: dpr,
        fullPage: true
      }
    }
  } finally {
    if (attached && dbg.isAttached()) dbg.detach()
  }
}

/** Archive MHTML de la page, écrite dans un dossier temporaire aussitôt effacé. */
async function mhtmlOf(wc: WebContents): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'masint-capture-'))
  try {
    const file = join(dir, 'page.mhtml')
    await wc.savePage(file, 'MHTML')
    return await readFile(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Prend la page telle qu'affichée : image, MHTML, contexte de navigation. */
export async function shoot(wc: WebContents, requestedUrl?: string): Promise<CaptureShot> {
  const { png, page } = await timeout(screenshot(wc), SHOT_TIMEOUT, 'Capture de la page')
  const mhtml = await timeout(mhtmlOf(wc), SHOT_TIMEOUT, 'Archive MHTML')
  return {
    png,
    mhtml,
    page,
    title: wc.getTitle(),
    finalUrl: wc.getURL(),
    requestedUrl,
    userAgent: wc.getUserAgent(),
    navigation: navigationOf(wc)
  }
}

// ---------------------------------------------------------------------------
// Service

export class CaptureService {
  constructor(
    private readonly deps: {
      repo: Repo
      settings: SettingsService
      activity?: ActivityWriter
      /** Nouvelle capture : la fiche du nœud se met à jour. */
      notify: (investigationId: string, nodeId: string | null) => void
    }
  ) {}

  /** Capture la page affichée par `wc` et l'enregistre dans l'enquête. */
  async capture(wc: WebContents, ctx: CaptureContext & { requestedUrl?: string }): Promise<Capture> {
    if (wc.isDestroyed()) throw new Error('Page fermée')
    if (!/^https?:\/\//i.test(wc.getURL())) throw new Error('Aucune page web à capturer')
    if (!this.deps.repo.getInvestigation(ctx.investigationId)) throw new Error('Enquête introuvable')
    const shot = await shoot(wc, ctx.requestedUrl)
    const nodeId = ctx.nodeId && this.deps.repo.getNode(ctx.nodeId) ? ctx.nodeId : null
    const capture = storeCapture(
      { repo: this.deps.repo, activity: this.deps.activity, settings: this.deps.settings.get(), appVersion: app.getVersion() },
      { ...ctx, nodeId },
      shot
    )
    this.deps.notify(ctx.investigationId, capture.nodeId)
    return capture
  }

  /**
   * Ouvre une adresse dans une fenêtre cachée de la partition d'enquête (même proxy ou Tor),
   * attend le chargement comme la recherche assistée (la fenêtre s'affiche en cas de captcha ou
   * de connexion), puis capture la page.
   */
  async captureUrl(ctx: { investigationId: string; nodeId: string | null; url: string; parent: BrowserWindow | null; title: string }): Promise<Capture> {
    if (!/^https?:\/\//i.test(ctx.url)) throw new Error('Adresse web invalide')
    const { win, isClosed } = createAssistWindow({ parent: ctx.parent, userAgent: this.deps.settings.get().userAgent, title: ctx.title })
    try {
      const state = await settlePage(win, isClosed, ctx.url, ctx.title)
      if (state === 'cancelled') throw new Error('Capture annulée (fenêtre fermée)')
      if (state === 'timeout') throw new Error('La page n’a pas répondu à temps')
      return await this.capture(win.webContents, { investigationId: ctx.investigationId, nodeId: ctx.nodeId, via: 'node', requestedUrl: ctx.url })
    } finally {
      if (!isClosed()) win.destroy()
    }
  }
}
