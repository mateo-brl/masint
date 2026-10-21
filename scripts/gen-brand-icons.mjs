// Génère src/renderer/src/lib/brandIcons.ts avec uniquement les logos simple-icons
// utilisés par le catalogue de plateformes (évite d'embarquer les 3000+ logos).
import { readFileSync, writeFileSync } from 'node:fs'
import * as si from 'simple-icons'

const src = readFileSync(new URL('../src/shared/platforms.ts', import.meta.url), 'utf8')
const slugs = new Set()
for (const m of src.matchAll(/\[\s*'[^']+',\s*'[^']*',\s*'([a-z0-9]+)'/g)) slugs.add(m[1])
for (const m of src.matchAll(/si: '([a-z0-9]+)'/g)) slugs.add(m[1])

const bySlug = new Map(Object.values(si).filter((i) => i && i.slug).map((i) => [i.slug, i]))
const entries = []
const missing = []
for (const slug of [...slugs].sort()) {
  const icon = bySlug.get(slug)
  if (!icon) {
    missing.push(slug)
    continue
  }
  entries.push(`  ${JSON.stringify(slug)}: { title: ${JSON.stringify(icon.title)}, hex: '${icon.hex}', path: ${JSON.stringify(icon.path)} }`)
}
const out = `// Fichier généré par scripts/gen-brand-icons.mjs : ne pas modifier à la main.
// Logos issus de simple-icons (CC0 1.0), https://simpleicons.org

export interface BrandIcon {
  title: string
  hex: string
  path: string
}

export const BRAND_ICONS: Record<string, BrandIcon> = {
${entries.join(',\n')}
}
`
writeFileSync(new URL('../src/renderer/src/lib/brandIcons.ts', import.meta.url), out)
console.log(`${entries.length} logos générés`)
if (missing.length) console.log('slugs introuvables :', missing.join(', '))
