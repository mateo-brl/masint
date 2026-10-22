import { describe, expect, it } from 'vitest'
import { computeView, type ViewEdge, type ViewNode } from '../src/renderer/src/lib/collapse'
import { EMPTY_FILTER, isFilterActive, matchesFilter, normalizeFilter, toggleIn, viewFilterKey, type NodeFilter, type ViewFilter } from '../src/renderer/src/lib/filters'

const node = (id: string, extra: Partial<ViewNode> = {}): ViewNode => ({
  id,
  kind: 'entity',
  type: 'domain',
  label: id,
  platform: null,
  notes: '',
  style: {},
  source: 'manual',
  createdAt: 1000,
  ...extra
})
const edge = (source: string, target: string, label = ''): ViewEdge => ({ id: `${source}>${target}`, source, target, label })
const vf = (filter: Partial<NodeFilter>, mode: ViewFilter['mode'] = 'hide', review: string[] = []): ViewFilter => ({
  mode,
  filter: { ...EMPTY_FILTER, ...filter },
  review: new Set(review)
})

describe('Critères du filtre', () => {
  const email = node('e', { type: 'email', platform: 'gmail', source: 'email.hibp', createdAt: 5000 })
  const note = node('t', { kind: 'text', type: 'text' })

  it('garde ce qui correspond à chaque critère renseigné', () => {
    const none = new Set<string>()
    expect(matchesFilter(email, { ...EMPTY_FILTER, types: ['email', 'phone'] }, none)).toBe(true)
    expect(matchesFilter(email, { ...EMPTY_FILTER, types: ['phone'] }, none)).toBe(false)
    expect(matchesFilter(email, { ...EMPTY_FILTER, platforms: ['gmail'] }, none)).toBe(true)
    expect(matchesFilter(node('x'), { ...EMPTY_FILTER, platforms: [''] }, none)).toBe(true)
    expect(matchesFilter(email, { ...EMPTY_FILTER, sources: ['manual'] }, none)).toBe(false)
    expect(matchesFilter(email, { ...EMPTY_FILTER, from: 4000, to: 6000 }, none)).toBe(true)
    expect(matchesFilter(email, { ...EMPTY_FILTER, to: 4999 }, none)).toBe(false)
    expect(matchesFilter(email, { ...EMPTY_FILTER, review: true }, none)).toBe(false)
    expect(matchesFilter(email, { ...EMPTY_FILTER, review: true }, new Set(['e']))).toBe(true)
  })

  it('ne filtre jamais les annotations', () => {
    expect(matchesFilter(note, { ...EMPTY_FILTER, types: ['email'], review: true }, new Set())).toBe(true)
  })

  it('détecte un filtre vide, nettoie un filtre enregistré, bascule une valeur', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTER, to: 0 })).toBe(true)
    expect(normalizeFilter({ types: ['email', 3 as unknown as string], to: Number.NaN })).toEqual({ ...EMPTY_FILTER, types: ['email'] })
    expect(toggleIn(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('ne met les nœuds « À vérifier » dans la clé que si le filtre s’en sert', () => {
    expect(viewFilterKey(vf({ types: ['email'] }, 'hide', ['a']))).toBe(viewFilterKey(vf({ types: ['email'] }, 'hide', ['b'])))
    expect(viewFilterKey(vf({ review: true }, 'hide', ['a']))).not.toBe(viewFilterKey(vf({ review: true }, 'hide', ['b'])))
    expect(viewFilterKey(vf({}))).toBe('')
  })
})

describe('Filtre dans computeView', () => {
  const subs = Array.from({ length: 8 }, (_, i) => node(`s${i}`, { createdAt: 1000 + i }))
  const base = [node('root', { type: 'person' }), node('mail', { type: 'email' }), node('txt', { kind: 'text', type: 'text' }), ...subs]
  const edges = [edge('root', 'mail'), ...subs.map((s) => edge('root', s.id, 'sous-domaine'))]

  it('masque les nœuds écartés et recompte les groupes sur ce qui reste', () => {
    const plain = computeView(base, edges, new Set())
    expect(plain.bundles[0].members).toHaveLength(8)
    // Curseur temporel : seuls les cinq premiers sous-domaines existaient à cette date.
    const v = computeView(base, edges, new Set(), { filter: vf({ to: 1004 }) })
    expect([...v.filtered].sort()).toEqual(['s5', 's6', 's7'])
    expect(v.hidden.has('s6')).toBe(true)
    // Cinq feuilles restantes : sous le seuil de regroupement.
    expect(v.bundles).toHaveLength(0)
    expect(v.dimmed.size).toBe(0)
  })

  it('ne garde que les types choisis, annotations comprises, et laisse les liens orphelins hors du regroupement', () => {
    const v = computeView(base, edges, new Set(), { filter: vf({ types: ['domain'] }) })
    expect([...v.filtered].sort()).toEqual(['mail', 'root'])
    expect(v.hidden.has('txt')).toBe(false)
    // Parent masqué : les sous-domaines n'ont plus de parent visible, pas de groupe.
    expect(v.bundles).toHaveLength(0)
  })

  it('estompe sans rien masquer en mode « estomper »', () => {
    const v = computeView(base, edges, new Set(), { filter: vf({ types: ['email'] }, 'dim') })
    expect(v.filtered.size).toBe(0)
    expect([...v.dimmed].sort()).toEqual(['root', ...subs.map((s) => s.id)].sort())
    expect(v.bundles).toHaveLength(1)
  })

  it('reste mémorisé tant que ni la structure ni le filtre ne changent', () => {
    const filter = vf({ types: ['domain', 'person'] })
    const v1 = computeView(base, edges, new Set(), { filter })
    // Positions modifiées, mêmes valeurs : même objet.
    const moved = base.map((n) => ({ ...n }))
    expect(computeView(moved, edges.map((e) => ({ ...e })), new Set(), { filter })).toBe(v1)
    // Même filtre recréé à l'identique : même clé, même vue.
    expect(computeView(moved, edges, new Set(), { filter: vf({ types: ['person', 'domain'] }) })).toBe(v1)
    // Filtre modifié : nouvelle vue.
    const v2 = computeView(moved, edges, new Set(), { filter: vf({ types: ['domain'] }) })
    expect(v2).not.toBe(v1)
    // Filtre inactif : équivalent à aucun filtre.
    const v3 = computeView(moved, edges, new Set())
    expect(computeView(moved, edges, new Set(), { filter: vf({}) })).toBe(v3)
    // Date de création modifiée : prise en compte seulement quand le filtre est actif.
    const later = moved.map((n) => (n.id === 's0' ? { ...n, createdAt: 9999 } : n))
    expect(computeView(later, edges, new Set())).toBe(v3)
    const timed = vf({ to: 5000 })
    const v4 = computeView(moved, edges, new Set(), { filter: timed })
    expect(v4.filtered.has('s0')).toBe(false)
    expect(computeView(later, edges, new Set(), { filter: timed }).filtered.has('s0')).toBe(true)
  })

  it('suit les nœuds « À vérifier »', () => {
    const v = computeView(base, edges, new Set(), { filter: vf({ review: true }, 'hide', ['root', 's1']) })
    expect(v.hidden.has('root')).toBe(false)
    expect(v.hidden.has('s1')).toBe(false)
    expect(v.filtered.has('mail')).toBe(true)
    const w = computeView(base, edges, new Set(), { filter: vf({ review: true }, 'hide', ['root']) })
    expect(w).not.toBe(v)
    expect(w.filtered.has('s1')).toBe(true)
  })

  it('accepte encore le seuil de regroupement en quatrième paramètre', () => {
    expect(computeView(base, edges, new Set(), 20).bundles).toHaveLength(0)
  })
})
