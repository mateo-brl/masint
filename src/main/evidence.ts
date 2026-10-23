// Preuves : enregistrement d'une capture de page (image pleine page, archive MHTML, contexte
// JSON) dans l'enquête, et manifeste qui scelle leurs empreintes. Partie sans Electron : la prise
// de vue elle-même est dans `capture.ts`.
//
// Chaque fichier devient une pièce jointe (SHA-256 calculé à l'enregistrement, `origin` = URL
// affichée). Le contexte JSON reprend les empreintes de l'image et du MHTML ; le manifeste,
// JSON canonique des trois empreintes, de l'adresse et de la date, reçoit la sienne
// (`captures.manifest_sha256`). Tout se recalcule à partir des fichiers (`verifyCapture`).

import { createHash } from 'node:crypto'
import type { Capture, Settings } from '@shared/types'
import { canonicalJson, nodeRef, type ActivityWriter } from './activity'
import type { Repo } from './db/repo'

export const CAPTURE_FORMAT = 'masint-capture'
export const CAPTURE_VERSION = 1
export const MHTML_MIME = 'multipart/related'

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

/** Navigation principale de la page capturée : chaîne de redirections, statut et en-têtes. */
export interface NavigationTrace {
  /** Adresse demandée, avant redirections. */
  requestedUrl: string
  redirects: Array<{ url: string; to: string; status: number }>
  /** Adresse de la réponse finale. */
  url: string
  method: string
  status: number
  statusLine?: string
  ip?: string
  fromCache: boolean
  headers: Record<string, string[]>
  /** Date de la réponse, ISO 8601 UTC. */
  at: string
}

/** Ce que la prise de vue a produit. */
export interface CaptureShot {
  png: Buffer
  mhtml: Buffer
  title: string
  /** Adresse affichée au moment de la capture. */
  finalUrl: string
  /** Adresse demandée connue de l'appelant (lien ouvert, recherche) ; sinon celle de la navigation. */
  requestedUrl?: string
  userAgent: string
  navigation: NavigationTrace | null
  page: {
    width: number
    height: number
    captured: { width: number; height: number }
    /** Page plus haute que la limite : seul le haut est capturé. */
    truncated: boolean
    devicePixelRatio: number
    /** `false` : seule la partie visible a pu être capturée (débogueur indisponible). */
    fullPage: boolean
  }
}

export interface CaptureContext {
  investigationId: string
  nodeId: string | null
  via: 'browser' | 'assist' | 'node'
}

/** Réseau utilisé par la partition d'enquête, sans identifiants de proxy. */
export function networkInfo(s: Pick<Settings, 'proxy'>): { mode: 'direct' | 'proxy' | 'tor'; proxy?: string } {
  const p = s.proxy
  if (p.mode === 'tor') return { mode: 'tor', proxy: `socks5://127.0.0.1:${p.torPort || 9050}` }
  if (p.mode !== 'none' && p.url.trim()) return { mode: 'proxy', proxy: redactProxy(p.url.trim()) }
  return { mode: 'direct' }
}

function redactProxy(url: string): string {
  try {
    const u = new URL(url)
    if (u.username || u.password) {
      u.username = '***'
      u.password = ''
    }
    return u.toString().replace(/\/$/, '')
  } catch {
    return url.replace(/\/\/[^@/]*@/, '//***@')
  }
}

/**
 * En-têtes de réponse gardés dans le contexte. Les valeurs des cookies posés sont masquées : la
 * preuve peut partir avec une archive, pas la session de l'enquêteur sur le site.
 */
export function redactHeaders(headers: Record<string, string[] | string> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    const values = Array.isArray(v) ? v : [String(v)]
    out[k.toLowerCase()] = k.toLowerCase() === 'set-cookie' ? values.map((c) => `${c.split('=')[0].trim()}=***`) : values
  }
  return out
}

/** Nom de base des fichiers : `capture-exemple.com-2026-10-22T14-03-12Z`. */
export function captureBaseName(url: string, capturedAt: string): string {
  let host = 'page'
  try {
    host = new URL(url).hostname || host
  } catch {
    /* adresse illisible : nom générique */
  }
  const stamp = capturedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
  return `capture-${host.replace(/[^a-z0-9.-]+/gi, '_')}-${stamp}`
}

export type CaptureRole = 'screenshot' | 'mhtml' | 'meta'

/**
 * Manifeste d'une capture : JSON canonique de l'adresse, de la date et des empreintes des trois
 * fichiers. Son SHA-256 est l'empreinte de la capture.
 */
export function captureManifest(
  c: Pick<Capture, 'url' | 'finalUrl' | 'capturedAt'>,
  files: Array<{ role: CaptureRole; sha256: string; size: number }>
): string {
  const order: CaptureRole[] = ['screenshot', 'mhtml', 'meta']
  return canonicalJson({
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    url: c.url,
    finalUrl: c.finalUrl,
    capturedAt: c.capturedAt,
    files: [...files].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).map((f) => ({ role: f.role, sha256: f.sha256, size: f.size }))
  })
}

/**
 * Enregistre une capture : trois pièces jointes, la ligne `captures` et l'entrée du journal.
 * `at` est la date de la capture (UTC).
 */
export function storeCapture(
  deps: { repo: Repo; activity?: ActivityWriter; settings: Pick<Settings, 'proxy'>; appVersion: string },
  ctx: CaptureContext,
  shot: CaptureShot,
  at: Date = new Date()
): Capture {
  const { repo } = deps
  const capturedAt = at.toISOString()
  const requestedUrl = shot.requestedUrl || shot.navigation?.requestedUrl || shot.finalUrl
  const base = captureBaseName(shot.finalUrl || requestedUrl, capturedAt)
  const files = {
    screenshot: { name: `${base}.png`, mime: 'image/png', size: shot.png.length, sha256: sha256(shot.png) },
    mhtml: { name: `${base}.mhtml`, mime: MHTML_MIME, size: shot.mhtml.length, sha256: sha256(shot.mhtml) }
  }
  const meta = {
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    capturedAt,
    requestedUrl,
    finalUrl: shot.finalUrl,
    title: shot.title,
    navigation: shot.navigation,
    browser: { userAgent: shot.userAgent, electron: process.versions.electron ?? null, chrome: process.versions.chrome ?? null },
    network: networkInfo(deps.settings),
    app: { name: 'MASINT', version: deps.appVersion },
    page: shot.page,
    files,
    investigation: { id: ctx.investigationId, nodeId: ctx.nodeId },
    via: ctx.via
  }
  const metaBuf = Buffer.from(JSON.stringify(meta, null, 2), 'utf8')
  const origin = shot.finalUrl || requestedUrl
  return repo.db.transaction(() => {
    const png = repo.addAttachment(ctx.investigationId, { name: files.screenshot.name, mime: files.screenshot.mime, data: shot.png, origin })
    const mhtml = repo.addAttachment(ctx.investigationId, { name: files.mhtml.name, mime: files.mhtml.mime, data: shot.mhtml, origin })
    const metaAtt = repo.addAttachment(ctx.investigationId, { name: `${base}.json`, mime: 'application/json', data: metaBuf, origin })
    const manifest = captureManifest({ url: requestedUrl, finalUrl: shot.finalUrl, capturedAt }, [
      { role: 'screenshot', sha256: png.sha256, size: png.size },
      { role: 'mhtml', sha256: mhtml.sha256, size: mhtml.size },
      { role: 'meta', sha256: metaAtt.sha256, size: metaAtt.size }
    ])
    const capture = repo.addCapture({
      investigationId: ctx.investigationId,
      nodeId: ctx.nodeId,
      url: requestedUrl,
      finalUrl: shot.finalUrl,
      title: shot.title,
      capturedAt,
      screenshotAttachment: png.id,
      mhtmlAttachment: mhtml.id,
      metaAttachment: metaAtt.id,
      manifestSha256: sha256(manifest)
    })
    const node = ctx.nodeId ? repo.getNode(ctx.nodeId) : null
    deps.activity?.log(ctx.investigationId, 'capture.create', {
      capture: capture.id,
      ...(node ? { node: nodeRef(node) } : {}),
      url: requestedUrl,
      finalUrl: shot.finalUrl,
      sha256: capture.manifestSha256,
      via: ctx.via
    })
    return capture
  })()
}

/**
 * Recalcule les empreintes d'une capture à partir de ses fichiers : chaque pièce jointe, les
 * empreintes reprises dans le contexte JSON et celle du manifeste.
 */
export function verifyCapture(repo: Repo, c: Capture): { ok: boolean; manifestSha256: string; problems: string[] } {
  const problems: string[] = []
  const files: Array<{ role: CaptureRole; sha256: string; size: number }> = []
  const roles: Array<[CaptureRole, string]> = [
    ['screenshot', c.screenshotAttachment],
    ['mhtml', c.mhtmlAttachment],
    ['meta', c.metaAttachment]
  ]
  type Meta = { files?: Record<string, { sha256?: string }> }
  let meta: Meta | null = null
  for (const [role, id] of roles) {
    const att = repo.getAttachment(id)
    const blob = repo.getAttachmentData(id)
    if (!att || !blob) {
      problems.push(`${role} : fichier absent`)
      continue
    }
    const actual = sha256(blob.data)
    if (actual !== att.sha256) problems.push(`${role} : empreinte différente`)
    files.push({ role, sha256: actual, size: blob.data.length })
    if (role === 'meta') {
      try {
        meta = JSON.parse(blob.data.toString('utf8')) as Meta
      } catch {
        problems.push('meta : JSON illisible')
      }
    }
  }
  for (const role of ['screenshot', 'mhtml'] as const) {
    const listed = meta?.files?.[role]?.sha256
    const actual = files.find((f) => f.role === role)?.sha256
    if (listed && actual && listed !== actual) problems.push(`${role} : empreinte du contexte différente`)
  }
  const manifestSha256 = sha256(captureManifest(c, files))
  if (manifestSha256 !== c.manifestSha256) problems.push('manifeste : empreinte différente')
  return { ok: problems.length === 0, manifestSha256, problems }
}
