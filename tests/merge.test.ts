import { describe, expect, it } from 'vitest'
import { mergeData } from '../src/main/merge'
import type { GraphNode } from '../src/shared/types'

const node = (label: string, data: GraphNode['data']): GraphNode => ({
  id: label,
  investigationId: 'inv',
  kind: 'entity',
  type: 'hash',
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
})

describe('fusion de nœuds', () => {
  it('garde les valeurs différentes et les libellés absorbés', () => {
    const data = mergeData(node('sha256-abc', { algorithm: 'sha256', size: 10 }), [node('md5-def', { algorithm: 'md5', size: 10, extra: 'x' })])
    expect(data.algorithm).toEqual(['sha256', 'md5'])
    expect(data.size).toBe(10)
    expect(data.extra).toBe('x')
    expect(data.aliases).toEqual(['md5-def'])
  })

  it("n'ajoute pas d'alias pour un libellé identique", () => {
    const data = mergeData(node('a@b.fr', { provider: 'Gmail' }), [node('a@b.fr', { provider: 'Gmail' })])
    expect(data).toEqual({ provider: 'Gmail' })
  })

  it('garde la cotation de la cible, reprend celle d’un nœud absorbé sinon', () => {
    expect(mergeData(node('a', { admiralty: 'B2' }), [node('b', { admiralty: 'E5' })]).admiralty).toBe('B2')
    expect(mergeData(node('a', {}), [node('b', { admiralty: 'C3' })]).admiralty).toBe('C3')
  })
})
