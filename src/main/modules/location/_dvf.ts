// Demandes de valeurs foncières (DVF) : ventes immobilières publiées par la DGFiP, via l'API
// du Cerema (géométries des parcelles vendues) ou, à défaut, les fichiers geo-dvf d'Etalab.
// Article R112 A-3 du LPF : ces données ne doivent jamais servir à réidentifier une personne.
// Les ventes sont rattachées au bien (adresse, parcelle), jamais à une personne, et aucun
// propriétaire n'en est déduit.

import { ModuleError, type HttpError, type ModuleContext, type OutEntity } from '@shared/modules'
import { compact, num, serviceError } from '../misc/_util'
import { distanceToParcel } from './_cadastre'
import { distanceM, type GeoPoint } from './_geo'
import { bbox } from './_france'

export const DVF_API = 'https://apidf-preprod.cerema.fr/dvf_opendata/geomutations/'
export const GEO_DVF = 'https://files.data.gouv.fr/geo-dvf/latest/csv'
/** Distance maximale d'une parcelle voisine au point : les parcelles voisines immédiates. */
export const DVF_RADIUS_M = 50
export const MAX_SALES = 10
/** Les fichiers geo-dvf ne donnent que le centre de la parcelle : marge pour son étendue. */
const CSV_RADIUS_M = DVF_RADIUS_M + 30

export interface DvfFeature {
  geometry?: { type: string; coordinates: number[][][][] } | null
  properties: {
    idmutinvar?: string
    idopendata?: string
    datemut: string
    libnatmut?: string
    vefa?: boolean
    valeurfonc?: string | number | null
    l_idpar?: string[]
    sbati?: string | number | null
    sterr?: string | number | null
    libtypbien?: string | null
  }
}

export interface DvfCollection {
  count?: number
  features?: DvfFeature[]
}

/** Vente telle qu'on la présente : rattachée à des parcelles, sans aucune partie. */
export interface Sale {
  id: string
  date: string
  nature: string | null
  price: number | null
  type: string | null
  builtArea: number | null
  landArea: number | null
  parcels: string[]
  /** Adresse du bien quand la source la donne (fichiers geo-dvf). */
  address: string | null
  offPlan: boolean
  /** Distance du point à la parcelle vendue la plus proche, en mètres. */
  distance: number | null
  /** La vente porte sur la parcelle de l'adresse. */
  onParcel: boolean
}

/** Sommets d'une géométrie multipolygone (anneaux extérieurs et intérieurs confondus). */
function rings(f: DvfFeature): number[][][] {
  return f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : []
}

/**
 * L'API renvoie les mutations dont l'emprise totale croise le carré demandé : une vente de
 * parcelles éloignées les unes des autres peut donc remonter. On ne garde que celles dont une
 * parcelle au moins touche le carré.
 */
export function touchesBox(f: DvfFeature, box: [number, number, number, number]): boolean {
  const [w, s, e, n] = box
  return rings(f).some((ring) => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of ring) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    return minX <= e && maxX >= w && minY <= n && maxY >= s
  })
}

/** Distance du point au contour de la parcelle vendue la plus proche. */
function nearest(f: DvfFeature, p: GeoPoint): number | null {
  return distanceToParcel({ geometry: f.geometry, properties: {} }, p)
}

const amount = (v: unknown): number | null => {
  const n = num(v)
  return n === null ? null : Math.round(n)
}
const area = (v: unknown): number | null => {
  const n = num(v)
  return n ? Math.round(n) : null
}

/** Ventes du carré autour du point, la parcelle de l'adresse d'abord, puis les plus récentes. */
export function parseDvfApi(c: DvfCollection, p: GeoPoint, parcel: string | null): Sale[] {
  const box = bbox(p, DVF_RADIUS_M)
  return (c.features ?? [])
    .filter((f) => touchesBox(f, box))
    .map((f): Sale => {
      const q = f.properties
      const parcels = q.l_idpar ?? []
      return {
        id: q.idopendata ?? q.idmutinvar ?? `${q.datemut}-${q.valeurfonc}`,
        date: q.datemut,
        nature: q.libnatmut ?? null,
        price: amount(q.valeurfonc),
        type: q.libtypbien ? q.libtypbien.toLowerCase() : null,
        builtArea: area(q.sbati),
        landArea: area(q.sterr),
        parcels,
        address: null,
        offPlan: q.vefa === true,
        distance: nearest(f, p),
        onParcel: !!parcel && parcels.includes(parcel)
      }
    })
    .filter((s) => s.onParcel || (s.distance !== null && s.distance <= DVF_RADIUS_M))
    .sort(bySaleRelevance)
}

export function bySaleRelevance(a: Sale, b: Sale): number {
  if (a.onParcel !== b.onParcel) return a.onParcel ? -1 : 1
  return b.date.localeCompare(a.date)
}

// ---------------------------------------------------------------------------
// Repli : fichiers geo-dvf d'Etalab (une commune et une année par fichier)

/** Découpe une ligne CSV (guillemets doubles possibles). */
export function csvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * Ventes d'un fichier geo-dvf qui portent sur la parcelle ou sur une parcelle dont le centre est
 * à moins de `CSV_RADIUS_M` mètres. Une mutation occupe une ligne par local et par parcelle : on les
 * regroupe (surfaces additionnées, types distincts).
 */
export function parseGeoDvfCsv(csv: string, p: GeoPoint, parcel: string | null): Sale[] {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const head = csvLine(lines[0])
  const col = (name: string): number => head.indexOf(name)
  const c = {
    id: col('id_mutation'),
    date: col('date_mutation'),
    nature: col('nature_mutation'),
    price: col('valeur_fonciere'),
    num: col('adresse_numero'),
    suffix: col('adresse_suffixe'),
    street: col('adresse_nom_voie'),
    postcode: col('code_postal'),
    city: col('nom_commune'),
    parcel: col('id_parcelle'),
    type: col('type_local'),
    built: col('surface_reelle_bati'),
    land: col('surface_terrain'),
    lon: col('longitude'),
    lat: col('latitude')
  }
  if (c.id < 0 || c.parcel < 0) return []
  const sales = new Map<string, Sale & { types: Set<string>; lands: Set<string> }>()
  for (const line of lines.slice(1)) {
    const r = csvLine(line)
    const idpar = r[c.parcel]
    const lat = num(r[c.lat])
    const lon = num(r[c.lon])
    const d = lat !== null && lon !== null ? distanceM(p, { lat, lon }) : null
    const onParcel = !!parcel && idpar === parcel
    if (!onParcel && (d === null || d > CSV_RADIUS_M)) continue
    const id = r[c.id]
    let s = sales.get(id)
    if (!s) {
      const street = [r[c.num], r[c.suffix], r[c.street]].filter(Boolean).join(' ')
      s = {
        id,
        date: r[c.date],
        nature: r[c.nature] || null,
        price: amount(r[c.price]),
        type: null,
        builtArea: null,
        landArea: null,
        parcels: [],
        address: street ? `${street}, ${[r[c.postcode], r[c.city]].filter(Boolean).join(' ')}` : null,
        offPlan: /futur d'ach/i.test(r[c.nature] ?? ''),
        distance: d,
        onParcel: false,
        types: new Set(),
        lands: new Set()
      }
      sales.set(id, s)
    }
    if (!s.parcels.includes(idpar)) s.parcels.push(idpar)
    s.onParcel ||= onParcel
    if (d !== null && (s.distance === null || d < s.distance)) s.distance = d
    if (r[c.type]) s.types.add(r[c.type].toLowerCase())
    const built = area(r[c.built])
    if (built) s.builtArea = (s.builtArea ?? 0) + built
    // La surface du terrain est répétée sur chaque ligne de la parcelle : une fois par parcelle.
    const land = area(r[c.land])
    if (land && !s.lands.has(idpar)) {
      s.lands.add(idpar)
      s.landArea = (s.landArea ?? 0) + land
    }
  }
  return [...sales.values()]
    .map(({ types, lands: _lands, ...s }) => ({ ...s, type: types.size ? [...types].join(', ') : null }))
    .sort(bySaleRelevance)
}

/** Ventes autour du point : API du Cerema, ou fichiers geo-dvf si elle ne répond pas. */
export async function fetchSales(
  ctx: ModuleContext,
  p: GeoPoint,
  parcel: { idu: string; insee: string; dep: string } | null
): Promise<{ sales: Sale[]; source: string }> {
  const box = bbox(p, DVF_RADIUS_M)
  try {
    const c = await ctx.fetchJson<DvfCollection>(DVF_API, { query: { in_bbox: box.join(','), page_size: 300 }, timeoutMs: 45000 })
    return { sales: parseDvfApi(c, p, parcel?.idu ?? null), source: 'API DVF+ open-data (Cerema)' }
  } catch (e) {
    const status = (e as Partial<HttpError>)?.status
    if (status && status < 500 && status !== 429) throw serviceError(e, 'DVF (Cerema)')
    if (!parcel) throw serviceError(e, 'DVF (Cerema)')
    ctx.log(`API DVF indisponible (${status ?? (e as Error).message}) : repli sur les fichiers geo-dvf`)
  }
  // Repli : les deux derniers millésimes publiés de la commune.
  const year = new Date().getFullYear()
  const sales: Sale[] = []
  let read = 0
  for (const y of [year - 1, year - 2, year - 3]) {
    if (read === 2) break
    const url = `${GEO_DVF}/${y}/communes/${parcel.dep}/${parcel.insee}.csv`
    let csv: string
    try {
      csv = await ctx.fetchText(url, { timeoutMs: 60000 })
    } catch (e) {
      if ((e as Partial<HttpError>)?.status === 404) continue
      throw serviceError(e, 'DVF (geo-dvf)')
    }
    read++
    sales.push(...parseGeoDvfCsv(csv, p, parcel.idu))
  }
  if (!read) throw new ModuleError('DVF : ni l’API du Cerema ni les fichiers geo-dvf ne répondent', 'unavailable')
  return { sales: sales.sort(bySaleRelevance), source: 'geo-dvf (Etalab)' }
}

const frDate = (d: string): string => d.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1')
const euros = (n: number): string => `${n.toLocaleString('fr-FR').replace(/ | /g, ' ')} €`

/** Événement daté d'une vente, relié à l'adresse : jamais à une personne. */
export function saleEntity(s: Sale, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const what = [s.type, s.builtArea ? `${s.builtArea} m²` : null].filter(Boolean).join(', ')
  const price = s.price !== null ? euros(s.price) : fr ? 'prix non publié' : 'price not published'
  const label = fr
    ? `Vente du ${frDate(s.date)} : ${price}${what ? ` (${what})` : ''}`
    : `Sale of ${s.date}: ${price}${what ? ` (${what})` : ''}`
  return {
    type: 'event',
    label,
    data: compact({
      date: s.date,
      sale_nature: s.nature,
      price: s.price,
      property_type: s.type,
      built_area_m2: s.builtArea,
      land_area_m2: s.landArea,
      parcels: s.parcels.slice(0, 10),
      place: s.address,
      distance_m: s.onParcel ? null : s.distance,
      off_plan: s.offPlan || null,
      dvf_id: s.id,
      source: 'DVF (DGFiP)'
    }),
    linkLabel: s.onParcel
      ? fr
        ? 'vente de la parcelle'
        : 'sale of the parcel'
      : fr
        ? `vente voisine${s.distance !== null ? ` (${s.distance} m)` : ''}`
        : `nearby sale${s.distance !== null ? ` (${s.distance} m)` : ''}`
  }
}
