import { describe, expect, it } from 'vitest'
import { childSlot, freeSpot, freeSpots, nodeBox, overlaps, type Box } from '../src/shared/placement'

const size = { width: 196, height: 52 }

describe('placement', () => {
  it('garde le point de départ quand il est libre', () => {
    expect(freeSpot([], { x: 10, y: 20 }, size)).toEqual({ x: 10, y: 20 })
  })

  it('évite les nœuds existants et reste proche du départ', () => {
    const occupied: Box[] = [{ x: 0, y: 0, ...size }]
    const p = freeSpot(occupied, { x: 0, y: 0 }, size)
    expect(overlaps({ ...p, ...size }, occupied[0], 24)).toBe(false)
    expect(Math.hypot(p.x, p.y)).toBeLessThan(150)
  })

  it('trouve une place hors d’un graphe dense', () => {
    const occupied: Box[] = []
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) occupied.push({ x: i * 220, y: j * 70, ...size })
    const p = freeSpot(occupied, { x: 0, y: 0 }, size)
    expect(occupied.every((o) => !overlaps({ ...p, ...size }, o, 24))).toBe(true)
  })

  it('pose plusieurs nœuds sans qu’ils se chevauchent entre eux', () => {
    const spots = freeSpots([], { x: 0, y: 0 }, [size, size, size, { width: 320, height: 220 }])
    const boxes = spots.map((p, i) => ({ ...p, ...(i === 3 ? { width: 320, height: 220 } : size) }))
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false)
  })

  it('range les enfants sous le parent puis saute les cases prises', () => {
    const parent = { x: 0, y: 0, ...size }
    expect(childSlot(parent, [])).toEqual({ x: 0, y: 130 })
    // Un nœud étranger occupe la première case : l'enfant passe à droite.
    const blocker = { x: 0, y: 130, ...size }
    const p = childSlot(parent, [blocker])
    expect(p).toEqual({ x: 220, y: 130 })
    // Sept enfants remplissent la rangée, le huitième descend.
    const taken: Box[] = []
    for (let k = 0; k < 7; k++) taken.push({ ...childSlot(parent, taken), ...size })
    expect(new Set(taken.map((b) => b.y))).toEqual(new Set([130]))
    expect(childSlot(parent, taken).y).toBe(200)
  })

  it('estime la taille des cartes d’entité et des annotations', () => {
    expect(nodeBox({ x: 1, y: 2, width: null, height: null, style: {} })).toEqual({ x: 1, y: 2, width: 196, height: 52 })
    expect(nodeBox({ x: 0, y: 0, width: null, height: null, style: { size: 'lg' } }).width).toBe(240)
    expect(nodeBox({ x: 0, y: 0, width: 320, height: 220, style: {} })).toEqual({ x: 0, y: 0, width: 320, height: 220 })
  })
})
