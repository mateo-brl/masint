// Recherches assistées scriptées dans le moteur : parcours gardé avec la recherche manuelle,
// éléments lus ajoutés par l'enquêteur (nom, contact masqué), recoupement des indices relancé.
// Valeurs fictives. better-sqlite3 est compilé pour Electron : `npm run test:core`.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineModule, type ModuleContext } from '@shared/modules'
import type { AssistResult } from '@shared/types'
import { buildArchive, importArchive } from '../../src/main/archive'
import { openDatabase, type DB } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { setModulesForTests } from '../../src/main/engine/registry'
import { Engine } from '../../src/main/engine/runner'
import { SettingsService } from '../../src/main/settings'
import { facebookIdentifyCheck } from '../../src/main/flows/facebook'

let dir: string
let db: DB
let repo: Repo
let settings: SettingsService
let engine: Engine

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-flow-'))
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

const fakeCtx = {} as ModuleContext
const links = defineModule({
  id: 'phone.links',
  name: { fr: 'Liens', en: 'Links' },
  description: { fr: '', en: '' },
  category: 'phone',
  inputTypes: ['phone'],
  run: async () => ({})
})

async function waitJobs(): Promise<void> {
  for (let i = 0; i < 400 && engine.listJobs().length; i++) await new Promise((r) => setTimeout(r, 10))
  expect(engine.listJobs()).toHaveLength(0)
}

/** Résultat d'un parcours Facebook sur la page des options (valeurs fictives). */
const optionsResult: AssistResult = {
  status: 'ok',
  url: 'https://www.facebook.com/recover/initiate/?privacy_mutation_token=fictif',
  title: 'Réinitialisez votre mot de passe',
  matches: [],
  extracted: {
    state: 'options',
    names: ['Camille Exemple'],
    maskedNames: [],
    usernames: [],
    maskedEmails: ['c*****@e******.fr'],
    maskedPhones: [],
    photos: []
  }
}

describe('recherche assistée scriptée', () => {
  it('garde le parcours avec la recherche manuelle, et le donne à une recherche déjà proposée', async () => {
    const inv = repo.createInvestigation({ name: 'Parcours' })
    const [phone] = repo.upsertNodes(inv.id, [{ type: 'phone', label: '+33600000012' }])
    await engine.applyOutput(phone, links, { manual: [facebookIdentifyCheck('fr')] }, fakeCtx)
    const [s] = repo.listSuggestions(inv.id, phone.id)
    expect(s).toMatchObject({ kind: 'manual', flow: 'facebook_identify', label: 'Facebook : retrouver le compte' })
    // Données propres : le parcours n'y apparaît pas.
    expect(s.data).toEqual({})

    // Recherche Tellows proposée avant que son parcours existe : elle le reçoit au passage suivant.
    const url = 'https://www.tellows.fr/num/0600000012'
    await engine.applyOutput(phone, links, { manual: [{ label: 'Tellows', url }] }, fakeCtx)
    expect(repo.listSuggestions(inv.id, phone.id).find((x) => x.url === url)?.flow).toBeUndefined()
    await engine.applyOutput(phone, links, { manual: [{ label: 'Tellows', url, flow: 'tellows' }] }, fakeCtx)
    const tellows = repo.listSuggestions(inv.id, phone.id).filter((x) => x.url === url)
    expect(tellows).toHaveLength(1)
    expect(tellows[0].flow).toBe('tellows')
  })

  it('conserve le parcours dans une archive', async () => {
    const inv = repo.createInvestigation({ name: 'Archive' })
    const [phone] = repo.upsertNodes(inv.id, [{ type: 'phone', label: '+33600000012' }])
    await engine.applyOutput(phone, links, { manual: [facebookIdentifyCheck('fr')] }, fakeCtx)
    const copy = await importArchive(repo, await buildArchive(repo, inv.id))
    expect(repo.listSuggestions(copy.id)[0].flow).toBe('facebook_identify')
  })

  it('nom lu par le parcours : ajouté par l’enquêteur, relié au nœud de la recherche', async () => {
    const inv = repo.createInvestigation({ name: 'Nom' })
    const [phone] = repo.upsertNodes(inv.id, [{ type: 'phone', label: '+33600000012' }])
    await engine.applyOutput(phone, links, { manual: [facebookIdentifyCheck('fr')] }, fakeCtx)
    const [s] = repo.listSuggestions(inv.id, phone.id)
    repo.setSuggestionAssist(s.id, { result: optionsResult, added: [], at: Date.now() })

    // Un nom qui n'a pas été lu sur la page est refusé.
    await engine.addAssistFinding(s.id, { kind: 'name', value: 'Quelqu’un d’autre' })
    expect(repo.listNodes(inv.id).some((n) => n.type === 'person')).toBe(false)

    await engine.addAssistFinding(s.id, { kind: 'name', value: 'Camille Exemple' })
    const person = repo.listNodes(inv.id).find((n) => n.type === 'person')!
    expect(person.label).toBe('Camille Exemple')
    expect(person.data).toMatchObject({ source: 'Facebook', source_url: optionsResult.url })
    expect(repo.listEdges(inv.id).find((e) => e.source === phone.id && e.target === person.id)?.label).toBe('nom (Facebook)')
    expect(repo.getSuggestion(s.id)!.assist!.added).toEqual(['name:Camille Exemple'])
    expect(repo.getSuggestion(s.id)!.status).toBe('pending')
  })

  it('contact masqué lu par le parcours : indice du nœud, recoupement relancé, recherche traitée', async () => {
    const inv = repo.createInvestigation({ name: 'Indice' })
    const [phone] = repo.upsertNodes(inv.id, [{ type: 'phone', label: '+33600000012', data: { masked_emails: 'a•••••@g•••••.com (Apple)' } }])
    await engine.applyOutput(phone, links, { manual: [facebookIdentifyCheck('fr')] }, fakeCtx)
    const [s] = repo.listSuggestions(inv.id, phone.id)
    repo.setSuggestionAssist(s.id, { result: optionsResult, added: ['name:Camille Exemple'], at: Date.now() })

    const crossmatch: string[] = []
    setModulesForTests([
      defineModule({
        id: 'hints.crossmatch',
        name: { fr: 'Recoupement', en: 'Cross-check' },
        description: { fr: '', en: '' },
        category: 'email',
        inputTypes: ['*'],
        accepts: (input) => Array.isArray(input.data.masked_emails),
        followUp: true,
        run: async (input) => {
          crossmatch.push(...(input.data.masked_emails as string[]))
          return {}
        }
      })
    ])
    await engine.addAssistFinding(s.id, { kind: 'masked_email', value: 'c*****@e******.fr' })
    await waitJobs()
    // L'indice isolé déjà présent est gardé, le nouveau s'y ajoute avec sa source.
    expect(repo.getNode(phone.id)!.data.masked_emails).toEqual(['a•••••@g•••••.com (Apple)', 'c*****@e******.fr (Facebook)'])
    expect(crossmatch).toEqual(['a•••••@g•••••.com (Apple)', 'c*****@e******.fr (Facebook)'])
    // Tout ce qui avait été lu est ajouté : la recherche est traitée.
    expect(repo.getSuggestion(s.id)!.status).toBe('accepted')
  })
})
