// Recherche globale (index plein texte), corrélation entre enquêtes et cloisonnement.
// better-sqlite3 est compilé pour Electron : ces tests tournent avec `npm run test:core`.
// Valeurs fictives uniquement.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ftsQuery, snippetParts } from '@shared/correlation'
import { duplicateInvestigation } from '../../src/main/archive'
import { crossReferences, globalSearch } from '../../src/main/correlation'
import { openDatabase, type DB } from '../../src/main/db/database'
import { Repo } from '../../src/main/db/repo'
import { SettingsService } from '../../src/main/settings'

let dir: string
let file: string
let db: DB
let repo: Repo
let settings: SettingsService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'masint-correlation-'))
  file = join(dir, 'test.db')
  db = openDatabase(file)
  repo = new Repo(db)
  settings = new SettingsService(repo)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const ids = (hits: Array<{ nodeId: string }>): string[] => hits.map((h) => h.nodeId).sort()

describe('Index plein texte', () => {
  it('trouve un nœud par son libellé, ses propriétés ou ses notes, casse et accents ignorés', () => {
    const inv = repo.createInvestigation({ name: 'Alpha' })
    const [a, b, c] = repo.upsertNodes(inv.id, [
      { kind: 'entity', type: 'person', label: 'Élodie Durand', data: { city: 'Montréal', tags: ['osint'] } },
      { kind: 'entity', type: 'email', label: 'contact@exemple-fictif.fr', notes: 'Vu sur un forum de revente' },
      { kind: 'entity', type: 'phone', label: '+33600000001', data: { carrier: 'Opérateur fictif' } }
    ])
    expect(ids(repo.searchNodes('elodie'))).toEqual([a.id])
    expect(ids(repo.searchNodes('MONTREAL'))).toEqual([a.id])
    expect(ids(repo.searchNodes('revente'))).toEqual([b.id])
    // Sous-chaîne d'une valeur : partie d'un numéro, d'une adresse.
    expect(ids(repo.searchNodes('0000001'))).toEqual([c.id])
    expect(ids(repo.searchNodes('exemple-fic'))).toEqual([b.id])
    // Tous les mots doivent apparaître.
    expect(ids(repo.searchNodes('durand montreal'))).toEqual([a.id])
    expect(repo.searchNodes('durand revente')).toEqual([])
    // Mots trop courts ignorés : aucune requête exploitable.
    expect(repo.searchNodes('du')).toEqual([])
  })

  it('renvoie l’enquête et un extrait qui encadre le passage trouvé', () => {
    const inv = repo.createInvestigation({ name: 'Bravo', color: '#0090ff' })
    repo.upsertNodes(inv.id, [{ kind: 'entity', type: 'person', label: 'Jean Fictif', notes: 'Rencontré à Lyon en 2021' }])
    const [hit] = repo.searchNodes('lyon')
    expect(hit).toMatchObject({ investigationId: inv.id, investigationName: 'Bravo', investigationColor: '#0090ff', type: 'person', label: 'Jean Fictif' })
    expect(snippetParts(hit.snippet).some((p) => p.hit && p.text.toLowerCase() === 'lyon')).toBe(true)
  })

  it('suit les modifications, suppressions et enquêtes supprimées, sans indexer les dessins ni les champs internes', () => {
    const inv = repo.createInvestigation({ name: 'Charlie' })
    const [n, d] = repo.upsertNodes(inv.id, [
      { kind: 'entity', type: 'username', label: 'pseudo_fictif', data: { __image: 'https://cache.invalid/secret.png' } },
      { kind: 'drawing', type: 'drawing', label: 'trait fictif' }
    ])
    expect(repo.searchNodes('secret')).toEqual([])
    expect(repo.searchNodes('trait fictif')).toEqual([])
    // Déplacement : l'index ne bouge pas ; changement de valeur : l'ancienne n'est plus trouvée.
    repo.upsertNodes(inv.id, [{ id: n.id, x: 400, y: 200 }])
    expect(ids(repo.searchNodes('pseudo_fictif'))).toEqual([n.id])
    repo.upsertNodes(inv.id, [{ id: n.id, label: 'autre_pseudo' }])
    expect(repo.searchNodes('pseudo_fictif')).toEqual([])
    expect(ids(repo.searchNodes('autre_pseudo'))).toEqual([n.id])
    repo.deleteNodes(inv.id, [n.id, d.id])
    expect(repo.searchNodes('autre_pseudo')).toEqual([])

    const other = repo.createInvestigation({ name: 'Delta' })
    repo.upsertNodes(other.id, [{ kind: 'entity', type: 'keyword', label: 'mot-témoin' }])
    expect(repo.searchNodes('temoin')).toHaveLength(1)
    repo.deleteInvestigation(other.id)
    expect(repo.searchNodes('temoin')).toEqual([])
    // Index cohérent avec son contenu.
    expect(() => db.exec("INSERT INTO node_fts(node_fts, rank) VALUES ('integrity-check', 1)")).not.toThrow()
  })

  it('indexe les nœuds déjà présents lors de la migration', () => {
    const inv = repo.createInvestigation({ name: 'Ancienne' })
    repo.upsertNodes(inv.id, [{ kind: 'entity', type: 'domain', label: 'ancien-domaine.invalid' }])
    // Base d'avant la recherche globale : index retiré, version ramenée à 3.
    db.exec(`DROP TRIGGER nodes_search_ai; DROP TRIGGER nodes_search_au; DROP TRIGGER nodes_search_ad;
      DROP TABLE node_fts; DROP TABLE node_text; DROP INDEX idx_nodes_dedup_key;`)
    db.pragma('user_version = 3')
    db.close()
    db = openDatabase(file)
    repo = new Repo(db)
    expect(repo.searchNodes('ancien-domaine')).toHaveLength(1)
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM nodes WHERE dedup_key = 'x'").all() as Array<{ detail: string }>
    expect(plan.map((p) => p.detail).join(' ')).toContain('idx_nodes_dedup_key')
  })

  it('compose une requête sûre à partir d’une saisie libre', () => {
    expect(ftsQuery('  a  ')).toBeNull()
    expect(ftsQuery('jean "dupont" -x')).toBe('"jean" AND """dupont"""')
    expect(snippetParts('avant \u0002trouvé\u0003 après')).toEqual([
      { text: 'avant ', hit: false },
      { text: 'trouvé', hit: true },
      { text: ' après', hit: false }
    ])
  })
})

describe('Corrélation entre enquêtes', () => {
  it('retrouve une même entité dans d’autres enquêtes, par sa clé canonique', () => {
    const a = repo.createInvestigation({ name: 'A' })
    const b = repo.createInvestigation({ name: 'B', color: '#30a46c' })
    const c = repo.createInvestigation({ name: 'C' })
    const [phoneA, emailA, cityA, emptyA, alone] = repo.upsertNodes(a.id, [
      { kind: 'entity', type: 'phone', label: '06 00 00 00 01' },
      { kind: 'entity', type: 'email', label: 'Alice@Exemple-Fictif.fr' },
      { kind: 'entity', type: 'city', label: 'Lyon' },
      { kind: 'entity', type: 'email', label: '' },
      { kind: 'entity', type: 'username', label: 'unique_fictif' }
    ])
    const [phoneB] = repo.upsertNodes(b.id, [
      { kind: 'entity', type: 'phone', label: '+33600000001' },
      { kind: 'entity', type: 'email', label: 'alice@exemple-fictif.fr' },
      { kind: 'entity', type: 'city', label: 'Lyon' },
      { kind: 'entity', type: 'email', label: '' }
    ])
    repo.upsertNodes(c.id, [{ kind: 'entity', type: 'email', label: 'ALICE@exemple-fictif.fr', platform: 'gmail' }])

    const refs = repo.crossRefs([phoneA.id, emailA.id, cityA.id, emptyA.id, alone.id, 'absent'])
    expect(refs[phoneA.id]).toEqual([{ investigationId: b.id, investigationName: 'B', investigationColor: '#30a46c', nodeId: phoneB.id }])
    expect(refs[emailA.id].map((r) => r.investigationName).sort()).toEqual(['B', 'C'])
    // Valeur vide, type de contexte et entité propre à l'enquête : rien.
    expect(refs[cityA.id]).toBeUndefined()
    expect(refs[emptyA.id]).toBeUndefined()
    expect(refs[alone.id]).toBeUndefined()
    expect(Object.keys(refs).sort()).toEqual([emailA.id, phoneA.id].sort())
  })

  it('ignore les enquêtes supprimées et les copies dans la même enquête', async () => {
    const a = repo.createInvestigation({ name: 'A' })
    const [n] = repo.upsertNodes(a.id, [
      { kind: 'entity', type: 'domain', label: 'domaine-fictif.invalid' },
      { kind: 'entity', type: 'domain', label: 'https://www.domaine-fictif.invalid/' }
    ])
    expect(repo.crossRefs([n.id])).toEqual({})
    const copy = await duplicateInvestigation(repo, a.id)
    expect(repo.crossRefs([n.id])[n.id].map((r) => r.investigationId)).toEqual([copy.id])
    repo.deleteInvestigation(copy.id)
    expect(repo.crossRefs([n.id])).toEqual({})
  })
})

describe('Cloisonnement des enquêtes', () => {
  it('désactive la recherche globale et la corrélation quand il est actif', () => {
    const a = repo.createInvestigation({ name: 'A' })
    const b = repo.createInvestigation({ name: 'B' })
    const [n] = repo.upsertNodes(a.id, [{ kind: 'entity', type: 'email', label: 'cloison@exemple-fictif.fr' }])
    repo.upsertNodes(b.id, [{ kind: 'entity', type: 'email', label: 'cloison@exemple-fictif.fr' }])
    expect(settings.get().isolateInvestigations).toBe(false)
    expect(globalSearch(repo, settings, 'cloison')).toHaveLength(2)
    expect(Object.keys(crossReferences(repo, settings, [n.id]))).toEqual([n.id])

    settings.set({ isolateInvestigations: true })
    expect(globalSearch(repo, settings, 'cloison')).toEqual([])
    expect(crossReferences(repo, settings, [n.id])).toEqual({})
    // Le réglage est enregistré : il tient après un redémarrage.
    expect(new SettingsService(repo).get().isolateInvestigations).toBe(true)
  })
})
