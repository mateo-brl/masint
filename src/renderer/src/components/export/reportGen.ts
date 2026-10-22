// Préparation du rapport : collecte des données, capture du graphe, mise en page, impression.

import type { Attachment, ModuleRun } from '@shared/types'
import { api } from '../../lib/api'
import { useApp } from '../../store/app'
import { captureGraphPng } from './capture'
import { collectImages, graphSnapshot, lucideMarkup, sha256Hex } from './collect'
import { exportFileName, exportStrings } from './format'
import { buildReportHtml, fingerprintPayload, type ReportOptions } from './report'

export type ReportStep = 'collect' | 'images' | 'capture' | 'build' | 'pdf' | 'save'

const REPORT_IMAGE_BUDGET = 30_000_000
const MAX_RAW_RUNS = 150

export async function buildReport(options: ReportOptions, onStep: (s: ReportStep) => void): Promise<{ html: string; baseName: string }> {
  const lang = options.lang
  const s = exportStrings(lang)
  onStep('collect')
  const snap = graphSnapshot()
  if (!snap) throw new Error(s.exportx.noInvestigation)
  const { investigation, nodes, edges } = snap
  const generatedAt = new Date()
  const imageIds = Array.from(new Set(nodes.map((n) => n.imageId).filter((id): id is string => !!id)))
  const [allRuns, runStats, info, modules, attachments] = await Promise.all([
    api('modules:runs', investigation.id).catch(() => [] as ModuleRun[]),
    // Chiffres exacts même au-delà des 2000 exécutions renvoyées par la liste.
    api('modules:runStats', investigation.id).catch(() => undefined),
    api('app:info').catch(() => null),
    useApp.getState().modules.length ? Promise.resolve(useApp.getState().modules) : api('modules:list').catch(() => []),
    Promise.all(imageIds.map((id) => api('attachments:get', id).catch(() => null))).then((list) => list.filter((a): a is Attachment => !!a))
  ])
  // Comme les statistiques et l'archive : seules les exécutions des nœuds présents.
  const nodeIds = new Set(nodes.map((n) => n.id))
  const runs = allRuns.filter((r) => nodeIds.has(r.nodeId))

  let rawRuns: Array<{ run: ModuleRun; raw: unknown }> = []
  if (options.sections.raw) {
    const candidates = runs.filter((r) => r.status === 'done' && r.resultCount > 0).slice(0, MAX_RAW_RUNS)
    for (let i = 0; i < candidates.length; i += 10) {
      const batch = candidates.slice(i, i + 10)
      const raws = await Promise.all(batch.map((r) => api('modules:runRaw', r.id).catch(() => null)))
      rawRuns = rawRuns.concat(batch.map((run, j) => ({ run, raw: raws[j] })))
    }
  }

  let images: Record<string, string> = {}
  if (options.sections.entities) {
    onStep('images')
    const requests = nodes
      .filter((n) => n.imageId && (n.kind === 'entity' || n.kind === 'image'))
      .map((n) => ({ id: n.imageId!, maxDim: n.kind === 'image' ? 1400 : 600 }))
    images = (await collectImages(requests, REPORT_IMAGE_BUDGET)).images
  }

  let graphImage: string | null = null
  if (options.sections.graph && nodes.length) {
    onStep('capture')
    try {
      graphImage = await captureGraphPng({ pixelRatio: 2, maxSide: 2600, theme: 'light' })
    } catch {
      graphImage = null
    }
  }

  onStep('build')
  // Images désignées par leur SHA-256 : l'empreinte ne dépend pas des identifiants.
  const imageHashes = Object.fromEntries(attachments.map((a) => [a.id, a.sha256]))
  const fingerprint = await sha256Hex(fingerprintPayload(investigation, nodes, edges, imageHashes)).catch(() => null)
  const html = buildReportHtml({
    options,
    investigation,
    nodes,
    edges,
    runs,
    modules,
    iconMarkup: lucideMarkup,
    generatedAt,
    graphImage,
    images,
    appVersion: info?.version ?? null,
    platform: info?.platform ?? null,
    fingerprint,
    rawRuns,
    runStats,
    attachments
  })
  const title = options.title.trim() || investigation.name
  return { html, baseName: exportFileName(title, generatedAt, s.exportx.files.report, 'x').replace(/\.x$/, '') }
}

/** Rapport imprimé en PDF par le processus principal. */
export async function generateReportPdf(options: ReportOptions, onStep: (s: ReportStep) => void): Promise<string | null> {
  const { html, baseName } = await buildReport(options, onStep)
  onStep('pdf')
  return api('export:pdf', html, baseName)
}

/** Même rapport enregistré en page HTML autonome. */
export async function generateReportHtml(options: ReportOptions, onStep: (s: ReportStep) => void): Promise<string | null> {
  const { html, baseName } = await buildReport(options, onStep)
  onStep('save')
  const s = exportStrings(options.lang).exportx
  return api('export:save', `${baseName}.html`, [{ name: s.filters.html, extensions: ['html'] }], html, 'utf8')
}
