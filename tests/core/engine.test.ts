// Tests du moteur et de la base. better-sqlite3 est compilé pour Electron :
// ces tests tournent avec `npm run test:core` (Electron en mode Node).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineModule, type ModuleContext } from '@shared/modules'
import type { GraphChange } from '@shared/types'
import { buildArchive, duplicateInvestigation, importArchive, openArchiveOnce } from '../../src/main/archive'
import { moveNoiseToReview } from '../../src/main/cleanup'
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

  it('pose les nouveaux enfants sur des cases libres, sans recouvrir le graphe', async () => {
    const inv = repo.createInvestigation({ name: 'Placement' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@gmail.com', x: 0, y: 0 }])
    // Un nœud étranger occupe la première case sous le parent.
    const [blocker] = repo.upsertNodes(inv.id, [{ type: 'keyword', label: 'déjà là', x: 0, y: 130 }])
    await engine.applyOutput(
      input,
      mod,
      { entities: ['a', 'b', 'c'].map((u) => ({ type: 'username', label: u })) },
      fakeCtx
    )
    const boxes = repo.listNodes(inv.id).map((n) => ({ id: n.id, x: n.x, y: n.y, w: 196, h: 52 }))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.id} / ${b.id}`).toBe(false)
      }
    expect(repo.getNode(blocker.id)!.y).toBe(130)
  })

  it('déduit le fournisseur des emails trouvés', async () => {
    const inv = repo.createInvestigation({ name: 'Test' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'username', label: 'john' }])
    await engine.applyOutput(input, mod, { entities: [{ type: 'email', label: 'john@proton.me' }] }, fakeCtx)
    expect(repo.listNodes(inv.id).find((n) => n.type === 'email')!.platform).toBe('proton')
  })
})

describe('Résultats à vérifier', () => {
  const mod = defineModule({
    id: 'test.review',
    name: { fr: 'Test', en: 'Test' },
    description: { fr: '', en: '' },
    category: 'person',
    inputTypes: ['person'],
    run: async () => ({})
  })

  it('met les hypothèses et les recherches manuelles de côté, hors du graphe', async () => {
    const inv = repo.createInvestigation({ name: 'Revue' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'person', label: 'Jean Test' }])
    const stats = { review: 0 }
    const count = await engine.applyOutput(
      input,
      mod,
      {
        entities: [
          { ref: 'p', type: 'username', label: 'jeantest', review: true, reviewReason: 'pseudo généré', linkLabel: 'pseudo possible' },
          { type: 'account', label: 'jeantest', platform: 'github', from: 'p' },
          { type: 'company', label: 'Société sûre' }
        ],
        manual: [{ label: 'Pages Blanches', url: 'https://www.pagesblanches.fr/?q=Jean+Test', hint: 'adresse' }]
      },
      fakeCtx,
      stats
    )
    expect(count).toBe(1)
    expect(stats.review).toBe(3)
    expect(repo.listNodes(inv.id).map((n) => n.label).sort()).toEqual(['Jean Test', 'Société sûre'])
    const list = repo.listSuggestions(inv.id, input.id)
    expect(list.map((s) => `${s.kind}:${s.type}:${s.label}`).sort()).toEqual([
      'entity:account:jeantest',
      'entity:username:jeantest',
      'manual:search_link:Pages Blanches'
    ])
    expect(list.find((s) => s.type === 'username')!.reason).toBe('pseudo généré')
  })

  it('ne repropose pas une suggestion écartée', async () => {
    const inv = repo.createInvestigation({ name: 'Revue' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'person', label: 'Jean Test' }])
    const out = { entities: [{ type: 'username', label: 'jeantest', review: true }] }
    await engine.applyOutput(input, mod, out, fakeCtx)
    const [s] = repo.listSuggestions(inv.id)
    await engine.resolveSuggestion(s.id, 'reject')
    const stats = { review: 0 }
    await engine.applyOutput(input, mod, out, fakeCtx, stats)
    expect(stats.review).toBe(0)
    expect(repo.listSuggestions(inv.id)).toHaveLength(1)
    expect(repo.getSuggestion(s.id)!.status).toBe('rejected')
  })

  it('relie directement une hypothèse déjà présente dans le graphe', async () => {
    const inv = repo.createInvestigation({ name: 'Revue' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'person', label: 'Jean Test' }])
    repo.upsertNodes(inv.id, [{ type: 'username', label: 'jeantest' }])
    const stats = { review: 0 }
    await engine.applyOutput(input, mod, { entities: [{ type: 'username', label: 'JeanTest', review: true }] }, fakeCtx, stats)
    expect(stats.review).toBe(0)
    expect(repo.listEdges(inv.id)).toHaveLength(1)
  })

  it('valide une suggestion : le nœud entre dans le graphe, relié au nœud d’origine', async () => {
    const inv = repo.createInvestigation({ name: 'Revue' })
    const [input] = repo.upsertNodes(inv.id, [{ type: 'person', label: 'Jean Test' }])
    await engine.applyOutput(
      input,
      mod,
      { entities: [{ type: 'username', label: 'jeantest', review: true, linkLabel: 'pseudo possible' }], manual: [{ label: 'Truecaller', url: 'https://www.truecaller.com/' }] },
      fakeCtx
    )
    const [pseudo, manual] = repo.listSuggestions(inv.id)
    await engine.resolveSuggestion(pseudo.id, 'accept')
    const node = repo.listNodes(inv.id).find((n) => n.type === 'username')!
    expect(node.source).toBe('test.review')
    expect(repo.listEdges(inv.id).find((e) => e.target === node.id)!.label).toBe('pseudo possible')
    expect(repo.getSuggestion(pseudo.id)!.status).toBe('accepted')
    // Recherche manuelle : ce que l'enquêteur a trouvé devient une entité.
    await engine.resolveSuggestion(manual.id, 'accept', { type: 'email', label: 'jean@example.org' })
    const email = repo.listNodes(inv.id).find((n) => n.type === 'email')!
    expect(email.data.source_url).toBe('https://www.truecaller.com/')
    expect(repo.listEdges(inv.id).find((e) => e.target === email.id)!.label).toBe('Truecaller')
    await engine.resolveSuggestion(manual.id, 'reopen')
    expect(repo.getSuggestion(manual.id)!.status).toBe('pending')
  })
})

describe('Rangement des anciennes enquêtes', () => {
  it('déplace les liens de recherche et pseudos générés intacts dans « À vérifier »', () => {
    const inv = repo.createInvestigation({ name: 'Ancienne' })
    const [p, link, pseudo, kept, touched] = repo.upsertNodes(inv.id, [
      { type: 'person', label: 'Jean Test' },
      { type: 'search_link', label: 'Google : Jean Test', data: { url: 'https://google.com/?q=x', engine: 'Google' }, source: 'person.search_links' },
      { type: 'username', label: 'jeantest', source: 'person.usernames' },
      { type: 'search_link', label: 'Bing : Jean Test', data: { url: 'https://bing.com/?q=x', engine: 'Bing' }, source: 'person.search_links' },
      { type: 'username', label: 'jtest', source: 'person.usernames', notes: 'vu sur un forum' }
    ])
    repo.upsertEdges(inv.id, [
      { source: p.id, target: link.id, label: 'recherche' },
      { source: p.id, target: pseudo.id, label: 'pseudo possible' },
      { source: p.id, target: kept.id, label: 'recherche' },
      { source: p.id, target: touched.id, label: 'pseudo possible' }
    ])
    // Un lien qui a des enfants a été exploité : on le garde.
    const [child] = repo.upsertNodes(inv.id, [{ type: 'url', label: 'https://exemple.org' }])
    repo.upsertEdges(inv.id, [{ source: kept.id, target: child.id, label: 'trouvé' }])
    expect(moveNoiseToReview(repo)).toBe(2)
    expect(repo.listNodes(inv.id).map((n) => n.label).sort()).toEqual(['Bing : Jean Test', 'Jean Test', 'https://exemple.org', 'jtest'])
    const list = repo.listSuggestions(inv.id)
    expect(list.map((s) => `${s.kind}:${s.label}:${s.url ?? ''}`).sort()).toEqual(['entity:jeantest:', 'manual:Google:https://google.com/?q=x'])
    expect(list.every((s) => s.nodeId === p.id)).toBe(true)
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

  it('conserve les résultats à vérifier et leur état', async () => {
    const inv = repo.createInvestigation({ name: 'Archive revue' })
    const [p] = repo.upsertNodes(inv.id, [{ type: 'person', label: 'Jean Dupont' }])
    const base = { investigationId: inv.id, nodeId: p.id, moduleId: 'm', platform: null, data: {}, linkLabel: '', reason: '' }
    repo.addSuggestion({ ...base, kind: 'entity', type: 'username', label: 'jdupont', url: null })
    const manual = repo.addSuggestion({ ...base, kind: 'manual', type: 'search_link', label: 'Truecaller', url: 'https://truecaller.com/x' })!
    repo.setSuggestionStatus(manual.id, 'checked')
    const copy = await importArchive(repo, await buildArchive(repo, inv.id))
    const list = repo.listSuggestions(copy.id)
    expect(list.map((s) => `${s.label}:${s.status}`).sort()).toEqual(['Truecaller:checked', 'jdupont:pending'])
    expect(list[0].nodeId).toBe(repo.listNodes(copy.id)[0].id)
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

describe('Import des archives', () => {
  it('donne un nom distinct à une copie importée', async () => {
    const inv = repo.createInvestigation({ name: 'Affaire' })
    const buf = await buildArchive(repo, inv.id)
    expect((await importArchive(repo, buf)).name).toBe('Affaire (2)')
    expect((await importArchive(repo, buf)).name).toBe('Affaire (3)')
  })

  it('rouvre l’enquête déjà importée depuis le même fichier', async () => {
    const inv = repo.createInvestigation({ name: 'Dossier' })
    const buf = await buildArchive(repo, inv.id)
    const first = await openArchiveOnce(repo, buf)
    const again = await openArchiveOnce(repo, buf)
    expect(again.id).toBe(first.id)
    repo.deleteInvestigation(first.id)
    expect((await openArchiveOnce(repo, buf)).id).not.toBe(first.id)
  })

  it('nomme une copie « (copie) »', async () => {
    const inv = repo.createInvestigation({ name: 'Source' })
    expect((await duplicateInvestigation(repo, inv.id)).name).toBe('Source (copie)')
  })
})
