// Archive `.masint` : un zip contenant l'enquête, ses nœuds, liens, pièces jointes et
// exécutions de modules. À l'import, tous les identifiants sont régénérés pour éviter les
// collisions.
//
// Version 2 :
// - `runs` : exécutions des modules (chapitre « Sources » du rapport), réponse brute du service
//   dans `runs/<id>.json` ;
// - seules les pièces jointes utilisées par un nœud présent sont embarquées (la photo d'un nœud
//   supprimé ne doit pas partir avec la copie) ; idem pour les exécutions ;
// - `hashes.json` : empreinte SHA-256 de chaque entrée, vérifiée à l'import.
// Les archives version 1 restent lisibles.

import { createHash, randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import type { Attachment, GraphEdge, GraphNode, Investigation, ModuleRun, Suggestion } from '@shared/types'
import type { Repo } from './db/repo'

export const ARCHIVE_FORMAT = 'masint'
export const ARCHIVE_VERSION = 2

export const MANIFEST = 'manifest.json'
export const HASHES = 'hashes.json'

/** Exécution archivée ; `raw` indique qu'une réponse brute accompagne l'exécution. */
export type ArchivedRun = ModuleRun & { raw: boolean }

export interface Manifest {
  format: string
  version: number
  exportedAt: number
  investigation: Investigation
  nodes: GraphNode[]
  edges: GraphEdge[]
  attachments: Attachment[]
  /** Résultats à vérifier (absents des archives créées avant leur apparition). */
  suggestions?: Suggestion[]
  /** Exécutions des modules (version 2). */
  runs?: ArchivedRun[]
}

/** Limites contre les archives piégées (bombe de décompression, milliers d'entrées). */
export interface ArchiveLimits {
  /** Nombre maximal d'entrées dans le zip. */
  maxEntries: number
  /** Taille décompressée maximale d'une entrée, en octets. */
  maxEntryBytes: number
  /** Taille décompressée maximale de l'ensemble, en octets. */
  maxTotalBytes: number
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 50_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

export async function buildArchive(repo: Repo, investigationId: string): Promise<Buffer> {
  const bundle = repo.getBundle(investigationId)
  // Pièces jointes réellement utilisées : les orphelines (nœud supprimé) restent sur le poste.
  const used = new Set(bundle.nodes.map((n) => n.imageId).filter((id): id is string => !!id))
  const attachments = repo.listAttachments(investigationId).filter((a) => used.has(a.id))
  const runs = repo.listRunsForArchive(investigationId)
  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: Date.now(),
    investigation: bundle.investigation,
    nodes: bundle.nodes,
    edges: bundle.edges,
    attachments,
    suggestions: repo.listSuggestions(investigationId),
    runs: runs.map(({ raw, ...run }) => ({ ...run, raw: raw !== null }))
  }
  const zip = new JSZip()
  const hashes: Record<string, string> = {}
  const add = (name: string, data: Buffer | string): void => {
    zip.file(name, data)
    hashes[name] = sha256(data)
  }
  add(MANIFEST, JSON.stringify(manifest, null, 2))
  for (const a of attachments) {
    const blob = repo.getAttachmentData(a.id)
    if (blob) add(`attachments/${a.id}`, blob.data)
  }
  for (const r of runs) if (r.raw !== null) add(`runs/${r.id}.json`, r.raw)
  zip.file(HASHES, JSON.stringify(hashes, null, 2))
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

/**
 * Nombre d'entrées annoncé par la fin du répertoire central (EOCD), lu avant toute
 * décompression. `null` si l'enregistrement est introuvable (zip invalide ou ZIP64).
 */
export function zipEntryCount(buf: Buffer): number | null {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue
    const total = buf.readUInt16LE(i + 10)
    return total === 0xffff ? null : total
  }
  return null
}

/** Lecture bornée d'une entrée : la décompression s'arrête dès qu'une limite est dépassée. */
class ArchiveReader {
  private total = 0
  /** Empreintes de `hashes.json` (archives version 2), `null` pour une archive version 1. */
  private hashes: Record<string, string> | null = null

  private constructor(
    private readonly zip: JSZip,
    private readonly limits: ArchiveLimits
  ) {}

  static async open(buf: Buffer, limits: ArchiveLimits): Promise<ArchiveReader> {
    if (buf.length > limits.maxTotalBytes) throw new Error('Archive trop volumineuse')
    const announced = zipEntryCount(buf)
    if (announced !== null && announced > limits.maxEntries) throw new Error(`Archive refusée : trop d'entrées (${announced})`)
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(buf)
    } catch {
      throw new Error("Ce fichier n'est pas une enquête MASINT")
    }
    const names = Object.keys(zip.files)
    if (names.length > limits.maxEntries) throw new Error(`Archive refusée : trop d'entrées (${names.length})`)
    // Tailles annoncées par le répertoire central : refus immédiat, avant de décompresser.
    let announcedTotal = 0
    for (const name of names) {
      const size = (zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
      if (typeof size !== 'number') continue
      if (size > limits.maxEntryBytes) throw new Error(`Archive refusée : entrée trop volumineuse (${name})`)
      announcedTotal += size
    }
    if (announcedTotal > limits.maxTotalBytes) throw new Error('Archive refusée : contenu décompressé trop volumineux')
    const reader = new ArchiveReader(zip, limits)
    const hashes = await reader.read(HASHES)
    if (!hashes) return reader
    try {
      const parsed = JSON.parse(hashes.toString('utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      reader.hashes = parsed as Record<string, string>
    } catch {
      throw new Error('Archive altérée : empreintes illisibles')
    }
    return reader
  }

  /** Contenu d'une entrée (`null` si absente), empreinte vérifiée quand l'archive en fournit. */
  async read(name: string): Promise<Buffer | null> {
    const entry = this.zip.file(name)
    if (!entry || entry.dir) return null
    const data = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let failed = false
      const stream = entry.nodeStream('nodebuffer')
      const fail = (message: string): void => {
        if (failed) return
        failed = true
        stream.pause()
        ;(stream as unknown as { destroy?: () => void }).destroy?.()
        reject(new Error(message))
      }
      stream.on('data', (chunk: Buffer) => {
        if (failed) return
        size += chunk.length
        this.total += chunk.length
        if (size > this.limits.maxEntryBytes) return fail(`Archive refusée : entrée trop volumineuse (${name})`)
        if (this.total > this.limits.maxTotalBytes) return fail('Archive refusée : contenu décompressé trop volumineux')
        chunks.push(chunk)
      })
      stream.on('error', (e: unknown) => fail(e instanceof Error ? e.message : String(e)))
      stream.on('end', () => {
        if (!failed) resolve(Buffer.concat(chunks))
      })
    })
    if (this.hashes) {
      const expected = this.hashes[name]
      if (!expected || expected !== sha256(data)) throw new Error(`Archive altérée : empreinte invalide (${name})`)
    }
    return data
  }
}

export async function importArchive(repo: Repo, buf: Buffer, limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS): Promise<Investigation> {
  const reader = await ArchiveReader.open(buf, limits)
  const file = await reader.read(MANIFEST)
  if (!file) throw new Error('Archive invalide : manifest.json manquant')
  let manifest: Manifest
  try {
    manifest = JSON.parse(file.toString('utf8')) as Manifest
  } catch {
    throw new Error('Archive invalide : manifest.json illisible')
  }
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error("Ce fichier n'est pas une enquête MASINT")
  if (manifest.version > ARCHIVE_VERSION) throw new Error('Archive créée par une version plus récente de MASINT')
  if (!Array.isArray(manifest.nodes) || !Array.isArray(manifest.edges)) throw new Error('Archive invalide : contenu incomplet')

  // Lectures et vérifications d'abord : une archive refusée ne laisse pas d'enquête à moitié créée.
  const blobs = new Map<string, Buffer>()
  for (const a of manifest.attachments ?? []) {
    const data = await reader.read(`attachments/${a.id}`)
    if (data) blobs.set(a.id, data)
  }
  const raws = new Map<string, string>()
  for (const r of manifest.runs ?? []) {
    if (!r.raw) continue
    const data = await reader.read(`runs/${r.id}.json`)
    if (data) raws.set(r.id, data.toString('utf8'))
  }

  const inv = repo.createInvestigation({
    name: uniqueName(repo, manifest.investigation.name),
    description: manifest.investigation.description,
    color: manifest.investigation.color,
    notes: manifest.investigation.notes
  })

  const attIds = new Map<string, string>()
  for (const a of manifest.attachments ?? []) {
    const data = blobs.get(a.id)
    if (!data) continue
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
  // Exécutions : nouveaux identifiants, une tâche d'origine devient une tâche de la copie.
  const jobIds = new Map<string, string>()
  for (const r of manifest.runs ?? []) {
    const nodeId = nodeIds.get(r.nodeId)
    if (!nodeId) continue
    if (!jobIds.has(r.jobId)) jobIds.set(r.jobId, randomUUID())
    const { raw: _raw, ...run } = r
    repo.importRun({ ...run, id: randomUUID(), investigationId: inv.id, nodeId, jobId: jobIds.get(r.jobId)! }, raws.get(r.id) ?? null)
  }
  if (manifest.investigation.viewport) repo.updateInvestigation(inv.id, { viewport: manifest.investigation.viewport })
  return repo.getInvestigation(inv.id)!
}

/** Copie complète d'une enquête dans la même base (même chemin que l'export puis l'import). */
export async function duplicateInvestigation(repo: Repo, id: string): Promise<Investigation> {
  const buf = await buildArchive(repo, id)
  const copy = await importArchive(repo, buf)
  const source = repo.getInvestigation(id)
  return repo.updateInvestigation(copy.id, { name: uniqueName(repo, `${source?.name ?? copy.name} (copie)`) })
}
