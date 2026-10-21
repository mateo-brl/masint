// Archive `.masint` : un zip contenant l'enquête, ses nœuds, liens et pièces jointes.
// À l'import, tous les identifiants sont régénérés pour éviter les collisions.

import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import type { Attachment, GraphEdge, GraphNode, Investigation } from '@shared/types'
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
    attachments
  }
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  for (const a of attachments) {
    const blob = repo.getAttachmentData(a.id)
    if (blob) zip.file(`attachments/${a.id}`, blob.data)
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function importArchive(repo: Repo, buf: Buffer): Promise<Investigation> {
  const zip = await JSZip.loadAsync(buf)
  const file = zip.file('manifest.json')
  if (!file) throw new Error('Archive invalide : manifest.json manquant')
  const manifest = JSON.parse(await file.async('string')) as Manifest
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error("Ce fichier n'est pas une enquête MASINT")
  if (manifest.version > ARCHIVE_VERSION) throw new Error('Archive créée par une version plus récente de MASINT')

  const inv = repo.createInvestigation({
    name: manifest.investigation.name,
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
  if (manifest.investigation.viewport) repo.updateInvestigation(inv.id, { viewport: manifest.investigation.viewport })
  return repo.getInvestigation(inv.id)!
}

/** Copie complète d'une enquête dans la même base. */
export async function duplicateInvestigation(repo: Repo, id: string): Promise<Investigation> {
  const buf = await buildArchive(repo, id)
  const copy = await importArchive(repo, buf)
  return repo.updateInvestigation(copy.id, { name: `${copy.name} (copie)` })
}
