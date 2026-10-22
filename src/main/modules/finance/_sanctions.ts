// Listes de sanctions : registre national des gels (DG Trésor), liste consolidée de l'Union
// européenne et liste SDN de l'OFAC. Lecture des trois formats, index commun (noms, courriels,
// sites, téléphones, identifiants) et appariement avec l'entité d'entrée.

import type { ModuleOutput, OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'
import { splitCsvLine } from '../crypto/ofac'
import { cappedList, compact, normalizeDomain } from '../domain/_util'
import { EMAIL_PROVIDERS } from '../hints/_domains'
import type { PartialDate } from '../person/frDirigeants'

export type SanctionSource = 'fr' | 'eu' | 'ofac'
export type SanctionKind = 'person' | 'entity' | 'vessel'

export interface BirthDate {
  year: number
  month?: number
  day?: number
  /** Date approximative (« vers », `circa`). */
  circa?: boolean
}

export interface SanctionEntry {
  source: SanctionSource
  /** Identifiant dans la liste d'origine (IdRegistre, logicalId, ent_num). */
  id: string
  kind: SanctionKind
  name: string
  aliases: string[]
  birthDates: BirthDate[]
  birthPlaces: string[]
  nationalities: string[]
  /** Fonctions publiées (« ministre des affaires étrangères »). */
  titles: string[]
  /** Motifs de l'inscription. */
  reasons: string[]
  /** Fondements juridiques (règlements, résolutions). */
  legalBases: string[]
  /** Régimes de sanctions (« UE Ukraine intégrité territoriale », `RUSSIA-EO14024`). */
  programmes: string[]
  euRefs: string[]
  unRefs: string[]
  emails: string[]
  websites: string[]
  phones: string[]
  /** Numéros d'enregistrement, fiscaux, OMI, passeports, adresses de portefeuille. */
  identifiers: string[]
  addresses: string[]
  /** Date de la première inscription (AAAA-MM-JJ). */
  listedAt?: string
  url?: string
}

export const SOURCE_LABELS: Record<SanctionSource, { fr: string; en: string }> = {
  fr: { fr: 'Registre national des gels (DG Trésor)', en: 'French national asset freeze register (DG Trésor)' },
  eu: { fr: 'Liste consolidée des sanctions de l’UE', en: 'EU consolidated sanctions list' },
  ofac: { fr: 'Liste SDN de l’OFAC (États-Unis)', en: 'OFAC SDN list (United States)' }
}

// ---------------------------------------------------------------------------------------------
// Normalisation

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// Formes juridiques ignorées dans les dénominations (latines et cyrilliques).
const LEGAL_FORMS = new Set(
  (
    'llc ooo oao zao pao ao jsc pjsc cjsc ojsc ltd limited co company corp corporation inc incorporated plc gmbh ag sa sas sasu sarl ' +
    'srl spa bv nv fze fzco fzc fz llp lp pte pvt private sdn bhd as ab oy kft doo tov pp sc the and of ' +
    'ооо оао зао пао ао тов'
  ).split(' ')
)

/** Mots d'un nom, sans accents ni ponctuation ; pour une entité, sans la forme juridique. */
export function nameTokens(s: string, entity = false): string[] {
  const tokens = fold(s)
    .replace(/['’`]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
  return entity ? tokens.filter((t) => !LEGAL_FORMS.has(t)) : tokens
}

/** Hôte d'un site publié (`https://www.x.ru/` → `x.ru`), `null` si ce n'est pas un domaine. */
export function hostOf(raw: string): string | null {
  const h = normalizeDomain(raw.trim())
  return /^[a-z0-9\p{L}-]+(\.[a-z0-9\p{L}-]+)+$/u.test(h) ? h : null
}

/** Clé de comparaison d'un numéro : ses 9 derniers chiffres (formats national et international). */
export function phoneKey(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8) return null
  return digits.length > 9 ? digits.slice(-9) : digits
}

/** Clé d'un identifiant : capitales et chiffres, au moins 6 caractères dont 4 chiffres. */
export function identKey(raw: string): string | null {
  const k = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return k.length >= 6 && (k.match(/\d/g)?.length ?? 0) >= 4 ? k : null
}

/** Valeurs multiples d'un même champ (« a.com; b.com », « +7 ..., +7 ... »). */
function splitValues(raw: string): string[] {
  return raw
    .split(/\s*[;,]\s*|\s+(?=https?:\/\/)/)
    .map((v) => v.trim())
    .filter(Boolean)
}

/** Numéros d'un champ téléphone : « Télécopie : +850-2-381-4410/4416 » donne un numéro. */
function splitPhones(raw: string): string[] {
  return raw
    .replace(/^[^+\d(]*/, '')
    .split(/\s*[;,]\s*|\s+(?:ou|or|et|and)\s+/)
    .map((v) => v.split('/')[0].trim())
    .filter((v) => (v.match(/\d/g)?.length ?? 0) >= 8)
}

const CRYPTO_RE = /\b(0x[0-9a-fA-F]{40}|bc1[02-9ac-hj-np-z]{25,62}|T[1-9A-HJ-NP-Za-km-z]{33}|[13][1-9A-HJ-NP-Za-km-z]{25,34})\b/g

/** Adresses de portefeuille citées dans un texte d'identification. */
export function cryptoAddresses(text: string): string[] {
  return Array.from(text.matchAll(CRYPTO_RE), (m) => m[1])
}

const uniq = <T>(list: Iterable<T>): T[] => Array.from(new Set(list))

// ---------------------------------------------------------------------------------------------
// Dates

const FR_MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number): string => String(n).padStart(2, '0')

/** Dates citées dans un fondement juridique (« du 25/02/2022 », « du 15 juin 2026 »), au format ISO. */
export function frenchDates(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) out.push(`${m[3]}-${pad(+m[2])}-${pad(+m[1])}`)
  for (const m of fold(text).matchAll(/\b(\d{1,2})(?:er)? ([a-z]+) (\d{4})\b/g)) {
    const month = FR_MONTHS.indexOf(m[2]) + 1
    if (month) out.push(`${m[3]}-${pad(month)}-${pad(+m[1])}`)
  }
  return out
}

const earliest = (dates: Array<string | undefined>): string | undefined =>
  dates.filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0]

/** Régime de sanctions d'un fondement : texte de la dernière parenthèse, avant le tiret. */
export function regimeOf(label: string): string | null {
  const s = label.trim()
  if (!s.endsWith(')')) return null
  let depth = 0
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ')') depth++
    else if (s[i] === '(' && --depth === 0) {
      const inner = s.slice(i + 1, -1).split(' - ')[0].trim()
      return /^(UE|ONU|Dispositif)/.test(inner) ? inner : null
    }
  }
  return null
}

export function formatBirthDate(b: BirthDate, lang: 'fr' | 'en' = 'fr'): string {
  const core = b.day && b.month ? `${pad(b.day)}/${pad(b.month)}/${b.year}` : b.month ? `${pad(b.month)}/${b.year}` : String(b.year)
  return b.circa ? (lang === 'fr' ? `vers ${core}` : `circa ${core}`) : core
}

// ---------------------------------------------------------------------------------------------
// Registre national des gels (DG Trésor), flux JSON

interface GelsValue {
  [key: string]: unknown
}

interface GelsField {
  TypeChamp: string
  Valeur?: GelsValue[]
}

export interface GelsJson {
  Publications?: {
    DatePublication?: string
    PublicationDetail?: Array<{ IdRegistre: number; Nature?: string; Nom?: string; RegistreDetail?: GelsField[] }>
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

export function parseGels(json: GelsJson): SanctionEntry[] {
  const out: SanctionEntry[] = []
  for (const e of json.Publications?.PublicationDetail ?? []) {
    const fields = (type: string): GelsValue[] => (e.RegistreDetail ?? []).filter((f) => f.TypeChamp === type).flatMap((f) => f.Valeur ?? [])
    const values = (type: string, key: string): string[] => fields(type).map((v) => text(v[key])).filter(Boolean)
    const kind: SanctionKind = /physique/i.test(e.Nature ?? '') ? 'person' : /navire/i.test(e.Nature ?? '') ? 'vessel' : 'entity'
    const first = values('PRENOM', 'Prenom').join(' ')
    const name = [text(e.Nom), kind === 'person' ? first : ''].filter(Boolean).join(' ')
    if (!name) continue
    const legalBases = values('FONDEMENT_JURIDIQUE', 'FondementJuridiqueLabel')
    const identification = fields('IDENTIFICATION').map((v) => text(v.Identification))
    out.push({
      source: 'fr',
      id: String(e.IdRegistre),
      kind,
      name,
      aliases: values('ALIAS', 'Alias'),
      birthDates: fields('DATE_DE_NAISSANCE')
        .map((v) => ({
          year: Number(v.Annee),
          month: Number(v.Mois) || undefined,
          day: Number(v.Jour) || undefined,
          circa: /vers|environ|circa/i.test(text(v.Commentaire)) || undefined
        }))
        .filter((b) => b.year > 1800),
      birthPlaces: fields('LIEU_DE_NAISSANCE').map((v) => [text(v.Lieu), text(v.Pays)].filter(Boolean).join(', ')).filter(Boolean),
      nationalities: values('NATIONALITE', 'Pays'),
      titles: values('TITRE', 'Titre'),
      reasons: values('MOTIFS', 'Motifs'),
      legalBases,
      programmes: uniq(legalBases.map(regimeOf).filter((r): r is string => !!r)),
      euRefs: values('REFERENCE_UE', 'ReferenceUe'),
      unRefs: values('REFERENCE_ONU', 'ReferenceOnu'),
      emails: values('COURRIEL', 'Courriel').flatMap(splitValues),
      websites: values('SITE_INTERNET', 'SiteInternet').flatMap(splitValues),
      phones: values('TELEPHONE', 'Telephone').flatMap(splitPhones),
      identifiers: [...identification, ...values('AUTRE_IDENTITE', 'NumeroCarte'), ...values('PASSEPORT', 'NumeroPasseport'), ...values('NUMERO_OMI', 'NumeroOMI')]
        .filter((v) => v && v !== '/'),
      addresses: [...fields('ADRESSE_PM'), ...fields('ADRESSE_PP')].map((v) => [text(v.Adresse), text(v.Pays)].filter(Boolean).join(', ')).filter(Boolean),
      listedAt: earliest(legalBases.flatMap(frenchDates))
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Liste consolidée de l'UE (FSF), XML : lecture ciblée par expressions régulières

const decodeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function attrs(s: string): Record<string, string> {
  const o: Record<string, string> = {}
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = decodeXml(m[2]).trim()
  return o
}

const tags = (block: string, tag: string): Array<Record<string, string>> =>
  Array.from(block.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'g')), (m) => attrs(m[1]))

export function parseEuXml(xml: string): SanctionEntry[] {
  const out: SanctionEntry[] = []
  for (const m of xml.matchAll(/<sanctionEntity\b([^>]*)>([\s\S]*?)<\/sanctionEntity>/g)) {
    const head = attrs(m[1])
    const block = m[2]
    const subject = tags(block, 'subjectType')[0]?.code
    const kind: SanctionKind = subject === 'person' ? 'person' : 'entity'
    const names = tags(block, 'nameAlias').map((a) => ({
      name: (a.wholeName || [a.firstName, a.middleName, a.lastName].filter(Boolean).join(' ')).replace(/\s+/g, ' '),
      lang: a.nameLanguage ?? '',
      fn: a.function ?? ''
    }))
    const main = names.find((n) => (n.lang === '' || n.lang === 'EN') && /[a-z]/i.test(n.name)) ?? names[0]
    if (!main?.name) continue
    const functions = uniq(names.map((n) => n.fn).filter(Boolean))
    const regulations = tags(block, 'regulation')
    const contacts = tags(block, 'contactInfo')
    const contact = (key: string): string[] => contacts.filter((c) => c.key === key).flatMap((c) => splitValues(c.value ?? ''))
    const publication = Array.from(block.matchAll(/publicationDate="(\d{4}-\d{2}-\d{2})"/g), (d) => d[1])
    const pubUrl = block.match(/<publicationUrl>([^<]+)<\/publicationUrl>/)?.[1]
    out.push({
      source: 'eu',
      id: head.logicalId ?? head.euReferenceNumber ?? main.name,
      kind,
      name: main.name,
      aliases: uniq(names.map((n) => n.name).filter((n) => n && n !== main.name)),
      birthDates: tags(block, 'birthdate')
        .map((b) => ({
          year: Number(b.year),
          month: Number(b.monthOfYear) || undefined,
          day: Number(b.dayOfMonth) || undefined,
          circa: b.circa === 'true' || undefined
        }))
        .filter((b) => b.year > 1800),
      birthPlaces: tags(block, 'birthdate')
        .map((b) => [b.city || b.place, b.countryDescription && b.countryDescription !== 'UNKNOWN' ? b.countryDescription : ''].filter(Boolean).join(', '))
        .filter(Boolean),
      nationalities: uniq(tags(block, 'citizenship').map((c) => c.countryDescription).filter((c) => c && c !== 'UNKNOWN')),
      // Pour une personne, `function` est sa fonction ; pour une entité, l'exposé des motifs.
      titles: kind === 'person' ? functions : [],
      reasons: kind === 'person' ? [] : functions,
      legalBases: uniq(regulations.map((r) => r.numberTitle).filter(Boolean)),
      programmes: uniq(regulations.map((r) => r.programme).filter(Boolean)),
      euRefs: head.euReferenceNumber ? [head.euReferenceNumber] : [],
      unRefs: head.unitedNationId ? [head.unitedNationId] : [],
      emails: contact('EMAIL'),
      websites: contact('WEB'),
      phones: contacts.filter((c) => c.key === 'PHONE' || c.key === 'FAX').flatMap((c) => splitPhones(c.value ?? '')),
      identifiers: tags(block, 'identification').map((i) => i.number).filter(Boolean),
      addresses: tags(block, 'address')
        .map((a) => [a.street, a.zipCode, a.city, a.countryDescription !== 'UNKNOWN' ? a.countryDescription : ''].filter(Boolean).join(', '))
        .filter(Boolean),
      listedAt: earliest([head.designationDate, ...publication]),
      url: pubUrl ? decodeXml(pubUrl) : undefined
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Liste SDN de l'OFAC (CSV) : sdn.csv, alt.csv (alias) et sdn_comments.csv (remarques longues)

const cleanCsv = (v: string | undefined): string => {
  const s = (v ?? '').trim()
  return s === '-0-' ? '' : s
}

/** `DOB 10 Dec 1948`, `DOB circa 1960`, `DOB 1960 to 1962`. */
export function ofacBirthDates(value: string): BirthDate[] {
  const circa = /circa/i.test(value)
  const parts = value.replace(/circa/i, '').split(/\s+to\s+/i)
  const parsed = parts.map((p) => {
    const m = p.trim().match(/^(?:(\d{1,2}) )?(?:([A-Za-z]{3})[a-z]* )?(\d{4})$/)
    if (!m) return null
    const month = m[2] ? EN_MONTHS.indexOf(m[2].toLowerCase()) + 1 : 0
    return { year: Number(m[3]), month: month || undefined, day: m[1] ? Number(m[1]) : undefined, circa: circa || undefined }
  })
  if (parsed.length === 2 && parsed[0] && parsed[1] && !parsed[0].month && parsed[1].year - parsed[0].year <= 10) {
    const out: BirthDate[] = []
    for (let y = parsed[0].year; y <= parsed[1].year; y++) out.push({ year: y })
    return out
  }
  return parsed.filter((b): b is NonNullable<typeof b> => !!b)
}

export function parseOfac(sdnCsv: string, altCsv = '', commentsCsv = ''): SanctionEntry[] {
  const remarks = new Map<string, string>()
  const rows: string[][] = []
  for (const line of sdnCsv.split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue
    const f = splitCsvLine(line)
    rows.push(f)
    remarks.set(f[0], cleanCsv(f[11]))
  }
  for (const line of commentsCsv.split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue
    const f = splitCsvLine(line)
    if (remarks.has(f[0])) remarks.set(f[0], remarks.get(f[0]) + (f[1] ?? ''))
  }
  const aliases = new Map<string, string[]>()
  for (const line of altCsv.split(/\r?\n/)) {
    if (!/^\d/.test(line)) continue
    const f = splitCsvLine(line)
    const alt = cleanCsv(f[3])
    if (alt) aliases.set(f[0], [...(aliases.get(f[0]) ?? []), alt])
  }

  const out: SanctionEntry[] = []
  for (const f of rows) {
    const type = cleanCsv(f[2]).toLowerCase()
    const kind: SanctionKind = type === 'individual' ? 'person' : type === 'vessel' || type === 'aircraft' ? 'vessel' : 'entity'
    const entry: SanctionEntry = {
      source: 'ofac',
      id: f[0],
      kind,
      name: cleanCsv(f[1]),
      aliases: aliases.get(f[0]) ?? [],
      birthDates: [],
      birthPlaces: [],
      nationalities: [],
      titles: cleanCsv(f[4]) ? [cleanCsv(f[4])] : [],
      reasons: [],
      legalBases: [],
      programmes: cleanCsv(f[3])
        .split(/\]\s*\[/)
        .map((p) => p.replace(/[[\]]/g, '').trim())
        .filter(Boolean),
      euRefs: [],
      unRefs: [],
      emails: [],
      websites: [],
      phones: [],
      identifiers: [],
      addresses: []
    }
    if (!entry.name) continue
    for (const raw of (remarks.get(f[0]) ?? '').split(';')) {
      const item = raw
        .trim()
        .replace(/^alt\.\s+/i, '')
        .replace(/\.$/, '')
      let m: RegExpMatchArray | null
      if ((m = item.match(/^DOB (.+)$/))) entry.birthDates.push(...ofacBirthDates(m[1]))
      else if ((m = item.match(/^POB (.+)$/))) entry.birthPlaces.push(m[1])
      else if ((m = item.match(/^(?:nationality|citizen) (.+)$/i))) entry.nationalities.push(m[1])
      else if ((m = item.match(/^Email Address (.+)$/i))) entry.emails.push(...splitValues(m[1]))
      else if ((m = item.match(/^Website (.+)$/i))) entry.websites.push(...splitValues(m[1]))
      else if ((m = item.match(/^(?:Phone(?: Number)?|Telephone|Fax(?: Number)?):? (.+)$/i))) entry.phones.push(...splitPhones(m[1]))
      else if ((m = item.match(/^Digital Currency Address - \w+ (\S+)$/))) entry.identifiers.push(m[1])
      else if (!/^a\.k\.a\./i.test(item)) {
        // Autres identifiants (immatriculation, numéro fiscal, OMI, SWIFT...) : jetons à chiffres.
        for (const t of item.replace(/\(.*?\)/g, ' ').match(/\b[A-Z0-9][A-Z0-9-]{5,}\b/gi) ?? []) if (identKey(t)) entry.identifiers.push(t)
      }
    }
    out.push(entry)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Index

export interface SanctionsIndex {
  entries: SanctionEntry[]
  /** Noms et alias de chaque entrée, en mots normalisés séparés par une espace. */
  variants: string[][]
  byToken: Map<string, number[]>
  byEmail: Map<string, number[]>
  byHost: Map<string, number[]>
  /** Domaine des courriels publiés (hors messageries grand public). */
  byMailDomain: Map<string, number[]>
  byPhone: Map<string, number[]>
  byIdent: Map<string, number[]>
  /** Textes d'identification qui citent des portefeuilles (adresses parfois collées entre elles). */
  cryptoTexts: Array<[number, string]>
}

const FREE_MAIL = new Set([...EMAIL_PROVIDERS, 'mail.ru', 'yandex.ru', 'yandex.com', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru', 'qq.com', '163.com', '126.com', 'yahoo.co.uk'])

function push(map: Map<string, number[]>, key: string | null, i: number): void {
  if (!key) return
  const list = map.get(key)
  if (!list) map.set(key, [i])
  else if (list[list.length - 1] !== i) list.push(i)
}

/**
 * Copie autonome des entrées : les chaînes extraites d'un gros fichier (XML de 25 Mo) ou
 * construites caractère par caractère (CSV) retiendraient sinon le texte source en mémoire.
 */
export function detach(entries: SanctionEntry[]): SanctionEntry[] {
  // Les listes vides, très nombreuses, partagent une seule instance.
  const empty: unknown[] = []
  return JSON.parse(JSON.stringify(entries), (_k, v: unknown) => (Array.isArray(v) && !v.length ? empty : v)) as SanctionEntry[]
}

export function buildIndex(entries: SanctionEntry[]): SanctionsIndex {
  const idx: SanctionsIndex = {
    entries,
    variants: [],
    byToken: new Map(),
    byEmail: new Map(),
    byHost: new Map(),
    byMailDomain: new Map(),
    byPhone: new Map(),
    byIdent: new Map(),
    cryptoTexts: []
  }
  entries.forEach((e, i) => {
    const entity = e.kind !== 'person'
    const variants = uniq([e.name, ...e.aliases].map((n) => nameTokens(n, entity).join(' '))).filter(Boolean)
    idx.variants.push(variants)
    for (const t of new Set(variants.flatMap((v) => v.split(' ')))) push(idx.byToken, t, i)
    for (const mail of e.emails) {
      const m = mail.toLowerCase().replace(/^mailto:/, '')
      if (!m.includes('@')) continue
      push(idx.byEmail, m, i)
      const domain = m.split('@')[1]
      if (domain && !FREE_MAIL.has(domain)) push(idx.byMailDomain, domain, i)
    }
    for (const w of e.websites) push(idx.byHost, hostOf(w), i)
    for (const p of e.phones) push(idx.byPhone, phoneKey(p), i)
    for (const id of e.identifiers) {
      for (const addr of cryptoAddresses(id)) push(idx.byIdent, addr.toLowerCase(), i)
      if (/portefeuille|wallet|digital currency|0x[0-9a-f]{40}|bc1/i.test(id)) idx.cryptoTexts.push([i, id])
      push(idx.byIdent, identKey(id), i)
    }
  })
  return idx
}

// ---------------------------------------------------------------------------------------------
// Appariement

export type MatchBasis = 'email' | 'website' | 'phone' | 'identifier' | 'wallet' | 'name_birth' | 'name' | 'mail_domain'

export interface SanctionHit {
  entry: SanctionEntry
  basis: MatchBasis
  /** Valeur commune (courriel, site, numéro) ou variante du nom qui correspond. */
  matched: string
  /** 3 : nom identique ; 2 : nom contenu ; 1 : dénomination approchante. */
  score: number
}

/** Le nom saisi correspond-il à une variante publiée (mêmes mots, dans n'importe quel ordre) ? */
export function variantScore(query: string[], variant: string[], entity: boolean): number {
  const Q = new Set(query)
  const V = new Set(variant)
  const qInV = [...Q].every((t) => V.has(t))
  const vInQ = [...V].every((t) => Q.has(t))
  if (qInV && vInQ) return 3
  if (entity) return qInV && Q.size >= 2 && V.size - Q.size <= 1 ? 1 : 0
  if (Q.size < 2 || V.size < 2) return 0
  return qInV || vInQ ? 2 : 0
}

export type BirthVerdict = 'confirmed' | 'possible' | 'excluded'

/** Date de naissance connue comparée aux dates publiées ; jour identique = confirmée. */
export function birthVerdict(known: PartialDate | null | undefined, published: BirthDate[]): BirthVerdict {
  if (!known || !published.length) return 'possible'
  let possible = false
  for (const b of published) {
    const yearOk = b.circa ? Math.abs(b.year - known.year) <= 2 : b.year === known.year
    const monthOk = !b.month || !known.month || b.month === known.month
    const dayOk = !b.day || !known.day || b.day === known.day
    if (!yearOk || !monthOk || !dayOk) continue
    if (!b.circa && b.day && known.day && b.month && known.month) return 'confirmed'
    possible = true
  }
  return possible ? 'possible' : 'excluded'
}

export interface NameQuery {
  names: string[]
  entity: boolean
  birth?: PartialDate | null
}

export interface NameResult {
  hits: Array<SanctionHit & { birth: BirthVerdict }>
  /** Correspondances écartées : dates de naissance incompatibles. */
  excluded: SanctionHit[]
}

export function matchNames(idx: SanctionsIndex, q: NameQuery): NameResult {
  const best = new Map<number, SanctionHit>()
  for (const raw of q.names) {
    const query = nameTokens(raw, q.entity)
    if (!query.length || (!q.entity && query.length < 2) || query.join('').length < 4) continue
    const candidates = new Set<number>()
    for (const t of query) for (const i of idx.byToken.get(t) ?? []) candidates.add(i)
    for (const i of candidates) {
      const e = idx.entries[i]
      if ((e.kind === 'person') === q.entity) continue
      let top = 0
      let matched = ''
      for (const v of idx.variants[i]) {
        const s = variantScore(query, v.split(' '), q.entity)
        if (s > top) {
          top = s
          matched = v
        }
      }
      if (top && top > (best.get(i)?.score ?? 0)) best.set(i, { entry: e, basis: 'name', matched, score: top })
    }
  }
  const out: NameResult = { hits: [], excluded: [] }
  for (const hit of best.values()) {
    const birth = q.entity ? 'possible' : birthVerdict(q.birth, hit.entry.birthDates)
    if (birth === 'excluded') out.excluded.push(hit)
    else out.hits.push({ ...hit, basis: birth === 'confirmed' ? 'name_birth' : 'name', birth })
  }
  out.hits.sort((a, b) => Number(b.birth === 'confirmed') - Number(a.birth === 'confirmed') || b.score - a.score)
  return out
}

/** Correspondances exactes : courriel, site, téléphone, identifiant ou portefeuille. */
export function matchExact(idx: SanctionsIndex, type: string, value: string, extraIds: string[] = []): SanctionHit[] {
  const hits: SanctionHit[] = []
  const add = (list: number[] | undefined, basis: MatchBasis, matched: string): void => {
    for (const i of list ?? []) if (!hits.some((h) => h.entry === idx.entries[i])) hits.push({ entry: idx.entries[i], basis, matched, score: 3 })
  }
  if (type === 'email') {
    const mail = value.trim().toLowerCase()
    add(idx.byEmail.get(mail), 'email', mail)
  } else if (type === 'domain' || type === 'website' || type === 'url') {
    const host = hostOf(value)
    if (host) add(idx.byHost.get(host), 'website', host)
  } else if (type === 'phone') {
    const key = phoneKey(value)
    if (key) add(idx.byPhone.get(key), 'phone', value.trim())
  } else if (type === 'crypto_wallet') {
    const addr = value.trim()
    add(idx.byIdent.get(addr.toLowerCase()), 'wallet', addr)
    if (addr.length >= 25)
      for (const [i, t] of idx.cryptoTexts) if (t.includes(addr)) add([i], 'wallet', addr)
  }
  for (const id of extraIds) add(idx.byIdent.get(identKey(id) ?? ''), 'identifier', id)
  return hits
}

/** Courriel dont le domaine est celui d'une entité sanctionnée (site ou courriels publiés). */
export function matchMailDomain(idx: SanctionsIndex, email: string): SanctionHit[] {
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain || FREE_MAIL.has(domain)) return []
  const ids = uniq([...(idx.byHost.get(domain) ?? []), ...(idx.byMailDomain.get(domain) ?? [])])
  return ids.map((i) => ({ entry: idx.entries[i], basis: 'mail_domain' as const, matched: domain, score: 1 }))
}

/** Domaine qui héberge les courriels publiés d'une entité sanctionnée. */
export function matchDomainMail(idx: SanctionsIndex, domainOrUrl: string): SanctionHit[] {
  const host = hostOf(domainOrUrl)
  if (!host) return []
  return (idx.byMailDomain.get(host) ?? [])
    .filter((i) => !(idx.byHost.get(host) ?? []).includes(i))
    .map((i) => ({ entry: idx.entries[i], basis: 'mail_domain' as const, matched: host, score: 1 }))
}

// ---------------------------------------------------------------------------------------------
// Regroupement des listes et sortie

/** Une même cible inscrite sur plusieurs listes. */
export interface SanctionGroup {
  entries: SanctionEntry[]
  hit: SanctionHit & { birth?: BirthVerdict }
}

const sameTarget = (a: SanctionEntry, b: SanctionEntry): boolean => {
  if (a.source === b.source || a.kind !== b.kind) return false
  if (a.euRefs.some((r) => b.euRefs.includes(r))) return true
  if (a.kind === 'person') {
    const full = (e: SanctionEntry): string[] => e.birthDates.filter((d) => d.day && d.month).map((d) => `${d.year}-${d.month}-${d.day}`)
    return full(a).some((d) => full(b).includes(d))
  }
  const names = (e: SanctionEntry): string[] => [e.name, ...e.aliases].map((n) => nameTokens(n, true).sort().join(' '))
  return names(a).some((n) => n && names(b).includes(n))
}

/** Regroupe les correspondances qui désignent la même cible (référence UE, naissance, dénomination). */
export function groupHits<H extends SanctionHit>(hits: H[]): Array<{ entries: SanctionEntry[]; hit: H }> {
  const groups: Array<{ entries: SanctionEntry[]; hit: H }> = []
  for (const h of hits) {
    const g = groups.find((x) => x.entries.some((e) => sameTarget(e, h.entry)))
    if (g) {
      if (!g.entries.includes(h.entry)) g.entries.push(h.entry)
    } else groups.push({ entries: [h.entry], hit: h })
  }
  for (const g of groups) g.entries.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))
  return groups
}

const SOURCE_ORDER: SanctionSource[] = ['fr', 'eu', 'ofac']
const trim = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Données d'une inscription, fusionnées sur toutes les listes du groupe. */
export function groupData(entries: SanctionEntry[], lang: 'fr' | 'en'): Record<string, PropValue> {
  const sorted = [...entries].sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))
  const all = <K extends keyof SanctionEntry>(k: K): string[] => uniq(sorted.flatMap((e) => e[k] as unknown as string[]))
  // Motifs dans la langue de l'interface d'abord : français au registre, anglais dans la liste UE.
  const reasons = uniq([...sorted.filter((e) => (e.source === 'fr') === (lang === 'fr')), ...sorted].flatMap((e) => e.reasons))
  const births = uniq(sorted.flatMap((e) => e.birthDates.map((b) => formatBirthDate(b, lang))))
  const fr = sorted.find((e) => e.source === 'fr')
  const ofac = sorted.find((e) => e.source === 'ofac')
  return compact({
    sanctioned_entity: sorted[0].name,
    sanctions_lists: sorted.map((e) => SOURCE_LABELS[e.source][lang]),
    sanctions_reasons: reasons.slice(0, 3).map((r) => trim(r, 600)),
    sanctions_legal_bases: all('legalBases').slice(0, 10),
    sanction_programs: all('programmes'),
    sanctions_eu_refs: all('euRefs'),
    sanctions_un_refs: all('unRefs'),
    sanctions_birth_dates: births,
    birth_place: all('birthPlaces')[0],
    nationality: all('nationalities').slice(0, 3).join(', ') || undefined,
    job_title: all('titles')[0] ? trim(all('titles')[0], 300) : undefined,
    address: sorted[0].kind !== 'person' ? all('addresses')[0] : undefined,
    ...cappedList('aliases', all('aliases').filter((a) => a !== sorted[0].name), 10),
    dgtresor_id: fr?.id,
    ofac_id: ofac?.id,
    sanctions_url: sorted.find((e) => e.url)?.url ?? (ofac ? `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${ofac.id}` : undefined)
  })
}

const BASIS_LABELS: Record<MatchBasis, { fr: string; en: string }> = {
  email: { fr: 'courriel identique', en: 'same email address' },
  website: { fr: 'site identique', en: 'same website' },
  phone: { fr: 'téléphone identique', en: 'same phone number' },
  identifier: { fr: 'identifiant identique', en: 'same identifier' },
  wallet: { fr: 'adresse de portefeuille identique', en: 'same wallet address' },
  name_birth: { fr: 'nom et date de naissance identiques', en: 'same name and birth date' },
  name: { fr: 'même nom', en: 'same name' },
  mail_domain: { fr: 'même domaine de messagerie', en: 'same mail domain' }
}

function reviewReason(entries: SanctionEntry[], hit: SanctionHit, lang: 'fr' | 'en'): string {
  const fr = lang === 'fr'
  const data = groupData(entries, lang)
  const lists = entries.map((e) => (e.source === 'fr' ? 'DG Trésor' : e.source === 'eu' ? (fr ? 'UE' : 'EU') : 'OFAC')).join(', ')
  const parts: string[] = []
  if (hit.basis === 'mail_domain')
    parts.push(fr ? `domaine ${hit.matched} : celui d’une entité sanctionnée (${entries[0].name}, ${lists})` : `domain ${hit.matched} belongs to a sanctioned entity (${entries[0].name}, ${lists})`)
  else
    parts.push(
      entries[0].kind === 'person'
        ? fr
          ? `homonyme possible : même nom que ${entries[0].name} (${lists})`
          : `possible namesake: same name as ${entries[0].name} (${lists})`
        : fr
          ? `dénomination proche de ${entries[0].name} (${lists}) : comparez l’adresse et les numéros d’enregistrement`
          : `name close to ${entries[0].name} (${lists}): compare address and registration numbers`
    )
  const births = data.sanctions_birth_dates as string[] | undefined
  if (entries[0].kind === 'person')
    parts.push(births?.length ? `${fr ? 'né(e) le' : 'born'} ${births.slice(0, 3).join(fr ? ' ou ' : ' or ')}` : fr ? 'date de naissance non publiée' : 'birth date not published')
  const reason = (data.sanctions_reasons as string[] | undefined)?.[0] ?? (data.job_title as string | undefined)
  if (reason) parts.push(`${fr ? 'motif' : 'reason'} : ${trim(reason, 220)}`)
  const basis = (data.sanctions_legal_bases as string[] | undefined)?.[0]
  if (basis) parts.push(`${fr ? 'fondement' : 'legal basis'} : ${trim(basis, 120)}`)
  const refs = [...((data.sanctions_eu_refs as string[] | undefined) ?? []).map((r) => `${fr ? 'UE' : 'EU'} ${r}`), ...((data.sanctions_un_refs as string[] | undefined) ?? []).map((r) => `${fr ? 'ONU' : 'UN'} ${r}`)]
  if (refs.length) parts.push(`${fr ? 'réf.' : 'ref.'} ${refs.slice(0, 3).join(', ')}`)
  return parts.join(' ; ')
}

export const MAX_PROPOSALS = 10

export interface SanctionsResult {
  /** Correspondances exactes (courriel, site, téléphone, identifiant, nom et naissance). */
  direct: SanctionHit[]
  /** Correspondances à vérifier (homonymes, domaine de messagerie). */
  review: Array<SanctionHit & { birth?: BirthVerdict }>
  excluded: number
}

/**
 * Sortie du module. Correspondance exacte : propriétés `sanctioned` sur l'entrée, entité
 * sanctionnée (pour un courriel, un site, un numéro) et événement « Gel des avoirs » daté.
 * Homonyme : événement mis de côté dans « À vérifier » avec motif, fondement et naissance.
 */
export function sanctionsOutput(
  result: SanctionsResult,
  inputType: string,
  checked: SanctionSource[],
  lang: 'fr' | 'en',
  unavailable: SanctionSource[] = []
): ModuleOutput {
  const fr = lang === 'fr'
  const entities: OutEntity[] = []
  const properties: Record<string, PropValue> = {}
  const selfTarget = ['person', 'company', 'organization'].includes(inputType)

  const direct = groupHits(result.direct)
  direct.forEach((g, n) => {
    const data = groupData(g.entries, lang)
    const main = g.entries[0]
    let from = '$input'
    if (!selfTarget) {
      from = `holder${n}`
      entities.push({
        ref: from,
        type: main.kind === 'person' ? 'person' : main.kind === 'vessel' ? 'vehicle' : 'organization',
        label: main.name,
        data: { ...data, sanctioned: true },
        linkLabel: `${fr ? 'titulaire sanctionné' : 'sanctioned holder'} (${BASIS_LABELS[g.hit.basis][lang]})`
      })
    }
    entities.push(eventEntity(g.entries, data, from, lang))
  })
  if (direct.length) {
    const all = direct.flatMap((g) => g.entries)
    const merged = groupData(all, lang)
    Object.assign(properties, {
      sanctioned: true,
      sanctions_match: uniq(direct.map((g) => BASIS_LABELS[g.hit.basis][lang])),
      ...merged,
      sanctioned_entity: uniq(direct.map((g) => g.entries[0].name)).join(' ; ')
    })
    if (!selfTarget) {
      // Les détails restent sur l'entité sanctionnée : l'entrée ne garde que l'essentiel.
      for (const k of ['birth_place', 'nationality', 'job_title', 'aliases', 'aliases_count', 'sanctions_birth_dates']) delete properties[k]
    }
  }

  const directIds = new Set(result.direct.map((h) => h.entry))
  const review = groupHits(result.review.filter((h) => !directIds.has(h.entry)))
  for (const g of review.slice(0, MAX_PROPOSALS)) {
    const data = groupData(g.entries, lang)
    entities.push({ ...eventEntity(g.entries, data, '$input', lang), review: true, reviewReason: reviewReason(g.entries, g.hit, lang) })
  }
  if (review.length) properties.sanctions_possible_matches = review.length
  if (result.excluded) properties.sanctions_excluded_matches = result.excluded
  if (!direct.length && !review.length && !unavailable.length) properties.sanctioned = false
  properties.sanctions_lists_checked = checked.map((s) => SOURCE_LABELS[s][lang])
  if (unavailable.length) properties.sanctions_lists_unavailable = unavailable.map((s) => SOURCE_LABELS[s][lang])

  return {
    properties,
    entities,
    raw: {
      direct: direct.map((g) => ({ basis: g.hit.basis, matched: g.hit.matched, entries: g.entries.map((e) => `${e.source}:${e.id} ${e.name}`) })),
      review: review.map((g) => ({ basis: g.hit.basis, matched: g.hit.matched, entries: g.entries.map((e) => `${e.source}:${e.id} ${e.name}`) })),
      excluded: result.excluded
    }
  }
}

function eventEntity(entries: SanctionEntry[], data: Record<string, PropValue>, from: string, lang: 'fr' | 'en'): OutEntity {
  const fr = lang === 'fr'
  const freeze = entries.some((e) => e.source !== 'ofac')
  const title = freeze ? (fr ? 'Gel des avoirs' : 'Asset freeze') : fr ? 'Sanctions OFAC' : 'OFAC sanctions'
  const date = earliest(entries.map((e) => e.listedAt))
  return {
    type: 'event',
    label: `${title} : ${entries[0].name}`,
    data: compact({ date, ...data }),
    from,
    linkLabel: freeze ? (fr ? 'gel des avoirs' : 'asset freeze') : fr ? 'sanctions' : 'sanctions'
  }
}

