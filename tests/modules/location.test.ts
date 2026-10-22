import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { distanceM, inFrance, looksFrench, parseCoords, parseGeopf, parseNominatim } from '../../src/main/modules/location/_geo'
import geocode, { geocodeOutput } from '../../src/main/modules/location/geocode'
import links from '../../src/main/modules/location/links'
import reverse, { reverseOutput } from '../../src/main/modules/location/reverse'
import { entity, LIVE, runModule } from '../helpers/context'

const json = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/location', name), 'utf8'))
const fr = { lang: 'fr' as const }

describe('location : outils', () => {
  it('lit les coordonnées et choisit le géocodeur', () => {
    expect(parseCoords('48.8566, 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 })
    expect(parseCoords('-33.8688 151.2093')).toEqual({ lat: -33.8688, lon: 151.2093 })
    expect(parseCoords('Paris')).toBeNull()
    expect(inFrance({ lat: 48.85, lon: 2.35 })).toBe(true)
    expect(inFrance({ lat: 52.5, lon: 13.4 })).toBe(false)
    expect(looksFrench('10 rue de Rivoli 75004 Paris')).toBe(true)
    expect(looksFrench('10 Downing Street, London')).toBe(false)
    expect(distanceM({ lat: 48.8566, lon: 2.3522 }, { lat: 48.856737, lon: 2.352092 })).toBeLessThan(25)
  })
})

describe('location.geocode (hors ligne)', () => {
  it('BAN : adresse française', () => {
    const r = parseGeopf(json('geopf_search.json').features[0])
    const out = geocodeOutput(fr, 'address', '10 rue de rivoli paris', r)
    expect(out.properties).toMatchObject({
      lat: 48.8555,
      lon: 2.36041,
      normalized: '10 Rue de Rivoli 75004 Paris',
      street: '10 Rue de Rivoli',
      postcode: '75004',
      city: 'Paris',
      country: 'France',
      citycode: '75104',
      department: 'Paris (75)',
      region: 'Île-de-France'
    })
    expect(out.entities?.[0]).toMatchObject({ type: 'city', label: 'Paris' })
  })

  it('BAN : commune', () => {
    const r = parseGeopf(json('geopf_city.json').features[0])
    const out = geocodeOutput(fr, 'city', 'Lyon', r)
    expect(out.properties).toMatchObject({ lat: 45.758, lon: 4.835, population: 519127 })
    expect(out.entities).toHaveLength(0)
  })

  it('Nominatim : lieu à l’étranger', () => {
    const r = parseNominatim(json('nominatim_search.json')[0])
    const out = geocodeOutput(fr, 'place', 'Brandenburger Tor Berlin', r)
    expect(out.properties).toMatchObject({ lat: 52.5162699, lon: 13.3777034, country_code: 'DE', city: 'Berlin', postcode: '10117' })
    expect(out.properties?.osm_url).toBe('https://www.openstreetmap.org/way/518071791')
  })
})

describe('location.reverse (hors ligne)', () => {
  it('BAN : adresse la plus proche', () => {
    const r = parseGeopf(json('geopf_reverse.json').features[0])
    const out = reverseOutput(fr, { lat: 48.8566, lon: 2.3522 }, r)
    expect(out.properties?.city).toBe('Paris')
    expect(out.entities?.[0]).toMatchObject({ type: 'address', linkLabel: 'adresse' })
    expect(out.entities?.[0].label).toMatch(/Place de l'Hôtel de Ville/)
  })

  it('Nominatim : distance calculée', () => {
    const r = parseNominatim(json('nominatim_reverse.json'))
    const out = reverseOutput(fr, { lat: 52.5163, lon: 13.3777 }, r)
    expect(out.entities?.[0].data?.distance_m).toBeLessThan(20)
    // Nom traduit depuis le code pays, quelle que soit la langue de la réponse Nominatim.
    expect(out.properties?.country).toBe('Allemagne')
  })
})

describe('location.map_links', () => {
  it('liens à partir des coordonnées, dans la fiche du lieu', async () => {
    const out = await runModule(links, entity('coordinates', '48.8566, 2.3522'))
    expect(out.entities).toBeUndefined()
    expect(Object.keys(out.properties!)).toEqual(['google_maps_url', 'street_view_url', 'osm_map_url', 'mapillary_url'])
    expect(out.properties?.street_view_url).toBe('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=48.856600,2.352200')
  })

  it('liens de recherche sans coordonnées', async () => {
    const out = await runModule(links, entity('address', '10 rue de Rivoli, Paris'))
    expect(Object.keys(out.properties!)).toEqual(['google_maps_url', 'osm_map_url'])
    expect(out.properties?.google_maps_url).toContain('query=10%20rue%20de%20Rivoli%2C%20Paris')
  })
})

describe.skipIf(!LIVE)('location : services réels', () => {
  it('BAN', async () => {
    const out = await runModule(geocode, entity('address', '10 rue de Rivoli 75004 Paris'))
    expect(out.properties?.geocoder).toMatch(/IGN/)
    expect(out.properties?.postcode).toBe('75004')
  })

  it('ville étrangère via Nominatim', async () => {
    const out = await runModule(geocode, entity('city', 'Berlin'))
    expect(out.properties?.geocoder).toMatch(/Nominatim/)
    expect(Number(out.properties?.lat)).toBeCloseTo(52.5, 0)
  })

  it('géocodage inverse en France et à l’étranger', async () => {
    const a = await runModule(reverse, entity('coordinates', '48.8566, 2.3522'))
    expect(a.properties?.city).toBe('Paris')
    const b = await runModule(reverse, entity('coordinates', '52.5163, 13.3777'))
    expect(b.properties?.city).toBe('Berlin')
  })
})
