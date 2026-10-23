// Registres d'entreprises européens ouverts (Norvège, Finlande, Tchéquie, Irlande) : pays
// probable d'une entreprise, contrôle des numéros nationaux, comparaison des raisons sociales
// et sortie commune, sur le modèle de Companies House.

import type { InputEntity, ModuleContext, ModuleOutput, OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { compact, tr } from '../misc/_util'
import { luhnOk, titleCase } from './_fr'

export type EuCountry = 'NO' | 'FI' | 'CZ' | 'IE'

export const COUNTRY_NAMES: Record<EuCountry, [string, string]> = {
  NO: ['Norvège', 'Norway'],
  FI: ['Finlande', 'Finland'],
  CZ: ['Tchéquie', 'Czechia'],
  IE: ['Irlande', 'Ireland']
}

const COUNTRY_WORDS: Record<string, string> = {
  norvege: 'NO', norway: 'NO', norge: 'NO', nor: 'NO',
  finlande: 'FI', finland: 'FI', suomi: 'FI', fin: 'FI',
  tchequie: 'CZ', 'republique tcheque': 'CZ', czechia: 'CZ', 'czech republic': 'CZ', cesko: 'CZ', 'ceska republika': 'CZ', cze: 'CZ',
  irlande: 'IE', ireland: 'IE', eire: 'IE', irl: 'IE',
  france: 'FR', 'royaume-uni': 'GB', 'united kingdom': 'GB', allemagne: 'DE', germany: 'DE'
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/** Pays déjà connu de l'entreprise (code, nom, juridiction OpenCorporates), en code ISO. */
export function countryHint(data: Record<string, unknown>): string | null {
  for (const k of ['country_code', 'jurisdiction', 'country']) {
    const v = data[k]
    if (typeof v !== 'string' || !v.trim()) continue
    const f = fold(v)
    if (/^[a-z]{2}$/.test(f)) return f.toUpperCase()
    // Juridiction OpenCorporates : `no`, `gb`, `us_de`...
    const j = f.match(/^([a-z]{2})_[a-z]{2}$/)
    if (j) return j[1].toUpperCase()
    if (COUNTRY_WORDS[f]) return COUNTRY_WORDS[f]
  }
  return null
}

// Formes juridiques en fin de raison sociale : un indice fort du pays d'immatriculation.
const SUFFIXES: Array<[EuCountry, RegExp]> = [
  ['NO', /\s(ASA|AS|ANS|NUF|SA|BA)$/],
  ['FI', /(\s(Oyj|Oy|Ab|Ky|Osk|Tmi)$)|(^(Oy|Ab)\s)/i],
  ['CZ', /\s(a\.\s?s\.|s\.\s?r\.\s?o\.|spol\.\s?s\s?r\.\s?o\.|v\.\s?o\.\s?s\.|k\.\s?s\.|z\.\s?s\.|z\.\s?ú\.|o\.\s?p\.\s?s\.)$/i],
  ['IE', /\s(DAC|Designated Activity Company|Teoranta|Teo\.|CGA|ULC|Unlimited Company|CLG|Company Limited by Guarantee)$/i]
]

export function suffixCountry(name: string): EuCountry | null {
  const n = name.trim()
  return SUFFIXES.find(([, re]) => re.test(n))?.[0] ?? null
}

/** Organisasjonsnummer norvégien : 9 chiffres, clé modulo 11 (poids 3 2 7 6 5 4 3 2). */
export function norwegianOrgNr(raw: string): string | null {
  const d = raw.toUpperCase().replace(/^NO/, '').replace(/MVA$/, '').replace(/[\s.-]/g, '')
  if (!/^\d{9}$/.test(d)) return null
  const w = [3, 2, 7, 6, 5, 4, 3, 2]
  const sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0)
  const r = 11 - (sum % 11)
  const check = r === 11 ? 0 : r
  return check !== 10 && check === Number(d[8]) ? d : null
}

/** Y-tunnus finlandais : 7 chiffres, tiret, clé (poids 7 9 10 5 8 4 2). Accepte le n° de TVA `FI01120389`. */
export function finnishBusinessId(raw: string): string | null {
  const s = raw.toUpperCase().replace(/\s/g, '')
  const m = s.match(/^(\d{7})-?(\d)$/) ?? s.match(/^FI(\d{7})(\d)$/)
  if (!m) return null
  const w = [7, 9, 10, 5, 8, 4, 2]
  const r = w.reduce((acc, x, i) => acc + x * Number(m[1][i]), 0) % 11
  if (r === 1) return null
  const check = r === 0 ? 0 : 11 - r
  return check === Number(m[2]) ? `${m[1]}-${m[2]}` : null
}

/** IČO tchèque : 8 chiffres, clé modulo 11 (poids 8 à 2). Accepte le DIČ `CZ00177041`. */
export function czechIco(raw: string): string | null {
  const d = raw.toUpperCase().replace(/^CZ/, '').replace(/\s/g, '')
  if (!/^\d{8}$/.test(d)) return null
  const sum = [8, 7, 6, 5, 4, 3, 2].reduce((s, x, i) => s + x * Number(d[i]), 0)
  const c = 11 - (sum % 11)
  const check = c === 10 ? 0 : c === 11 ? 1 : c
  return check === Number(d[7]) ? d : null
}

/** Numéro CRO irlandais : de 1 à 6 chiffres, reconnu seulement avec un préfixe explicite. */
export function irishCroNumber(raw: string, hinted: boolean): string | null {
  const s = raw.trim().toUpperCase()
  const m = s.match(/^(?:CRO|IE)\s*[:#]?\s*(\d{1,6})$/) ?? (hinted ? s.match(/^(\d{1,6})$/) : null)
  return m ? String(Number(m[1])) : null
}

/** Raison sociale comparable : sans casse, accents, ponctuation ni forme juridique. */
export function euNorm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/[^a-z0-9&]+/g, ' ')
    .replace(
      /\b(asa|as|ans|nuf|oyj|oy|ab|ky|osk|tmi|spol s r o|sro|s r o|a s|v o s|k s|z s|z u|plc|public limited company|ltd|limited|dac|designated activity company|teoranta|teo|clg|ulc|unlimited company|company)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/** Le numéro national saisi ou déjà connu, sinon `null`. */
export function numberFrom(input: InputEntity, parse: (s: string) => string | null): string | null {
  for (const v of [input.data.company_number, input.data.registration_number, input.label]) {
    if (typeof v === 'string' && v.trim()) {
      const n = parse(v)
      if (n) return n
    }
  }
  return null
}

/**
 * Le module d'un pays est proposé pour un numéro national valide, ou pour un nom quand le pays
 * est connu ou que la forme juridique le désigne. Jamais pour une entreprise d'un autre pays.
 */
export function acceptsCountry(input: InputEntity, country: EuCountry, parse: (s: string) => string | null): boolean {
  const hint = countryHint(input.data)
  if (hint && hint !== country) return false
  if (numberFrom(input, parse)) return true
  if (hint === country) return true
  return suffixCountry(input.label) === country
}

export interface Officer {
  /** Personne physique ou entreprise. */
  kind: 'person' | 'company'
  name: string
  role: string
  /** Numéro national d'une entreprise dirigeante. */
  number?: string | null
  /** Année de naissance : seulement pour départager deux homonymes. */
  birthYear?: string | null
  appointedOn?: string | null
}

/**
 * Dirigeants en entités. La date de naissance n'est jamais reprise : quand deux dirigeants
 * portent le même nom, seule l'année de naissance les départage, et ils passent par « À vérifier ».
 */
export function officerEntities(ctx: Pick<ModuleContext, 'lang'>, officers: Officer[], country: EuCountry, max = 25): OutEntity[] {
  const byName = new Map<string, Set<string>>()
  for (const o of officers) if (o.kind === 'person') byName.set(euNorm(o.name), (byName.get(euNorm(o.name)) ?? new Set()).add(o.birthYear ?? '?'))
  const seen = new Set<string>()
  const out: OutEntity[] = []
  for (const o of officers) {
    if (out.length >= max) break
    if (o.kind === 'company') {
      out.push({
        type: 'company',
        label: o.name,
        data: compact({ company_number: o.number ?? null, country_code: o.number ? country : null, appointed_on: o.appointedOn ?? null }),
        linkLabel: o.role
      })
      continue
    }
    const namesakes = (byName.get(euNorm(o.name))?.size ?? 1) > 1
    const label = namesakes && o.birthYear ? `${o.name} (${o.birthYear})` : o.name
    const key = `${label}|${o.role}`
    if (seen.has(key)) continue
    seen.add(key)
    const parts = o.name.split(' ')
    out.push({
      type: 'person',
      label,
      data: compact({
        first_name: parts.length > 1 ? parts.slice(0, -1).join(' ') : null,
        last_name: parts[parts.length - 1],
        occupation: o.role,
        appointed_on: o.appointedOn ?? null
      }),
      linkLabel: o.role,
      ...(namesakes
        ? {
            review: true,
            reviewReason: tr(ctx, 'homonymes parmi les dirigeants : départagés par l’année de naissance', 'namesakes among the officers: told apart by birth year')
          }
        : {})
    })
  }
  return out
}

/** Nom propre d'un registre en capitales (« KLAUS-DIETER » → « Klaus-Dieter »), sinon tel quel. */
export function personName(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => !!p && !!p.trim())
    .map((p) => (p === p.toUpperCase() ? titleCase(p.trim()) : p.trim()))
    .join(' ')
}

export interface EuProfile {
  country: EuCountry
  name: string
  number: string
  properties: Record<string, PropValue | undefined>
  address?: { label: string; street?: string | null; postcode?: string | null; city?: string | null } | null
  website?: string | null
  officers?: Officer[]
  raw?: unknown
}

export function euOutput(ctx: Pick<ModuleContext, 'lang'>, p: EuProfile): ModuleOutput {
  const country = COUNTRY_NAMES[p.country][ctx.lang === 'fr' ? 0 : 1]
  const entities: OutEntity[] = []
  if (p.address?.label) {
    entities.push({
      type: 'address',
      label: p.address.label,
      data: compact({ street: p.address.street ?? null, postcode: p.address.postcode ?? null, city: p.address.city ?? null, country }),
      linkLabel: tr(ctx, 'siège', 'registered office')
    })
  }
  if (p.website) {
    const url = /^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`
    entities.push({ type: 'website', label: url, linkLabel: tr(ctx, 'site officiel', 'official website') })
  }
  entities.push(...officerEntities(ctx, p.officers ?? [], p.country))
  return {
    properties: compact({ name: p.name, company_number: p.number, country, country_code: p.country, ...p.properties, address: p.address?.label ?? null }),
    entities,
    raw: p.raw
  }
}

export interface EuCandidate {
  name: string
  number: string
  address?: string | null
  status?: string | null
  created?: string | null
}

/** Recherche par nom sans correspondance unique : candidats à vérifier. */
export function candidatesOutput(ctx: Pick<ModuleContext, 'lang'>, country: EuCountry, list: EuCandidate[], registry: string, max = 5): ModuleOutput {
  if (!list.length) return {}
  return {
    entities: list.slice(0, max).map((c) => ({
      type: 'company',
      label: c.name,
      data: compact({
        company_number: c.number,
        country: COUNTRY_NAMES[country][ctx.lang === 'fr' ? 0 : 1],
        country_code: country,
        address: c.address ?? null,
        status: c.status ?? null,
        created_at: c.created ?? null
      }),
      linkLabel: tr(ctx, 'correspondance possible', 'possible match'),
      review: true,
      reviewReason: tr(ctx, `nom proche dans le registre ${registry}`, `similar name in the ${registry} register`)
    })),
    raw: list.slice(0, max)
  }
}

/** Correspondance exacte unique (raison sociale normalisée), sinon `null`. */
export function exactMatch<T>(list: T[], name: string, nameOf: (t: T) => string[]): T | null {
  const q = euNorm(name)
  if (!q) return null
  const hits = list.filter((t) => nameOf(t).some((n) => euNorm(n) === q))
  return hits.length === 1 ? hits[0] : null
}

/** Un numéro norvégien à 9 chiffres peut aussi être un SIREN valide : on exige alors le pays. */
export const sirenAmbiguous = (n: string): boolean => /^\d{9}$/.test(n) && luhnOk(n)
