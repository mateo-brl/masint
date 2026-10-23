// Noms donnés au numéro par les annuaires d'appelants, de bout en bout dans le moteur : scan
// roso.info simulé (fixture fictive), suggestions à vérifier, absence de doublon avec le module
// générique, puis validation d'un pseudo qui lance la recherche du pseudo sur les sites.
// better-sqlite3 est compilé pour Electron : ces tests tournent avec `npm run test:core`.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defineModule } from '@shared/modules'
import type { GraphNode } from '@shared/types'
import { openDatabase, type DB } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { setModulesForTests } from '../../src/main/engine/registry'
import { Engine, toInput } from '../../src/main/engine/runner'
import { SettingsService } from '../../src/main/settings'
import callerNames from '../../src/main/modules/phone/callerNames'
import rosoPhone, { phoneTiming } from '../../src/main/modules/roso/phone'
import { fixture, mockContext, NO_MAINTENANCE } from '../fixtures/roso/mock'

type J = Record<string, any>

let dir: string
let db: DB
let repo: Repo
let settings: SettingsService
let engine: Engine

beforeAll(() => {
  phoneTiming.batchDelayMs = 0
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-caller-'))
  db = openDatabase(join(dir, 'test.db'))
  repo = new Repo(db)
  settings = new SettingsService(repo)
  engine = new Engine(repo, settings, () => undefined)
})

afterEach(() => {
  setModulesForTests(null)
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

async function waitJobs(): Promise<void> {
  for (let i = 0; i < 400 && engine.listJobs().length; i++) await new Promise((r) => setTimeout(r, 10))
  expect(engine.listJobs()).toHaveLength(0)
}

/** Scan roso.info d'un numéro, rejoué sur la fixture fictive, puis enregistré par le moteur. */
async function rosoScan(invId: string): Promise<GraphNode> {
  const fx = fixture<J>('phone.json')
  const { ctx } = mockContext([
    NO_MAINTENANCE,
    ['POST', '/api/gateway/phone/log', { body: fx.log }],
    ['GET', /^\/api\/gateway\/twilio\/lookup\//, { body: fx.twilio }],
    ['GET', /^\/api\/gateway\/twilio\/callfilter\//, { body: fx.callfilter }],
    ['GET', '/api/funstat', { body: fx.funstat }],
    ['POST', /^\/api\/autocheck\/check\//, (c) => ({ body: fx.autocheck[c.url.pathname.split('/').pop()!] ?? { exists: false } })]
  ])
  const [phone] = repo.upsertNodes(invId, [{ type: 'phone', label: '+33612345678' }])
  const out = await rosoPhone.run(toInput(phone), ctx)
  await engine.applyOutput(phone, rosoPhone, out, ctx)
  return repo.getNode(phone.id)!
}

describe('noms d’annuaires d’appelants dans le moteur', () => {
  it('scan roso.info : pseudo et personne d’annuaire à vérifier, hors du graphe', async () => {
    const inv = repo.createInvestigation({ name: 'Annuaires' })
    const phone = await rosoScan(inv.id)
    const pending = repo.listSuggestions(inv.id, phone.id).filter((s) => s.kind === 'entity')
    expect(pending.find((s) => s.type === 'username' && s.label === 'QW778')?.reason).toBe('nom sous lequel le numéro est enregistré dans Eyecon : peut-être un pseudo')
    // Aucun pseudo ni étiquette dans le graphe ; l'étiquette reste une propriété du numéro.
    expect(repo.listNodes(inv.id).some((n) => n.type === 'username')).toBe(false)
    expect(repo.listNodes(inv.id).some((n) => n.label === 'Livraison Amazon')).toBe(false)
    expect(phone.data.caller_tags).toEqual(['Livraison Amazon (ViewCaller)'])
  })

  it('pas de doublon : le compte d’annuaire classé par roso.info n’est pas repris par le module générique', async () => {
    const inv = repo.createInvestigation({ name: 'Doublon' })
    await rosoScan(inv.id)
    const eyecon = repo.listNodes(inv.id).find((n) => n.type === 'account' && n.platform === 'eyecon')!
    expect(eyecon.label).toBe('QW778')
    expect(engine.applicable(eyecon).accepted).not.toContain('phone.caller_names')
    // Même lancé à la main, il ne s'applique pas : aucune seconde suggestion.
    engine.enrich(inv.id, eyecon.id, ['phone.caller_names'])
    await waitJobs()
    expect(repo.listSuggestions(inv.id).filter((s) => s.label === 'QW778')).toHaveLength(1)
  })

  it('pas de doublon : un pseudo déjà validé est relié, pas reproposé', async () => {
    const inv = repo.createInvestigation({ name: 'Clé canonique' })
    const phone = await rosoScan(inv.id)
    const s = repo.listSuggestions(inv.id, phone.id).find((x) => x.label === 'QW778')!
    await engine.resolveSuggestion(s.id, 'accept')
    const pseudo = repo.listNodes(inv.id).find((n) => n.type === 'username')!
    // Un compte Eyecon venu d'ailleurs, au même nom (casse différente) : même clé canonique.
    const [other] = repo.upsertNodes(inv.id, [{ type: 'account', platform: 'eyecon', label: 'qw778', data: { display_name: 'qw778' } }])
    expect(engine.applicable(other).accepted).toContain('phone.caller_names')
    engine.enrich(inv.id, other.id, ['phone.caller_names'])
    await waitJobs()
    expect(repo.listNodes(inv.id).filter((n) => n.type === 'username')).toHaveLength(1)
    expect(repo.listSuggestions(inv.id, other.id)).toHaveLength(0)
    expect(repo.listEdges(inv.id).some((e) => e.source === other.id && e.target === pseudo.id)).toBe(true)
  })

  it('pseudo d’annuaire validé : l’enrichissement automatique lance la recherche du pseudo sur les sites', async () => {
    const inv = repo.createInvestigation({ name: 'Enchaînement' })
    const phone = await rosoScan(inv.id)

    // Catalogue réel : la recherche sur les sites s'applique au pseudo validé.
    const [probe] = repo.upsertNodes(inv.id, [{ type: 'username', label: 'probe_x9' }])
    expect(engine.applicable(probe).auto).toContain('username.sites')
    repo.deleteNodes(inv.id, [probe.id])

    // Exécution : faux module au même identifiant, sans réseau.
    const searched: string[] = []
    setModulesForTests([
      callerNames,
      defineModule({
        id: 'username.sites',
        name: { fr: 'Pseudo sur des centaines de sites', en: 'Username on hundreds of sites' },
        description: { fr: '', en: '' },
        category: 'username',
        inputTypes: ['username'],
        run: async (input) => {
          searched.push(input.label)
          return {}
        }
      })
    ])
    settings.set({ autoEnrich: true })
    const s = repo.listSuggestions(inv.id, phone.id).find((x) => x.type === 'username' && x.label === 'QW778')!
    await engine.resolveSuggestion(s.id, 'accept')
    await waitJobs()
    const pseudo = repo.listNodes(inv.id).find((n) => n.type === 'username' && n.label === 'QW778')!
    expect(repo.listEdges(inv.id).some((e) => e.source === phone.id && e.target === pseudo.id)).toBe(true)
    expect(searched).toEqual(['QW778'])
    expect(repo.listRuns(inv.id, pseudo.id).map((r) => r.moduleId)).toEqual(['username.sites'])
  })

  it('sans enrichissement automatique, la validation ne lance rien', async () => {
    const inv = repo.createInvestigation({ name: 'Manuel' })
    const phone = await rosoScan(inv.id)
    const searched: string[] = []
    setModulesForTests([
      defineModule({
        id: 'username.sites',
        name: { fr: 'x', en: 'x' },
        description: { fr: '', en: '' },
        category: 'username',
        inputTypes: ['username'],
        run: async (input) => {
          searched.push(input.label)
          return {}
        }
      })
    ])
    settings.set({ autoEnrich: false })
    const s = repo.listSuggestions(inv.id, phone.id).find((x) => x.label === 'QW778')!
    await engine.resolveSuggestion(s.id, 'accept')
    await waitJobs()
    expect(searched).toEqual([])
  })
})
