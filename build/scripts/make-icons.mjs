// Génère toutes les icônes de l'application à partir de build/icon.svg.
//
//   build/icon.png              1024 px (source pour electron-builder)
//   build/icon.ico              Windows, 16 à 256 px
//   build/icons/NxN.png         Linux (16, 32, 48, 64, 128, 256, 512)
//   resources/icon.png          512 px, icône de fenêtre (src/main/index.ts)
//
// Les tailles de 32 px et moins utilisent build/icon-small.svg (traits plus
// épais, sans détails) pour rester lisibles dans la barre des tâches.
//
// La rasterisation passe par Chromium (Playwright), qui n'est pas une dépendance
// du projet : `npx playwright install chromium` puis `npm run icons`, ou
// PLAYWRIGHT_PATH=/chemin/vers/node_modules/playwright npm run icons.

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pngsToIco } from './png2ico.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const SMALL_MAX = 32

function loadPlaywright() {
  const require = createRequire(import.meta.url)
  const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright', 'playwright-core'].filter(Boolean)
  let globalRoot = null
  try {
    globalRoot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    /* npm absent du PATH */
  }
  for (const name of candidates) {
    try {
      return require(require.resolve(name, { paths: [root, ...(globalRoot ? [globalRoot] : [])] }))
    } catch {
      /* candidat suivant */
    }
  }
  throw new Error('Playwright introuvable : installez-le (npm i -g playwright && npx playwright install chromium) ou définissez PLAYWRIGHT_PATH.')
}

/** Fixe la taille intrinsèque du SVG pour que Chromium le trace directement à la bonne taille. */
function sized(svg, size) {
  return svg.replace(/<svg([^>]*?)\swidth="\d+"\s+height="\d+"/, `<svg$1 width="${size}" height="${size}"`)
}

async function main() {
  const big = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
  let small = big
  try {
    small = readFileSync(join(root, 'build', 'icon-small.svg'), 'utf8')
  } catch {
    /* pas de variante simplifiée */
  }

  const { chromium } = loadPlaywright()
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await page.setContent('<!doctype html><html><body></body></html>')

  const render = async (size) => {
    const svg = sized(size <= SMALL_MAX ? small : big, size)
    const dataUrl = await page.evaluate(
      async ({ svg, size }) => {
        const img = new Image()
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, size, size)
        return canvas.toDataURL('image/png')
      },
      { svg, size }
    )
    return Buffer.from(dataUrl.split(',')[1], 'base64')
  }

  const cache = new Map()
  const get = async (size) => {
    if (!cache.has(size)) cache.set(size, await render(size))
    return cache.get(size)
  }

  const write = (rel, buf) => {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, buf)
    console.log(`${rel} (${buf.length} octets)`)
  }

  write('build/icon.png', await get(1024))
  write('resources/icon.png', await get(512))
  for (const size of LINUX_SIZES) write(`build/icons/${size}x${size}.png`, await get(size))
  const icoImages = []
  for (const size of ICO_SIZES) icoImages.push(await get(size))
  write('build/icon.ico', pngsToIco(icoImages))

  await browser.close()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
