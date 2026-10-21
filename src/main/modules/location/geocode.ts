// Géocodage d'une adresse, d'une ville ou d'un lieu : coordonnées et adresse normalisée.
// France : Base Adresse Nationale (Géoplateforme IGN) ; ailleurs ou à défaut : Nominatim.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { compact, tr } from '../misc/_util'
import { geopfSearch, looksFrench, nominatimSearch, type GeoResult } from './_geo'

const MIN_BAN_SCORE = 0.5

const simplify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export function geocodeOutput(ctx: Pick<ModuleContext, 'lang'>, type: string, label: string, r: GeoResult): ModuleOutput {
  const properties: ModuleOutput['properties'] = {
    lat: r.lat,
    lon: r.lon,
    normalized: r.label,
    country: r.country,
    country_code: r.countryCode,
    region: r.region,
    geocoder: r.source === 'ign' ? 'Base Adresse Nationale (IGN)' : 'Nominatim (OpenStreetMap)',
    geocode_score: r.score !== null ? Math.round(r.score * 1000) / 1000 : null,
    osm_url: r.url
  }
  if (type !== 'city') {
    properties.street = r.street
    properties.postcode = r.postcode
    properties.city = r.city
  } else if (r.postcode) properties.postcode = r.postcode
  if (r.kind) properties.kind = r.kind
  for (const [k, v] of Object.entries(r.extra ?? {})) if (v !== null && k !== 'name') properties[k] = v

  const entities: OutEntity[] = []
  // Une adresse ou un lieu est rattaché à sa ville (pivot entre entités d'une même commune).
  if (type !== 'city' && r.city && r.city.toLowerCase() !== label.trim().toLowerCase()) {
    entities.push({
      type: 'city',
      label: r.city,
      data: { country: r.country, postcode: r.postcode },
      linkLabel: tr(ctx, 'ville', 'city')
    })
  }
  return { properties: compact(properties!), entities, raw: r }
}

export default defineModule({
  id: 'location.geocode',
  name: { fr: 'Géocodage (BAN / OpenStreetMap)', en: 'Geocoding (BAN / OpenStreetMap)' },
  description: {
    fr: "Coordonnées GPS et adresse normalisée d'une adresse, d'une ville ou d'un lieu, pour l'afficher sur la carte. Base Adresse Nationale pour la France, Nominatim (OpenStreetMap) ailleurs.",
    en: 'GPS coordinates and normalized address of an address, city or place, to show it on the map. French National Address Base for France, Nominatim (OpenStreetMap) elsewhere.'
  },
  category: 'location',
  inputTypes: ['address', 'city', 'place'],
  homepage: 'https://nominatim.openstreetmap.org',
  async run(input, ctx) {
    const q = input.label.trim()
    if (q.length < 2) return {}
    let r: GeoResult | null = null
    const country = String(input.data.country ?? '')
    const french = looksFrench(q) || /^(france|fr)$/i.test(country) || (input.type === 'city' && !country)
    if (french && input.type !== 'place') {
      r = await geopfSearch(ctx, q, input.type === 'city' ? 'municipality' : undefined)
      if (r && (r.score ?? 0) < MIN_BAN_SCORE) r = null
      // Une ville n'est retenue que si la commune trouvée porte exactement ce nom.
      if (r && input.type === 'city' && simplify(r.city ?? '') !== simplify(q)) r = null
    }
    if (!r) {
      const query = country && !q.toLowerCase().includes(country.toLowerCase()) ? `${q}, ${country}` : q
      r = await nominatimSearch(ctx, query, input.type === 'city' ? 'city' : undefined)
    }
    if (!r) return {}
    return geocodeOutput(ctx, input.type, q, r)
  }
})
