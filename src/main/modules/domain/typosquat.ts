import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { isDomain, normalizeDomain, pool } from './_util'

const MAX_CANDIDATES = 150
const MAX_ENTITIES = 25

const HOMOGLYPHS: Record<string, string[]> = {
  a: ['4'],
  b: ['d', '6'],
  c: ['e'],
  d: ['b', 'cl'],
  e: ['3'],
  g: ['q', '9'],
  i: ['1', 'l'],
  l: ['1', 'i'],
  m: ['rn', 'nn'],
  n: ['m', 'r'],
  o: ['0'],
  q: ['g'],
  s: ['5', 'z'],
  u: ['v'],
  v: ['u'],
  w: ['vv'],
  z: ['2', 's']
}

// Touches voisines sur les claviers AZERTY et QWERTY.
const NEIGHBOURS: Record<string, string> = {
  a: 'qzsw',
  z: 'aesx',
  e: 'zrdsw',
  r: 'etfd',
  t: 'rygf',
  y: 'tuhg',
  u: 'yijh',
  i: 'uokj',
  o: 'iplk',
  p: 'olm',
  q: 'aswz',
  s: 'qdzxea',
  d: 'sfecx',
  f: 'dgrv',
  g: 'fhtb',
  h: 'gjyn',
  j: 'hkun',
  k: 'jlim',
  l: 'kmop',
  m: 'lpkn',
  w: 'qsxa',
  x: 'wcsd',
  c: 'xvd',
  v: 'cbf',
  b: 'vng',
  n: 'bmhj'
}

const TLDS = ['com', 'net', 'org', 'fr', 'eu', 'info', 'io', 'co', 'biz', 'online', 'site', 'shop', 'app', 'xyz', 'store']

/** Sépare `example.co.uk` en `example` + `co.uk` (approximation sans liste des suffixes publics). */
export function splitDomain(domain: string): { name: string; tld: string } | null {
  const labels = domain.split('.')
  if (labels.length < 2) return null
  const twoLevel = labels.length >= 3 && labels[labels.length - 1].length === 2 && /^(co|com|net|org|gov|ac|edu|gouv|asso)$/.test(labels[labels.length - 2])
  const n = twoLevel ? 2 : 1
  return { name: labels[labels.length - n - 1], tld: labels.slice(-n).join('.') }
}

export interface Candidate {
  domain: string
  fuzzer: string
}

/** Variantes plausibles d'un domaine (omission, inversion, homoglyphes, extension...). */
export function generateCandidates(domain: string): Candidate[] {
  const parts = splitDomain(domain)
  if (!parts) return []
  const { name, tld } = parts
  const out = new Map<string, string>()
  const add = (n: string, t: string, fuzzer: string): void => {
    const d = `${n}.${t}`
    if (d !== domain && !out.has(d) && /^[a-z0-9-]+$/.test(n) && !n.startsWith('-') && !n.endsWith('-') && n.length > 0) out.set(d, fuzzer)
  }
  for (let i = 0; i < name.length; i++) add(name.slice(0, i) + name.slice(i + 1), tld, 'omission')
  for (let i = 0; i < name.length - 1; i++) add(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2), tld, 'transposition')
  for (let i = 0; i < name.length; i++) add(name.slice(0, i + 1) + name[i] + name.slice(i + 1), tld, 'repetition')
  for (let i = 0; i < name.length; i++)
    for (const g of HOMOGLYPHS[name[i]] ?? []) add(name.slice(0, i) + g + name.slice(i + 1), tld, 'homoglyph')
  for (const [from, to] of [['rn', 'm'], ['vv', 'w'], ['cl', 'd']]) if (name.includes(from)) add(name.replace(from, to), tld, 'homoglyph')
  for (let i = 1; i < name.length; i++) add(name.slice(0, i) + '-' + name.slice(i), tld, 'hyphenation')
  for (const t of TLDS) if (t !== tld) add(name, t, 'tld-swap')
  add(name + tld.replace(/\./g, ''), tld, 'tld-merge')
  add('www' + name, tld, 'prefix')
  for (let i = 0; i < name.length; i++)
    for (const k of NEIGHBOURS[name[i]] ?? '') add(name.slice(0, i) + k + name.slice(i + 1), tld, 'keyboard')
  return Array.from(out, ([d, fuzzer]) => ({ domain: d, fuzzer }))
}

/** Ordre de vérification : les variantes les plus souvent enregistrées par les fraudeurs d'abord. */
const PRIORITY = ['tld-swap', 'homoglyph', 'omission', 'repetition', 'transposition', 'hyphenation', 'tld-merge', 'prefix', 'keyboard']

export function prioritize(candidates: Candidate[], max = MAX_CANDIDATES): Candidate[] {
  return [...candidates].sort((a, b) => PRIORITY.indexOf(a.fuzzer) - PRIORITY.indexOf(b.fuzzer)).slice(0, max)
}

export default defineModule({
  id: 'domain.typosquat',
  name: { fr: 'Domaines similaires (typosquatting)', en: 'Lookalike domains (typosquatting)' },
  description: {
    fr: 'Génère jusqu’à 150 variantes proches (faute de frappe, homoglyphe, autre extension...) et vérifie par DNS lesquelles sont enregistrées. Utile contre le phishing. Lancé sur demande.',
    en: 'Generates up to 150 close variants (typos, homoglyphs, other TLDs...) and checks via DNS which ones are registered. Useful against phishing. Run on demand.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  ondemand: true,
  timeoutMs: 120000,
  async run(input, ctx): Promise<ModuleOutput> {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    const candidates = prioritize(generateCandidates(domain))
    let failures = 0
    const checked = await pool(candidates, 10, async (c) => {
      try {
        const ns = await ctx.resolveDns(c.domain, 'NS')
        const a = ns.length ? await ctx.resolveDns(c.domain, 'A').catch(() => []) : await ctx.resolveDns(c.domain, 'A')
        return { ...c, registered: ns.length > 0 || a.length > 0, a }
      } catch {
        failures++
        return { ...c, registered: false, a: [] as string[] }
      }
    })
    if (failures === candidates.length && candidates.length) throw new ModuleError('Résolution DNS impossible', 'unavailable')
    const registered = checked.filter((c) => c.registered)
    if (!registered.length) return { properties: { typosquat_checked: candidates.length } }
    const fr = ctx.lang === 'fr'
    const entities: OutEntity[] = registered.slice(0, MAX_ENTITIES).map((c) => ({
      type: 'domain',
      label: c.domain,
      data: { typosquat_kind: c.fuzzer, a: c.a.slice(0, 5) },
      linkLabel: fr ? 'domaine similaire' : 'lookalike domain'
    }))
    return {
      properties: {
        typosquat_checked: candidates.length,
        typosquat_registered: registered.map((c) => `${c.domain} (${c.fuzzer})`)
      },
      entities,
      raw: registered
    }
  }
})
