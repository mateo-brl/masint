// Cadastre (API Carto de l'IGN) : parcelle sous un point, avec sa section et sa contenance.
// Le plan cadastral ne donne aucun propriétaire, et aucun module n'en cherche.

import type { ModuleContext } from '@shared/modules'
import { getJson, num } from '../misc/_util'
import type { GeoPoint } from './_geo'

export const CADASTRE_API = 'https://apicarto.ign.fr/api/cadastre/parcelle'
/** Le point BAN d'un numéro est souvent posé sur la voie : on cherche alors la parcelle la plus proche. */
const NEAR_M = 15

export interface CadastreFeature {
  geometry?: { type: string; coordinates: number[][][][] } | null
  properties: {
    idu?: string
    section?: string
    numero?: string
    contenance?: number | string
    code_insee?: string
    nom_com?: string
  }
}

export interface CadastreCollection {
  features?: CadastreFeature[]
}

export interface Parcel {
  /** Identifiant national à 14 caractères (`80021000VD0067`). */
  idu: string
  section: string
  number: string
  /** Contenance en m². */
  area: number | null
  /** Code commune de l'IDU : l'arrondissement à Paris, Lyon et Marseille (75104), comme dans DVF. */
  insee: string
  /** Code de la commune entière (75056), comme dans Sitadel. */
  communeInsee: string
  dep: string
  commune: string | null
  /** Distance du point à la parcelle quand le point tombe hors de toute parcelle (voie publique). */
  distance: number | null
}

export function parseParcel(f: CadastreFeature | undefined, distance: number | null = null): Parcel | null {
  const p = f?.properties
  if (!p?.idu || !p.section || !p.numero) return null
  const insee = p.idu.slice(0, 5)
  return {
    idu: p.idu,
    section: p.section,
    number: p.numero,
    area: num(p.contenance),
    insee,
    communeInsee: p.code_insee ?? insee,
    // Départements d'outre-mer : code à trois chiffres (971...).
    dep: insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2),
    commune: p.nom_com ?? null,
    distance
  }
}

/** Distance en mètres d'un point au contour d'une parcelle (projection locale, suffisante à 100 m). */
export function distanceToParcel(f: CadastreFeature, p: GeoPoint): number | null {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180)
  const ky = 110_574
  let best: number | null = null
  for (const ring of f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : []) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const ax = (ring[i][0] - p.lon) * kx
      const ay = (ring[i][1] - p.lat) * ky
      const bx = (ring[i + 1][0] - p.lon) * kx
      const by = (ring[i + 1][1] - p.lat) * ky
      const dx = bx - ax
      const dy = by - ay
      const len = dx * dx + dy * dy
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
      const d = Math.hypot(ax + t * dx, ay + t * dy)
      if (best === null || d < best) best = d
    }
  }
  return best === null ? null : Math.round(best)
}

/** Parcelle la plus proche parmi celles d'un petit carré autour du point. */
export function nearestParcel(c: CadastreCollection | null, p: GeoPoint): Parcel | null {
  let best: { f: CadastreFeature; d: number } | null = null
  for (const f of c?.features ?? []) {
    const d = distanceToParcel(f, p)
    if (d !== null && (!best || d < best.d)) best = { f, d }
  }
  return best ? parseParcel(best.f, best.d) : null
}

function square(p: GeoPoint, meters: number): object {
  const dy = meters / 110_574
  const dx = meters / (111_320 * Math.cos((p.lat * Math.PI) / 180))
  const ring = [
    [p.lon - dx, p.lat - dy],
    [p.lon + dx, p.lat - dy],
    [p.lon + dx, p.lat + dy],
    [p.lon - dx, p.lat + dy],
    [p.lon - dx, p.lat - dy]
  ].map(([x, y]) => [Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7])
  return { type: 'Polygon', coordinates: [ring] }
}

export async function parcelAt(ctx: ModuleContext, p: GeoPoint): Promise<Parcel | null> {
  const get = (geom: object): Promise<CadastreCollection | null> =>
    getJson<CadastreCollection>(ctx, CADASTRE_API, 'Cadastre (API Carto IGN)', { query: { geom: JSON.stringify(geom) }, timeoutMs: 30000 })
  const under = parseParcel((await get({ type: 'Point', coordinates: [p.lon, p.lat] }))?.features?.[0])
  if (under) return under
  return nearestParcel(await get(square(p, NEAR_M)), p)
}
