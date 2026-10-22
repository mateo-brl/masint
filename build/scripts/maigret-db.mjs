// Produit resources/data/maigret-sites.json à partir de la base de sites de Maigret
// (https://github.com/soxoj/maigret, licence MIT) : les sites désactivés et les champs que
// MASINT n'utilise pas sont retirés, l'attribution, la date et l'empreinte de la base
// d'origine sont ajoutées dans `$meta`. Le moteur (src/main/modules/username/_maigret.ts)
// lit indifféremment ce fichier réduit et la base complète téléchargée par la mise à jour.
//
// Usage : node build/scripts/maigret-db.mjs <data.json> <db_meta.json> [commit]

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [dataPath, metaPath, commit] = process.argv.slice(2)
if (!dataPath || !metaPath) {
  console.error('Usage : node build/scripts/maigret-db.mjs <data.json> <db_meta.json> [commit]')
  process.exit(1)
}

// Champs lus par le moteur. Les autres (usernameUnclaimed, source, mirrors, encoding...) sont retirés.
const KEEP = [
  'url',
  'urlMain',
  'urlSubpath',
  'urlProbe',
  'getParams',
  'checkType',
  'presenseStrs',
  'absenceStrs',
  'errors',
  'regexCheck',
  'headers',
  'requestMethod',
  'requestPayload',
  'requestHeadOnly',
  'type',
  'protection',
  'activation',
  'similarSearch',
  'ignore403',
  'protocol',
  'tags',
  'alexaRank',
  'engine',
  'usernameClaimed'
]

const pick = (obj) => {
  const out = {}
  for (const k of KEEP) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

const buf = readFileSync(dataPath)
const data = JSON.parse(buf.toString('utf8'))
const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
const sha256 = createHash('sha256').update(buf).digest('hex')
if (meta.data_sha256 && meta.data_sha256 !== sha256) {
  console.error(`Empreinte différente de db_meta.json : ${sha256} au lieu de ${meta.data_sha256}`)
  process.exit(1)
}

const sites = {}
let disabled = 0
for (const [name, entry] of Object.entries(data.sites)) {
  if (entry.disabled) {
    disabled++
    continue
  }
  sites[name] = pick(entry)
}
const engines = {}
for (const [name, engine] of Object.entries(data.engines ?? {})) engines[name] = { site: pick(engine.site ?? {}) }

const out = {
  $meta: {
    source: 'https://github.com/soxoj/maigret',
    file: 'maigret/resources/data.json',
    license: 'MIT, Copyright (c) 2020-2026 Soxoj',
    ...(commit ? { commit } : {}),
    updated_at: meta.updated_at,
    sha256,
    sites_count: Object.keys(data.sites).length,
    disabled_removed: disabled
  },
  sites,
  engines
}

// Une entrée par ligne : fichier compact, mais différences lisibles d'une version à l'autre.
const block = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    .join(',\n')
const text = `{"$meta":${JSON.stringify(out.$meta)},\n"sites":{\n${block(out.sites)}\n},\n"engines":{\n${block(out.engines)}\n}}\n`
JSON.parse(text)

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const target = join(root, 'resources/data/maigret-sites.json')
writeFileSync(target, text)
console.log(`${Object.keys(sites).length} sites gardés (${disabled} désactivés retirés), ${Object.keys(engines).length} moteurs : ${target}`)
