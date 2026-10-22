// Provenance fine, corroboration, profondeur et enchaînement contrôlé. Faux modules, aucun accès
// réseau. better-sqlite3 est compilé pour Electron : ces tests tournent avec `npm run test:core`.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineModule, type ModuleContext, type ModuleOutput, type OsintModule, type InputEntity } from '@shared/modules'
import type { GraphChange, GraphNode, JobProgress } from '@shared/types'
import { buildArchive, duplicateInvestigation, importArchive, type Manifest } from '../../src/main/archive'
import { openDatabase, type DB } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { CHAIN_BUDGET, chainExcluded, defaultStrength, isCommonPseudo, isGenericAddress, isPlatformHome, isShortener, stopReason } from '../../src/main/engine/chain'
import { setModulesForTests } from '../../src/main/engine/registry'
import { ActivityLog } from '../../src/main/activity'
import { Engine } from '../../src/main/engine/runner'
import { mergeNodes } from '../../src/main/merge'
import { SettingsService } from '../../src/main/settings'
import JSZip from 'jszip'

let dir: string
let file: string
let db: DB
let repo: Repo
let settings: SettingsService
let changes: GraphChange[]
let progress: JobProgress[]
let engine: Engine

const fakeCtx = {} as ModuleContext

function makeEngine(): void {
  changes = []
  progress = []
  engine = new Engine(repo, settings, (event, payload) => {
    if (event === 'graph:changed') changes.push(payload as GraphChange)
    if (event === 'job:progress') progress.push(payload as JobProgress)
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-prov-'))
  file = join(dir, 'test.db')
  db = openDatabase(file)
  repo = new Repo(db)
  settings = new SettingsService(repo)
  makeEngine()
})

afterEach(() => {
  setModulesForTests(null)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Faux module, sans réseau : la sortie dépend seulement de l'entrée. */
function fake(id: string, inputTypes: string[], run: (input: InputEntity) => ModuleOutput, extra: Partial<OsintModule> = {}): OsintModule {
  return defineModule({
    id,
    name: { fr: id, en: id },
    description: { fr: '', en: '' },
    category: 'social',
    inputTypes,
    run: async (input) => run(input),
    ...extra
  })
}

async function waitJobs(): Promise<void> {
  for (let i = 0; i < 400 && engine.listJobs().length; i++) await new Promise((r) => setTimeout(r, 10))
  expect(engine.listJobs()).toHaveLength(0)
}

const ran = (invId: string, nodeId: string): string[] =>
  repo
    .listRuns(invId, nodeId)
    .filter((r) => r.status === 'done')
    .map((r) => r.moduleId)
    .sort()

const byLabel = (invId: string, label: string): GraphNode => {
  const n = repo.listNodes(invId).find((x) => x.label === label)
  if (!n) throw new Error(`nœud absent : ${label}`)
  return n
}

const lastChain = (): NonNullable<JobProgress['chain']> => {
  const p = [...progress].reverse().find((x) => x.chain)
  if (!p?.chain) throw new Error('aucune tâche en chaîne')
  return p.chain
}

// ---------------------------------------------------------------------------

describe('Observations', () => {
  const modA = fake('test.a', ['email'], () => ({}))
  const modB = fake('test.b', ['email'], () => ({}))

  it('consigne la corroboration quand l’entité et le lien existent déjà', async () => {
    const inv = repo.createInvestigation({ name: 'Obs' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    await engine.applyOutput(
      email,
      modA,
      { properties: { provider: 'Exemple', country: 'FR' }, entities: [{ type: 'domain', label: 'exemple.fr', data: { registrar: 'OVH', url: 'https://exemple.fr' } }] },
      fakeCtx,
      undefined,
      { runId: 'run-a' }
    )
    await engine.applyOutput(
      email,
      modB,
      { properties: { provider: 'Autre', country: 'FR' }, entities: [{ type: 'domain', label: 'EXEMPLE.fr', data: { registrar: 'OVH' } }] },
      fakeCtx,
      undefined,
      { runId: 'run-b' }
    )
    const domain = byLabel(inv.id, 'exemple.fr')
    const [edge] = repo.listEdges(inv.id)
    const score = repo.corroboration(inv.id)
    expect(score.nodes[domain.id]).toBe(2)
    expect(score.edges[edge.id]).toBe(2)

    // Propriétés : une observation par clé écrite ; une valeur différente non écrite n'est pas attribuée.
    const onEmail = repo.listObservations(inv.id, { nodeId: email.id })
    const mods = (key: string): string[] => onEmail.filter((o) => o.property === key).map((o) => o.moduleId).sort()
    expect(mods('provider')).toEqual(['test.a'])
    expect(mods('country')).toEqual(['test.a', 'test.b'])
    expect(repo.getNode(email.id)!.data.provider).toBe('Exemple')

    const onDomain = repo.listObservations(inv.id, { nodeId: domain.id })
    const entityRows = onDomain.filter((o) => o.property === null)
    expect(entityRows.map((o) => `${o.moduleId}:${o.runId}:${o.edgeId === edge.id}`).sort()).toEqual(['test.a:run-a:true', 'test.b:run-b:true'])
    expect(entityRows.find((o) => o.moduleId === 'test.a')!.sourceUrl).toBe('https://exemple.fr')
    expect(onDomain.filter((o) => o.property === 'registrar').map((o) => o.moduleId).sort()).toEqual(['test.a', 'test.b'])

    // Scores envoyés avec le changement, pour l'interface.
    const last = changes[changes.length - 1]
    expect(last.corroboration?.nodes[domain.id]).toBe(2)
    expect(last.corroboration?.edges[edge.id]).toBe(2)
    // Score chargé avec le graphe.
    expect(repo.getBundle(inv.id).corroboration?.edges[edge.id]).toBe(2)
  })

  it('ne double pas une observation quand le même module repasse', async () => {
    const inv = repo.createInvestigation({ name: 'Obs' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    const out = { entities: [{ type: 'domain', label: 'exemple.fr' }] }
    await engine.applyOutput(email, modA, out, fakeCtx, undefined, { runId: 'r1' })
    await engine.applyOutput(email, modA, out, fakeCtx, undefined, { runId: 'r2' })
    const rows = repo.listObservations(inv.id, { nodeId: byLabel(inv.id, 'exemple.fr').id })
    expect(rows).toHaveLength(1)
    expect(rows[0].runId).toBe('r2')
  })

  it('corrobore un lien supplémentaire (`links`) déjà présent', async () => {
    const inv = repo.createInvestigation({ name: 'Liens' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    const out = (): ModuleOutput => ({
      entities: [
        { ref: 'a', type: 'account', label: 'jane', platform: 'github' },
        { ref: 'b', type: 'account', label: 'jane', platform: 'gitlab', from: '$input' }
      ],
      links: [{ from: 'a', to: 'b', label: 'même avatar' }]
    })
    await engine.applyOutput(email, modA, out(), fakeCtx)
    await engine.applyOutput(email, modB, out(), fakeCtx)
    const a = repo.listNodes(inv.id).find((n) => n.platform === 'github')!
    const b = repo.listNodes(inv.id).find((n) => n.platform === 'gitlab')!
    const link = repo.findEdge(inv.id, a.id, b.id)!
    expect(repo.corroboration(inv.id).edges[link.id]).toBe(2)
  })

  it('rattache l’observation d’une suggestion validée à la dernière exécution du module', async () => {
    const inv = repo.createInvestigation({ name: 'Revue' })
    const [p] = repo.upsertNodes(inv.id, [{ type: 'person', label: 'Jean Test' }])
    repo.insertRun({ id: 'run-x', investigationId: inv.id, nodeId: p.id, moduleId: 'test.a', jobId: 'j', status: 'done', found: null, resultCount: 1, error: null, startedAt: 1, finishedAt: 2 })
    await engine.applyOutput(p, modA, { entities: [{ type: 'username', label: 'jeantest', review: true }] }, fakeCtx)
    const [s] = repo.listSuggestions(inv.id)
    await engine.resolveSuggestion(s.id, 'accept')
    const pseudo = byLabel(inv.id, 'jeantest')
    expect(pseudo.hop).toBe(1)
    const [o] = repo.listObservations(inv.id, { nodeId: pseudo.id })
    expect(o.runId).toBe('run-x')
    expect(o.moduleId).toBe('test.a')
  })
})

describe('Profondeur et chemin', () => {
  it('donne à chaque nœud la profondeur de son parent + 1 et retrouve son chemin', async () => {
    const modA = fake('test.a', ['email'], () => ({}))
    const modB = fake('test.b', ['account'], () => ({}))
    const inv = repo.createInvestigation({ name: 'Hop' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    expect(email.hop).toBe(0)
    await engine.applyOutput(
      email,
      modA,
      { entities: [{ ref: 'acc', type: 'account', label: 'jane', platform: 'github' }, { type: 'url', label: 'https://jane.dev', from: 'acc' }] },
      fakeCtx
    )
    const acc = repo.listNodes(inv.id).find((n) => n.type === 'account')!
    expect(acc.hop).toBe(1)
    expect(byLabel(inv.id, 'https://jane.dev').hop).toBe(2)
    await engine.applyOutput(acc, modB, { entities: [{ type: 'website', label: 'jane.example' }] }, fakeCtx)
    const site = byLabel(inv.id, 'jane.example')
    expect(site.hop).toBe(2)
    expect(repo.provenancePath(site.id)).toEqual([
      { moduleId: 'test.a', fromId: email.id, fromLabel: 'jane@exemple.fr', fromType: 'email' },
      { moduleId: 'test.b', fromId: acc.id, fromLabel: 'jane', fromType: 'account' }
    ])
    // Un nœud saisi n'a pas de chemin, même s'il est observé ensuite.
    expect(repo.provenancePath(email.id)).toEqual([])
  })
})

describe('Règles d’enchaînement (fonctions pures)', () => {
  it('donne une force par défaut selon le type', () => {
    expect(defaultStrength('account')).toBe('declared')
    expect(defaultStrength('username')).toBe('weak')
    expect(defaultStrength('person')).toBe('mention')
    expect(defaultStrength('domain')).toBe('mention')
  })

  it('reconnaît la liste d’arrêt', () => {
    expect(isGenericAddress('noreply@exemple.fr')).toBe(true)
    expect(isGenericAddress('support@github.com')).toBe(true)
    expect(isGenericAddress('contact@petite-boite.fr')).toBe(false)
    expect(isGenericAddress('jane.doe@gmail.com')).toBe(false)
    expect(isShortener('https://bit.ly/abc')).toBe(true)
    expect(isShortener('https://jane.dev')).toBe(false)
    expect(isPlatformHome('https://github.com/')).toBe(true)
    expect(isPlatformHome('https://www.x.com')).toBe(true)
    expect(isPlatformHome('gmail.com')).toBe(true)
    expect(isPlatformHome('https://github.com/jane')).toBe(false)
    expect(stopReason({ type: 'account', label: 'marque', data: { followers: 250_000 } })).toBe('brand-account')
    expect(stopReason({ type: 'account', label: 'marque', data: { followers: 250_000 } }, true)).toBeNull()
    expect(stopReason({ type: 'account', label: 'jane', data: { followers: 120 } })).toBeNull()
  })

  it('écarte les pseudos trop courants', () => {
    for (const p of ['alex', 'jo', 'Julien', 'shadow', '@Gamer', 'jean-pierre'.slice(0, 4), '123456']) expect(isCommonPseudo(p), p).toBe(true)
    for (const p of ['jdupont75', 'xq_zorglub', 'janedoe42']) expect(isCommonPseudo(p), p).toBe(false)
  })

  it('exclut les modules sensibles et borne la recherche de pseudo', () => {
    const base = { id: 'x', category: 'social' as const }
    expect(chainExcluded({ ...base, ondemand: true }, { type: 'account' }, 1)).toBe(true)
    expect(chainExcluded({ ...base, noisy: true }, { type: 'account' }, 1)).toBe(true)
    expect(chainExcluded({ ...base, keys: [{ id: 'k', label: 'k' }] }, { type: 'account' }, 1)).toBe(true)
    expect(chainExcluded({ ...base, keys: [{ id: 'k', label: 'k', optional: true }] }, { type: 'account' }, 1)).toBe(false)
    expect(chainExcluded({ ...base, id: 'username.sites' }, { type: 'username' }, 1)).toBe(false)
    expect(chainExcluded({ ...base, id: 'username.sites' }, { type: 'username' }, 2)).toBe(true)
    expect(chainExcluded({ ...base, id: 'username.sites_extended' }, { type: 'username' }, 2)).toBe(true)
    expect(chainExcluded({ ...base, category: 'web' }, { type: 'url' }, 1)).toBe(true)
    expect(chainExcluded({ ...base, category: 'web' }, { type: 'domain' }, 1)).toBe(false)
  })
})

describe('Enchaînement', () => {
  /** Faux modules : un email mène à un compte GitHub, qui mène à d'autres comptes. */
  function install(extra: OsintModule[] = []): void {
    setModulesForTests([
      fake('test.mail', ['email'], (input) =>
        input.label === 'jane@exemple.fr'
          ? {
              entities: [
                { type: 'account', label: 'janedoe42', platform: 'github', strength: 'same' },
                { type: 'account', label: 'jdoe-weak', platform: 'gitlab', strength: 'weak' },
                { type: 'url', label: 'https://bit.ly/abc', strength: 'declared' },
                { type: 'email', label: 'noreply@github.com', strength: 'declared' },
                { type: 'username', label: 'alex', strength: 'same' }
              ]
            }
          : { properties: { checked: true } }
      ),
      fake('test.profile', ['account'], (input) =>
        input.label === 'janedoe42' && input.platform === 'github'
          ? {
              properties: { bio: 'dev' },
              entities: [
                { type: 'account', label: 'janedoe42', platform: 'x', strength: 'same' },
                { type: 'email', label: 'jane.doe.42@exemple.org', strength: 'mention' },
                { type: 'url', label: 'https://jane.example', strength: 'declared' }
              ]
            }
          : {}
      ),
      fake('test.urlinfo', ['url'], () => ({ properties: { title: 'Jane' } }), { category: 'misc' }),
      fake('test.webpage', ['url'], () => ({ properties: { fetched: true } }), { category: 'web' }),
      fake('test.pseudo', ['username'], () => ({ properties: { seen: true } })),
      fake('test.ondemand', ['account'], () => ({ properties: { paid: true } }), { ondemand: true }),
      fake('test.noisy', ['account'], () => ({ properties: { pinged: true } }), { noisy: true }),
      fake('test.keyed', ['account'], () => ({ properties: { quota: true } }), { keys: [{ id: 'test-key', label: 'clé' }] }),
      ...extra
    ])
    settings.set({ passiveMode: false })
    settings.setSecret('test-key', 'secret')
  }

  it('enrichit les nouveaux nœuds sûrs jusqu’à la profondeur réglée, sans les modules exclus', async () => {
    install()
    settings.set({ chainDepth: 2 })
    const inv = repo.createInvestigation({ name: 'Chaîne' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()

    const gh = repo.listNodes(inv.id).find((n) => n.platform === 'github')!
    const x = repo.listNodes(inv.id).find((n) => n.platform === 'x')!
    expect(gh.hop).toBe(1)
    expect(x.hop).toBe(2)
    // Compte sûr : module de profil seulement (ni à la demande, ni bruyant, ni à clé obligatoire).
    expect(ran(inv.id, gh.id)).toEqual(['test.profile'])
    expect(ran(inv.id, x.id)).toEqual(['test.profile'])
    // URL déclarée à la profondeur 2 : module d'analyse oui, module web non.
    expect(ran(inv.id, byLabel(inv.id, 'https://jane.example').id)).toEqual(['test.urlinfo'])
    // Lien fragile, raccourcisseur, adresse générique, pseudo courant : pas d'enchaînement.
    for (const label of ['jdoe-weak', 'https://bit.ly/abc', 'noreply@github.com', 'alex']) expect(ran(inv.id, byLabel(inv.id, label).id), label).toEqual([])
    // Mention trouvée sur un nœud enchaîné : dans « À vérifier », avec son chemin.
    const [s] = repo.listSuggestions(inv.id)
    expect(s.label).toBe('jane.doe.42@exemple.org')
    expect(s.nodeId).toBe(gh.id)
    expect(s.reason).toBe('trouvé via test.mail puis test.profile, profondeur 2')
    expect(repo.listNodes(inv.id).some((n) => n.label === 'jane.doe.42@exemple.org')).toBe(false)
    const chain = lastChain()
    expect(chain).toMatchObject({ maxDepth: 2, depth: 2, enriched: 3, budget: false, active: [] })
    expect(chain.created).toBe(7)
  })

  it('s’arrête à la profondeur 1 et ne s’applique pas sans réglage ni action explicite', async () => {
    install()
    settings.set({ chainDepth: 1 })
    const inv = repo.createInvestigation({ name: 'Chaîne courte' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()
    const gh = repo.listNodes(inv.id).find((n) => n.platform === 'github')!
    expect(ran(inv.id, gh.id)).toEqual(['test.profile'])
    // Profondeur 2 : créé, mais pas enrichi.
    expect(ran(inv.id, repo.listNodes(inv.id).find((n) => n.platform === 'x')!.id)).toEqual([])

    // Enrichissement automatique coupé : un « Enrichir » ordinaire n'enchaîne pas.
    const inv2 = repo.createInvestigation({ name: 'Sans chaîne' })
    const [e2] = repo.upsertNodes(inv2.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    engine.enrich(inv2.id, e2.id)
    await waitJobs()
    expect(ran(inv2.id, repo.listNodes(inv2.id).find((n) => n.platform === 'github')!.id)).toEqual([])
    // Enrichissement automatique actif avec une profondeur : la chaîne part d'elle-même. (La
    // première enquête est supprimée : son compte, enrichi à l'instant, serait sinon écarté.)
    repo.deleteInvestigation(inv.id)
    settings.set({ autoEnrich: true })
    const inv3 = repo.createInvestigation({ name: 'Auto' })
    const [e3] = repo.upsertNodes(inv3.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    engine.enrich(inv3.id, e3.id)
    await waitJobs()
    expect(ran(inv3.id, repo.listNodes(inv3.id).find((n) => n.platform === 'github')!.id)).toEqual(['test.profile'])
  })

  it('inscrit au journal d’activité les modules lancés par enchaînement', async () => {
    install()
    settings.set({ chainDepth: 1 })
    const log = new ActivityLog(repo, () => 'Enquêteur test')
    engine = new Engine(repo, settings, () => undefined, log)
    const inv = repo.createInvestigation({ name: 'Journal' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()
    const runs = repo.allActivity(inv.id).filter((e) => e.action === 'module.run')
    expect(runs.map((e) => [e.target.node?.label, e.target.chain?.depth ?? 0, e.target.chain?.path.join(' > ') ?? ''])).toEqual([
      ['jane@exemple.fr', 0, ''],
      ['janedoe42', 1, 'test.mail']
    ])
  })

  it('relance la chaîne quand une mention mise de côté est validée', async () => {
    install()
    settings.set({ chainDepth: 2 })
    const inv = repo.createInvestigation({ name: 'Validation' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()
    const [s] = repo.listSuggestions(inv.id)
    await engine.resolveSuggestion(s.id, 'accept')
    await waitJobs()
    const found = byLabel(inv.id, 'jane.doe.42@exemple.org')
    expect(found.hop).toBe(2)
    expect(found.data.__chain).toBeUndefined()
    expect(ran(inv.id, found.id)).toEqual(['test.mail'])
  })

  it('ne suit pas un pseudo de départ trop courant, suit un pseudo rare', async () => {
    install([
      fake('test.handle', ['username'], (input) => ({ entities: [{ type: 'account', label: input.label, platform: 'github', strength: 'same' }] }))
    ])
    settings.set({ chainDepth: 1 })
    const inv = repo.createInvestigation({ name: 'Pseudo' })
    const [common, rare] = repo.upsertNodes(inv.id, [
      { type: 'username', label: 'julien' },
      { type: 'username', label: 'xq_zorglub' }
    ])
    engine.enrich(inv.id, common.id, undefined, { chain: true })
    engine.enrich(inv.id, rare.id, undefined, { chain: true })
    await waitJobs()
    const acc = (label: string): GraphNode => repo.listNodes(inv.id).find((n) => n.type === 'account' && n.label === label)!
    expect(ran(inv.id, acc('julien').id)).toEqual([])
    expect(ran(inv.id, acc('xq_zorglub').id)).toEqual(['test.profile'])
  })

  it('ne relance pas un identifiant enrichi récemment, ni un compte de marque', async () => {
    install([
      fake('test.brand', ['email'], () => ({
        entities: [
          { type: 'account', label: 'megacorp', platform: 'github', data: { followers: 500_000 }, strength: 'same' },
          { type: 'account', label: 'janedoe42', platform: 'github', strength: 'same' }
        ]
      }))
    ])
    settings.set({ chainDepth: 1 })
    // Le même compte vient d'être enrichi dans une autre enquête.
    const other = repo.createInvestigation({ name: 'Autre' })
    const [known] = repo.upsertNodes(other.id, [{ type: 'account', label: 'janedoe42', platform: 'github' }])
    repo.insertRun({ id: 'r', investigationId: other.id, nodeId: known.id, moduleId: 'test.profile', jobId: 'j', status: 'done', found: null, resultCount: 0, error: null, startedAt: Date.now(), finishedAt: Date.now() })
    const inv = repo.createInvestigation({ name: 'Garde-fous' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'boss@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()
    expect(ran(inv.id, byLabel(inv.id, 'megacorp').id)).toEqual([])
    expect(ran(inv.id, repo.listNodes(inv.id).find((n) => n.label === 'janedoe42')!.id)).toEqual([])

    // Le nœud de départ, lui, peut être un compte de marque.
    const inv2 = repo.createInvestigation({ name: 'Marque au départ' })
    const [brand] = repo.upsertNodes(inv2.id, [{ type: 'account', label: 'megacorp', platform: 'gitlab', data: { followers: 500_000 } }])
    setModulesForTests([
      fake('test.dev', ['account'], (input) => (input.label === 'megacorp' ? { entities: [{ type: 'account', label: 'megacorp-dev', platform: 'github', strength: 'same' }] } : { properties: { ok: true } }))
    ])
    engine.enrich(inv2.id, brand.id, undefined, { chain: true })
    await waitJobs()
    expect(ran(inv2.id, byLabel(inv2.id, 'megacorp-dev').id)).toEqual(['test.dev'])
  })

  it('met le surplus de nœuds d’un saut dans « À vérifier » (budget atteint)', async () => {
    setModulesForTests([
      fake('test.wide', ['email'], () => ({ entities: [{ type: 'account', label: 'hub-account', platform: 'github', strength: 'same' }] })),
      fake('test.hub', ['account'], (input) =>
        input.label === 'hub-account'
          ? { entities: Array.from({ length: 40 }, (_, i) => ({ type: 'account', label: `leaf-${String(i).padStart(2, '0')}`, platform: 'gitlab', strength: 'declared' as const })) }
          : {}
      )
    ])
    settings.set({ chainDepth: 2 })
    const inv = repo.createInvestigation({ name: 'Budget nœuds' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'hub@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()
    const leaves = repo.listNodes(inv.id).filter((n) => n.label.startsWith('leaf-'))
    expect(leaves).toHaveLength(CHAIN_BUDGET.nodesPerHop)
    const aside = repo.listSuggestions(inv.id)
    expect(aside).toHaveLength(40 - CHAIN_BUDGET.nodesPerHop)
    expect(aside.every((s) => s.reason.startsWith('budget atteint (trouvé via test.wide puis test.hub, profondeur 2)'))).toBe(true)
    expect(lastChain().budget).toBe(true)
  })

  it('borne le nombre d’exécutions de la tâche', async () => {
    setModulesForTests([
      fake('test.fanout', ['email'], () => ({
        entities: Array.from({ length: 150 }, (_, i) => ({ type: 'account', label: `user-${String(i).padStart(3, '0')}`, platform: 'github', strength: 'same' as const }))
      })),
      fake('test.leaf', ['account'], () => ({ properties: { ok: true } }))
    ])
    settings.set({ chainDepth: 1 })
    const inv = repo.createInvestigation({ name: 'Budget exécutions' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'many@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()
    const runs = repo.listRuns(inv.id)
    expect(runs).toHaveLength(CHAIN_BUDGET.runs)
    expect(runs.every((r) => r.status === 'done')).toBe(true)
    expect(repo.listNodes(inv.id).filter((n) => n.type === 'account')).toHaveLength(150)
    expect(lastChain()).toMatchObject({ budget: true, enriched: CHAIN_BUDGET.runs - 1 })
  })

  it('n’enchaîne plus une fois la durée dépassée', async () => {
    install()
    settings.set({ chainDepth: 2 })
    const saved = CHAIN_BUDGET.durationMs
    CHAIN_BUDGET.durationMs = -1
    try {
      const inv = repo.createInvestigation({ name: 'Durée' })
      const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
      engine.enrich(inv.id, email.id, undefined, { chain: true })
      await waitJobs()
      expect(ran(inv.id, repo.listNodes(inv.id).find((n) => n.platform === 'github')!.id)).toEqual([])
      expect(lastChain().budget).toBe(true)
    } finally {
      CHAIN_BUDGET.durationMs = saved
    }
  })

  it('n’applique pas la recherche de pseudo sur des centaines de sites au-delà du premier saut', async () => {
    setModulesForTests([
      fake('test.start', ['email'], () => ({ entities: [{ ref: 'a', type: 'account', label: 'zorglub-main', platform: 'github', strength: 'same' }] })),
      fake('test.rename', ['account'], (input) =>
        input.label === 'zorglub-main' ? { entities: [{ type: 'username', label: 'zorglub_old', strength: 'same' }] } : {}
      ),
      fake('username.sites', ['username'], () => ({ properties: { scanned: true } })),
      fake('test.pseudo', ['username'], () => ({ properties: { seen: true } }))
    ])
    settings.set({ chainDepth: 3 })
    const inv = repo.createInvestigation({ name: 'Pseudos' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'zorglub@exemple.fr' }])
    engine.enrich(inv.id, email.id, undefined, { chain: true })
    await waitJobs()
    const old = byLabel(inv.id, 'zorglub_old')
    expect(old.hop).toBe(2)
    expect(ran(inv.id, old.id)).toEqual(['test.pseudo'])
  })
})

describe('Fusion, suppression et archive', () => {
  const modA = fake('test.a', ['email'], () => ({}))
  const modB = fake('test.b', ['email'], () => ({}))

  async function twoSources(): Promise<{ invId: string; email: GraphNode; a: GraphNode; b: GraphNode }> {
    const inv = repo.createInvestigation({ name: 'Fusion' })
    const [email] = repo.upsertNodes(inv.id, [{ type: 'email', label: 'jane@exemple.fr' }])
    await engine.applyOutput(email, modA, { entities: [{ type: 'account', label: 'jane', platform: 'github', data: { url: 'https://github.com/jane' } }] }, fakeCtx)
    await engine.applyOutput(email, modB, { entities: [{ type: 'account', label: 'jane.doe', platform: 'github', data: { bio: 'dev' } }] }, fakeCtx)
    const a = byLabel(inv.id, 'jane')
    const b = byLabel(inv.id, 'jane.doe')
    return { invId: inv.id, email, a, b }
  }

  it('reporte les observations sur la cible de la fusion', async () => {
    const { invId, email, a, b } = await twoSources()
    const change = mergeNodes(repo, invId, a.id, [b.id])
    const edge = repo.findEdge(invId, email.id, a.id)!
    expect(repo.listEdges(invId)).toHaveLength(1)
    expect(change.corroboration?.nodes[a.id]).toBe(2)
    expect(change.corroboration?.edges[edge.id]).toBe(2)
    const rows = repo.listObservations(invId, { nodeId: a.id })
    expect(rows.filter((o) => o.property === null).every((o) => o.edgeId === edge.id)).toBe(true)
    expect(rows.find((o) => o.property === 'bio')?.moduleId).toBe('test.b')
    expect(db.prepare('SELECT COUNT(*) AS n FROM observations WHERE node_id = ?').get(b.id)).toEqual({ n: 0 })
  })

  it('ignore les observations d’un nœud supprimé, les retrouve après annulation, puis les efface', async () => {
    const { invId, a } = await twoSources()
    const snapshot = repo.getNode(a.id)!
    repo.deleteNodes(invId, [a.id])
    expect(repo.corroboration(invId).nodes[a.id]).toBeUndefined()
    expect(repo.listObservations(invId, { nodeId: a.id })).toEqual([])
    // Ctrl+Z : le nœud revient sous le même identifiant, avec sa provenance.
    repo.upsertNodes(invId, [snapshot])
    expect(repo.corroboration(invId).nodes[a.id]).toBe(1)
    repo.deleteNodes(invId, [a.id])
    expect(repo.purgeOrphanObservations(invId)).toBeGreaterThan(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM observations WHERE node_id = ?').get(a.id)).toEqual({ n: 0 })
  })

  it('emporte les observations dans l’archive et dans « Dupliquer »', async () => {
    const { invId, email, a, b } = await twoSources()
    await engine.applyOutput(email, modB, { entities: [{ type: 'account', label: 'jane', platform: 'github' }] }, fakeCtx)
    repo.deleteNodes(invId, [b.id])
    const zip = await JSZip.loadAsync(await buildArchive(repo, invId))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as Manifest
    expect(manifest.observations?.length).toBeGreaterThan(0)
    expect(manifest.observations!.some((o) => o.nodeId === b.id)).toBe(false)

    const scoreOf = (id: string, label: string): number => {
      const n = repo.listNodes(id).find((x) => x.label === label)!
      return repo.corroboration(id).nodes[n.id]
    }
    const edgeScore = (id: string): number => {
      const [e] = repo.listEdges(id)
      return repo.corroboration(id).edges[e.id]
    }
    const copy = await importArchive(repo, await buildArchive(repo, invId))
    expect(scoreOf(copy.id, 'jane')).toBe(2)
    expect(edgeScore(copy.id)).toBe(2)
    expect(repo.listNodes(copy.id).find((n) => n.label === 'jane')!.hop).toBe(1)
    const dup = await duplicateInvestigation(repo, invId)
    expect(scoreOf(dup.id, 'jane')).toBe(scoreOf(invId, a.label))
    expect(repo.listObservations(dup.id, { nodeId: repo.listNodes(dup.id).find((n) => n.label === 'jane')!.id }).find((o) => o.moduleId === 'test.a')!.sourceUrl).toBe(
      'https://github.com/jane'
    )
  })
})

describe('Migration de la provenance', () => {
  it('crée la table observations et reprend l’existant', () => {
    const inv = repo.createInvestigation({ name: 'Ancienne' })
    const [p, acc] = repo.upsertNodes(inv.id, [
      { type: 'person', label: 'Jean' },
      { type: 'account', label: 'jean', platform: 'github', source: 'person.usernames' }
    ])
    repo.upsertEdges(inv.id, [{ source: p.id, target: acc.id, label: 'compte', sourceModule: 'social.github' }])
    // Base d'avant la migration : ni table ni colonne (les migrations suivantes sont rejouables).
    db.exec('DROP TABLE observations; ALTER TABLE nodes DROP COLUMN hop;')
    db.pragma('user_version = 3')
    db.close()
    db = openDatabase(file)
    repo = new Repo(db)
    expect(repo.getNode(acc.id)!.hop).toBe(1)
    expect(repo.getNode(p.id)!.hop).toBe(0)
    const rows = repo.listObservations(inv.id, { nodeId: acc.id })
    expect(rows.map((o) => o.moduleId).sort()).toEqual(['person.usernames', 'social.github'])
    expect(repo.corroboration(inv.id).nodes[acc.id]).toBe(2)
  })
})
