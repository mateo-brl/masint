// Exports du graphe : PNG, SVG, JSON, CSV (nœuds, liens), HTML interactif autonome,
// GraphML, GEXF et CSV pour Maltego.

import { api } from '../../lib/api'
import { currentLang } from '../../lib/i18n'
import { useApp } from '../../store/app'
import { captureGraphPng, captureGraphSvg } from './capture'
import { collectImages, drawingMarkup, graphSnapshot, lucideMarkup, type GraphSnapshot } from './collect'
import { buildEdgesCsv, buildNodesCsv } from './csv'
import { exportFileName, exportStrings } from './format'
import { buildGexf, buildGraphMl, buildMaltegoCsv } from './graphFormats'
import { buildViewerHtml } from './viewer'

export type ExportFormat = 'png' | 'svg' | 'json' | 'csv-nodes' | 'csv-edges' | 'html' | 'graphml' | 'gexf' | 'maltego'

export { captureGraphPng }

/** Taille maximale cumulée des images embarquées dans le HTML interactif (caractères base64). */
const HTML_IMAGE_BUDGET = 40_000_000

function snapshotOrThrow(): GraphSnapshot {
  const snap = graphSnapshot()
  if (!snap) throw new Error(exportStrings(currentLang()).exportx.noInvestigation)
  return snap
}

/** Document JSON du graphe (format `masint-graph`, version 1). */
export function buildGraphJson(snap: GraphSnapshot, exportedAt: Date): string {
  return JSON.stringify(
    {
      format: 'masint-graph',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      investigation: snap.investigation,
      nodes: snap.nodes,
      edges: snap.edges
    },
    null,
    2
  )
}

/** HTML interactif complet, images embarquées. */
export async function buildInteractiveHtml(snap: GraphSnapshot, exportedAt: Date): Promise<string> {
  const lang = currentLang()
  const requests = snap.nodes
    .filter((n) => n.imageId && n.kind !== 'drawing')
    .map((n) => ({ id: n.imageId!, maxDim: n.kind === 'image' ? 1600 : 640 }))
  const { images, omitted } = await collectImages(requests, HTML_IMAGE_BUDGET)
  return buildViewerHtml({
    investigation: snap.investigation,
    nodes: snap.nodes,
    edges: snap.edges,
    lang,
    exportedAt,
    iconMarkup: lucideMarkup,
    images,
    omittedImages: omitted,
    sizes: snap.sizes,
    drawings: drawingMarkup(snap.nodes),
    modules: useApp.getState().modules
  })
}

/** Exporte le graphe dans le format demandé. Renvoie le chemin enregistré, ou `null` si annulé. */
export async function exportGraph(format: ExportFormat): Promise<string | null> {
  const snap = snapshotOrThrow()
  const lang = currentLang()
  const s = exportStrings(lang).exportx
  const now = new Date()
  const name = (suffix: string, ext: string): string => exportFileName(snap.investigation.name, now, suffix, ext)
  // Export inscrit au journal de l'enquête (fichier, taille, SHA-256).
  const meta = { investigationId: snap.investigation.id, kind: format }

  switch (format) {
    case 'png': {
      const url = await captureGraphPng()
      return api('export:save', name(s.files.graph, 'png'), [{ name: s.filters.png, extensions: ['png'] }], url.slice(url.indexOf(',') + 1), 'base64', meta)
    }
    case 'svg': {
      const url = await captureGraphSvg()
      const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1))
      return api('export:save', name(s.files.graph, 'svg'), [{ name: s.filters.svg, extensions: ['svg'] }], svg, 'utf8', meta)
    }
    case 'json':
      return api('export:save', name('', 'json'), [{ name: s.filters.json, extensions: ['json'] }], buildGraphJson(snap, now), 'utf8', meta)
    case 'csv-nodes':
      return api('export:save', name(s.files.nodes, 'csv'), [{ name: s.filters.csv, extensions: ['csv'] }], buildNodesCsv(snap.nodes, lang), 'utf8', meta)
    case 'csv-edges':
      return api(
        'export:save',
        name(s.files.edges, 'csv'),
        [{ name: s.filters.csv, extensions: ['csv'] }],
        buildEdgesCsv(snap.nodes, snap.edges, lang, useApp.getState().modules),
        'utf8',
        meta
      )
    case 'graphml':
      return api('export:save', name('', 'graphml'), [{ name: s.filters.graphml, extensions: ['graphml'] }], buildGraphMl(snap, lang), 'utf8', meta)
    case 'gexf':
      return api('export:save', name('', 'gexf'), [{ name: s.filters.gexf, extensions: ['gexf'] }], buildGexf(snap, lang, now), 'utf8', meta)
    case 'maltego':
      return api('export:save', name(s.files.maltego, 'csv'), [{ name: s.filters.maltego, extensions: ['csv'] }], buildMaltegoCsv(snap, lang), 'utf8', meta)
    case 'html': {
      const html = await buildInteractiveHtml(snap, now)
      return api('export:save', name(s.files.graph, 'html'), [{ name: s.filters.html, extensions: ['html'] }], html, 'utf8', meta)
    }
  }
}
