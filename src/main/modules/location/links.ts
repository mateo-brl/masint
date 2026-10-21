// Liens cartographiques pour un lieu : Google Maps, Street View, OpenStreetMap et Mapillary
// (imagerie au sol). Hors ligne : les liens sont construits à partir des coordonnées ou du libellé.

import { defineModule, type ModuleContext, type OutEntity } from '@shared/modules'
import { pointOf, type GeoPoint } from './_geo'

export function mapLinks(label: string, p: GeoPoint | null): Array<{ engine: string; url: string }> {
  if (!p) {
    const q = encodeURIComponent(label.trim())
    return [
      { engine: 'Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${q}` },
      { engine: 'OpenStreetMap', url: `https://www.openstreetmap.org/search?query=${q}` }
    ]
  }
  const lat = p.lat.toFixed(6)
  const lon = p.lon.toFixed(6)
  return [
    { engine: 'Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` },
    { engine: 'Google Street View', url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}` },
    { engine: 'OpenStreetMap', url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}` },
    { engine: 'Mapillary', url: `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=17` }
  ]
}

export function linkEntities(ctx: Pick<ModuleContext, 'lang'>, label: string, p: GeoPoint | null): OutEntity[] {
  const subject = p ? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` : label.trim()
  return mapLinks(label, p).map((l) => ({
    type: 'search_link',
    label: `${l.engine} · ${subject}`,
    data: { url: l.url, engine: l.engine },
    linkLabel: ctx.lang === 'fr' ? 'voir sur la carte' : 'view on map'
  }))
}

export default defineModule({
  id: 'location.map_links',
  name: { fr: 'Liens cartographiques', en: 'Map links' },
  description: {
    fr: "Liens Google Maps, Street View, OpenStreetMap et Mapillary (photos de rue) vers le lieu, à partir de ses coordonnées ou de son libellé. Hors ligne.",
    en: 'Google Maps, Street View, OpenStreetMap and Mapillary (street-level photos) links to the place, from its coordinates or label. Offline.'
  },
  category: 'location',
  inputTypes: ['address', 'city', 'place', 'coordinates'],
  async run(input, ctx) {
    const p = pointOf(input.label, input.data)
    if (!p && input.label.trim().length < 2) return {}
    return { entities: linkEntities(ctx, input.label, p) }
  }
})
