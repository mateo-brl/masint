// Placement des nouveaux nœuds dans un espace libre, pour ne jamais les poser
// par-dessus le graphe existant. Partagé par le moteur (enfants d'un enrichissement)
// et l'interface (ajouts depuis les barres d'outils, collage).

import type { GraphNode } from './types'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** Largeur d'une carte d'entité selon sa taille (voir EntityNode). */
const ENTITY_WIDTH: Record<string, number> = { sm: 168, md: 196, lg: 240 }
/** Hauteur d'une carte d'entité avec sous-titre. */
export const ENTITY_HEIGHT = 52

/** Emprise approximative d'un nœud enregistré. */
export function nodeBox(n: Pick<GraphNode, 'x' | 'y' | 'width' | 'height' | 'style'>): Box {
  const width = n.width ?? ENTITY_WIDTH[n.style?.size ?? 'md'] ?? ENTITY_WIDTH.md
  return { x: n.x, y: n.y, width, height: n.height ?? ENTITY_HEIGHT }
}

export function overlaps(a: Box, b: Box, margin = 0): boolean {
  return a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin
}

function isFree(box: Box, occupied: Box[], margin: number): boolean {
  for (const o of occupied) if (overlaps(box, o, margin)) return false
  return true
}

/**
 * Coin haut gauche libre le plus proche de `start` pour un nœud de taille `size`.
 * Les candidats sont pris sur des anneaux carrés de plus en plus larges autour du départ ;
 * dans un anneau, le plus proche du départ l'emporte.
 */
export function freeSpot(
  occupied: Box[],
  start: Point,
  size: { width: number; height: number },
  { margin = 24, stepX = 40, stepY = 30, maxRings = 120 }: { margin?: number; stepX?: number; stepY?: number; maxRings?: number } = {}
): Point {
  const at = (i: number, j: number): Box => ({ x: start.x + i * stepX, y: start.y + j * stepY, ...size })
  if (isFree(at(0, 0), occupied, margin)) return { x: start.x, y: start.y }
  for (let r = 1; r <= maxRings; r++) {
    const ring: Array<[number, number]> = []
    for (let i = -r; i <= r; i++) {
      ring.push([i, -r], [i, r])
      if (i > -r && i < r) ring.push([-r, i], [r, i])
    }
    ring.sort(([a, b], [c, d]) => Math.hypot(a * stepX, b * stepY) - Math.hypot(c * stepX, d * stepY))
    for (const [i, j] of ring) {
      const box = at(i, j)
      if (isFree(box, occupied, margin)) return { x: box.x, y: box.y }
    }
  }
  return { x: start.x, y: start.y }
}

/** Position de plusieurs nœuds à poser ensemble près de `start`, sans se chevaucher entre eux. */
export function freeSpots(occupied: Box[], start: Point, sizes: Array<{ width: number; height: number }>): Point[] {
  const taken = [...occupied]
  return sizes.map((size) => {
    const p = freeSpot(taken, start, size)
    taken.push({ ...p, ...size })
    return p
  })
}

const PER_ROW = 7
const CELL_W = 220
const CELL_H = 70

/**
 * Position d'un nouvel enfant : rangées centrées sous le parent (0, +1, -1, +2, -2...),
 * en sautant les cases déjà occupées par d'autres nœuds.
 */
export function childSlot(parent: Box, occupied: Box[], size = { width: ENTITY_WIDTH.md, height: ENTITY_HEIGHT }): Point {
  const top = parent.y + Math.max(parent.height, ENTITY_HEIGHT) + 78
  const cx = parent.x + parent.width / 2 - size.width / 2
  for (let k = 0; k < PER_ROW * 60; k++) {
    const i = k % PER_ROW
    const row = Math.floor(k / PER_ROW)
    const offset = i === 0 ? 0 : i % 2 === 1 ? (i + 1) / 2 : -i / 2
    const box = { x: cx + offset * CELL_W, y: top + row * CELL_H, ...size }
    if (isFree(box, occupied, 8)) return { x: box.x, y: box.y }
  }
  return freeSpot(occupied, { x: cx, y: top }, size)
}
