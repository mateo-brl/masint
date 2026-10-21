// Métadonnées EXIF, XMP et IPTC d'une photo (exifr, hors ligne) : date de prise de vue,
// appareil et numéro de série, logiciel, auteur, position GPS.

import exifr from 'exifr'
import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, tr, uniq } from '../misc/_util'
import { loadImage, publicUrl } from './_load'

type Tags = Record<string, unknown>

const EDITORS = /photoshop|lightroom|gimp|snapseed|picsart|affinity|pixelmator|canva|facetune|vsco|capture one|luminar|paint\.net|darktable|faceapp|meitu|remini/i

/** `2023:06:14 21:37:12` (+ décalage `+02:00`) → `2023-06-14T21:37:12+02:00`. */
export function exifDate(v: unknown, offset?: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m || m[1] === '0000') return null
  const off = typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : ''
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${off}`
}

function gpsDate(t: Tags): string | null {
  const d = typeof t.GPSDateStamp === 'string' ? t.GPSDateStamp.match(/^(\d{4}):(\d{2}):(\d{2})$/) : null
  const time = Array.isArray(t.GPSTimeStamp) ? (t.GPSTimeStamp as number[]) : null
  if (!d || !time || time.length < 3) return null
  const pad = (n: number): string => String(Math.floor(n)).padStart(2, '0')
  return `${d[1]}-${d[2]}-${d[3]}T${pad(time[0])}:${pad(time[1])}:${pad(time[2])}Z`
}

const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.replace(/\0/g, '').trim() || null
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return (v as string[]).join(', ') || null
  if (v && typeof v === 'object' && 'value' in v && typeof (v as { value: unknown }).value === 'string') return (v as { value: string }).value
  return null
}

const list = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(str).filter((s): s is string => !!s)
  const s = str(v)
  return s ? s.split(/[;,]\s*/).filter(Boolean) : []
}

const first = (t: Tags, keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(t[k])
    if (v) return v
  }
  return null
}

/** Arrondi à 6 décimales (~10 cm), sans zéros superflus. */
const coord = (n: number): number => Number(n.toFixed(6))

export function exifOutput(ctx: Pick<ModuleContext, 'lang'>, t: Tags | null | undefined): ModuleOutput {
  if (!t || !Object.keys(t).length) return {}
  const make = first(t, ['Make'])
  const model = first(t, ['Model'])
  const camera = model ? (make && !model.toLowerCase().startsWith(make.split(' ')[0].toLowerCase()) ? `${make} ${model}` : model) : make
  const serial = first(t, ['SerialNumber', 'BodySerialNumber', 'InternalSerialNumber', 'CameraSerialNumber'])
  const software = first(t, ['Software', 'CreatorTool', 'ProcessingSoftware', 'HistorySoftwareAgent'])
  const lat = typeof t.latitude === 'number' && Number.isFinite(t.latitude) ? coord(t.latitude) : null
  const lon = typeof t.longitude === 'number' && Number.isFinite(t.longitude) ? coord(t.longitude) : null
  const altitude = typeof t.GPSAltitude === 'number' ? Math.round(t.GPSAltitude * 10) / 10 : null
  const authors = uniq([first(t, ['Artist']), first(t, ['XPAuthor']), first(t, ['Byline']), ...list(t.creator)].filter((s): s is string => !!s))
  const owner = first(t, ['OwnerName', 'CameraOwnerName'])

  const properties: Record<string, PropValue> = {
    taken_at: exifDate(t.DateTimeOriginal, t.OffsetTimeOriginal) ?? exifDate(t.CreateDate, t.OffsetTimeDigitized),
    modified_at: exifDate(t.ModifyDate, t.OffsetTime),
    gps_fix_at: gpsDate(t),
    camera,
    lens: first(t, ['LensModel', 'Lens', 'LensMake']),
    serial_number: serial,
    lens_serial_number: first(t, ['LensSerialNumber']),
    camera_owner: owner,
    software,
    edited: software ? EDITORS.test(software) : null,
    artist: authors.length ? authors.join(', ') : null,
    copyright: first(t, ['Copyright', 'CopyrightNotice', 'rights']),
    description: first(t, ['ImageDescription', 'XPTitle', 'Caption', 'description', 'title']),
    keywords: uniq([...list(t.Keywords), ...list(t.XPKeywords), ...list(t.subject)]),
    width: (t.ExifImageWidth ?? t.ImageWidth ?? t.PixelXDimension ?? null) as number | null,
    height: (t.ExifImageHeight ?? t.ImageHeight ?? t.PixelYDimension ?? null) as number | null,
    orientation: str(t.Orientation),
    lat,
    lon,
    altitude,
    iptc_location: [first(t, ['Sublocation']), first(t, ['City']), first(t, ['State', 'ProvinceState']), first(t, ['Country', 'CountryName'])]
      .filter(Boolean)
      .join(', ') || null
  }

  const entities: OutEntity[] = []
  if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
    entities.push({
      type: 'coordinates',
      label: `${lat}, ${lon}`,
      data: { lat, lon, altitude },
      linkLabel: tr(ctx, 'position GPS (EXIF)', 'GPS position (EXIF)')
    })
  }
  if (serial) {
    entities.push({
      type: 'device',
      label: `${camera ?? tr(ctx, 'Appareil photo', 'Camera')} (S/N ${serial})`,
      data: { model: camera, serial_number: serial, owner },
      linkLabel: tr(ctx, 'prise avec', 'taken with')
    })
  }
  for (const a of authors) entities.push({ type: 'person', label: a, linkLabel: tr(ctx, 'auteur (métadonnées)', 'author (metadata)') })
  if (owner && !authors.includes(owner)) {
    entities.push({ type: 'person', label: owner, linkLabel: tr(ctx, "propriétaire de l'appareil", 'camera owner') })
  }

  // Les valeurs binaires ne sont pas archivées.
  const raw = Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v !== 'object' || Array.isArray(v)))
  return { properties: compact(properties), entities, raw }
}

export async function readTags(data: Buffer): Promise<Tags | null> {
  return (await exifr.parse(data, {
    tiff: true,
    exif: true,
    gps: true,
    xmp: true,
    iptc: true,
    icc: false,
    interop: false,
    makerNote: false,
    userComment: true,
    mergeOutput: true,
    reviveValues: false
  })) as Tags | null
}

export default defineModule({
  id: 'image.exif',
  name: { fr: 'Métadonnées de la photo (EXIF)', en: 'Photo metadata (EXIF)' },
  description: {
    fr: "Lit les métadonnées EXIF, XMP et IPTC : date de prise de vue, appareil, objectif, numéro de série, logiciel de retouche, auteur et position GPS (ajoutée sur la carte). Hors ligne pour une photo importée.",
    en: 'Reads EXIF, XMP and IPTC metadata: capture date, camera, lens, serial number, editing software, author and GPS position (added to the map). Offline for an imported photo.'
  },
  category: 'image',
  inputTypes: ['photo'],
  accepts: (input) => !!input.imageId || !!publicUrl(input),
  async run(input, ctx) {
    const img = await loadImage(input, ctx)
    if (!img) return {}
    let tags: Tags | null
    try {
      tags = await readTags(img.data)
    } catch {
      // Format non pris en charge ou fichier sans métadonnées.
      return {}
    }
    return exifOutput(ctx, tags)
  }
})
