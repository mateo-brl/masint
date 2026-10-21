// Exports CSV compatibles Excel (version française) : séparateur `;`, BOM UTF-8, fins de ligne CRLF.

import type { GraphEdge, GraphNode, Lang, ModuleInfo } from '@shared/types'
import { exportStrings, formatValue, isoLocal, platformName, typeLabel } from './format'

export const CSV_SEPARATOR = ';'
const BOM = '\uFEFF'

/**
 * Cellule CSV : guillemets si nécessaire, et neutralisation des contenus qu'Excel
 * interpréterait comme une formule (données collectées sur des sources non fiables).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  const numeric = /^[+-]?[\d\s().]*$/.test(s)
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !numeric)) s = `'${s}`
  if (/[";\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(CSV_SEPARATOR)
}

export function csvDocument(rows: unknown[][]): string {
  return BOM + rows.map(csvRow).join('\r\n') + '\r\n'
}

/** Nœuds exportés en CSV : les entités (les annotations du canevas n'ont pas de propriétés). */
export function csvNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.filter((n) => n.kind === 'entity')
}

export function buildNodesCsv(nodes: GraphNode[], lang: Lang): string {
  const h = exportStrings(lang).exportx.csv
  const list = csvNodes(nodes)
  // Une colonne par clé de propriété, dans l'ordre de première apparition.
  const keys: string[] = []
  const seen = new Set<string>()
  for (const n of list) {
    for (const k of Object.keys(n.data ?? {})) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  const header = [h.id, h.type, h.typeLabel, h.label, h.platform, h.source, h.createdAt, h.updatedAt, h.notes, ...keys]
  const rows = list.map((n) => [
    n.id,
    n.type,
    typeLabel(n.type, lang),
    n.label,
    platformName(n.platform),
    n.source,
    isoLocal(n.createdAt),
    isoLocal(n.updatedAt),
    n.notes,
    ...keys.map((k) => formatValue(n.data?.[k], lang))
  ])
  return csvDocument([header, ...rows])
}

export function buildEdgesCsv(nodes: GraphNode[], edges: GraphEdge[], lang: Lang, modules: ModuleInfo[] = []): string {
  const h = exportStrings(lang).exportx.csv
  const labels = new Map(nodes.map((n) => [n.id, n.label]))
  const moduleNames = new Map(modules.map((m) => [m.id, m.name[lang]]))
  const header = [h.id, h.edgeSource, h.edgeSourceLabel, h.edgeTarget, h.edgeTargetLabel, h.edgeLabel, h.module, h.createdAt]
  const rows = edges.map((e) => [
    e.id,
    e.source,
    labels.get(e.source) ?? '',
    e.target,
    labels.get(e.target) ?? '',
    e.label,
    e.sourceModule === 'manual' ? 'manual' : (moduleNames.get(e.sourceModule) ?? e.sourceModule),
    isoLocal(e.createdAt)
  ])
  return csvDocument([header, ...rows])
}
