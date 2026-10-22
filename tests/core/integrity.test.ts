// Intégrité des données : clés canoniques en base, migration, mode « mise à jour seule »,
// doublons signalés, archive version 2. better-sqlite3 est compilé pour Electron : ces tests
// tournent avec `npm run test:core`. Valeurs fictives uniquement.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildArchive, duplicateInvestigation, importArchive, zipEntryCount, type Manifest } from '../../src/main/archive'
import { openDatabase, type DB } from '../../src/main/db/database'
import { dedupKey, Repo } from '../../src/main/db/repo'

let dir: string
let file: string
let db: DB
let repo: Repo

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-integrity-'))
  file = join(dir, 'test.db')
  db = openDatabase(file)
  repo = new Repo(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Rouvre la base comme au lancement d'une version plus récente (migrations rejouées). */
function reopen(): void {
  db.close()
  db = openDatabase(file)
  repo = new Repo(db)
}

const key = (id: string): string => (db.prepare('SELECT dedup_key FROM nodes WHERE id = ?').get(id) as { dedup_key: string }).dedup_key

describe('Migration des clés de dédoublonnage', () => {
  it('recalcule les clés sans fusionner les nœuds qui entrent en collision', () => {
    const inv = repo.createInvestigation({ name: 'Migration' })
    const other = repo.createInvestigation({ name: 'Autre' })
    // Clés au format d'avant : chiffres et « + » seulement, plateforme dans la clé.
    const insert = db.prepare(
      `INSERT INTO nodes (id, investigation_id, kind, type, label, platform, dedup_key, created_at, updated_at)
       VALUES (?, ?, 'entity', ?, ?, ?, ?, ?, ?)`
    )
    insert.run('n1', inv.id, 'phone', '06 39 98 12 34', null, 'phone||0639981234', 1, 1)
    insert.run('n2', inv.id, 'phone', '+33639981234', null, 'phone||+33639981234', 2, 2)
    insert.run('n3', inv.id, 'email', 'Alice@Gmail.com', 'gmail', 'email|gmail|alice@gmail.com', 3, 3)
    insert.run('n4', inv.id, 'email', 'alice@gmail.com', null, 'email||alice@gmail.com', 4, 4)
    insert.run('n5', other.id, 'phone', '0639981234', null, 'phone||0639981234', 5, 5)
    insert.run('n6', inv.id, 'account', 'alice', 'github', 'account|github|alice', 6, 6)
    db.prepare("INSERT INTO nodes (id, investigation_id, kind, type, label, created_at, updated_at) VALUES ('t1', ?, 'text', 'text', 'note', 7, 7)").run(inv.id)
    // Deux suggestions qui deviennent identiques : l'index unique doit rester valide.
    const sugg = db.prepare(
      `INSERT INTO suggestions (id, investigation_id, node_id, module_id, kind, type, label, platform, dedup_key, status, created_at, updated_at)
       VALUES (?, ?, 'n6', 'm', 'entity', 'email', ?, ?, ?, ?, ?, ?)`
    )
    sugg.run('s1', inv.id, 'bob@gmail.com', 'gmail', 'email|gmail|bob@gmail.com', 'rejected', 1, 1)
    sugg.run('s2', inv.id, 'BOB@gmail.com', null, 'email||bob@gmail.com', 'pending', 2, 2)
    db.pragma('user_version = 2')

    reopen()
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(3)
    // Les deux nœuds restent, avec la même clé canonique.
    expect(repo.listNodes(inv.id).filter((n) => n.type === 'phone')).toHaveLength(2)
    expect(key('n1')).toBe('phone||+33639981234')
    expect(key('n2')).toBe('phone||+33639981234')
    expect(key('n3')).toBe(key('n4'))
    expect(key('n6')).toBe('account|github|alice')
    expect((db.prepare("SELECT dedup_key FROM nodes WHERE id = 't1'").get() as { dedup_key: string | null }).dedup_key).toBeNull()
    // Le plus ancien sert de référence au dédoublonnage.
    expect(repo.findNodeByDedup(inv.id, dedupKey('phone', '+33 6 39 98 12 34'))?.id).toBe('n1')
    // Une autre enquête n'est pas concernée.
    expect(repo.findNodeByDedup(other.id, dedupKey('phone', '+33639981234'))?.id).toBe('n5')
    // Suggestions : la plus ancienne garde la clé, la suivante est suffixée.
    const keys = db.prepare('SELECT id, dedup_key FROM suggestions ORDER BY id').all() as Array<{ id: string; dedup_key: string }>
    expect(keys[0].dedup_key).toBe('email||bob@gmail.com')
    expect(keys[1].dedup_key).toBe('email||bob@gmail.com#s2')
    // La suggestion écartée n'est pas reproposée sous une autre forme.
    expect(
      repo.addSuggestion({ investigationId: inv.id, nodeId: 'n6', moduleId: 'm', kind: 'entity', type: 'email', label: 'bob@gmail.com', platform: 'gmail', data: {}, linkLabel: '', url: null, reason: '' })
    ).toBeNull()
  })
})

describe('Doublons signalés', () => {
  it('signale une valeur saisie qui existe déjà, sans fusionner', () => {
    const inv = repo.createInvestigation({ name: 'Doublons' })
    const [found] = repo.upsertNodes(inv.id, [{ type: 'phone', label: '+33639981234', source: 'phone.info' }])
    const [typed] = repo.upsertNodes(inv.id, [{ type: 'phone', label: '06 39 98 12 34' }])
    expect(typed.id).not.toBe(found.id)
    expect(typed.duplicateOf).toBe(found.id)
    expect(repo.listNodes(inv.id)).toHaveLength(2)
  })

  it('signale aussi une valeur modifiée, et pas un simple déplacement', () => {
    const inv = repo.createInvestigation({ name: 'Doublons' })
    const [a] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'alice@example.com', platform: 'x' }])
    const [b] = repo.upsertNodes(inv.id, [{ type: 'email', label: '' }])
    expect(b.duplicateOf).toBeUndefined()
    const [renamed] = repo.upsertNodes(inv.id, [{ id: b.id, label: 'ALICE@example.com' }], { updateOnly: true })
    expect(renamed.duplicateOf).toBe(a.id)
    const [moved] = repo.upsertNodes(inv.id, [{ id: b.id, x: 50 }], { updateOnly: true })
    expect(moved.duplicateOf).toBeUndefined()
  })
})

describe('Mise à jour seule', () => {
  it('ignore un patch vers un nœud supprimé au lieu de créer un nœud fantôme', () => {
    const inv = repo.createInvestigation({ name: 'Annulation' })
    const [a, b] = repo.upsertNodes(inv.id, [
      { type: 'person', label: 'Alice Exemple', x: 0, y: 0 },
      { type: 'person', label: 'Bob Exemple', x: 300, y: 0 }
    ])
    repo.deleteNodes(inv.id, [a.id])
    const out = repo.upsertNodes(inv.id, [{ id: a.id, x: 10, y: 20 }, { id: b.id, x: 400 }], { updateOnly: true })
    expect(out.map((n) => n.id)).toEqual([b.id])
    const nodes = repo.listNodes(inv.id)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].x).toBe(400)
    expect(nodes.some((n) => n.type === 'keyword')).toBe(false)
  })

  it('ne touche pas un nœud d’une autre enquête', () => {
    const inv = repo.createInvestigation({ name: 'A' })
    const other = repo.createInvestigation({ name: 'B' })
    const [n] = repo.upsertNodes(other.id, [{ type: 'person', label: 'Alice Exemple', x: 1 }])
    expect(repo.upsertNodes(inv.id, [{ id: n.id, x: 99 }], { updateOnly: true })).toHaveLength(0)
    expect(repo.getNode(n.id)!.x).toBe(1)
  })

  it('sans ce mode, une création avec identifiant reste possible (annulation d’une suppression)', () => {
    const inv = repo.createInvestigation({ name: 'Annulation' })
    const [a] = repo.upsertNodes(inv.id, [{ type: 'person', label: 'Alice Exemple' }])
    repo.deleteNodes(inv.id, [a.id])
    repo.upsertNodes(inv.id, [a])
    expect(repo.getNode(a.id)?.label).toBe('Alice Exemple')
  })

  it('ne crée jamais de lien vers un nœud absent, et ignore le patch d’un lien supprimé', () => {
    const inv = repo.createInvestigation({ name: 'Liens' })
    const [a, b] = repo.upsertNodes(inv.id, [
      { type: 'person', label: 'Alice Exemple' },
      { type: 'person', label: 'Bob Exemple' }
    ])
    expect(repo.upsertEdges(inv.id, [{ source: a.id, target: 'absent' }])).toHaveLength(0)
    const [e] = repo.upsertEdges(inv.id, [{ source: a.id, target: b.id, label: 'connaît' }])
    repo.deleteEdges(inv.id, [e.id])
    expect(repo.upsertEdges(inv.id, [{ ...e, label: 'autre' }], { updateOnly: true })).toHaveLength(0)
    expect(repo.listEdges(inv.id)).toHaveLength(0)
  })
})

describe('Fusion', () => {
  it('reporte les exécutions du nœud absorbé sur la cible', () => {
    const inv = repo.createInvestigation({ name: 'Fusion' })
    const [a, b] = repo.upsertNodes(inv.id, [
      { type: 'phone', label: '+33639981234' },
      { type: 'phone', label: '06 39 98 12 34' }
    ])
    repo.insertRun({ id: 'r1', investigationId: inv.id, nodeId: b.id, moduleId: 'phone.info', jobId: 'j', status: 'done', found: null, resultCount: 2, error: null, startedAt: 1, finishedAt: 2 })
    repo.reassignNodeHistory(inv.id, [b.id], a.id)
    repo.deleteNodes(inv.id, [b.id])
    expect(repo.listRuns(inv.id, a.id).map((r) => r.id)).toEqual(['r1'])
    expect(repo.runStats(inv.id)).toEqual([{ moduleId: 'phone.info', runs: 1, results: 2, errors: 0 }])
  })
})

describe('Statistiques des exécutions', () => {
  it('compte toutes les exécutions, au-delà de la limite de la liste', () => {
    const inv = repo.createInvestigation({ name: 'Stats' })
    const [n] = repo.upsertNodes(inv.id, [{ type: 'domain', label: 'example.com' }])
    const insert = db.transaction(() => {
      for (let i = 0; i < 2100; i++)
        repo.insertRun({ id: `r${i}`, investigationId: inv.id, nodeId: n.id, moduleId: i % 3 ? 'dns' : 'rdap', jobId: 'j', status: i % 10 ? 'done' : 'error', found: null, resultCount: 1, error: null, startedAt: i, finishedAt: i })
    })
    insert()
    expect(repo.listRuns(inv.id)).toHaveLength(2000)
    const stats = repo.runStats(inv.id)
    expect(stats.reduce((a, s) => a + s.runs, 0)).toBe(2100)
    expect(stats.find((s) => s.moduleId === 'rdap')).toEqual({ moduleId: 'rdap', runs: 700, results: 700, errors: 70 })
  })
})

describe('Archive version 2', () => {
  async function sample(): Promise<{ invId: string; kept: string; orphan: string }> {
    const inv = repo.createInvestigation({ name: 'Archive v2' })
    const kept = repo.addAttachment(inv.id, { name: 'photo.png', mime: 'image/png', data: Buffer.from([1, 2, 3]), origin: 'https://example.com/photo.png' })
    const orphan = repo.addAttachment(inv.id, { name: 'orpheline.png', mime: 'image/png', data: Buffer.from([4, 5, 6]) })
    const [p, gone] = repo.upsertNodes(inv.id, [
      { type: 'person', label: 'Alice Exemple', imageId: kept.id },
      { type: 'photo', label: 'Supprimée', imageId: orphan.id }
    ])
    repo.insertRun({ id: 'run-1', investigationId: inv.id, nodeId: p.id, moduleId: 'person.wikidata', jobId: 'job-1', status: 'done', found: true, resultCount: 3, error: null, startedAt: 10, finishedAt: 20 })
    repo.updateRun('run-1', { raw: JSON.stringify({ hits: ['alpha'] }) })
    repo.insertRun({ id: 'run-2', investigationId: inv.id, nodeId: gone.id, moduleId: 'image.exif', jobId: 'job-1', status: 'done', found: null, resultCount: 1, error: null, startedAt: 11, finishedAt: 21 })
    repo.updateRun('run-2', { raw: JSON.stringify({ secret: 'ne doit pas partir' }) })
    repo.deleteNodes(inv.id, [gone.id])
    return { invId: inv.id, kept: kept.id, orphan: orphan.id }
  }

  it('inclut les exécutions avec leur réponse brute et exclut les pièces orphelines', async () => {
    const { invId, kept, orphan } = await sample()
    const buf = await buildArchive(repo, invId)
    const zip = await JSZip.loadAsync(buf)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as Manifest
    expect(manifest.version).toBe(2)
    expect(manifest.attachments.map((a) => a.id)).toEqual([kept])
    expect(zip.file(`attachments/${orphan}`)).toBeNull()
    expect(manifest.runs?.map((r) => r.id)).toEqual(['run-1'])
    expect(zip.file('runs/run-2.json')).toBeNull()
    const hashes = JSON.parse(await zip.file('hashes.json')!.async('string')) as Record<string, string>
    expect(Object.keys(hashes).sort()).toEqual(['attachments/' + kept, 'manifest.json', 'runs/run-1.json'].sort())

    const copy = await importArchive(repo, buf)
    const runs = repo.listRuns(copy.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].moduleId).toBe('person.wikidata')
    expect(runs[0].nodeId).toBe(repo.listNodes(copy.id)[0].id)
    expect(repo.getRunRaw(runs[0].id)).toEqual({ hits: ['alpha'] })
    expect(repo.listAttachments(copy.id).map((a) => a.name)).toEqual(['photo.png'])
    expect(repo.listAttachments(copy.id)[0].origin).toBe('https://example.com/photo.png')
  })

  it('la copie d’enquête garde les exécutions', async () => {
    const { invId } = await sample()
    const copy = await duplicateInvestigation(repo, invId)
    expect(repo.runStats(copy.id)).toEqual(repo.runStats(invId))
    expect(repo.listAttachments(copy.id)).toHaveLength(1)
  })

  it('refuse une archive dont une entrée a été modifiée', async () => {
    const { invId, kept } = await sample()
    const zip = await JSZip.loadAsync(await buildArchive(repo, invId))
    zip.file(`attachments/${kept}`, Buffer.from([9, 9, 9]))
    const tampered = await zip.generateAsync({ type: 'nodebuffer' })
    const before = repo.listInvestigations().length
    await expect(importArchive(repo, tampered)).rejects.toThrow(/empreinte/)
    expect(repo.listInvestigations()).toHaveLength(before)
  })

  it('lit encore les archives version 1', async () => {
    const inv = repo.createInvestigation({ name: 'Ancienne' })
    const [n] = repo.upsertNodes(inv.id, [{ type: 'domain', label: 'example.com' }])
    const zip = new JSZip()
    const manifest = { format: 'masint', version: 1, exportedAt: 0, investigation: inv, nodes: [n], edges: [], attachments: [] }
    zip.file('manifest.json', JSON.stringify(manifest))
    const copy = await importArchive(repo, await zip.generateAsync({ type: 'nodebuffer' }))
    expect(repo.listNodes(copy.id).map((x) => x.label)).toEqual(['example.com'])
    expect(repo.listRuns(copy.id)).toHaveLength(0)
  })

  it('refuse une archive piégée : trop d’entrées, entrée ou total trop volumineux', async () => {
    const { invId } = await sample()
    const buf = await buildArchive(repo, invId)
    const limits = { maxEntries: 50_000, maxEntryBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024 }
    // Nombre d'entrées lu dans le répertoire central, avant décompression.
    // Manifeste, empreintes, une pièce jointe, une réponse brute et leurs deux dossiers.
    expect(zipEntryCount(buf)).toBe(6)
    await expect(importArchive(repo, buf, { ...limits, maxEntries: 3 })).rejects.toThrow(/entrées/)
    // Bombe de décompression : 4 Mo de zéros compressés en quelques kilo-octets.
    const bomb = await JSZip.loadAsync(buf)
    bomb.file('runs/bombe.json', Buffer.alloc(4 * 1024 * 1024))
    const bombBuf = await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    expect(bombBuf.length).toBeLessThan(64 * 1024)
    await expect(importArchive(repo, bombBuf, limits)).rejects.toThrow(/volumineuse/)
    await expect(importArchive(repo, buf, { ...limits, maxTotalBytes: 100 })).rejects.toThrow(/volumineu/)
    expect(repo.listInvestigations().map((i) => i.name)).toEqual(['Archive v2'])
  })
})
