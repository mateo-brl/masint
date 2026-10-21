// Carte : extraction des entités géolocalisées, fonds de carte et regroupement des marqueurs.

import type { GraphNode } from '@shared/types'

export interface GeoPoint {
  id: string
  lat: number
  lon: number
  node: GraphNode
}

function coord(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}

const cache = new WeakMap<GraphNode, GeoPoint | null>()

/** Position d'une entité (`data.lat` / `data.lon`), mise en cache par référence de nœud. */
export function geoPoint(n: GraphNode): GeoPoint | null {
  if (cache.has(n)) return cache.get(n)!
  let p: GeoPoint | null = null
  if (n.kind === 'entity') {
    const lat = coord(n.data.lat)
    const lon = coord(n.data.lon)
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
      p = { id: n.id, lat, lon, node: n }
    }
  }
  cache.set(n, p)
  return p
}

export function geoPoints(nodes: GraphNode[]): GeoPoint[] {
  const out: GeoPoint[] = []
  for (const n of nodes) {
    const p = geoPoint(n)
    if (p) out.push(p)
  }
  return out
}

// ---------------------------------------------------------------------------
// Fonds de carte (hôtes autorisés par la CSP de l'interface). Les fonds CARTO
// exigent désormais une clé : les fonds gris d'Esri les remplacent.

export type BasemapId = 'dark' | 'light' | 'osm' | 'satellite'

export interface Basemap {
  id: BasemapId
  url: string
  /** Couche de libellés posée au-dessus du fond. */
  overlay?: string
  attribution: string
  subdomains?: string
  maxZoom: number
  maxNativeZoom?: number
  /** Le fond est déjà sombre ou photographique : pas de filtre d'inversion en thème sombre. */
  raw: boolean
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const ESRI_CANVAS_ATTR = `Tiles &copy; Esri, HERE, Garmin, ${OSM_ATTR}`

export const BASEMAPS: Basemap[] = [
  {
    id: 'dark',
    url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlay: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_CANVAS_ATTR,
    maxZoom: 19,
    maxNativeZoom: 16,
    raw: true
  },
  {
    id: 'light',
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlay: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_CANVAS_ATTR,
    maxZoom: 19,
    maxNativeZoom: 16,
    raw: true
  },
  {
    id: 'osm',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    subdomains: 'abc',
    maxZoom: 19,
    raw: false
  },
  {
    id: 'satellite',
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    maxNativeZoom: 18,
    raw: true
  }
]

export function getBasemap(id: unknown, theme: 'dark' | 'light' | undefined): Basemap {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS.find((b) => b.id === (theme === 'light' ? 'light' : 'dark'))!
}

// Préférence de fond mémorisée par thème (purement locale).
const storeKey = (theme: 'dark' | 'light' | undefined): string => `masint.map.basemap.${theme ?? 'dark'}`

export function loadBasemapPref(theme: 'dark' | 'light' | undefined): BasemapId | null {
  try {
    const v = localStorage.getItem(storeKey(theme))
    return BASEMAPS.some((b) => b.id === v) ? (v as BasemapId) : null
  } catch {
    return null
  }
}

export function saveBasemapPref(theme: 'dark' | 'light' | undefined, id: BasemapId): void {
  try {
    localStorage.setItem(storeKey(theme), id)
  } catch {
    // Préférence purement locale : on ignore l'échec.
  }
}

// ---------------------------------------------------------------------------
// Regroupement des marqueurs proches (grille en pixels au zoom courant)

export interface GeoCluster {
  key: string
  lat: number
  lon: number
  points: GeoPoint[]
}

export function clusterPoints(
  points: GeoPoint[],
  project: (lat: number, lon: number) => { x: number; y: number },
  cell: number,
  keepApart: Set<string>
): GeoCluster[] {
  const buckets = new Map<string, GeoPoint[]>()
  const out: GeoCluster[] = []
  for (const p of points) {
    if (keepApart.has(p.id)) {
      out.push({ key: p.id, lat: p.lat, lon: p.lon, points: [p] })
      continue
    }
    const { x, y } = project(p.lat, p.lon)
    const k = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`
    const list = buckets.get(k)
    if (list) list.push(p)
    else buckets.set(k, [p])
  }
  for (const [k, list] of buckets) {
    if (list.length === 1) {
      out.push({ key: list[0].id, lat: list[0].lat, lon: list[0].lon, points: list })
      continue
    }
    const lat = list.reduce((s, p) => s + p.lat, 0) / list.length
    const lon = list.reduce((s, p) => s + p.lon, 0) / list.length
    out.push({ key: `c:${k}:${list.length}`, lat, lon, points: list })
  }
  return out
}

export function formatCoord(lat: number, lon: number, digits = 4): string {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`
}
