// Tests du moteur et de la base. better-sqlite3 est compilé pour Electron :
// ces tests tournent avec `npm run test:core` (Electron en mode Node).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineModule, type ModuleContext } from '@shared/modules'
import type { GraphChange } from '@shared/types'
import { buildArchive, importArchive } from '../../src/main/archive'
import { openDatabase, type DB } from '../../src/main/db/database'
import { dedupKey, Repo } from '../../src/main/db/repo'
import { Engine } from '../../src/main/engine/runner'
import { SettingsService } from '../../src/main/settings'

let dir: string
let db: DB
let repo: Repo
let settings: SettingsService
let changes: GraphChange[]
let engine: Engine

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-test-'))
  db = openDatabase(join(dir, 'test.db'))
  repo = new Repo(db)
  settings = new SettingsService(repo)
  changes = []
  engine = new Engine(repo, settings, (event, payload) => {
    if (event === 'graph:changed') changes.push(payload as GraphChange)
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const fakeCtx = {} as ModuleContext

describe('Repo', () => {
  it('crée une enquête et ses nœuds', () => {
    const inv = repo.createInvestigation({ name: 'Test' })
    const [n] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'a@b.fr', x: 10, y: 20 }])
    expect(n.kind).toBe('entity')
    expect(repo.listInvestigations()[0].nodeCount).toBe(1)
    const [updated] = repo.upsertNodes(inv.id, [{ id: n.id, label: 'c@d.fr' }])
    expect(updated.x).toBe(10)
    expect(updated.label).toBe('c@d.fr')
  })

  it('normalise la clé de dédoublonnage', () => {
    expect(dedupKey('phone', '+33 6 12 34 56 78')).toBe(dedupKey('phone', '+33612345678'))
    expect(dedupKey('domain', 'https://www.Example.com/')).toBe(dedupKey('domain', 'example.com'))
  })

  it('supprime les liens avec le nœud', () => {
    const inv = repo.createInvestigation({ name: 'Test' })
    const [a, b] = repo.upsertNodes(inv.id, [
      { type: 'email', label: 'a@b.fr' },
      { type: 'domain', label: 'b.fr' }
    ])
    repo.upsertEdges(inv.id, [{ source: a.id, target: b.id }])
    expect(repo.deleteNodes(inv.id, [b.id])).toHaveLength(1)
    expect(repo.listEdges(inv.id)).toHaveLength(0)
  })
})

describe('Engine.applyOutput', () => {
  const mod = defineModule({
    id: 'test.mod',
    name: { fr: 'Test', en: 'Test' },
    description: { fr: '', en: '' },
    category: 'email',
    inputTypes: ['email'],
    run: async () => ({})
  })

  it('crée les entités, les liens et fusionne les propriétés', async () => {
    const inv = repo.createInvestigation({ name: 'Test' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'john@gmail.com' }])
    const count = await engine.applyOutput(
      input,
      mod,
      {
        properties: { provider: 'Gmail' },
        entities: [
          { ref: 'acc', type: 'account', label: 'john', platform: 'github', data: { url: 'https://github.com/john' } },
          { type: 'url', label: 'https://john.dev', from: 'acc', linkLabel: 'site' }
        ]
      },
      fakeCtx
    )
    expect(count).toBe(3)
    const nodes = repo.listNodes(inv.id)
    expect(nodes).toHaveLength(3)
    expect(repo.getNode(input.id)!.data.provider).toBe('Gmail')
    const edges = repo.listEdges(inv.id)
    expect(edges).toHaveLength(2)
    const acc = nodes.find((n) => n.type === 'account')!
    expect(edges.some((e) => e.source === acc.id && e.label === 'site')).toBe(true)
    expect(changes.length).toBe(1)
  })

  it('réutilise une entité existante au lieu de la dupliquer', async () => {
    const inv = repo.createInvestigation({ name: 'Test' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'john@gmail.com' }])
    const [existing] = repo.upsertNodes(inv.id, [{ type: 'domain', label: 'gmail.com' }])
    await engine.applyOutput(input, mod, { entities: [{ type: 'domain', label: 'GMAIL.com', data: { registrar: 'MarkMonitor' } }] }, fakeCtx)
    expect(repo.listNodes(inv.id)).toHaveLength(2)
    expect(repo.getNode(existing.id)!.data.registrar).toBe('MarkMonitor')
    expect(repo.listEdges(inv.id)).toHaveLength(1)
  })

  it('déduit le fournisseur des emails trouvés', async () => {
    const inv = repo.createInvestigation({ name: 'Test' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'username', label: 'john' }])
    await engine.applyOutput(input, mod, { entities: [{ type: 'email', label: 'john@proton.me' }] }, fakeCtx)
    expect(repo.listNodes(inv.id).find((n) => n.type === 'email')!.platform).toBe('proton')
  })
})

describe('Engine.enrich', () => {
  it('termine immédiatement sans module applicable', () => {
    const inv = repo.createInvestigation({ name: 'Test' })
    const [n] = repo.upsertNodes(inv.id, [{ type: 'keyword', label: 'zzz' }])
    const { jobId } = engine.enrich(inv.id, n.id, ['inexistant'])
    expect(jobId).toBeTruthy()
    expect(engine.listJobs()).toHaveLength(0)
  })
})

describe('Archives .masint', () => {
  it('exporte puis réimporte une enquête avec de nouveaux identifiants', async () => {
    const inv = repo.createInvestigation({ name: 'Archive', notes: 'notes' })
    const att = repo.addAttachment(inv.id, { name: 'a.png', mime: 'image/png', data: Buffer.from([1, 2, 3]) })
    const [a, b] = repo.upsertNodes(inv.id, [
      { type: 'person', label: 'Jean Dupont', imageId: att.id },
      { type: 'email', label: 'jean@exemple.fr' }
    ])
    repo.upsertEdges(inv.id, [{ source: a.id, target: b.id, label: 'utilise' }])
    const copy = await importArchive(repo, await buildArchive(repo, inv.id))
    expect(copy.id).not.toBe(inv.id)
    expect(copy.notes).toBe('notes')
    const nodes = repo.listNodes(copy.id)
    expect(nodes).toHaveLength(2)
    expect(nodes.every((n) => n.id !== a.id && n.id !== b.id)).toBe(true)
    const person = nodes.find((n) => n.type === 'person')!
    expect(repo.getAttachmentData(person.imageId!)!.data).toEqual(Buffer.from([1, 2, 3]))
    expect(repo.listEdges(copy.id)[0].label).toBe('utilise')
  })
})

describe('Paramètres et coffre', () => {
  it('borne les valeurs et conserve les secrets', () => {
    const s = settings.set({ concurrency: 99, timeoutMs: 10 })
    expect(s.concurrency).toBe(32)
    expect(s.timeoutMs).toBe(3000)
    settings.setSecret('hibp', '  abc  ')
    expect(new SettingsService(repo).getSecret('hibp')).toBe('abc')
    expect(settings.listSecrets(['hibp', 'shodan'])).toEqual([
      { id: 'hibp', set: true },
      { id: 'shodan', set: false }
    ])
  })
})
