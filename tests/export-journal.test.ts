// Chapitres « Journal » et « Preuves » du rapport, description des entrées du journal.
// Valeurs fictives uniquement.

import { describe, expect, it } from 'vitest'
import { activityLine, isSignificantActivity, type ActivityWords } from '@shared/evidence'
import type { ActivityEntry, Attachment, Capture, GraphNode, Investigation } from '@shared/types'
import { buildReportHtml, DEFAULT_SECTIONS, type ReportInput } from '../src/renderer/src/components/export/report'

const T0 = Date.UTC(2026, 9, 22, 8, 0)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const H = (c: string): string => c.repeat(64)

const investigation: Investigation = { id: 'inv-1', name: 'Preuves', description: '', color: '#e5484d', createdAt: T0, updatedAt: T0, notes: '', viewport: null }
const node: GraphNode = {
  id: 'u1',
  investigationId: 'inv-1',
  kind: 'entity',
  type: 'url',
  label: 'https://exemple.test/profil',
  platform: null,
  data: {},
  notes: '',
  imageId: null,
  x: 0,
  y: 0,
  width: null,
  height: null,
  style: {},
  source: 'manual',
  createdAt: T0,
  updatedAt: T0
}

const entry = (seq: number, action: ActivityEntry['action'], target: ActivityEntry['target']): ActivityEntry => ({
  id: `a${seq}`,
  investigationId: 'inv-1',
  seq,
  at: new Date(T0 + seq * 60_000).toISOString(),
  actor: 'Lt. <Martin>',
  action,
  target,
  prevHash: H(String(seq - 1)),
  hash: H(String(seq))
})

const entries = [
  entry(1, 'investigation.create', { name: 'Preuves' }),
  entry(2, 'node.create', { nodes: [{ id: 'u1', type: 'url', label: node.label }], count: 1 }),
  entry(3, 'module.run', { node: { id: 'u1', type: 'url', label: node.label }, modules: ['a', 'b', 'c'], count: 3, job: 'j' }),
  entry(4, 'capture.create', { capture: 'c1', url: node.label, finalUrl: node.label, sha256: H('e'), via: 'node' })
]

const capture: Capture = {
  id: 'c1',
  investigationId: 'inv-1',
  nodeId: 'u1',
  url: 'http://exemple.test/p',
  finalUrl: 'https://exemple.test/profil',
  title: 'Profil <fictif>',
  capturedAt: new Date(T0 + 240_000).toISOString(),
  screenshotAttachment: 'f1',
  mhtmlAttachment: 'f2',
  metaAttachment: 'f3',
  manifestSha256: H('e')
}

const att = (id: string, name: string, sha: string): Attachment => ({ id, investigationId: 'inv-1', name, mime: 'x', size: 1234, sha256: sha, origin: null, createdAt: T0 })

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  options: { title: '', investigator: '', reference: '', classification: '', lang: 'fr', sections: { ...DEFAULT_SECTIONS } },
  investigation,
  nodes: [node],
  edges: [],
  runs: [],
  modules: [],
  iconMarkup: () => '',
  generatedAt: new Date(T0),
  journal: { entries, total: 9, check: { ok: true, count: 9, lastHash: H('9') } },
  captures: [capture],
  captureImages: { c1: PNG },
  attachments: [att('f1', 'capture.png', H('1')), att('f2', 'capture.mhtml', H('2')), att('f3', 'capture.json', H('3'))],
  ...over
})

describe('Chapitre « Journal »', () => {
  const html = buildReportHtml(input())

  it('liste les actions significatives en UTC, avec l’empreinte de la dernière entrée', () => {
    expect(html).toContain('id="s-journal"')
    expect(html).toContain('Journal d’activité')
    expect(html).toContain('2026-10-22 08:03:00 UTC')
    expect(html).toContain('Modules lancés')
    expect(html).toContain('3 modules')
    expect(html).toContain('Lt. &lt;Martin&gt;')
    expect(html).toContain(H('9'))
    expect(html).toContain('intacte (9 entrées)')
    expect(html).toContain('(4 sur 9 entrées du journal)')
  })

  it('signale une chaîne rompue', () => {
    const h = buildReportHtml(input({ journal: { entries, total: 4, check: { ok: false, count: 4, lastHash: H('4'), broken: { seq: 3, id: 'a3', at: entries[2].at, action: 'module.run', reason: 'hash' } } } }))
    expect(h).toContain('rompue à l’entrée n° 3')
  })

  it('reste lisible sans journal', () => {
    expect(buildReportHtml(input({ journal: null }))).toContain('Le journal de cette enquête est vide.')
  })
})

describe('Annexe « Preuves »', () => {
  const html = buildReportHtml(input())

  it('présente chaque capture : URL, date UTC, SHA-256 et miniature', () => {
    expect(html).toContain('id="s-evidence"')
    expect(html).toContain('http://exemple.test/p')
    expect(html).toContain('https://exemple.test/profil')
    expect(html).toContain('2026-10-22 08:04:00 UTC')
    expect(html).toContain(H('e'))
    expect(html).toContain(H('2'))
    expect(html).toContain(`<img class="ev-img" src="${PNG}"`)
    expect(html).toContain('Profil &lt;fictif&gt;')
  })

  it('refuse une miniature qui ne serait pas une data URL', () => {
    const h = buildReportHtml(input({ captureImages: { c1: 'masint-file://att/f1' } }))
    expect(h).not.toContain('masint-file')
    expect(h).toContain('Miniature indisponible')
  })

  it('se traduit en anglais', () => {
    const h = buildReportHtml(input({ options: { ...input().options, lang: 'en' } }))
    expect(h).toContain('Appendix: evidence')
    expect(h).toContain('Modules run')
    expect(h).toContain('Manifest SHA-256')
  })
})

describe('Description des entrées du journal', () => {
  const words: ActivityWords = {
    modules: (n) => `${n} modules`,
    more: (n) => `+${n}`,
    field: (k) => k,
    untitled: '(sans libellé)',
    followUp: 'suite',
    removedEdges: (n) => `avec ${n} liens`
  }

  it('résume les nœuds visés et le nombre au-delà de la liste', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, type: 'phone', label: `n${i}` }))
    expect(activityLine({ action: 'node.delete', target: { nodes, count: 14, removedEdges: 3 } }, words)).toEqual({
      subject: 'n0, n1, n2, n3, n4, n5, n6, n7, n8, n9 (+4)',
      detail: 'avec 3 liens'
    })
    expect(activityLine({ action: 'edge.create', target: { edges: [{ id: 'e', from: 'a', to: '', label: 'compte' }], count: 1 } }, words).subject).toBe('a → (sans libellé) (compte)')
    expect(activityLine({ action: 'node.update', target: { nodes: [nodes[0]], count: 1, fields: ['label', 'style'] } }, words).detail).toBe('label, style')
  })

  it('signale les modules lancés par enchaînement', () => {
    const run = { action: 'module.run' as const, target: { node: { id: 'a', type: 'account', label: 'jane' }, count: 2, chain: { depth: 2, path: ['m1', 'm2'] } } }
    expect(activityLine(run, { ...words, chain: (d) => `en chaîne, profondeur ${d}` }).detail).toBe('2 modules · en chaîne, profondeur 2')
    expect(activityLine(run, words).detail).toBe('2 modules')
  })

  it('distingue les modifications significatives', () => {
    expect(isSignificantActivity({ action: 'edge.update', target: { fields: ['style'] } })).toBe(false)
    expect(isSignificantActivity({ action: 'capture.create', target: {} })).toBe(true)
  })
})
