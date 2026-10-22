// Matière première des candidats : noms, pseudos, emails et téléphones déjà présents sur
// l'entité étudiée ou dans ses propriétés, et parties locales d'adresse construites à partir
// d'un nom. Fonctions pures.

import type { InputEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { parsePhoneNumberFromString } from 'libphonenumber-js'

export interface PersonName {
  first: string
  last: string
  /** Nom tel qu'il figure sur l'entité, cité dans la raison de la suggestion. */
  display: string
}

export interface LocalPart {
  local: string
  /** Modèle utilisé, dans la langue de l'interface (« prénom.nom »). */
  pattern: string
  /** Rang du modèle : les plus courants d'abord. */
  rank: number
}

const MAX_NAMES = 3
const MAX_PSEUDOS = 5
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Chaînes d'une propriété (texte ou liste de textes). */
function strings(v: PropValue | unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : []
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim())
  return []
}

/** Minuscules sans accents ni ponctuation ; le tiret est conservé. */
export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/^-+|-+$/g, '')
}

/**
 * Découpe « Jean Dupont » ou « DUPONT Jean » en prénom et nom. Un mot entièrement en
 * capitales est pris pour le nom de famille. `null` si le texte ne ressemble pas à un nom.
 */
export function splitFullName(raw: string): PersonName | null {
  const display = raw.trim().replace(/\s+/g, ' ')
  if (!display || display.length > 60 || /[@\d/:]/.test(display)) return null
  const tokens = display.split(' ').filter((t) => /\p{L}/u.test(t))
  if (tokens.length < 2 || tokens.length > 4) return null
  const isCaps = (t: string): boolean => t.length > 1 && t === t.toUpperCase() && t !== t.toLowerCase()
  const caps = tokens.filter(isCaps)
  if (caps.length && caps.length < tokens.length) {
    return { first: tokens.filter((t) => !isCaps(t)).join(' '), last: caps.join(' '), display }
  }
  return { first: tokens[0], last: tokens.slice(1).join(' '), display }
}

const NAME_KEYS = ['display_name', 'name', 'real_name', 'full_name', 'fullname', 'owner_name']
const NESTED_FIRST = ['firstName', 'first_name', 'givenName']
const NESTED_LAST = ['lastName', 'last_name', 'familyName']
const NESTED_FULL = ['displayName', 'display_name', 'fullName', 'full_name', 'name']

/** Noms et prénoms connus de l'entité : champs prénom / nom, nom affiché, libellé d'une personne. */
export function namesOf(input: InputEntity): PersonName[] {
  const out: PersonName[] = []
  const add = (n: PersonName | null): void => {
    if (!n || !slug(n.first) || !slug(n.last)) return
    const key = `${slug(n.first)}|${slug(n.last)}`
    if (!out.some((o) => `${slug(o.first)}|${slug(o.last)}` === key)) out.push(n)
  }
  const first = strings(input.data.first_name)[0]
  const last = strings(input.data.last_name)[0]
  if (first && last) add({ first, last, display: `${first} ${last}` })
  if (input.type === 'person') add(splitFullName(input.label))
  for (const k of NAME_KEYS) for (const v of strings(input.data[k])) add(splitFullName(v))
  // Profils imbriqués (roso.info range le profil brut dans un objet).
  for (const v of Object.values(input.data)) {
    if (!isObj(v)) continue
    const f = NESTED_FIRST.map((k) => v[k]).find((x): x is string => typeof x === 'string' && !!x.trim())
    const l = NESTED_LAST.map((k) => v[k]).find((x): x is string => typeof x === 'string' && !!x.trim())
    if (f && l) add({ first: f.trim(), last: l.trim(), display: `${f.trim()} ${l.trim()}` })
    for (const k of NESTED_FULL) if (typeof v[k] === 'string') add(splitFullName(v[k] as string))
  }
  return out.slice(0, MAX_NAMES)
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/i
const MASKED = /[*•●∗·⋅…■▪◦]/

/** Emails complets (non masqués) figurant dans les propriétés de l'entité. */
export function emailsOf(input: InputEntity): string[] {
  const out = new Set<string>()
  const visit = (v: unknown, depth: number): void => {
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase()
      if (EMAIL_RE.test(s) && !MASKED.test(s)) out.add(s)
    } else if (Array.isArray(v)) v.slice(0, 50).forEach((x) => visit(x, depth))
    else if (isObj(v) && depth < 1) Object.values(v).forEach((x) => visit(x, depth + 1))
  }
  Object.values(input.data).forEach((v) => visit(v, 0))
  if (input.type === 'email') out.delete(input.label.trim().toLowerCase())
  return [...out].slice(0, 30)
}

const PHONE_KEYS = ['e164', 'phone', 'phones', 'phone_number', 'mobile']

/** Téléphones complets (E.164) des propriétés de l'entité, hors le numéro étudié lui-même. */
export function phonesOf(input: InputEntity): string[] {
  const out = new Set<string>()
  for (const k of PHONE_KEYS) {
    for (const v of strings(input.data[k])) {
      if (MASKED.test(v) || /x{2,}/i.test(v)) continue
      const p = parsePhoneNumberFromString(v, 'FR')
      if (p?.isPossible()) out.add(p.number)
    }
  }
  const self = input.type === 'phone' ? parsePhoneNumberFromString(input.label, 'FR')?.number : undefined
  if (self) out.delete(self)
  return [...out]
}

const PSEUDO_RE = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/

/**
 * Pseudos connus : identifiant, alias, libellé d'un pseudo ou d'un compte, partie locale de
 * l'adresse étudiée et des emails de la fiche (les gens réutilisent souvent la même).
 */
export function pseudosOf(input: InputEntity): string[] {
  const raw: string[] = []
  if (input.type === 'username' || input.type === 'account') raw.push(input.label)
  for (const k of ['username', 'aliases', 'previous_usernames']) raw.push(...strings(input.data[k]))
  if (input.type === 'email') raw.push(input.label.split('@')[0])
  for (const e of emailsOf(input)) raw.push(e.split('@')[0])
  const out: string[] = []
  for (const r of raw) {
    const p = r.trim().replace(/^@/, '').toLowerCase()
    // Un identifiant purement numérique est le plus souvent un numéro ou un ID technique.
    if (!PSEUDO_RE.test(p) || /^\d+$/.test(p) || out.includes(p)) continue
    out.push(p)
  }
  return out.slice(0, MAX_PSEUDOS)
}

// Modèles d'adresse à partir d'un nom, du plus courant au plus rare.
const PATTERNS: Array<{ fr: string; en: string; build: (f: string, l: string) => string }> = [
  { fr: 'prénom.nom', en: 'first.last', build: (f, l) => `${f}.${l}` },
  { fr: 'prénomnom', en: 'firstlast', build: (f, l) => f + l },
  { fr: 'p.nom', en: 'f.last', build: (f, l) => `${f[0]}.${l}` },
  { fr: 'pnom', en: 'flast', build: (f, l) => f[0] + l },
  { fr: 'prénom_nom', en: 'first_last', build: (f, l) => `${f}_${l}` },
  { fr: 'prénom-nom', en: 'first-last', build: (f, l) => `${f}-${l}` },
  { fr: 'nom.prénom', en: 'last.first', build: (f, l) => `${l}.${f}` },
  { fr: 'nomprénom', en: 'lastfirst', build: (f, l) => l + f },
  { fr: 'prénom.n', en: 'first.l', build: (f, l) => `${f}.${l[0]}` },
  { fr: 'prénomn', en: 'firstl', build: (f, l) => f + l[0] },
  { fr: 'nomp', en: 'lastf', build: (f, l) => l + f[0] },
  { fr: 'prénom', en: 'first', build: (f) => f },
  { fr: 'nom', en: 'last', build: (_f, l) => l }
]

/** Variantes d'une partie de nom : « Jean-Pierre » donne `jean-pierre` et `jeanpierre`. */
const variants = (s: string): string[] => Array.from(new Set([slug(s), slug(s).replace(/-/g, '')])).filter(Boolean)

/** Parties locales candidates pour un nom, les modèles les plus courants d'abord. */
export function localPartsFor(name: PersonName, lang: 'fr' | 'en'): LocalPart[] {
  const out: LocalPart[] = []
  PATTERNS.forEach((p, rank) => {
    for (const f of variants(name.first))
      for (const l of variants(name.last)) {
        const local = p.build(f, l)
        if (!out.some((o) => o.local === local)) out.push({ local, pattern: lang === 'fr' ? p.fr : p.en, rank })
      }
  })
  return out
}
