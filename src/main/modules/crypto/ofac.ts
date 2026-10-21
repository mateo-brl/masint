// Vérifie si une adresse crypto figure sur la liste des sanctions SDN de l'OFAC
// (Trésor américain). La liste officielle (CSV) est téléchargée puis gardée en mémoire.

import { defineModule, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import { serviceError, tr } from '../misc/_util'
import { walletAddress } from './_chain'

const SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv'
const COMMENTS_URL = 'https://www.treasury.gov/ofac/downloads/sdn_comments.csv'
const TTL = 12 * 3600 * 1000

export interface SdnEntry {
  entNum: string
  name: string
  /** `individual`, `entity`, `vessel` ou `aircraft`. */
  kind: string
  programs: string[]
  currency: string
  /** Toutes les adresses crypto de la même entrée. */
  addresses: number
}

/** Découpe une ligne CSV (champs entre guillemets, `""` échappé). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

const clean = (v: string | undefined): string => {
  const s = (v ?? '').trim()
  return s === '-0-' ? '' : s
}

const ADDRESS_RE = /Digital Currency Address - ([A-Za-z0-9]+) ([A-Za-z0-9:]+)/g

/** Index adresse (en minuscules) → entrée SDN, à partir de `sdn.csv` et `sdn_comments.csv`. */
export function parseSdn(sdnCsv: string, commentsCsv = ''): Map<string, SdnEntry> {
  const rows = new Map<string, { name: string; kind: string; programs: string[]; remarks: string }>()
  for (const line of sdnCsv.split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue
    const f = splitCsvLine(line)
    rows.set(f[0], {
      name: clean(f[1]),
      kind: clean(f[2]) || 'entity',
      programs: clean(f[3])
        .split(/\]\s*\[/)
        .map((p) => p.replace(/[[\]]/g, '').trim())
        .filter(Boolean),
      remarks: clean(f[11])
    })
  }
  // Les remarques trop longues se poursuivent dans sdn_comments.csv.
  for (const line of commentsCsv.split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue
    const f = splitCsvLine(line)
    const row = rows.get(f[0])
    if (row) row.remarks += f[1] ?? ''
  }
  const index = new Map<string, SdnEntry>()
  for (const [entNum, row] of rows) {
    if (!row.remarks.includes('Digital Currency Address')) continue
    const matches = Array.from(row.remarks.matchAll(ADDRESS_RE))
    for (const m of matches) {
      index.set(m[2].toLowerCase(), {
        entNum,
        name: row.name,
        kind: row.kind,
        programs: row.programs,
        currency: m[1],
        addresses: matches.length
      })
    }
  }
  return index
}

let cache: { at: number; index: Promise<Map<string, SdnEntry>> } | null = null

async function loadIndex(ctx: ModuleContext): Promise<Map<string, SdnEntry>> {
  if (cache && Date.now() - cache.at < TTL) return cache.index
  const index = (async () => {
    const [sdn, comments] = await Promise.all([
      ctx.fetchText(SDN_URL, { timeoutMs: 90000 }),
      ctx.fetchText(COMMENTS_URL, { timeoutMs: 60000 }).catch(() => '')
    ])
    if (!sdn.includes('Digital Currency Address')) throw new Error('liste SDN illisible')
    return parseSdn(sdn, comments)
  })()
  cache = { at: Date.now(), index }
  index.catch(() => {
    cache = null
  })
  return index
}

export function sanctionOutput(ctx: Pick<ModuleContext, 'lang'>, entry: SdnEntry | undefined): ModuleOutput {
  if (!entry) return { properties: { sanctioned: false } }
  const entities: OutEntity[] = [
    {
      type: entry.kind === 'individual' ? 'person' : 'organization',
      label: entry.name,
      data: {
        ofac_id: entry.entNum,
        sanction_programs: entry.programs,
        sanctioned: true
      },
      linkLabel: tr(ctx, 'sanctionné OFAC', 'OFAC sanctioned')
    }
  ]
  return {
    properties: {
      sanctioned: true,
      sanction_list: 'OFAC SDN',
      sanctioned_entity: entry.name,
      sanction_programs: entry.programs,
      ofac_id: entry.entNum,
      ofac_url: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${entry.entNum}`
    },
    entities,
    raw: { ...entry }
  }
}

export default defineModule({
  id: 'crypto.ofac',
  name: { fr: 'Sanctions OFAC (adresses crypto)', en: 'OFAC sanctions (crypto addresses)' },
  description: {
    fr: "Recherche l'adresse dans la liste officielle des sanctions SDN du Trésor américain (OFAC) et rattache la personne ou l'organisation sanctionnée. Liste téléchargée (6 Mo) puis gardée en cache 12 h.",
    en: 'Looks the address up in the official US Treasury (OFAC) SDN sanctions list and links the sanctioned person or organization. List downloaded (6 MB) then cached for 12 h.'
  },
  category: 'crypto',
  inputTypes: ['crypto_wallet'],
  homepage: 'https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists',
  timeoutMs: 120000,
  async run(input, ctx) {
    let index: Map<string, SdnEntry>
    try {
      index = await loadIndex(ctx)
    } catch (e) {
      throw serviceError(e, 'OFAC')
    }
    return sanctionOutput(ctx, index.get(walletAddress(input).toLowerCase()))
  }
})
