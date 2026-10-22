import { describe, expect, it } from 'vitest'
import { analyzeConsistency } from '../src/renderer/src/lib/consistency'
import type { GraphEdge, GraphNode } from '../src/shared/types'

let seq = 0
const node = (type: string, label: string, data: GraphNode['data'] = {}, platform: string | null = null): GraphNode => ({
  id: `n${++seq}`,
  investigationId: 'inv',
  kind: 'entity',
  type,
  label,
  platform,
  data,
  notes: '',
  imageId: null,
  x: 0,
  y: 0,
  width: null,
  height: null,
  style: {},
  source: 'test',
  createdAt: 0,
  updatedAt: 0
})
const edge = (a: GraphNode, b: GraphNode): GraphEdge => ({
  id: `${a.id}>${b.id}`,
  investigationId: 'inv',
  source: a.id,
  target: b.id,
  label: '',
  style: {},
  sourceModule: 'test',
  createdAt: 0
}) as GraphEdge

describe('cohérence des indices', () => {
  it('regroupe les variantes d’un même nom', () => {
    const phone = node('phone', '+33600000000')
    const a = node('account', 'jdupont', { display_name: 'Jean Dupont', created_at: '2016-03-01' }, 'facebook')
    const b = node('account', 'x', { caller_name: 'J. DUPONT' }, 'truecaller')
    const c = node('data_breach', 'Fuite', { breach_date: '2021' })
    const v = analyzeConsistency(phone.id, [phone, a, b, c], [edge(phone, a), edge(phone, b), edge(phone, c)])
    expect(v.identities).toHaveLength(1)
    expect(v.identities[0].name).toBe('Jean Dupont')
    expect(v.identities[0].sources.sort()).toEqual(['Facebook', 'Truecaller'].sort())
    expect([v.from, v.to, v.dated]).toEqual([2016, 2021, 2])
  })

  it('signale deux identités différentes (numéro partagé ou réattribué)', () => {
    const phone = node('phone', '+33600000001', { arcep_attribution_date: '2001-01-01' })
    const a = node('account', 'a', { display_name: 'Jean Dupont' }, 'facebook')
    const b = node('person', 'Marie Martin')
    const masked = node('account', 'm', { display_name: 'M*** M***' }, 'apple')
    const v = analyzeConsistency(phone.id, [phone, a, b, masked], [edge(phone, a), edge(phone, b), edge(phone, masked)])
    expect(v.identities.map((i) => i.name).sort()).toEqual(['Jean Dupont', 'Marie Martin'])
    // La date d'attribution du bloc ARCEP ne dit rien de l'usage du numéro.
    expect(v.dated).toBe(0)
  })
})
