// Préparation du rapport : collecte des données, capture du graphe, mise en page, impression.

import type { ModuleRun } from '@shared/types'
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
  const [runs, info, modules] = await Promise.all([
    api('modules:runs', investigation.id).catch(() => [] as ModuleRun[]),
    api('app:info').catch(() => null),
    useApp.getState().modules.length ? Promise.resolve(useApp.getState().modules) : api('modules:list').catch(() => [])
  ])

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
  const fingerprint = await sha256Hex(fingerprintPayload(investigation, nodes, edges)).catch(() => null)
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
    rawRuns
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
