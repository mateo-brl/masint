// Liens cartographiques pour un lieu : Google Maps, Street View, OpenStreetMap et Mapillary
// (imagerie au sol), rangés dans la fiche du lieu plutôt que dans le graphe. Hors ligne : les
// liens sont construits à partir des coordonnées ou du libellé.

import { defineModule } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { pointOf, type GeoPoint } from './_geo'

export function mapLinks(label: string, p: GeoPoint | null): Record<string, PropValue> {
  if (!p) {
    const q = encodeURIComponent(label.trim())
    return {
      google_maps_url: `https://www.google.com/maps/search/?api=1&query=${q}`,
      osm_map_url: `https://www.openstreetmap.org/search?query=${q}`
    }
  }
  const lat = p.lat.toFixed(6)
  const lon = p.lon.toFixed(6)
  return {
    google_maps_url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    street_view_url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`,
    osm_map_url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`,
    mapillary_url: `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=17`
  }
}

export default defineModule({
  id: 'location.map_links',
  name: { fr: 'Liens cartographiques', en: 'Map links' },
  description: {
    fr: 'Ajoute à la fiche du lieu des liens Google Maps, Street View, OpenStreetMap et Mapillary (photos de rue), à partir de ses coordonnées ou de son libellé. Hors ligne.',
    en: 'Adds Google Maps, Street View, OpenStreetMap and Mapillary (street-level photos) links to the place record, from its coordinates or label. Offline.'
  },
  category: 'location',
  inputTypes: ['address', 'city', 'place', 'coordinates'],
  async run(input) {
    const p = pointOf(input.label, input.data)
    if (!p && input.label.trim().length < 2) return {}
    return { properties: mapLinks(input.label, p) }
  }
})
