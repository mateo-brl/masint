// Emplacement réservé : exports du graphe (PNG, SVG, JSON, CSV, HTML interactif).
export type ExportFormat = 'png' | 'svg' | 'json' | 'csv-nodes' | 'csv-edges' | 'html'

export async function exportGraph(format: ExportFormat): Promise<string | null> {
  void format
  return null
}
