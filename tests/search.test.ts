import { describe, expect, it } from 'vitest'
import type { GraphNode } from '@shared/types'
import { searchNodes, searchText } from '../src/renderer/src/lib/search'

const node = (id: string, label: string, data: GraphNode['data'] = {}): { id: string; data: { node: GraphNode } } => ({
  id,
  data: {
    node: {
      id,
      investigationId: 'i',
      kind: 'entity',
      type: 'email',
      label,
      platform: null,
      data,
      notes: '',
      imageId: null,
      x: 0,
      y: 0,
      width: null,
      height: null,
      style: {},
      source: 'manual',
      createdAt: 0,
      updatedAt: 0
    }
  }
})

describe('recherche dans le graphe', () => {
  const nodes = [node('a', 'Jean.Dupont@exemple.fr'), node('b', 'acme.fr', { ville: 'Valparaíso', ip: '10.0.0.1' }), node('c', 'autre')]

  it('trouve par libellé ou par propriété, sans tenir compte de la casse', () => {
    expect(searchNodes(nodes, 'dupont').map((n) => n.id)).toEqual(['a'])
    expect(searchNodes(nodes, '  VALPARAÍSO ').map((n) => n.id)).toEqual(['b'])
    expect(searchNodes(nodes, '10.0.0').map((n) => n.id)).toEqual(['b'])
    expect(searchNodes(nodes, '')).toEqual([])
  })

  it('ne fait pas correspondre la fin du libellé avec le début des propriétés', () => {
    // Libellé « acme.fr » suivi des propriétés : « fr{ » ne doit pas être trouvé.
    expect(searchNodes(nodes, 'fr{')).toEqual([])
  })

  it('limite le nombre de résultats', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`n${i}`, `exemple-${i}`))
    expect(searchNodes(many, 'exemple')).toHaveLength(12)
    expect(searchNodes(many, 'exemple', 1)).toHaveLength(1)
  })

  it('calcule le texte une fois par version du nœud', () => {
    const n = node('d', 'Texte', { a: 1 }).data.node
    expect(searchText(n)).toBe(searchText(n))
    expect(searchText(n)).toContain('texte')
    // Nouvelle version (mise à jour) : nouveau texte.
    expect(searchText({ ...n, label: 'Autre' })).toContain('autre')
  })
})
