// Géocodage : Géoplateforme IGN (Base Adresse Nationale, France, gratuit) et Nominatim
// (OpenStreetMap, monde). Nominatim impose un User-Agent identifiable et au plus
// une requête par seconde : les appels sont sérialisés ici pour tous les modules.

import type { ModuleContext } from '@shared/modules'
import { getJson, num } from '../misc/_util'

export const GEOPF = 'https://data.geopf.fr/geocodage'
export const NOMINATIM = 'https://nominatim.openstreetmap.org'
export const NOMINATIM_UA = 'MASINT/0.1 (OSINT desktop app; +https://github.com/mateo-brl/masint)'

export interface GeoPoint {
  lat: number
  lon: number
}

export interface GeoResult extends GeoPoint {
  label: string
  street: string | null
  postcode: string | null
  city: string | null
  country: string | null
  countryCode: string | null
  region: string | null
  kind: string | null
  score: number | null
  source: 'ign' | 'nominatim'
  url: string | null
  /** Distance au point demandé (géocodage inverse), en mètres. */
  distance?: number | null
  extra?: Record<string, string | number | null>
}

/** Coordonnées saisies sous la forme `48.8566, 2.3522` (ou `48.8566 2.3522`). */
export function parseCoords(s: string): GeoPoint | null {
  const m = s.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1].replace(',', '.'))
  const lon = Number(m[2].replace(',', '.'))
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/** Point d'une entité : propriétés `lat`/`lon`, sinon libellé en coordonnées. */
export function pointOf(label: string, data: Record<string, unknown>): GeoPoint | null {
  const lat = num(data.lat)
  const lon = num(data.lon)
  if (lat !== null && lon !== null) return { lat, lon }
  return parseCoords(label)
}

/** France métropolitaine et Corse (pour choisir la BAN en géocodage inverse). */
export function inFrance(p: GeoPoint): boolean {
  return p.lat > 41.3 && p.lat < 51.2 && p.lon > -5.3 && p.lon < 9.7
}

const FR_HINT = /\b(\d{5}|france|rue|avenue|av\.|boulevard|bd|chemin|allée|allee|impasse|place|quai|route|cours|lieu-dit|cedex)\b/i
const FOREIGN_HINT = /\b(street|st\.|road|rd\.|strasse|straße|calle|via|deutschland|germany|spain|españa|italia|italy|belgique|belgium|suisse|switzerland|uk|usa|united)\b/i

export function looksFrench(q: string): boolean {
  return FR_HINT.test(q) && !FOREIGN_HINT.test(q)
}

// ---------------------------------------------------------------------------
// Géoplateforme IGN

export interface GeopfFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    label: string
    /** Identifiant BAN au numéro près (`75104_8249_00010`) : clé des DPE de l'ADEME. */
    id?: string
    score?: number
    type?: string
    name?: string
    housenumber?: string
    street?: string
    postcode?: string
    city?: string
    citycode?: string
    district?: string | null
    context?: string
    distance?: number
    population?: number
  }
}

/** Le libellé BAN colle l'arrondissement à la ville (« 75007 Paris,Paris 7e Arrondissement »). */
export function cleanBanLabel(label: string): string {
  return label
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseGeopf(f: GeopfFeature): GeoResult {
  const p = f.properties
  const ctx = (p.context ?? '').split(',').map((s) => s.trim())
  const street = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.street ?? (p.type === 'street' ? (p.name ?? null) : null))
  return {
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    label: cleanBanLabel(p.label),
    street,
    postcode: p.postcode ?? null,
    city: p.city ?? null,
    country: 'France',
    countryCode: 'FR',
    region: ctx[2] ?? null,
    kind: p.type ?? null,
    score: p.score ?? null,
    source: 'ign',
    url: null,
    distance: p.distance ?? null,
    extra: {
      ban_id: p.type === 'housenumber' ? (p.id ?? null) : null,
      citycode: p.citycode ?? null,
      district: p.district ?? null,
      department: ctx[1] ? `${ctx[1]} (${ctx[0]})` : null,
      population: p.type === 'municipality' ? (p.population ?? null) : null
    }
  }
}

export async function geopfSearch(ctx: ModuleContext, q: string, type?: string): Promise<GeoResult | null> {
  const d = await getJson<{ features: GeopfFeature[] }>(ctx, `${GEOPF}/search`, 'Géoplateforme IGN', {
    query: { q, limit: 1, type, autocomplete: 0 }
  })
  const f = d?.features?.[0]
  return f ? parseGeopf(f) : null
}

export async function geopfReverse(ctx: ModuleContext, p: GeoPoint): Promise<GeoResult | null> {
  const d = await getJson<{ features: GeopfFeature[] }>(ctx, `${GEOPF}/reverse`, 'Géoplateforme IGN', {
    query: { lat: p.lat, lon: p.lon, limit: 1 }
  })
  const f = d?.features?.[0]
  return f ? parseGeopf(f) : null
}

// ---------------------------------------------------------------------------
// Nominatim

export interface NominatimPlace {
  lat: string
  lon: string
  display_name: string
  name?: string
  category?: string
  type?: string
  addresstype?: string
  importance?: number
  osm_type?: string
  osm_id?: number
  address?: Record<string, string>
  error?: string
}

export function parseNominatim(n: NominatimPlace): GeoResult {
  const a = n.address ?? {}
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? null
  const road = a.road ?? a.pedestrian ?? a.footway ?? null
  return {
    lat: Number(n.lat),
    lon: Number(n.lon),
    label: n.display_name,
    street: road ? [a.house_number, road].filter(Boolean).join(' ') : null,
    postcode: a.postcode ?? null,
    city,
    country: a.country ?? null,
    countryCode: a.country_code ? a.country_code.toUpperCase() : null,
    region: a.state ?? a.region ?? null,
    kind: [n.category, n.type].filter(Boolean).join(':') || null,
    score: n.importance ?? null,
    source: 'nominatim',
    url: n.osm_type && n.osm_id ? `https://www.openstreetmap.org/${n.osm_type}/${n.osm_id}` : null,
    extra: { name: n.name || null }
  }
}

let nextSlot = 0

/** Réserve un créneau d'une requête par seconde (politique d'usage de Nominatim). */
async function nominatimSlot(ctx: ModuleContext): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + 1100
  if (wait) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, wait)
      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t)
          reject(new Error('annulé'))
        },
        { once: true }
      )
    })
  }
}

const nominatimHeaders = (ctx: ModuleContext) => ({ 'user-agent': NOMINATIM_UA, 'accept-language': ctx.lang === 'fr' ? 'fr,en' : 'en' })

export async function nominatimSearch(ctx: ModuleContext, q: string, featureType?: string): Promise<GeoResult | null> {
  await nominatimSlot(ctx)
  const list = await getJson<NominatimPlace[]>(ctx, `${NOMINATIM}/search`, 'Nominatim', {
    query: { q, format: 'jsonv2', addressdetails: 1, limit: 1, featureType },
    headers: nominatimHeaders(ctx)
  })
  return list?.[0] ? parseNominatim(list[0]) : null
}

export async function nominatimReverse(ctx: ModuleContext, p: GeoPoint): Promise<GeoResult | null> {
  await nominatimSlot(ctx)
  const n = await getJson<NominatimPlace>(ctx, `${NOMINATIM}/reverse`, 'Nominatim', {
    query: { lat: p.lat, lon: p.lon, format: 'jsonv2', addressdetails: 1, zoom: 18 },
    headers: nominatimHeaders(ctx)
  })
  return n && !n.error ? parseNominatim(n) : null
}

/** Distance en mètres entre deux points (formule de haversine). */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000
  const rad = (d: number): number => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}
