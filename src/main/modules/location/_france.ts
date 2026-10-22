// Point et adresse BAN d'une adresse ou de coordonnées françaises, pour les services qui
// travaillent sur un point : SIRENE géolocalisée, cadastre, DVF, DPE de l'ADEME.

import type { InputEntity, ModuleContext } from '@shared/modules'
import { num } from '../misc/_util'
import { distanceM, geopfReverse, geopfSearch, inFrance, looksFrench, pointOf, type GeoPoint, type GeoResult } from './_geo'

/** Score minimal d'un géocodage BAN pour qu'on s'y fie. */
const MIN_BAN_SCORE = 0.5
/** Au-delà, l'adresse BAN la plus proche de coordonnées n'est plus celle du point. */
const MAX_REVERSE_DISTANCE = 30

export interface FrenchPlace extends GeoPoint {
  /** Adresse normalisée (BAN) ou, à défaut, saisie telle quelle. */
  label: string
  /** Identifiant BAN au numéro près (`11069_0550_00025`), `null` hors numéro. */
  banId: string | null
  /** Code commune INSEE. */
  citycode: string | null
  housenumber: string | null
  /** Voie sans le numéro (« Rue de Belfort »). */
  street: string | null
  postcode: string | null
  city: string | null
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Numéro et voie d'une ligne d'adresse BAN (« 25 bis Rue de Belfort »). */
export function splitStreet(line: string | null): { housenumber: string | null; street: string | null } {
  if (!line) return { housenumber: null, street: null }
  const m = line.match(/^(\d+\s?(?:bis|ter|quater|[a-z])?)\s+(.+)$/i)
  return m ? { housenumber: m[1].replace(/\s+/g, '').toLowerCase(), street: m[2] } : { housenumber: null, street: line }
}

/** Lieu français tiré d'un résultat BAN. */
export function placeFromBan(r: GeoResult, point?: GeoPoint): FrenchPlace {
  const { housenumber, street } = splitStreet(r.kind === 'housenumber' ? r.street : null)
  return {
    lat: point?.lat ?? r.lat,
    lon: point?.lon ?? r.lon,
    label: r.label,
    banId: typeof r.extra?.ban_id === 'string' ? r.extra.ban_id : null,
    citycode: typeof r.extra?.citycode === 'string' ? r.extra.citycode : null,
    housenumber,
    street: street ?? r.street,
    postcode: r.postcode,
    city: r.city
  }
}

/**
 * Lieu français d'une entité adresse ou coordonnées, `null` hors de France ou si l'adresse
 * n'est pas reconnue par la BAN. Une adresse est géocodée (identifiant BAN, code commune) ;
 * des coordonnées gardent leur point et reçoivent l'adresse la plus proche si elle est à
 * moins de 30 m.
 */
export async function locateFrench(input: InputEntity, ctx: ModuleContext): Promise<FrenchPlace | null> {
  const known = pointOf(input.type === 'coordinates' ? input.label : '', input.data)
  if (input.type === 'coordinates') {
    if (!known || !inFrance(known)) return null
    const r = await geopfReverse(ctx, known)
    if (r && (r.distance ?? distanceM(known, r)) <= MAX_REVERSE_DISTANCE) return placeFromBan(r, known)
    return { ...known, label: input.label, banId: null, citycode: null, housenumber: null, street: null, postcode: null, city: null }
  }
  const country = text(input.data.country)
  if (country && !/^(france|fr)$/i.test(country)) return null
  const q = input.label.trim()
  const r = q.length >= 5 ? await geopfSearch(ctx, q) : null
  if (r && (r.score ?? 0) >= MIN_BAN_SCORE) return placeFromBan(r)
  // Adresse non reconnue par la BAN : on garde les coordonnées déjà connues, s'il y en a.
  if (known && inFrance(known)) {
    const { housenumber, street } = splitStreet(text(input.data.street))
    return {
      ...known,
      label: q,
      banId: text(input.data.ban_id),
      citycode: text(input.data.citycode),
      housenumber,
      street,
      postcode: text(input.data.postcode),
      city: text(input.data.city)
    }
  }
  return null
}

/** Le module n'est proposé que pour la France : pays de l'adresse, ou point en métropole. */
export function acceptsFrench(input: InputEntity): boolean {
  if (input.type === 'coordinates') {
    const p = pointOf(input.label, input.data)
    return !p || inFrance(p)
  }
  const country = text(input.data.country_code) ?? text(input.data.country)
  return !country || /^(france|fr)$/i.test(country)
}

/** Adresse introuvable : une erreur si elle a l'air française, sinon simplement rien. */
export function notFrench(input: InputEntity): boolean {
  return input.type === 'coordinates' || !looksFrench(input.label)
}

/** Coordonnées d'un champ texte (« 48.85, 2.35 ») ou numérique. */
export const coord = (v: unknown): number | null => num(typeof v === 'string' ? v.replace(',', '.') : v)

/** Rectangle `ouest,sud,est,nord` d'environ `meters` mètres autour d'un point. */
export function bbox(p: GeoPoint, meters: number): [number, number, number, number] {
  const dLat = meters / 111_320
  const dLon = meters / (111_320 * Math.cos((p.lat * Math.PI) / 180))
  const r = (x: number): number => Math.round(x * 1e6) / 1e6
  return [r(p.lon - dLon), r(p.lat - dLat), r(p.lon + dLon), r(p.lat + dLat)]
}

/** Texte comparable : majuscules sans accents ni ponctuation. */
export function plain(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

// Mots qui ne distinguent pas une voie (types de voie, articles), abrégés ou non dans SIRENE.
const STREET_NOISE = new Set([
  'RUE', 'R', 'AVENUE', 'AV', 'AVE', 'BOULEVARD', 'BD', 'BLVD', 'PLACE', 'PL', 'CHEMIN', 'CHE', 'CH', 'ALLEE', 'ALL',
  'IMPASSE', 'IMP', 'QUAI', 'ROUTE', 'RTE', 'COURS', 'CRS', 'ESPLANADE', 'ESP', 'PASSAGE', 'PAS', 'SQUARE', 'SQ',
  'FAUBOURG', 'FG', 'PROMENADE', 'PROM', 'LIEU', 'DIT', 'LD', 'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'L', 'D', 'ET', 'AU', 'AUX'
])

/** Mots significatifs d'un nom de voie. */
export function streetWords(street: string): string[] {
  return plain(street)
    .split(' ')
    .filter((w) => w.length > 1 && !STREET_NOISE.has(w) && !/^\d+$/.test(w))
}

/**
 * L'adresse SIRENE ou DVF (« 4 PL HOTEL VILLE ESP LIBERATION 75004 PARIS 04 ») désigne-t-elle
 * la même adresse que la BAN : même numéro, même code postal et tous les mots de la voie ?
 */
export function sameAddress(place: Pick<FrenchPlace, 'housenumber' | 'street' | 'postcode'>, other: string, otherPostcode?: string | null): boolean {
  if (!place.housenumber || !place.street) return false
  if (place.postcode && otherPostcode && place.postcode !== otherPostcode) return false
  const words = plain(other).split(' ')
  const number = place.housenumber.match(/^\d+/)?.[0]
  if (!number || words[0] !== number) return false
  const wanted = streetWords(place.street)
  return wanted.length > 0 && wanted.every((w) => words.includes(w))
}

/** Lieu d'un résultat : texte, coordonnées éventuelles. */
export function pointFrom(lat: unknown, lon: unknown): GeoPoint | null {
  const a = coord(lat)
  const b = coord(lon)
  return a !== null && b !== null ? { lat: a, lon: b } : null
}
