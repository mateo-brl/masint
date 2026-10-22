import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import exif, { exifDate, exifOutput, readTags } from '../../src/main/modules/image/exif'
import hashes from '../../src/main/modules/image/hashes'
import reverseSearch, { tineyeOutput, type TinEyeResponse } from '../../src/main/modules/image/reverseSearch'
import { entity, LIVE, makeContext, runModule } from '../helpers/context'

const file = (name: string): Buffer => readFileSync(join(__dirname, '../fixtures/image', name))
const withAttachment = (name: string, mime: string) => ({
  ...makeContext(),
  attachment: async () => ({ mime, name, data: file(name), origin: null })
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
  const tineye = JSON.parse(file('tineye_python_logo.json').toString('utf8')) as TinEyeResponse
  const requests: string[] = []
  const tineyeCtx = (body: string, status = 200) => ({
    ...makeContext(),
    fetch: async (url: string, init?: { query?: Record<string, string | number | undefined> }) => {
      const u = new URL(url)
      for (const [k, v] of Object.entries(init?.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v))
      requests.push(u.toString())
      return new Response(body, { status })
    }
  })

  it('relie les pages où TinEye a trouvé la même image', () => {
    const out = tineyeOutput(tineye, 'fr')
    expect(out.entities).toHaveLength(3)
    expect(out.entities![2]).toMatchObject({
      type: 'url',
      label: 'http://en.wikipedia.org/wiki/Python_(programming_language)',
      linkLabel: 'même image (TinEye)',
      data: { domain: 'wikipedia.org', first_seen: '2010-12-29', match_score: 28 }
    })
    expect(out.properties).toEqual({ tineye_matches: 2388, tineye_first_seen: '2008-04-19', tineye_search_url: 'https://tineye.com/search/fb64a464c0cb7da50c6e35ab8767063d9c6dc887' })
    expect(tineyeOutput({ num_matches: 0, matches: [] }, 'fr')).toEqual({ properties: { tineye_matches: 0 } })
  })

  it('URL publique : TinEye automatique, autres moteurs à la main avec l’URL', async () => {
    requests.length = 0
    const out = await runModule(reverseSearch, entity('photo', 'a.jpg', { data: { url: 'https://example.com/photos/a.jpg' } }), tineyeCtx(JSON.stringify(tineye)))
    expect(requests[0]).toBe('https://tineye.com/api/v1/result_json/?url=https%3A%2F%2Fexample.com%2Fphotos%2Fa.jpg')
    expect(out.entities).toHaveLength(3)
    expect(out.manual!.map((m) => m.label)).toEqual(['Google Lens', 'Yandex Images', 'Bing Visual Search'])
    expect(out.manual![0].url).toBe('https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fexample.com%2Fphotos%2Fa.jpg')
  })

  it('TinEye ne peut pas lire l’image : TinEye proposé à la main', async () => {
    const refused = JSON.stringify({ suggestions: { key: 'Download Error', description: ['TinEye could not read that image url.'] } })
    const out = await runModule(reverseSearch, entity('photo', 'https://example.com/a.jpg'), tineyeCtx(refused, 422))
    expect(out.entities).toBeUndefined()
    expect(out.manual!.at(-1)).toMatchObject({ label: 'TinEye', url: 'https://tineye.com/search?url=https%3A%2F%2Fexample.com%2Fa.jpg' })
  })

  it('photo importée sans URL : pages de dépôt à la main, rien n’est envoyé', async () => {
    requests.length = 0
    expect(reverseSearch.accepts!(photo())).toBe(true)
    expect(reverseSearch.accepts!(entity('photo', 'x'))).toBe(false)
    const out = await runModule(reverseSearch, photo(), tineyeCtx('{}'))
    expect(requests).toEqual([])
    expect(out.manual!.map((m) => m.url)).toEqual(['https://lens.google.com/', 'https://yandex.com/images/', 'https://www.bing.com/visualsearch', 'https://tineye.com/'])
    expect(out.manual!.every((m) => m.hint?.startsWith('Déposez la photo sur la page.'))).toBe(true)
  })
})

describe.skipIf(!LIVE)('image : photo publique réelle', () => {
  it('TinEye : pages qui publient le logo Python', async () => {
    const out = await runModule(reverseSearch, entity('photo', 'https://www.python.org/static/img/python-logo.png'))
    expect(Number(out.properties?.tineye_matches)).toBeGreaterThan(100)
    expect(out.entities!.length).toBeGreaterThan(0)
  }, 60000)

  it('EXIF GPS d’une photo téléchargée', async () => {
    const url = 'https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/gps/DSCN0010.jpg'
    const out = await runModule(exif, entity('photo', url))
    expect(out.properties?.camera).toMatch(/NIKON|COOLPIX/i)
    expect(out.entities?.some((e) => e.type === 'coordinates')).toBe(true)
  })
})
