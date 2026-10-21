// Géocodage inverse de coordonnées GPS : adresse la plus proche.
// France : Base Adresse Nationale (IGN) ; ailleurs ou à défaut : Nominatim.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import { localizeCountry } from '../domain/_util'
import { compact, tr } from '../misc/_util'
import { distanceM, geopfReverse, inFrance, nominatimReverse, pointOf, type GeoPoint, type GeoResult } from './_geo'

/** Au-delà, l'adresse BAN est trop éloignée : on interroge OpenStreetMap. */
const MAX_BAN_DISTANCE = 300

export function reverseOutput(ctx: Pick<ModuleContext, 'lang'>, p: GeoPoint, r: GeoResult): ModuleOutput {
  const distance = r.distance ?? distanceM(p, r)
  const country = localizeCountry(r.country, r.countryCode, ctx.lang)
  return {
    properties: compact({
      lat: p.lat,
      lon: p.lon,
      address: r.label,
      city: r.city,
      postcode: r.postcode,
      country,
      region: r.region,
      district: typeof r.extra?.district === 'string' ? r.extra.district : null,
      osm_url: r.url
    }),
    entities: [
      {
        type: 'address',
        label: r.label,
        data: { street: r.street, postcode: r.postcode, city: r.city, country, lat: r.lat, lon: r.lon, distance_m: distance },
        linkLabel: distance > 50 ? tr(ctx, `adresse proche (${distance} m)`, `nearby address (${distance} m)`) : tr(ctx, 'adresse', 'address')
      }
    ],
    raw: r
  }
}

export default defineModule({
  id: 'location.reverse',
  name: { fr: 'Géocodage inverse', en: 'Reverse geocoding' },
  description: {
    fr: "Adresse la plus proche de coordonnées GPS, avec la distance. Base Adresse Nationale en France, Nominatim (OpenStreetMap) ailleurs.",
    en: 'Nearest address to GPS coordinates, with the distance. French National Address Base in France, Nominatim (OpenStreetMap) elsewhere.'
  },
  category: 'location',
  inputTypes: ['coordinates'],
  homepage: 'https://nominatim.openstreetmap.org',
  async run(input, ctx) {
    const p = pointOf(input.label, input.data)
    if (!p) throw new ModuleError('Coordonnées non reconnues (attendu : « latitude, longitude »)', 'invalid_input')
    let r: GeoResult | null = null
    if (inFrance(p)) {
      r = await geopfReverse(ctx, p)
      if (r && (r.distance ?? distanceM(p, r)) > MAX_BAN_DISTANCE) r = null
    }
    if (!r) r = await nominatimReverse(ctx, p)
    if (!r) return { properties: { lat: p.lat, lon: p.lon } }
    return reverseOutput(ctx, p, r)
  }
})
