// Assemble un fichier .ico Windows à partir de PNG carrés (sans dépendance).
//
// Format : en-tête ICONDIR (6 octets), une entrée ICONDIRENTRY (16 octets) par
// image, puis les données des images. Les images de 256 px sont stockées en PNG
// (format « Vista »), les plus petites en bitmap 32 bits BGRA + masque AND, la
// forme la plus compatible (Explorateur, rcedit, NSIS).
//
// Usage : node build/scripts/png2ico.mjs sortie.ico entree-16.png entree-32.png ...

import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Décode un PNG 8 bits RGB/RGBA non entrelacé (ce que produisent Chromium et Pillow). */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG invalide')
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  let off = 8
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]
      colorType = data[9]
      const interlace = data[12]
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`PNG non pris en charge (profondeur ${depth}, type ${colorType}, entrelacement ${interlace})`)
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[x] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp
      const d = (y * width + x) * 4
      pixels[d] = line[s]
      pixels[d + 1] = line[s + 1]
      pixels[d + 2] = line[s + 2]
      pixels[d + 3] = bpp === 4 ? line[s + 3] : 255
    }
    prev = line
  }
  return { width, height, pixels }
}

/** Bitmap DIB 32 bits (BITMAPINFOHEADER + BGRA de bas en haut + masque AND 1 bit). */
function toDib({ width, height, pixels }) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(width, 4)
  header.writeInt32LE(height * 2, 8) // hauteur doublée : image + masque
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16) // BI_RGB
  const xor = Buffer.alloc(width * height * 4)
  const maskStride = Math.ceil(width / 32) * 4
  const mask = Buffer.alloc(maskStride * height)
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = (row * width + x) * 4
      xor[d] = pixels[s + 2]
      xor[d + 1] = pixels[s + 1]
      xor[d + 2] = pixels[s]
      xor[d + 3] = pixels[s + 3]
      if (pixels[s + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  header.writeUInt32LE(xor.length + mask.length, 20)
  return Buffer.concat([header, xor, mask])
}

/** Construit un .ico à partir de PNG carrés, triés par taille croissante. */
export function pngsToIco(pngBuffers) {
  const images = pngBuffers
    .map((png) => {
      const img = decodePng(png)
      if (img.width !== img.height) throw new Error(`Image non carrée (${img.width}x${img.height})`)
      if (img.width > 256) throw new Error(`Taille maximale 256 px (reçu ${img.width})`)
      return { size: img.width, data: img.width >= 256 ? png : toDib(img) }
    })
    .sort((a, b) => a.size - b.size)

  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2) // 1 = icône
  dir.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size // 0 signifie 256
    e[1] = size >= 256 ? 0 : size
    e[2] = 0 // pas de palette
    e[3] = 0
    e.writeUInt16LE(1, 4) // plans
    e.writeUInt16LE(32, 6) // bits par pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, ...inputs] = process.argv.slice(2)
  if (!out || !inputs.length) {
    console.error('Usage : node build/scripts/png2ico.mjs sortie.ico entree.png [entree.png ...]')
    process.exit(1)
  }
  writeFileSync(out, pngsToIco(inputs.map((p) => readFileSync(p))))
  console.log(`${out} : ${inputs.length} images`)
}
