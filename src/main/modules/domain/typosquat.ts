import { domainToASCII } from 'node:url'
import { defineModule, ModuleError, type ModuleOutput, type OutEntity } from '@shared/modules'
import { parseMx } from './_mail'
import { isDomain, normalizeDomain, pool, publicSuffixLength } from './_util'

const MAX_CANDIDATES = 250
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

// Lettres latines et leur sosie cyrillique (а, с, е, о...) : le nom converti en punycode
// s'affiche presque à l'identique dans un navigateur ou un client mail.
const CYRILLIC: Record<string, string> = {
  a: '\u0430',
  c: '\u0441',
  d: '\u0501',
  e: '\u0435',
  h: '\u04bb',
  i: '\u0456',
  j: '\u0458',
  l: '\u04cf',
  o: '\u043e',
  p: '\u0440',
  q: '\u051b',
  s: '\u0455',
  w: '\u051d',
  x: '\u0445',
  y: '\u0443'
}

const VOWELS = 'aeiouy'

// Mots accolés au nom par les campagnes d'hameçonnage (`login-exemple.fr`, `exemple-secure.com`).
const DICTIONARY = ['login', 'secure', 'mail', 'account', 'support', 'fr', 'app']

const TLDS = ['com', 'net', 'org', 'fr', 'eu', 'info', 'io', 'co', 'biz', 'online', 'site', 'shop', 'app', 'xyz', 'store']

/** Sépare `example.co.uk` en `example` + `co.uk` (approximation sans liste des suffixes publics). */
export function splitDomain(domain: string): { name: string; tld: string } | null {
  const labels = domain.split('.')
  if (labels.length < 2) return null
  const n = publicSuffixLength(domain)
  return { name: labels[labels.length - n - 1], tld: labels.slice(-n).join('.') }
}

/** Nom en caractères Unicode converti en punycode (`xn--...`), ou null s'il est refusé. */
export function toPunycode(name: string, tld: string): string | null {
  const ascii = domainToASCII(`${name}.${tld}`)
  return ascii && ascii.endsWith(`.${tld}`) ? ascii.slice(0, -tld.length - 1) : null
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
  // Lettre ajoutée en fin de nom (`exemplee`, `exemples`).
  for (const c of 'abcdefghijklmnopqrstuvwxyz') add(name + c, tld, 'addition')
  // Voyelle remplacée par une autre (`exampla`, `ixample`).
  for (let i = 0; i < name.length; i++)
    if (VOWELS.includes(name[i])) for (const v of VOWELS) if (v !== name[i]) add(name.slice(0, i) + v + name.slice(i + 1), tld, 'vowel-swap')
  // Mot de dictionnaire en préfixe ou suffixe, avec un tiret.
  for (const w of DICTIONARY) {
    add(`${w}-${name}`, tld, 'dictionary')
    add(`${name}-${w}`, tld, 'dictionary')
  }
  // Homoglyphes cyrilliques : une lettre à la fois, puis le nom entier s'il ne contient que des sosies.
  for (let i = 0; i < name.length; i++) {
    const cyr = CYRILLIC[name[i]]
    const puny = cyr ? toPunycode(name.slice(0, i) + cyr + name.slice(i + 1), tld) : null
    if (puny) add(puny, tld, 'cyrillic')
  }
  if ([...name].every((c) => CYRILLIC[c])) {
    const puny = toPunycode([...name].map((c) => CYRILLIC[c]).join(''), tld)
    if (puny) add(puny, tld, 'cyrillic')
  }
  // Bitsquatting : un bit inversé dans un caractère (erreur mémoire), seuls les caractères valides restent.
  for (let i = 0; i < name.length; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const c = String.fromCharCode(name.charCodeAt(i) ^ (1 << bit))
      if (/^[a-z0-9-]$/.test(c)) add(name.slice(0, i) + c + name.slice(i + 1), tld, 'bitsquatting')
    }
  }
  return Array.from(out, ([d, fuzzer]) => ({ domain: d, fuzzer }))
}

/** Ordre de vérification : les variantes les plus souvent enregistrées par les fraudeurs d'abord. */
const PRIORITY = [
  'tld-swap',
  'dictionary',
  'homoglyph',
  'omission',
  'repetition',
  'addition',
  'transposition',
  'hyphenation',
  'vowel-swap',
  'cyrillic',
  'tld-merge',
  'prefix',
  'keyboard',
  'bitsquatting'
]

export function prioritize(candidates: Candidate[], max = MAX_CANDIDATES): Candidate[] {
  return [...candidates].sort((a, b) => PRIORITY.indexOf(a.fuzzer) - PRIORITY.indexOf(b.fuzzer)).slice(0, max)
}

export interface CheckedCandidate extends Candidate {
  registered: boolean
  a: string[]
  mx: string[]
}

/**
 * Sortie du module. Seules les variantes actives (site ou messagerie) deviennent des entités ;
 * une variante qui reçoit des emails sans site web (`mx_only`) sert typiquement à l'hameçonnage
 * par email. Les variantes enregistrées sans A ni MX restent en propriété.
 */
export function buildTyposquatOutput(checked: CheckedCandidate[], ownIps: Set<string>, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const registered = checked.filter((c) => c.registered)
  if (!registered.length) return { properties: { typosquat_checked: checked.length } }
  const sameIp = (c: CheckedCandidate): boolean => c.a.some((ip) => ownIps.has(ip))
  const mxOnly = (c: CheckedCandidate): boolean => c.mx.length > 0 && !c.a.length
  const rank = (c: CheckedCandidate): number => (sameIp(c) ? 0 : mxOnly(c) ? 1 : 2)
  const active = registered.filter((c) => c.a.length || c.mx.length).sort((x, y) => rank(x) - rank(y))
  const entities: OutEntity[] = active.slice(0, MAX_ENTITIES).map((c) => ({
    type: 'domain',
    label: c.domain,
    data: {
      typosquat_kind: c.fuzzer,
      a: c.a.slice(0, 5),
      mx: c.mx.slice(0, 3),
      same_ip_as_target: sameIp(c),
      mx_only: mxOnly(c) || null
    },
    linkLabel: sameIp(c)
      ? fr
        ? 'domaine similaire (même IP)'
        : 'lookalike domain (same IP)'
      : mxOnly(c)
        ? fr
          ? 'domaine similaire (email seul)'
          : 'lookalike domain (email only)'
        : fr
          ? 'domaine similaire'
          : 'lookalike domain'
  }))
  return {
    properties: {
      typosquat_checked: checked.length,
      typosquat_registered: registered.map((c) => `${c.domain} (${c.fuzzer})`),
      typosquat_mx_only: registered.filter(mxOnly).map((c) => c.domain)
    },
    entities,
    raw: registered
  }
}

export default defineModule({
  id: 'domain.typosquat',
  name: { fr: 'Domaines similaires (typosquatting)', en: 'Lookalike domains (typosquatting)' },
  description: {
    fr: 'Génère jusqu’à 250 variantes proches (faute de frappe, lettre ajoutée, voyelle, homoglyphe latin ou cyrillique, bit inversé, mot comme « login » ou « secure », autre extension...) et vérifie par DNS lesquelles sont enregistrées, avec leur site et leur messagerie. Une variante qui reçoit des emails sans site web est signalée (hameçonnage par email). Lancé sur demande.',
    en: 'Generates up to 250 close variants (typos, added letter, vowel swap, Latin or Cyrillic homoglyphs, bit flips, words like “login” or “secure”, other TLDs...) and checks via DNS which ones are registered, with their website and mail servers. A variant that receives email without a website is flagged (email phishing). Run on demand.'
  },
  category: 'domain',
  inputTypes: ['domain'],
  ondemand: true,
  timeoutMs: 120000,
  async run(input, ctx): Promise<ModuleOutput> {
    const domain = normalizeDomain(input.label)
    if (!isDomain(domain)) throw new ModuleError('Domaine invalide', 'invalid_input')
    const candidates = prioritize(generateCandidates(domain))
    // IP du domaine d'origine : une variante sur la même IP appartient souvent au même propriétaire.
    const own = new Set(await ctx.resolveDns(domain, 'A').catch(() => [] as string[]))
    let failures = 0
    let done = 0
    const checked = await pool(candidates, 10, async (c): Promise<CheckedCandidate> => {
      try {
        const ns = await ctx.resolveDns(c.domain, 'NS')
        const a = ns.length ? await ctx.resolveDns(c.domain, 'A').catch(() => []) : await ctx.resolveDns(c.domain, 'A')
        const registered = ns.length > 0 || a.length > 0
        // MX d'une variante enregistrée ; un « null MX » (0 .) déclare n'accepter aucun email.
        const mx = registered ? parseMx(await ctx.resolveDns(c.domain, 'MX').catch(() => [])).hosts.map((h) => h.host) : []
        return { ...c, registered, a, mx }
      } catch {
        failures++
        return { ...c, registered: false, a: [], mx: [] }
      } finally {
        ctx.progress(++done, candidates.length, c.domain)
      }
    })
    if (failures === candidates.length && candidates.length) throw new ModuleError('Résolution DNS impossible', 'unavailable')
    return buildTyposquatOutput(checked, own, ctx.lang)
  }
})
