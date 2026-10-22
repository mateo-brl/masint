// Garde-fous d'exécution et hygiène de la base : sémaphore global du moteur, mode passif,
// exécutions interrompues, vue enregistrée sans effet sur l'ordre des enquêtes, effacement
// réel des enquêtes supprimées. Lancé avec `npm run test:core` (Electron en mode Node).

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OsintModule } from '@shared/modules'

// Modules factices : le registre réel interrogerait de vrais services.
const fake = vi.hoisted(() => {
  const stats = { active: 0, max: 0, started: 0 }
  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new Error('annulé'))
      })
    })
  const slow = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: { fr: id, en: id },
    description: { fr: '', en: '' },
    category: 'misc',
    inputTypes: ['keyword'],
    ...extra,
    async run(_input: unknown, ctx: { signal: AbortSignal }) {
      stats.active++
      stats.started++
      stats.max = Math.max(stats.max, stats.active)
      try {
        await sleep(40, ctx.signal)
      } finally {
        stats.active--
      }
      return {}
    }
  })
  const modules = [slow('test.a'), slow('test.b'), slow('test.c'), slow('test.d'), slow('test.noisy', { noisy: true })]
  return { stats, modules }
})

vi.mock('../../src/main/engine/registry', () => ({
  allModules: () => fake.modules,
  getModule: (id: string) => fake.modules.find((m) => m.id === id),
  isConfigured: () => true,
  knownKeyIds: () => [],
  moduleInfo: () => {
    throw new Error('inutilisé')
  }
}))

import { closeInterruptedRuns, compactDatabase, INTERRUPTED_RUN, openDatabase, readStoredLang, vacuumIfPending, type DB } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { applicableModules, Engine } from '../../src/main/engine/runner'
import { DEFAULT_USER_AGENT, SettingsService } from '../../src/main/settings'

let dir: string
let file: string
let db: DB
let repo: Repo
let settings: SettingsService
let engine: Engine

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-opsec-'))
  file = join(dir, 'test.db')
  db = openDatabase(file)
  repo = new Repo(db)
  settings = new SettingsService(repo)
  engine = new Engine(repo, settings, () => undefined)
  Object.assign(fake.stats, { active: 0, max: 0, started: 0 })
})

afterEach(() => {
  if (db.open) db.close()
  rmSync(dir, { recursive: true, force: true })
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function idle(): Promise<void> {
  for (let i = 0; i < 200 && engine.listJobs().length; i++) await sleep(20)
}

describe('Sémaphore global du moteur', () => {
  it('ne lance jamais plus de modules que la limite globale, tous nœuds confondus', async () => {
    settings.set({ globalConcurrency: 3, concurrency: 8 })
    const inv = repo.createInvestigation({ name: 'Concurrence' })
    const nodes = repo.upsertNodes(
      inv.id,
      Array.from({ length: 5 }, (_, i) => ({ type: 'keyword', label: `mot-${i}` }))
    )
    for (const n of nodes) engine.enrich(inv.id, n.id)
    await idle()
    // 5 nœuds × 4 modules (le module bruyant est exclu par le mode passif).
    expect(fake.stats.started).toBe(20)
    expect(fake.stats.max).toBe(3)
    expect(engine.slots.running).toBe(0)
    expect(repo.listRuns(inv.id).every((r) => r.status === 'done')).toBe(true)
  })

  it('annule sans attendre une tâche dont les modules attendent une place', async () => {
    settings.set({ globalConcurrency: 1 })
    const inv = repo.createInvestigation({ name: 'Annulation' })
    const [a, b] = repo.upsertNodes(inv.id, [
      { type: 'keyword', label: 'premier' },
      { type: 'keyword', label: 'second' }
    ])
    engine.enrich(inv.id, a.id)
    const { jobId } = engine.enrich(inv.id, b.id)
    await sleep(10)
    const t0 = Date.now()
    engine.cancel(jobId)
    for (let i = 0; i < 50 && engine.listJobs().some((j) => j.jobId === jobId); i++) await sleep(5)
    expect(Date.now() - t0).toBeLessThan(100)
    const runs = repo.listRuns(inv.id, b.id)
    expect(runs).toHaveLength(4)
    expect(runs.every((r) => r.status === 'cancelled')).toBe(true)
    await idle()
    expect(repo.listRuns(inv.id, a.id).every((r) => r.status === 'done')).toBe(true)
    expect(engine.slots.idle).toBe(true)
  })
})

describe('Mode passif', () => {
  it('écarte les modules qui contactent la cible de « Enrichir », pas du choix manuel', () => {
    const inv = repo.createInvestigation({ name: 'Passif' })
    const [n] = repo.upsertNodes(inv.id, [{ type: 'keyword', label: 'exemple' }])
    const ids = (explicit?: string[]): string[] => applicableModules(n, settings, explicit).map((m: OsintModule) => m.id)
    expect(settings.get().passiveMode).toBe(true)
    expect(ids()).not.toContain('test.noisy')
    expect(engine.applicable(n).accepted).toContain('test.noisy')
    expect(ids(['test.noisy'])).toEqual(['test.noisy'])
    settings.set({ passiveMode: false })
    expect(ids()).toContain('test.noisy')
  })
})

describe('Exécutions interrompues', () => {
  it('passe au démarrage les exécutions restées « en cours » en annulées', () => {
    const inv = repo.createInvestigation({ name: 'Interrompue' })
    const [n] = repo.upsertNodes(inv.id, [{ type: 'keyword', label: 'x' }])
    const base = { investigationId: inv.id, nodeId: n.id, jobId: 'job', found: null, resultCount: 0, error: null, startedAt: 1, finishedAt: null }
    repo.insertRun({ ...base, id: 'r1', moduleId: 'test.a', status: 'running' })
    repo.insertRun({ ...base, id: 'r2', moduleId: 'test.b', status: 'done', finishedAt: 2 })
    repo.insertRun({ ...base, id: 'r3', moduleId: 'test.c', status: 'error', error: 'HTTP 500', finishedAt: 2 })
    db.close()
    db = openDatabase(file)
    repo = new Repo(db)
    const runs = Object.fromEntries(repo.listRuns(inv.id).map((r) => [r.id, r]))
    expect(runs.r1.status).toBe('cancelled')
    expect(runs.r1.error).toBe(INTERRUPTED_RUN)
    expect(runs.r1.finishedAt).toBeGreaterThan(0)
    expect(runs.r2.status).toBe('done')
    expect(runs.r3).toMatchObject({ status: 'error', error: 'HTTP 500' })
    expect(closeInterruptedRuns(db)).toBe(0)
  })
})

describe('Réglages réseau', () => {
  const LEGACY = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

  it('remplace l’ancien en-tête Windows par l’en-tête du vrai système, garde un en-tête choisi', () => {
    repo.setSetting('settings', { lang: 'fr', userAgent: LEGACY })
    const s = new SettingsService(repo)
    expect(s.get().userAgent).toBe(DEFAULT_USER_AGENT)
    expect(s.get().userAgent).toContain(`Chrome/${process.versions.chrome?.split('.')[0] ?? ''}`)
    // Enregistré vide : l'en-tête automatique suit les mises à jour d'Electron.
    s.set({ theme: 'light' })
    expect(repo.getSetting<{ userAgent: string }>('settings', { userAgent: 'x' }).userAgent).toBe('')
    s.set({ userAgent: '  Mon en-tête/1.0 ' })
    expect(s.get().userAgent).toBe('Mon en-tête/1.0')
    expect(new SettingsService(repo).get().userAgent).toBe('Mon en-tête/1.0')
    s.set({ userAgent: '' })
    expect(s.get().userAgent).toBe(DEFAULT_USER_AGENT)
  })

  it('donne des valeurs par défaut aux nouveaux réglages et borne la limite globale', () => {
    repo.setSetting('settings', { lang: 'en' })
    const s = new SettingsService(repo)
    expect(s.get()).toMatchObject({ passiveMode: true, globalConcurrency: 12, linkOpening: 'auto', torSalt: '' })
    expect(s.set({ globalConcurrency: 500 }).globalConcurrency).toBe(64)
    expect(s.set({ globalConcurrency: 0 }).globalConcurrency).toBe(12)
    expect(s.set({ linkOpening: 'bizarre' as never }).linkOpening).toBe('auto')
  })

  it('lit la langue enregistrée avant le démarrage, sans créer de base', () => {
    settings.set({ lang: 'en' })
    expect(readStoredLang(file)).toBe('en')
    expect(readStoredLang(join(dir, 'absente.db'))).toBeNull()
    expect(existsSync(join(dir, 'absente.db'))).toBe(false)
  })
})

describe('Ordre des enquêtes', () => {
  it('enregistrer la vue ne modifie pas la date de mise à jour', async () => {
    const a = repo.createInvestigation({ name: 'A' })
    await sleep(5)
    const b = repo.createInvestigation({ name: 'B' })
    expect(repo.listInvestigations().map((i) => i.name)).toEqual(['B', 'A'])
    await sleep(5)
    const moved = repo.updateInvestigation(a.id, { viewport: { x: 10, y: 20, zoom: 0.5 } })
    expect(moved.viewport).toEqual({ x: 10, y: 20, zoom: 0.5 })
    expect(moved.updatedAt).toBe(a.updatedAt)
    expect(repo.listInvestigations().map((i) => i.name)).toEqual(['B', 'A'])
    await sleep(5)
    expect(repo.updateInvestigation(a.id, { name: 'A2' }).updatedAt).toBeGreaterThan(b.updatedAt)
    expect(repo.listInvestigations().map((i) => i.name)).toEqual(['A2', 'B'])
  })
})

describe('Suppression d’une enquête', () => {
  const MARKER = 'MARQUEUR-DE-TEST-EFFACEMENT-7f3a9c'

  const fileHas = (path: string, text: string): boolean => existsSync(path) && readFileSync(path).includes(Buffer.from(text))

  it('active secure_delete à l’ouverture', () => {
    expect(db.pragma('secure_delete', { simple: true })).toBe(1)
  })

  it('efface le contenu du fichier et du journal, et mesure le compactage', () => {
    const keep = repo.createInvestigation({ name: 'Gardée' })
    repo.upsertNodes(keep.id, [{ type: 'keyword', label: 'garde' }])
    const inv = repo.createInvestigation({ name: 'Supprimée' })
    repo.upsertNodes(
      inv.id,
      Array.from({ length: 50 }, (_, i) => ({ type: 'keyword', label: `${MARKER}-${i}`, notes: MARKER.repeat(20) }))
    )
    // Pièces jointes volumineuses : la base dépasse 20 Mo.
    for (let i = 0; i < 6; i++) repo.addAttachment(inv.id, { name: `p${i}.bin`, mime: 'application/octet-stream', data: Buffer.alloc(4 * 1024 * 1024, i + 1) })
    db.pragma('wal_checkpoint(TRUNCATE)')
    expect(fileHas(file, MARKER)).toBe(true)

    repo.deleteInvestigation(inv.id)
    const r = compactDatabase(db)
    console.log(
      `[test] compactage : checkpoint ${r.checkpointMs.toFixed(1)} ms, VACUUM ${r.vacuumMs?.toFixed(1)} ms, ` +
        `${(r.bytesBefore / 1048576).toFixed(1)} Mo → ${(r.bytesAfter / 1048576).toFixed(2)} Mo`
    )
    expect(r.deferred).toBe(false)
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore / 10)
    expect(statSync(file).size).toBeLessThan(1024 * 1024)
    expect(fileHas(file, MARKER)).toBe(false)
    expect(fileHas(`${file}-wal`, MARKER)).toBe(false)
    expect(existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0).toBe(0)
    expect(repo.listInvestigations().map((i) => i.name)).toEqual(['Gardée'])
  })

  it('reporte le VACUUM d’une grosse base à la fermeture', () => {
    const inv = repo.createInvestigation({ name: 'Grosse' })
    repo.addAttachment(inv.id, { name: 'p.bin', mime: 'application/octet-stream', data: Buffer.alloc(2 * 1024 * 1024, 7) })
    repo.deleteInvestigation(inv.id)
    const r = compactDatabase(db, { maxBytes: 1024 })
    expect(r.deferred).toBe(true)
    expect(r.vacuumMs).toBeNull()
    expect(statSync(file).size).toBeGreaterThan(1024 * 1024)
    vacuumIfPending(db)
    expect(statSync(file).size).toBeLessThan(1024 * 1024)
  })
})
