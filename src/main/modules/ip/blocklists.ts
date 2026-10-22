// Réputation d'une IP d'après des listes de blocage publiques et gratuites, téléchargées une fois
// par jour et gardées en mémoire entre les lancements : Spamhaus DROP et ASN-DROP, IPsum,
// Feodo Tracker (abuse.ch), FireHOL level1, blocklist.de, CINS Army. Les signalements du
// DShield (SANS ISC) complètent. Résultat en propriétés seulement : aucune entité.

import { defineModule, ModuleError, type ModuleContext, type ModuleOutput } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { parseAsn, sharedInfrastructure } from '../domain/_hosting'
import { compact, isIPv4, isIPv6, normalizeHost } from '../domain/_util'
import { cymruOrigin } from './_cymru'
import { expandIPv6 } from './reverseDns'

/** Durée de conservation d'une liste téléchargée. */
const TTL_MS = 24 * 3600_000
/** Une liste qui n'a pas répondu est retentée après ce délai, pas avant. */
const FAILURE_TTL_MS = 15 * 60_000

// ---------------------------------------------------------------------------
// Adresses sous forme numérique : nombre pour l'IPv4, BigInt pour l'IPv6.

type IpValue = { v: 4; n: number } | { v: 6; n: bigint }

export function ipValue(ip: string): IpValue | null {
  const s = ip.trim().toLowerCase()
  if (isIPv4(s)) return { v: 4, n: s.split('.').reduce((acc, o) => acc * 256 + Number(o), 0) }
  const full = s.includes(':') ? expandIPv6(s) : null
  return full ? { v: 6, n: BigInt('0x' + full.replace(/:/g, '')) } : null
}

/** Forme canonique d'une adresse, pour les listes d'adresses exactes. */
export function canonicalIp(ip: string): string | null {
  const s = ip.trim().toLowerCase()
  if (isIPv4(s)) return s.split('.').map(Number).join('.')
  return s.includes(':') ? expandIPv6(s) : null
}

/** Bloc CIDR en bornes numériques (`1.10.16.0/20`, `2001:678:254::/48`, adresse seule). */
export function cidrBounds(cidr: string): { v: 4; start: number; end: number } | { v: 6; start: bigint; end: bigint } | null {
  const [net, lenRaw] = cidr.trim().split('/')
  const base = ipValue(net ?? '')
  if (!base) return null
  if (base.v === 4) {
    const len = lenRaw === undefined ? 32 : Number(lenRaw)
    if (!Number.isInteger(len) || len < 0 || len > 32) return null
    const size = 2 ** (32 - len)
    const start = Math.floor(base.n / size) * size
    return { v: 4, start, end: start + size - 1 }
  }
  const len = lenRaw === undefined ? 128 : Number(lenRaw)
  if (!Number.isInteger(len) || len < 0 || len > 128) return null
  const host = (1n << BigInt(128 - len)) - 1n
  const start = base.n & ~host & ((1n << 128n) - 1n)
  return { v: 6, start, end: start | host }
}

/**
 * Index de plages, construit une fois au chargement : tri par début, maximum cumulé des fins,
 * puis recherche dichotomique. Une recherche coûte O(log n), sans parcourir les milliers de blocs.
 */
export class RangeIndex<T extends number | bigint> {
  private starts: T[] = []
  private ends: T[] = []
  private maxEnds: T[] = []
  private labels: string[] = []

  constructor(ranges: Array<{ start: T; end: T; label: string }>) {
    const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    for (const r of sorted) {
      const prev = this.maxEnds[this.maxEnds.length - 1]
      this.starts.push(r.start)
      this.ends.push(r.end)
      this.maxEnds.push(prev !== undefined && prev > r.end ? prev : r.end)
      this.labels.push(r.label)
    }
  }

  get size(): number {
    return this.starts.length
  }

  /** Libellé de la plage qui contient l'adresse, ou `null`. */
  find(n: T): string | null {
    let lo = 0
    let hi = this.starts.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.starts[mid] <= n) {
        idx = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    // Remonte tant qu'une plage antérieure peut encore couvrir l'adresse (plages imbriquées).
    for (let i = idx; i >= 0 && this.maxEnds[i] >= n; i--) if (this.ends[i] >= n) return this.labels[i]
    return null
  }
}

// ---------------------------------------------------------------------------
// Listes et formats.

export interface ListIndex {
  /** Détail affiché quand l'adresse est listée (`SBL256894`, `5 listes`), `''` sans détail, `null` sinon. */
  lookup(ip: string, asn: number | null): string | null
  size: number
}

export interface ListDef {
  id: string
  name: string
  url: string
  /** Familles d'adresses couvertes : la liste n'est pas téléchargée pour les autres. */
  covers: Array<4 | 6>
  /** Liste par ASN : nécessite l'ASN de l'adresse. */
  byAsn?: boolean
  parse(text: string): ListIndex
}

/** Lignes utiles d'une liste texte : sans commentaires (`#`, `;`) ni lignes vides. */
const dataLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/[#;].*$/, '').trim())
    .filter(Boolean)

/** Liste d'adresses exactes (une par ligne, éventuellement suivie d'un champ). */
export function exactList(text: string): ListIndex {
  const set = new Set<string>()
  for (const line of dataLines(text)) {
    const ip = canonicalIp(line.split(/[\s,]+/)[0])
    if (ip) set.add(ip)
  }
  return { size: set.size, lookup: (ip) => (set.has(canonicalIp(ip) ?? '') ? '' : null) }
}

/** IPsum : `IP<TAB>nombre de listes` ; le nombre est le score. */
export function ipsumList(text: string): ListIndex & { score(ip: string): number | null } {
  const scores = new Map<string, number>()
  for (const line of dataLines(text)) {
    const [raw, count] = line.split(/\s+/)
    const ip = canonicalIp(raw ?? '')
    const n = Number(count)
    if (ip && Number.isFinite(n)) scores.set(ip, n)
  }
  const score = (ip: string): number | null => scores.get(canonicalIp(ip) ?? '') ?? null
  // Le score est repris à part (`ipsum_score`) : pas de détail dans `listed_in`.
  return { size: scores.size, score, lookup: (ip) => (score(ip) === null ? null : '') }
}

/** Liste de blocs CIDR (ou d'adresses seules), avec un libellé facultatif par bloc. */
export function cidrList(entries: Array<{ cidr: string; label?: string }>): ListIndex {
  const v4: Array<{ start: number; end: number; label: string }> = []
  const v6: Array<{ start: bigint; end: bigint; label: string }> = []
  for (const e of entries) {
    const b = cidrBounds(e.cidr)
    if (b?.v === 4) v4.push({ start: b.start, end: b.end, label: e.label ?? '' })
    else if (b?.v === 6) v6.push({ start: b.start, end: b.end, label: e.label ?? '' })
  }
  const i4 = new RangeIndex(v4)
  const i6 = new RangeIndex(v6)
  return {
    size: i4.size + i6.size,
    lookup: (ip) => {
      const v = ipValue(ip)
      if (!v) return null
      return v.v === 4 ? i4.find(v.n) : i6.find(v.n)
    }
  }
}

/** Spamhaus DROP (JSON par ligne) : `{"cidr":"1.10.16.0/20","sblid":"SBL256894",...}`. */
export function spamhausDrop(text: string): ListIndex {
  const entries: Array<{ cidr: string; label?: string }> = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as { cidr?: string; sblid?: string }
      if (r.cidr) entries.push({ cidr: r.cidr, label: r.sblid ?? '' })
    } catch {
      /* ligne illisible ignorée */
    }
  }
  return cidrList(entries)
}

/** Spamhaus ASN-DROP (JSON par ligne) : `{"asn":245,"asname":"PRC-AS","cc":"US",...}`. */
export function spamhausAsnDrop(text: string): ListIndex {
  const asns = new Map<number, string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as { asn?: number; asname?: string }
      if (typeof r.asn === 'number') asns.set(r.asn, `AS${r.asn}${r.asname ? ` ${r.asname}` : ''}`)
    } catch {
      /* ligne illisible ignorée */
    }
  }
  return { size: asns.size, lookup: (_ip, asn) => (asn !== null ? (asns.get(asn) ?? null) : null) }
}

/** FireHOL : blocs CIDR et adresses seules, une par ligne. */
export function netsetList(text: string): ListIndex {
  return cidrList(dataLines(text).map((cidr) => ({ cidr })))
}

export const LISTS: ListDef[] = [
  { id: 'spamhaus_drop', name: 'Spamhaus DROP', url: 'https://www.spamhaus.org/drop/drop_v4.json', covers: [4], parse: spamhausDrop },
  { id: 'spamhaus_drop_v6', name: 'Spamhaus DROP', url: 'https://www.spamhaus.org/drop/drop_v6.json', covers: [6], parse: spamhausDrop },
  { id: 'spamhaus_asndrop', name: 'Spamhaus ASN-DROP', url: 'https://www.spamhaus.org/drop/asndrop.json', covers: [4, 6], byAsn: true, parse: spamhausAsnDrop },
  { id: 'ipsum', name: 'IPsum', url: 'https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt', covers: [4], parse: ipsumList },
  { id: 'feodo', name: 'abuse.ch Feodo Tracker', url: 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt', covers: [4], parse: exactList },
  {
    id: 'firehol_level1',
    name: 'FireHOL level1',
    url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset',
    covers: [4],
    parse: netsetList
  },
  { id: 'blocklist_de', name: 'blocklist.de', url: 'https://lists.blocklist.de/lists/all.txt', covers: [4, 6], parse: exactList },
  { id: 'cins', name: 'CINS Army', url: 'https://cinsscore.com/list/ci-badguys.txt', covers: [4], parse: exactList }
]

// ---------------------------------------------------------------------------
// Cache en mémoire, partagé entre les lancements du module : une requête par liste et par jour.

interface CacheEntry {
  at: number
  failed: boolean
  promise: Promise<ListIndex>
}

const cache = new Map<string, CacheEntry>()

/** Vide le cache (tests). */
export function resetBlocklistCache(): void {
  cache.clear()
}

export function loadList(ctx: ModuleContext, def: ListDef, now = Date.now()): Promise<ListIndex> {
  const hit = cache.get(def.id)
  if (hit && now - hit.at < (hit.failed ? FAILURE_TTL_MS : TTL_MS)) return hit.promise
  const entry: CacheEntry = {
    at: now,
    failed: false,
    promise: ctx.fetchText(def.url, { timeoutMs: 60000 }).then((text) => {
      const index = def.parse(text)
      // Page d'erreur servie en 200, format changé : la liste est inutilisable.
      if (!index.size) throw new Error(`${def.name} : liste vide ou format inattendu`)
      return index
    })
  }
  entry.promise.catch(() => {
    // Annulation par l'utilisateur : rien à retenir, la liste sera retéléchargée au prochain lancement.
    if (ctx.signal.aborted) cache.delete(def.id)
    else entry.failed = true
  })
  cache.set(def.id, entry)
  return entry.promise
}

// ---------------------------------------------------------------------------
// DShield (SANS Internet Storm Center).

export interface DShieldIp {
  number?: string | false
  count?: number | null
  attacks?: number | null
  mindate?: string | null
  maxdate?: string | null
  comment?: string | null
  threatfeeds?: Record<string, { firstseen?: string; lastseen?: string }>
}

export interface BlocklistHit {
  list: string
  detail: string
}

export function buildBlocklistOutput(
  ip: string,
  hits: BlocklistHit[],
  unavailable: string[],
  ipsumScore: number | null,
  dshield: DShieldIp | null
): ModuleOutput {
  const sbl = hits.find((h) => h.list === 'Spamhaus DROP')?.detail || null
  const asnDrop = hits.find((h) => h.list === 'Spamhaus ASN-DROP')?.detail || null
  const reports = typeof dshield?.count === 'number' ? dshield.count : null
  const properties = compact({
    listed_in: hits.map((h) => (h.detail && h.list !== 'Spamhaus ASN-DROP' ? `${h.list} (${h.detail})` : h.list)),
    listed_count: hits.length,
    ipsum_score: ipsumScore,
    spamhaus_drop: sbl,
    spamhaus_asn_drop: asnDrop,
    dshield_reports: reports,
    dshield_targets: typeof dshield?.attacks === 'number' ? dshield.attacks : null,
    dshield_first_seen: dshield?.mindate ?? null,
    dshield_last_seen: dshield?.maxdate ?? null,
    dshield_comment: dshield?.comment?.trim() || null,
    dshield_feeds: Object.keys(dshield?.threatfeeds ?? {}),
    dshield_link: dshield ? `https://isc.sans.edu/ipinfo/${ip}` : null,
    blocklists_unavailable: unavailable
  }) as Record<string, PropValue>
  return { properties, raw: { hits, unavailable, dshield } }
}

async function dshieldLookup(ctx: ModuleContext, ip: string): Promise<DShieldIp | null> {
  try {
    const d = await ctx.fetchJson<{ ip?: DShieldIp }>(`https://isc.sans.edu/api/ip/${ip}`, { query: { json: '' }, timeoutMs: 20000 })
    // Adresse non reconnue (l'API ne traite pas l'IPv6) : `number` vaut false.
    return d.ip && d.ip.number ? d.ip : null
  } catch (e) {
    ctx.log(`DShield : ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export default defineModule({
  id: 'ip.blocklists',
  name: { fr: 'Listes de blocage publiques', en: 'Public blocklists' },
  description: {
    fr: 'Cherche l’IP dans des listes de réputation gratuites : Spamhaus DROP et ASN-DROP, IPsum (score : nombre de listes qui la citent), Feodo Tracker (serveurs de botnet), FireHOL level1, blocklist.de, CINS Army, et signalements DShield (SANS ISC). Listes téléchargées une fois par jour et gardées en mémoire. Propriétés seulement, sans contacter la cible.',
    en: 'Looks the IP up in free reputation lists: Spamhaus DROP and ASN-DROP, IPsum (score: number of lists citing it), Feodo Tracker (botnet servers), FireHOL level1, blocklist.de, CINS Army, plus DShield (SANS ISC) reports. Lists are downloaded once a day and kept in memory. Properties only, without contacting the target.'
  },
  category: 'ip',
  inputTypes: ['ip'],
  homepage: 'https://isc.sans.edu',
  async run(input, ctx) {
    const ip = normalizeHost(input.label)
    if (!isIPv4(ip) && !isIPv6(ip)) throw new ModuleError('Adresse IP invalide', 'invalid_input')
    // Adresse privée ou réservée : FireHOL liste les plages non routées, le résultat n'aurait pas de sens.
    if (sharedInfrastructure(ip)?.kind === 'reserved') return {}
    const family = isIPv4(ip) ? 4 : 6
    const lists = LISTS.filter((l) => l.covers.includes(family))
    let asn = parseAsn(input.data.asn)
    if (!asn) asn = (await cymruOrigin(ctx, ip))?.asn ?? null

    const total = lists.length + (family === 4 ? 1 : 0)
    let done = 0
    const step = (detail: string): void => ctx.progress(++done, total, detail)
    const hits: BlocklistHit[] = []
    const unavailable: string[] = []
    let consulted = 0
    let ipsumScore: number | null = null
    const dshieldP = family === 4 ? dshieldLookup(ctx, ip).finally(() => step('DShield')) : Promise.resolve(null)
    await Promise.all(
      lists.map(async (def) => {
        try {
          // ASN inconnu (résolution Team Cymru en échec) : ASN-DROP ne peut pas être consultée.
          if (def.byAsn && asn === null) return
          consulted++
          const index = await loadList(ctx, def)
          const detail = index.lookup(ip, asn)
          if (detail !== null) hits.push({ list: def.name, detail })
          if (def.id === 'ipsum') ipsumScore = (index as ReturnType<typeof ipsumList>).score(ip)
        } catch (e) {
          if (ctx.signal.aborted) throw e
          ctx.log(`${def.name} : ${e instanceof Error ? e.message : String(e)}`)
          unavailable.push(def.name)
        } finally {
          step(def.name)
        }
      })
    )
    const dshield = await dshieldP
    // Ordre stable, indépendant de l'arrivée des téléchargements.
    const order = (name: string): number => LISTS.findIndex((l) => l.name === name)
    hits.sort((a, b) => order(a.list) - order(b.list))
    unavailable.sort((a, b) => order(a) - order(b))
    if (unavailable.length === consulted && !dshield) throw new ModuleError('Aucune liste de blocage n’a répondu', 'unavailable')
    return buildBlocklistOutput(ip, hits, unavailable, ipsumScore, dshield)
  }
})
