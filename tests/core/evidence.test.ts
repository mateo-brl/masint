// Preuves et journal d'activité : tables créées par migration, chaîne d'empreintes du journal
// (vérification puis altération détectée), regroupement des modifications, captures
// enregistrées avec leurs empreintes, archive version 2 avec captures et journal.
// better-sqlite3 est compilé pour Electron : `npm run test:core`. Valeurs fictives uniquement.

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureUrlOf, isSignificantActivity } from '@shared/evidence'
import type { Capture, GraphNode } from '@shared/types'
import {
  activityHash,
  ActivityLog,
  actorName,
  canonicalJson,
  changedNodeFields,
  GENESIS_HASH,
  isLayoutOnly,
  nodeRefs,
  verifyActivity
} from '../../src/main/activity'
import { ACTIVITY, buildArchive, duplicateInvestigation, HASHES, importArchive, MANIFEST, type Manifest } from '../../src/main/archive'
import { openDatabase, type DB } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { captureManifest, redactHeaders, storeCapture, verifyCapture, type CaptureShot } from '../../src/main/evidence'

let dir: string
let file: string
let db: DB
let repo: Repo
let clock: number
let log: ActivityLog

const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-evidence-'))
  file = join(dir, 'test.db')
  db = openDatabase(file)
  repo = new Repo(db)
  clock = Date.UTC(2026, 9, 22, 8, 0, 0)
  log = new ActivityLog(repo, () => 'Enquêteur test', () => new Date(clock))
})

afterEach(() => {
  log.dispose()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const tick = (ms = 1000): void => {
  clock += ms
}

const columns = (table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)

function reopen(): void {
  log.dispose()
  db.close()
  db = openDatabase(file)
  repo = new Repo(db)
  log = new ActivityLog(repo, () => 'Enquêteur test', () => new Date(clock))
}

function fakeShot(over: Partial<CaptureShot> = {}): CaptureShot {
  return {
    png: Buffer.from('\x89PNG\r\n\x1a\n page capturée'),
    mhtml: Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="x"\r\n\r\n--x--'),
    title: 'Profil fictif',
    finalUrl: 'https://exemple.test/profil/alice',
    requestedUrl: 'http://exemple.test/alice',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Test',
    navigation: {
      requestedUrl: 'http://exemple.test/alice',
      redirects: [{ url: 'http://exemple.test/alice', to: 'https://exemple.test/profil/alice', status: 301 }],
      url: 'https://exemple.test/profil/alice',
      method: 'GET',
      status: 200,
      fromCache: false,
      headers: redactHeaders({ 'Content-Type': ['text/html'], 'Set-Cookie': ['sid=secret-value; HttpOnly'] }),
      at: new Date(clock).toISOString()
    },
    page: { width: 1100, height: 2400, captured: { width: 1100, height: 2400 }, truncated: false, devicePixelRatio: 1, fullPage: true },
    ...over
  }
}

function seed(): { invId: string; node: GraphNode; other: GraphNode } {
  const inv = repo.createInvestigation({ name: 'Preuves' })
  const [node, other] = repo.upsertNodes(inv.id, [
    { kind: 'entity', type: 'url', label: 'https://exemple.test/profil/alice' },
    { kind: 'entity', type: 'account', label: 'alice', platform: 'github' }
  ])
  repo.upsertEdges(inv.id, [{ source: node.id, target: other.id, label: 'profil' }])
  return { invId: inv.id, node, other }
}

const settings = { proxy: { mode: 'tor' as const, url: '', torPort: 9150, perModule: {} } }

describe('Migrations', () => {
  it('crée les tables des preuves et du journal, et la colonne des recherches assistées', () => {
    expect(columns('captures')).toEqual([
      'id',
      'investigation_id',
      'node_id',
      'url',
      'final_url',
      'title',
      'captured_at',
      'screenshot_attachment',
      'mhtml_attachment',
      'meta_attachment',
      'manifest_sha256'
    ])
    expect(columns('activity')).toEqual(['id', 'investigation_id', 'seq', 'at', 'actor', 'action', 'target', 'prev_hash', 'hash'])
    expect(columns('suggestions')).toContain('assist_result')
    const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name)
    // Déclencheurs du journal (l'index de recherche globale a aussi les siens : nodes_search_*).
    expect(triggers.filter((name) => name.startsWith('activity_'))).toEqual(['activity_no_delete', 'activity_no_update'])
  })

  it('met à niveau une base antérieure sans toucher à ses données, et se rejoue sans erreur', () => {
    const { invId, node } = seed()
    // Base d'avant les preuves et le journal.
    db.exec('DROP TABLE captures; DROP TABLE activity; ALTER TABLE suggestions DROP COLUMN assist_result;')
    db.pragma('user_version = 3')
    reopen()
    expect(columns('captures')).toContain('manifest_sha256')
    expect(columns('activity')).toContain('prev_hash')
    expect(columns('suggestions')).toContain('assist_result')
    expect(repo.getNode(node.id)?.label).toBe(node.label)
    // Migrations rejouées sur une base déjà à jour (versions réordonnées) : aucune erreur.
    log.log(invId, 'investigation.create', { name: 'Preuves' })
    db.pragma('user_version = 3')
    reopen()
    expect(repo.allActivity(invId)).toHaveLength(1)
  })

  it('refuse la modification et la suppression d’une entrée, sauf avec l’enquête entière', () => {
    const { invId } = seed()
    log.log(invId, 'investigation.create', { name: 'Preuves' })
    expect(() => db.prepare("UPDATE activity SET actor = 'autre'").run()).toThrow(/ajout seul/)
    expect(() => db.prepare('DELETE FROM activity').run()).toThrow(/ajout seul/)
    repo.deleteInvestigation(invId)
    expect((db.prepare('SELECT COUNT(*) AS n FROM activity').get() as { n: number }).n).toBe(0)
  })
})

describe("Chaîne d'empreintes du journal", () => {
  function fill(invId: string): void {
    log.log(invId, 'investigation.create', { name: 'Preuves' })
    tick()
    log.log(invId, 'node.create', nodeRefs([{ id: 'n1', type: 'phone', label: '+33600000000' }]))
    tick()
    log.log(invId, 'module.run', { node: { id: 'n1', type: 'phone', label: '+33600000000' }, modules: ['a', 'b'], count: 2, job: 'j1' })
    tick()
    log.log(invId, 'suggestion.reject', { suggestion: 's1', value: 'bob', module: 'a' })
    tick()
    log.log(invId, 'export.report', { kind: 'report-pdf', file: 'rapport.pdf', sha256: 'ab'.repeat(32), size: 10 })
  }

  it('chaîne chaque entrée à la précédente et se vérifie', () => {
    const { invId } = seed()
    fill(invId)
    const all = repo.allActivity(invId)
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(all[0].prevHash).toBe(GENESIS_HASH)
    for (let i = 1; i < all.length; i++) expect(all[i].prevHash).toBe(all[i - 1].hash)
    // Formule documentée : sha256(prev_hash + JSON canonique de l'entrée).
    const e = all[2]
    const canonical = canonicalJson({ seq: e.seq, at: e.at, actor: e.actor, action: e.action, target: e.target })
    expect(e.hash).toBe(sha(e.prevHash + canonical))
    expect(e.hash).toBe(activityHash(e.prevHash, e))
    expect(all[0].actor).toBe('Enquêteur test')
    expect(all[0].at).toBe('2026-10-22T08:00:00.000Z')
    const check = log.verify(invId)
    expect(check).toEqual({ ok: true, count: 5, lastHash: all[4].hash })
    // Chaîne propre à chaque enquête.
    const other = repo.createInvestigation({ name: 'Autre' })
    log.log(other.id, 'investigation.create', { name: 'Autre' })
    expect(repo.allActivity(other.id)[0].prevHash).toBe(GENESIS_HASH)
  })

  it('détecte la première entrée altérée, réécrite ou retirée', () => {
    const { invId } = seed()
    fill(invId)
    // Accès direct au fichier : les déclencheurs ne protègent pas d'un attaquant qui les retire.
    db.exec('DROP TRIGGER activity_no_update; DROP TRIGGER activity_no_delete;')
    db.prepare("UPDATE activity SET target = ? WHERE investigation_id = ? AND seq = 3").run(JSON.stringify({ modules: ['a'] }), invId)
    let check = log.verify(invId)
    expect(check.ok).toBe(false)
    expect(check.broken).toMatchObject({ seq: 3, action: 'module.run', reason: 'hash' })

    // Empreinte de l'entrée recalculée par l'attaquant : la suivante ne s'y raccroche plus.
    const third = repo.allActivity(invId)[2]
    db.prepare('UPDATE activity SET hash = ? WHERE id = ?').run(activityHash(third.prevHash, third), third.id)
    check = log.verify(invId)
    expect(check.broken).toMatchObject({ seq: 4, reason: 'link' })

    // Entrée retirée : rang manquant.
    reopen()
    const { invId: inv2 } = seed()
    fill(inv2)
    db.exec('DROP TRIGGER IF EXISTS activity_no_delete;')
    db.prepare('DELETE FROM activity WHERE investigation_id = ? AND seq = 2').run(inv2)
    expect(log.verify(inv2).broken).toMatchObject({ seq: 3, reason: 'order' })
  })

  it('vérifie aussi une liste vide et une liste fournie telle quelle', () => {
    expect(verifyActivity([])).toEqual({ ok: true, count: 0, lastHash: null })
  })

  it("regroupe une création et la saisie qui suit, et les modifications d'un même nœud", () => {
    const { invId } = seed()
    const ref = { id: 'n9', type: 'email', label: '' }
    log.group(invId, 'node.create', { nodes: [ref], count: 1 })
    tick(500)
    log.group(invId, 'node.update', { nodes: [{ ...ref, label: 'a@exemple.test' }], count: 1 }, ['label'])
    tick(500)
    log.group(invId, 'node.update', { nodes: [{ ...ref, label: 'alice@exemple.test' }], count: 1 }, ['label'])
    expect(repo.allActivity(invId)).toHaveLength(0)
    // Toute autre entrée de l'enquête écrit d'abord les modifications en attente.
    tick(500)
    log.log(invId, 'node.delete', { nodes: [{ ...ref, label: 'alice@exemple.test' }], count: 1 })
    const all = repo.allActivity(invId)
    expect(all.map((e) => e.action)).toEqual(['node.create', 'node.delete'])
    expect(all[0].target.nodes?.[0].label).toBe('alice@exemple.test')
    expect(all[0].at).toBe('2026-10-22T08:00:00.000Z')

    const n2 = { id: 'n10', type: 'phone', label: '+33600000001' }
    log.group(invId, 'node.update', { nodes: [n2], count: 1 }, ['style'])
    log.group(invId, 'node.update', { nodes: [n2], count: 1 }, ['notes'])
    log.flush(invId)
    const last = repo.allActivity(invId).at(-1)!
    expect(last.action).toBe('node.update')
    expect(last.target.fields).toEqual(['notes', 'style'])
    expect(log.verify(invId).ok).toBe(true)
  })

  it('ignore les déplacements et ne retient que les champs modifiés', () => {
    const { node } = seed()
    expect(isLayoutOnly({ id: node.id, x: 10, y: 20 })).toBe(true)
    expect(isLayoutOnly({ id: node.id, width: 100, height: 40 })).toBe(true)
    expect(isLayoutOnly({ id: node.id, x: 10, label: 'x' })).toBe(false)
    expect(changedNodeFields(node, { id: node.id, x: 5, label: node.label, data: { ...node.data } })).toEqual([])
    expect(changedNodeFields(node, { id: node.id, label: 'https://exemple.test/autre', style: { color: '#fff' } })).toEqual(['label', 'style'])
    // Replier une descendance est un état d'affichage.
    expect(changedNodeFields(node, { id: node.id, style: { ...node.style, collapsed: true } })).toEqual([])
  })

  it('ne garde au rapport que les actions significatives', () => {
    expect(isSignificantActivity({ action: 'node.delete', target: {} })).toBe(true)
    expect(isSignificantActivity({ action: 'node.update', target: { fields: ['style', 'notes'] } })).toBe(false)
    expect(isSignificantActivity({ action: 'node.update', target: { fields: ['label'] } })).toBe(true)
  })

  it("prend le nom de l'enquêteur, sinon celui de la session du système", () => {
    expect(actorName({ investigatorName: '  Lt. Martin ' })).toBe('Lt. Martin')
    expect(actorName({ investigatorName: '' }).length).toBeGreaterThan(0)
  })
})

describe('Captures', () => {
  it('enregistre trois pièces jointes, leurs empreintes et celle du manifeste', () => {
    const { invId, node } = seed()
    const shot = fakeShot()
    const c = storeCapture({ repo, activity: log, settings, appVersion: '9.9.9' }, { investigationId: invId, nodeId: node.id, via: 'node' }, shot, new Date(clock))
    expect(c).toMatchObject({ nodeId: node.id, url: 'http://exemple.test/alice', finalUrl: 'https://exemple.test/profil/alice', capturedAt: '2026-10-22T08:00:00.000Z' })
    const png = repo.getAttachment(c.screenshotAttachment)!
    const mhtml = repo.getAttachment(c.mhtmlAttachment)!
    const meta = repo.getAttachment(c.metaAttachment)!
    expect(png).toMatchObject({ mime: 'image/png', sha256: sha(shot.png), origin: shot.finalUrl })
    expect(mhtml).toMatchObject({ mime: 'multipart/related', sha256: sha(shot.mhtml) })
    expect(png.name).toBe('capture-exemple.test-2026-10-22T08-00-00Z.png')
    const context = JSON.parse(repo.getAttachmentData(meta.id)!.data.toString('utf8'))
    expect(context).toMatchObject({
      requestedUrl: 'http://exemple.test/alice',
      finalUrl: 'https://exemple.test/profil/alice',
      capturedAt: '2026-10-22T08:00:00.000Z',
      network: { mode: 'tor', proxy: 'socks5://127.0.0.1:9150' },
      app: { name: 'MASINT', version: '9.9.9' },
      browser: { userAgent: shot.userAgent },
      files: { screenshot: { sha256: png.sha256 }, mhtml: { sha256: mhtml.sha256 } }
    })
    expect(context.navigation.redirects[0].status).toBe(301)
    // La session de l'enquêteur ne part pas avec la preuve.
    expect(context.navigation.headers['set-cookie']).toEqual(['sid=***'])
    const manifest = captureManifest(c, [
      { role: 'meta', sha256: meta.sha256, size: meta.size },
      { role: 'screenshot', sha256: png.sha256, size: png.size },
      { role: 'mhtml', sha256: mhtml.sha256, size: mhtml.size }
    ])
    expect(c.manifestSha256).toBe(sha(manifest))
    expect(verifyCapture(repo, c)).toEqual({ ok: true, manifestSha256: c.manifestSha256, problems: [] })
    // Inscrite au journal.
    const entry = repo.allActivity(invId).at(-1)!
    expect(entry).toMatchObject({ action: 'capture.create', target: { capture: c.id, sha256: c.manifestSha256, via: 'node', node: { id: node.id } } })
  })

  it("liste les captures d'un nœud, suit une fusion et masque celles d'un nœud supprimé", () => {
    const { invId, node, other } = seed()
    const c1 = storeCapture({ repo, settings, appVersion: '1' }, { investigationId: invId, nodeId: node.id, via: 'browser' }, fakeShot())
    tick()
    const loose = storeCapture({ repo, settings, appVersion: '1' }, { investigationId: invId, nodeId: null, via: 'browser' }, fakeShot({ png: Buffer.from('autre image') }))
    expect(repo.listCaptures(invId, node.id).map((c) => c.id)).toEqual([c1.id])
    repo.reassignNodeHistory(invId, [node.id], other.id)
    expect(repo.listCaptures(invId, other.id).map((c) => c.id)).toEqual([c1.id])
    repo.deleteNodes(invId, [other.id])
    expect(repo.listCaptures(invId).map((c) => c.id)).toEqual([loose.id])
  })

  it("détecte un fichier de capture modifié", () => {
    const { invId, node } = seed()
    const c = storeCapture({ repo, settings, appVersion: '1' }, { investigationId: invId, nodeId: node.id, via: 'node' }, fakeShot())
    db.prepare('UPDATE attachments SET data = ? WHERE id = ?').run(Buffer.from('image retouchée'), c.screenshotAttachment)
    const v = verifyCapture(repo, c)
    expect(v.ok).toBe(false)
    expect(v.problems).toContain('screenshot : empreinte différente')
  })

  it('trouve la page à capturer d’un nœud url ou account', () => {
    expect(captureUrlOf({ kind: 'entity', type: 'url', label: 'https://exemple.test/a', platform: null, data: {} })).toBe('https://exemple.test/a')
    expect(captureUrlOf({ kind: 'entity', type: 'account', label: 'alice', platform: 'github', data: {} })).toBe('https://github.com/alice')
    expect(captureUrlOf({ kind: 'entity', type: 'account', label: 'x', platform: null, data: { url: 'https://exemple.test/u/x' } })).toBe('https://exemple.test/u/x')
    expect(captureUrlOf({ kind: 'entity', type: 'phone', label: '+33600000000', platform: null, data: {} })).toBeNull()
  })
})

describe('Archive avec captures et journal', () => {
  async function prepared(): Promise<{ invId: string; capture: Capture; buf: Buffer }> {
    const { invId, node, other } = seed()
    log.log(invId, 'investigation.create', { name: 'Preuves' })
    tick()
    const capture = storeCapture({ repo, activity: log, settings, appVersion: '1' }, { investigationId: invId, nodeId: node.id, via: 'browser' }, fakeShot(), new Date(clock))
    tick()
    // Capture d'un nœud supprimé : elle reste sur le poste.
    const gone = repo.upsertNodes(invId, [{ kind: 'entity', type: 'url', label: 'https://exemple.test/supprime' }])[0]
    storeCapture({ repo, settings, appVersion: '1' }, { investigationId: invId, nodeId: gone.id, via: 'node' }, fakeShot({ png: Buffer.from('image du nœud supprimé'), mhtml: Buffer.from('mhtml supprimé') }))
    repo.deleteNodes(invId, [gone.id])
    log.log(invId, 'node.delete', nodeRefs([gone]))
    tick()
    log.log(invId, 'suggestion.accept', { value: other.label })
    return { invId, capture, buf: await buildArchive(repo, invId) }
  }

  it('embarque les captures, leurs fichiers et le journal, avec leurs empreintes', async () => {
    const { invId, capture, buf } = await prepared()
    const zip = await JSZip.loadAsync(buf)
    const manifest = JSON.parse(await zip.file(MANIFEST)!.async('string')) as Manifest
    const hashes = JSON.parse(await zip.file(HASHES)!.async('string')) as Record<string, string>
    expect(manifest.captures?.map((c) => c.id)).toEqual([capture.id])
    expect(manifest.activity).toBe(4)
    for (const id of [capture.screenshotAttachment, capture.mhtmlAttachment, capture.metaAttachment]) {
      expect(zip.file(`attachments/${id}`)).toBeTruthy()
      expect(hashes[`attachments/${id}`]).toBe(repo.getAttachment(id)!.sha256)
    }
    // Fichiers de la capture du nœud supprimé absents.
    expect(Object.keys(zip.files).filter((n) => n.startsWith('attachments/') && !zip.files[n].dir)).toHaveLength(3)
    const journal = await zip.file(ACTIVITY)!.async('string')
    expect(hashes[ACTIVITY]).toBe(sha(journal))
    expect((JSON.parse(journal) as unknown[]).length).toBe(4)
    expect(repo.allActivity(invId)).toHaveLength(4)
  })

  it('reprend les captures et le journal à l’import : mêmes empreintes, chaîne intacte', async () => {
    const { invId, capture, buf } = await prepared()
    const original = log.verify(invId)
    const copy = await importArchive(repo, buf)
    const [imported] = repo.listCaptures(copy.id)
    const node = repo.listNodes(copy.id).find((n) => n.type === 'url')!
    expect(imported).toMatchObject({ nodeId: node.id, url: capture.url, finalUrl: capture.finalUrl, capturedAt: capture.capturedAt, manifestSha256: capture.manifestSha256 })
    expect(imported.id).not.toBe(capture.id)
    expect(verifyCapture(repo, imported).ok).toBe(true)
    const check = log.verify(copy.id)
    expect(check).toEqual({ ok: true, count: 4, lastHash: original.lastHash })
    // Le journal de la copie se poursuit à partir de la chaîne importée.
    log.log(copy.id, 'archive.import', { file: 'preuves.masint', sha256: sha(buf), size: buf.length })
    const after = log.verify(copy.id)
    expect(after.ok).toBe(true)
    expect(after.count).toBe(5)
    expect(repo.allActivity(copy.id)[4].prevHash).toBe(original.lastHash)
  })

  it('la copie d’enquête garde les captures et le journal', async () => {
    const { invId } = await prepared()
    const copy = await duplicateInvestigation(repo, invId)
    expect(repo.listCaptures(copy.id)).toHaveLength(1)
    expect(log.verify(copy.id)).toMatchObject({ ok: true, count: 4 })
  })

  it('refuse une archive dont le journal a été modifié', async () => {
    const { buf } = await prepared()
    const zip = await JSZip.loadAsync(buf)
    const journal = JSON.parse(await zip.file(ACTIVITY)!.async('string')) as Array<{ actor: string }>
    journal[0].actor = 'Quelqu’un d’autre'
    zip.file(ACTIVITY, JSON.stringify(journal))
    const before = repo.listInvestigations().length
    await expect(importArchive(repo, await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/empreinte invalide \(activity\.json\)/)
    expect(repo.listInvestigations()).toHaveLength(before)
  })

  it('importe une archive au journal réécrit (empreintes refaites) et signale la chaîne rompue', async () => {
    const { buf } = await prepared()
    const zip = await JSZip.loadAsync(buf)
    const journal = JSON.parse(await zip.file(ACTIVITY)!.async('string')) as Array<{ actor: string }>
    journal[1].actor = 'Quelqu’un d’autre'
    const text = JSON.stringify(journal)
    zip.file(ACTIVITY, text)
    const hashes = JSON.parse(await zip.file(HASHES)!.async('string')) as Record<string, string>
    hashes[ACTIVITY] = sha(text)
    zip.file(HASHES, JSON.stringify(hashes))
    const copy = await importArchive(repo, await zip.generateAsync({ type: 'nodebuffer' }))
    expect(log.verify(copy.id)).toMatchObject({ ok: false, broken: { seq: 2, reason: 'hash' } })
  })

  it('refuse un journal mal formé avant de créer l’enquête', async () => {
    const { buf } = await prepared()
    const zip = await JSZip.loadAsync(buf)
    const text = JSON.stringify([{ seq: 1 }, { seq: 1 }])
    zip.file(ACTIVITY, text)
    const hashes = JSON.parse(await zip.file(HASHES)!.async('string')) as Record<string, string>
    hashes[ACTIVITY] = sha(text)
    zip.file(HASHES, JSON.stringify(hashes))
    const before = repo.listInvestigations().length
    await expect(importArchive(repo, await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/journal d’activité illisible/)
    expect(repo.listInvestigations()).toHaveLength(before)
  })
})

describe('Recherche assistée gardée en base', () => {
  it('garde le dernier résultat avec la recherche manuelle, jusque dans une copie', async () => {
    const { invId, node } = seed()
    const s = repo.addSuggestion({ investigationId: invId, nodeId: node.id, moduleId: 'm', kind: 'manual', type: 'search_link', label: 'Recherche', platform: null, data: {}, linkLabel: '', url: 'https://exemple.test/q', reason: '' })!
    const result = { status: 'ok' as const, url: 'https://exemple.test/q', title: 'Résultats', matches: [{ title: 'Alice', url: 'https://exemple.test/a', snippet: 'alice' }] }
    repo.setSuggestionAssist(s.id, { result, added: ['https://exemple.test/a'], at: 1 })
    expect(repo.getSuggestion(s.id)?.assist).toEqual({ result, added: ['https://exemple.test/a'], at: 1 })
    expect(repo.listSuggestions(invId)[0].assist?.result.matches).toHaveLength(1)
    const copy = await duplicateInvestigation(repo, invId)
    expect(repo.listSuggestions(copy.id)[0].assist?.added).toEqual(['https://exemple.test/a'])
  })
})
