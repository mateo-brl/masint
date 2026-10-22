// Archive `.masint` : un zip contenant l'enquête, ses nœuds, liens et pièces jointes.
// À l'import, tous les identifiants sont régénérés pour éviter les collisions.

import { createHash, randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import type { Attachment, GraphEdge, GraphNode, Investigation, Suggestion } from '@shared/types'
import type { Repo } from './db/repo'

export const ARCHIVE_FORMAT = 'masint'
export const ARCHIVE_VERSION = 1

interface Manifest {
  format: string
  version: number
  exportedAt: number
  investigation: Investigation
  nodes: GraphNode[]
  edges: GraphEdge[]
  attachments: Attachment[]
  /** Résultats à vérifier (absents des archives créées avant leur apparition). */
  suggestions?: Suggestion[]
}

export async function buildArchive(repo: Repo, investigationId: string): Promise<Buffer> {
  const bundle = repo.getBundle(investigationId)
  const attachments = repo.listAttachments(investigationId)
  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: Date.now(),
    investigation: bundle.investigation,
    nodes: bundle.nodes,
    edges: bundle.edges,
    attachments,
    suggestions: repo.listSuggestions(investigationId)
  }
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  for (const a of attachments) {
    const blob = repo.getAttachmentData(a.id)
    if (blob) zip.file(`attachments/${a.id}`, blob.data)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/** Nom libre : « Enquête », sinon « Enquête (2) », « Enquête (3) »... */
function uniqueName(repo: Repo, name: string): string {
  const taken = new Set(repo.listInvestigations().map((i) => i.name))
  if (!taken.has(name)) return name
  let n = 2
  while (taken.has(`${name} (${n})`)) n++
  return `${name} (${n})`
}

/**
 * Ouvre une archive reçue de l'explorateur : si ce fichier exact a déjà été importé
 * et que l'enquête existe encore, on la réutilise au lieu de créer un doublon.
 */
export async function openArchiveOnce(repo: Repo, buf: Buffer): Promise<Investigation> {
  const hash = createHash('sha256').update(buf).digest('hex')
  const seen = repo.getSetting<Record<string, string>>('importedArchives', {})
  const existing = seen[hash] ? repo.getInvestigation(seen[hash]) : null
  if (existing) return existing
  const inv = await importArchive(repo, buf)
  repo.setSetting('importedArchives', { ...seen, [hash]: inv.id })
  return inv
}

export async function importArchive(repo: Repo, buf: Buffer): Promise<Investigation> {
  const zip = await JSZip.loadAsync(buf)
  const file = zip.file('manifest.json')
  if (!file) throw new Error('Archive invalide : manifest.json manquant')
  const manifest = JSON.parse(await file.async('string')) as Manifest
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error("Ce fichier n'est pas une enquête MASINT")
  if (manifest.version > ARCHIVE_VERSION) throw new Error('Archive créée par une version plus récente de MASINT')

  const inv = repo.createInvestigation({
    name: uniqueName(repo, manifest.investigation.name),
    description: manifest.investigation.description,
    color: manifest.investigation.color,
    notes: manifest.investigation.notes
  })

  const attIds = new Map<string, string>()
  for (const a of manifest.attachments ?? []) {
    const entry = zip.file(`attachments/${a.id}`)
    if (!entry) continue
    const data = await entry.async('nodebuffer')
    const created = repo.addAttachment(inv.id, { name: a.name, mime: a.mime, data, origin: a.origin, createdAt: a.createdAt })
    attIds.set(a.id, created.id)
  }

  const nodeIds = new Map<string, string>()
  for (const n of manifest.nodes) nodeIds.set(n.id, randomUUID())
  repo.upsertNodes(
    inv.id,
    manifest.nodes.map((n) => ({
      ...n,
      id: nodeIds.get(n.id)!,
      imageId: n.imageId ? (attIds.get(n.imageId) ?? null) : null
    }))
  )
  repo.upsertEdges(
    inv.id,
    manifest.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ ...e, id: randomUUID(), source: nodeIds.get(e.source)!, target: nodeIds.get(e.target)! }))
  )
  for (const s of manifest.suggestions ?? []) {
    const nodeId = nodeIds.get(s.nodeId)
    if (!nodeId) continue
    const { id: _old, status, createdAt: _c, updatedAt: _u, ...rest } = s
    const created = repo.addSuggestion({ ...rest, investigationId: inv.id, nodeId })
    if (created && status !== 'pending') repo.setSuggestionStatus(created.id, status)
  }
  if (manifest.investigation.viewport) repo.updateInvestigation(inv.id, { viewport: manifest.investigation.viewport })
  return repo.getInvestigation(inv.id)!
}

/** Copie complète d'une enquête dans la même base. */
export async function duplicateInvestigation(repo: Repo, id: string): Promise<Investigation> {
  const buf = await buildArchive(repo, id)
  const copy = await importArchive(repo, buf)
  const source = repo.getInvestigation(id)
  return repo.updateInvestigation(copy.id, { name: uniqueName(repo, `${source?.name ?? copy.name} (copie)`) })
}
