import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import exif, { exifDate, exifOutput, readTags } from '../../src/main/modules/image/exif'
import hashes from '../../src/main/modules/image/hashes'
import reverseSearch from '../../src/main/modules/image/reverseSearch'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const file = (name: string): Buffer => readFileSync(join(__dirname, '../fixtures/image', name))
const withAttachment = (name: string, mime: string) => ({
  ...makeContext(),
  attachment: async () => ({ mime, name, data: file(name) })
})
const photo = (extra = {}) => entity('photo', 'photo.jpg', { imageId: 'att1', ...extra })

describe('image.exif (hors ligne)', () => {
  it('convertit les dates EXIF', () => {
    expect(exifDate('2023:06:14 21:37:12', '+02:00')).toBe('2023-06-14T21:37:12+02:00')
    expect(exifDate('2023:06:14 21:37:12')).toBe('2023-06-14T21:37:12')
    expect(exifDate('0000:00:00 00:00:00')).toBeNull()
  })

  it('lit date, appareil, numéro de série, logiciel, auteur et GPS', async () => {
    const out = await runModule(exif, photo(), withAttachment('exif_gps.jpg', 'image/jpeg'))
    expect(out.properties).toMatchObject({
      taken_at: '2023-06-14T21:37:12+02:00',
      modified_at: '2023-06-15T18:00:00',
      gps_fix_at: '2023-06-14T19:37:12Z',
      camera: 'Canon EOS 5D Mark IV',
      lens: 'EF24-105mm f/4L IS USM',
      serial_number: '032021001234',
      camera_owner: 'Jean Dupont',
      software: 'Adobe Photoshop Lightroom Classic 12.0 (Windows)',
      edited: true,
      artist: 'Jean Dupont',
      description: 'Tour Eiffel',
      lat: 48.8584,
      lon: 2.2945,
      altitude: 35.5
    })
    const gps = out.entities!.find((e) => e.type === 'coordinates')!
    expect(gps.label).toBe('48.8584, 2.2945')
    expect(gps.data).toMatchObject({ lat: 48.8584, lon: 2.2945 })
    expect(out.entities!.find((e) => e.type === 'device')?.label).toBe('Canon EOS 5D Mark IV (S/N 032021001234)')
    expect(out.entities!.filter((e) => e.type === 'person').map((e) => e.label)).toEqual(['Jean Dupont'])
  })

  it('image sans EXIF : seulement les dimensions', async () => {
    const out = await runModule(exif, photo(), withAttachment('no_exif.png', 'image/png'))
    expect(out.properties).toEqual({ width: 16, height: 16 })
    expect(out.entities).toEqual([])
    expect(exifOutput({ lang: 'fr' }, null)).toEqual({})
    expect((await readTags(file('no_exif.png')))?.ImageWidth).toBe(16)
  })

  it('ne s’applique pas sans image ni URL', () => {
    expect(exif.accepts!(entity('photo', 'souvenir'))).toBe(false)
    expect(exif.accepts!(entity('photo', 'x', { data: { url: 'https://example.com/a.jpg' } }))).toBe(true)
  })
})

describe('image.hashes (hors ligne)', () => {
  it('calcule SHA-256, SHA-1 et MD5', async () => {
    const out = await runModule(hashes, photo(), withAttachment('no_exif.png', 'image/png'))
    expect(out.properties?.size).toBe(82)
    expect(out.properties?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(out.properties?.md5).toMatch(/^[0-9a-f]{32}$/)
    expect(out.entities?.map((e) => e.data?.algorithm)).toEqual(['SHA-256', 'MD5'])
    expect(out.entities?.[0].label).toBe(out.properties?.sha256)
  })
})

describe('image.reverse_search', () => {
  it('construit les liens à partir de l’URL publique', async () => {
    const url = 'https://example.com/photos/a b.jpg'
    const out = await runModule(reverseSearch, entity('photo', 'a.jpg', { data: { url: 'https://example.com/photos/a.jpg' } }))
    expect(out.entities?.map((e) => e.data?.engine)).toEqual(['Google Lens', 'Yandex Images', 'Bing Visual Search', 'TinEye'])
    expect(out.entities?.[3].data?.url).toBe('https://tineye.com/search?url=https%3A%2F%2Fexample.com%2Fphotos%2Fa.jpg')
    expect(reverseSearch.accepts!(entity('photo', url))).toBe(false)
    expect(reverseSearch.accepts!(entity('photo', 'x'))).toBe(false)
  })
})

describe.skipIf(!LIVE)('image : photo publique réelle', () => {
  it('EXIF GPS d’une photo téléchargée', async () => {
    const url = 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/gps/DSCN0010.jpg'
    const out = await runModule(exif, entity('photo', url))
    expect(out.properties?.camera).toMatch(/NIKON|COOLPIX/i)
    expect(out.entities?.some((e) => e.type === 'coordinates')).toBe(true)
  })
})
