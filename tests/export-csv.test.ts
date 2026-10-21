import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '@shared/types'
import { buildEdgesCsv, buildNodesCsv, csvCell, csvRow } from '../src/renderer/src/components/export/csv'

const node = (over: Partial<GraphNode>): GraphNode => ({
  id: 'n1',
  investigationId: 'inv',
  kind: 'entity',
  type: 'phone',
  label: '+33612345678',
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
  createdAt: new Date(2026, 9, 21, 14, 3, 5).getTime(),
  updatedAt: new Date(2026, 9, 21, 14, 3, 5).getTime(),
  ...over
})

const edge = (over: Partial<GraphEdge>): GraphEdge => ({
  id: 'e1',
  investigationId: 'inv',
  source: 'n1',
  target: 'n2',
  label: '',
  data: {},
  style: {},
  sourceModule: 'manual',
  createdAt: 0,
  updatedAt: 0,
  ...over
})

/** Découpe un CSV `;` en respectant les guillemets (pour vérifier l'aller-retour). */
function parse(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ';') {
      row.push(cell)
      cell = ''
    } else if (c === '\r' && s[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else cell += c
  }
  return rows
}

describe('csvCell', () => {
  it('laisse les valeurs simples intactes', () => {
    expect(csvCell('abc')).toBe('abc')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('met entre guillemets et double les guillemets', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('il a dit "oui"')).toBe('"il a dit ""oui"""')
    expect(csvCell('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"')
    expect(csvCell(' espace')).toBe('" espace"')
  })

  it('neutralise les formules mais garde les numéros', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('-2+3+cmd|x')).toBe("'-2+3+cmd|x")
    expect(csvCell('+33612345678')).toBe('+33612345678')
    expect(csvCell('-12.5')).toBe('-12.5')
    expect(csvCell('+33 6 12 34 56 78')).toBe('+33 6 12 34 56 78')
  })

  it('assemble une ligne avec le séparateur ;', () => {
    expect(csvRow(['a', 'b;c', 1])).toBe('a;"b;c";1')
  })
})

describe('buildNodesCsv', () => {
  const nodes = [
    node({ id: 'n1', data: { country: 'France', carrier: 'Orange' } }),
    node({ id: 'n2', type: 'account', platform: 'facebook', label: 'Jean "JD" Dupont', data: { username: 'jdupont', aliases: ['jd', 'jean'] }, notes: 'vu le 12;03' }),
    node({ id: 't1', kind: 'text', type: 'text', label: 'annotation' })
  ]
  const csv = buildNodesCsv(nodes, 'fr')

  it('commence par le BOM UTF-8 et utilise CRLF', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.includes('\r\n')).toBe(true)
  })

  it('a les colonnes fixes puis une colonne par propriété', () => {
    const rows = parse(csv)
    expect(rows[0]).toEqual([
      'id',
      'type',
      'libellé du type',
      'libellé',
      'plateforme',
      'source',
      'créé le',
      'modifié le',
      'notes',
      'country',
      'carrier',
      'username',
      'aliases'
    ])
    expect(rows).toHaveLength(3)
  })

  it('remplit les valeurs et ignore les annotations', () => {
    const rows = parse(csv)
    expect(rows[1].slice(0, 7)).toEqual(['n1', 'phone', 'Téléphone', '+33612345678', '', 'manual', '2026-10-21 14:03:05'])
    expect(rows[1][9]).toBe('France')
    expect(rows[2][3]).toBe('Jean "JD" Dupont')
    expect(rows[2][4]).toBe('Facebook')
    expect(rows[2][8]).toBe('vu le 12;03')
    expect(rows[2][12]).toBe('jd, jean')
    expect(rows.some((r) => r[0] === 't1')).toBe(false)
  })

  it('traduit les en-têtes en anglais', () => {
    expect(parse(buildNodesCsv(nodes, 'en'))[0].slice(0, 3)).toEqual(['id', 'type', 'type label'])
  })
})

describe('buildEdgesCsv', () => {
  it('reprend les libellés des extrémités et le nom du module', () => {
    const nodes = [node({ id: 'a', label: 'Alice' }), node({ id: 'b', label: 'Bob; le frère' })]
    const csv = buildEdgesCsv(nodes, [edge({ id: 'e1', source: 'a', target: 'b', label: 'frère de', sourceModule: 'phone_info' })], 'fr', [
      {
        id: 'phone_info',
        name: { fr: 'Infos téléphone', en: 'Phone info' },
        description: { fr: '', en: '' },
        category: 'phone',
        inputTypes: [],
        keys: [],
        ondemand: false,
        noisy: false,
        experimental: false,
        enabled: true,
        configured: true
      }
    ])
    const rows = parse(csv)
    expect(rows[0]).toEqual(['id', 'source', 'libellé source', 'cible', 'libellé cible', 'libellé du lien', 'module', 'créé le'])
    expect(rows[1].slice(0, 7)).toEqual(['e1', 'a', 'Alice', 'b', 'Bob; le frère', 'frère de', 'Infos téléphone'])
  })
})
