// Import en masse : lecture d'un CSV ou d'une liste collée, choix d'un type par colonne,
// dédoublonnage par clé canonique et préparation des nœuds et liens à créer.
// Fonctions pures, sans accès au DOM ni à la base (testées dans tests/tabular.test.ts).

import { canonicalDomain, canonicalKey, canonicalPhone } from './canonical'
import { detectEntity, hashAlgorithm } from './detect'
import { emailProvider } from './platforms'

export type Separator = ',' | ';' | '\t'

/** Séparateurs reconnus, dans l'ordre de préférence en cas d'égalité. */
export const SEPARATORS: Separator[] = ['\t', ';', ',']

/** Lignes lues au plus (au-delà, le reste du fichier est ignoré et signalé). */
export const MAX_IMPORT_ROWS = 5000

/** Retire l'indicateur d'ordre des octets et unifie les fins de ligne. */
export function cleanText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

/**
 * Découpe un texte délimité (RFC 4180) : champs entre guillemets, guillemets doublés,
 * séparateurs et retours à la ligne à l'intérieur des guillemets. Sans séparateur (`null`),
 * chaque ligne est une valeur. Les lignes vides sont ignorées.
 */
export function parseDelimited(text: string, sep: Separator | null, maxRows = Infinity): string[][] {
  const src = cleanText(text)
  if (sep === null)
    return src
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, maxRows)
      .map((l) => [l])
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const endRow = (): void => {
    row.push(field)
    field = ''
    if (row.some((c) => c.trim() !== '')) rows.push(row)
    row = []
  }
  while (i < src.length && rows.length < maxRows) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field.trim() === '') {
      // Guillemet ouvrant (les espaces avant lui sont ignorés).
      field = ''
      quoted = true
    } else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n') endRow()
    else field += c
    i++
  }
  if (rows.length < maxRows && (field !== '' || row.length)) endRow()
  return rows
}

/**
 * Séparateur le plus probable : celui qui donne le même nombre de colonnes (au moins deux)
 * sur le plus de lignes de l'échantillon. `null` : une valeur par ligne.
 */
export function detectSeparator(text: string): Separator | null {
  const sample = cleanText(text).slice(0, 64 * 1024)
  let best: { sep: Separator; score: number } | null = null
  for (const sep of SEPARATORS) {
    const rows = parseDelimited(sample, sep, 30)
    if (!rows.length) continue
    const counts = new Map<number, number>()
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
    let mode = 1
    let freq = 0
    for (const [n, f] of counts) if (f > freq || (f === freq && n > mode)) [mode, freq] = [n, f]
    if (mode < 2) continue
    const score = freq / rows.length
    if (score >= 0.6 && (!best || score > best.score)) best = { sep, score }
  }
  return best?.sep ?? null
}

/** Valeurs qui signifient « rien » dans un tableau (cellule non renseignée). */
const PLACEHOLDER = /^(?:-+|\.+|\?+|n\/?a|null|none|nan|undefined|nil|vide|aucun|aucune)$/i

/** Types dont la valeur doit être reconnue telle quelle : sinon la cellule est ignorée. */
const STRICT = new Set(['email', 'ip', 'iban', 'hash', 'crypto_wallet', 'mac_address', 'cve', 'asn', 'cidr', 'coordinates'])
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

/**
 * Valeur d'une cellule pour le type choisi : libellé normalisé et plateforme, ou `null` si la
 * cellule ne contient pas une valeur de ce type (elle est alors comptée parmi les ignorées).
 */
export function cellValue(type: string, raw: string): { label: string; platform: string | null } | null {
  const v = raw.trim().replace(/\s+/g, ' ')
  if (!v || PLACEHOLDER.test(v)) return null
  const d = detectEntity(v)
  if (type === 'phone') {
    const e164 = canonicalPhone(v)
    return /^\+\d{8,15}(;ext=\d+)?$/.test(e164) ? { label: e164, platform: null } : null
  }
  if (type === 'domain') {
    const domain = canonicalDomain(v)
    return DOMAIN.test(domain) ? { label: domain, platform: null } : null
  }
  // Empreinte : SHA-1 compris (que la détection automatique laisse de côté).
  if (type === 'hash') return hashAlgorithm(v) ? { label: v.toLowerCase(), platform: null } : null
  if (d && d.type === type) {
    const platform = d.platform ?? (type === 'email' ? (emailProvider(d.value)?.id ?? null) : null)
    return { label: d.value, platform }
  }
  if (STRICT.has(type)) return null
  return { label: type === 'username' || type === 'account' ? v.replace(/^@/, '') : v, platform: null }
}

/** Type d'entité suggéré pour une colonne, d'après les valeurs (majorité d'au moins 60 %). */
export function suggestColumnType(values: string[]): string | null {
  const sample = values.map((v) => v.trim()).filter((v) => v && !PLACEHOLDER.test(v)).slice(0, 50)
  if (!sample.length) return null
  const counts = new Map<string, number>()
  for (const v of sample) {
    const d = detectEntity(v)
    if (d) counts.set(d.type, (counts.get(d.type) ?? 0) + 1)
  }
  let best: [string, number] | null = null
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry
  if (!best) return null
  return best[1] / sample.length >= 0.6 ? best[0] : 'keyword'
}

/**
 * La première ligne est-elle un en-tête ? Oui si, dans une colonne au moins, les autres lignes
 * sont d'un type reconnu (email, numéro...) et la première cellule n'en est pas un.
 */
export function guessHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const first = rows[0]
  const rest = rows.slice(1, 51)
  for (let c = 0; c < first.length; c++) {
    const type = suggestColumnType(rest.map((r) => r[c] ?? ''))
    if (!type || type === 'keyword' || type === 'person' || type === 'username') continue
    if (detectEntity(first[c] ?? '')?.type !== type) return true
  }
  return false
}

export interface ImportColumn {
  /** Type d'entité, ou `null` pour ignorer la colonne. */
  type: string | null
  /** En-tête (libellé des liens), vide sans ligne d'en-tête. */
  header: string
}

export interface PlannedEntity {
  key: string
  type: string
  label: string
  platform: string | null
  /** Ligne et colonne de première apparition (placement en grille). */
  row: number
  col: number
}

export interface PlannedLink {
  from: string
  to: string
  label: string
}

export interface ImportPlan {
  /** Entités à créer, une par clé canonique. */
  create: PlannedEntity[]
  /** Clés déjà présentes dans l'enquête, avec l'identifiant du nœud existant. */
  existing: Map<string, string>
  /** Liens à poser, par clés canoniques (sans doublon de paire). */
  links: PlannedLink[]
  /** Cellules non vides écartées (valeur absente ou d'un autre type que la colonne). */
  ignored: number
}

/**
 * Prépare l'import : dédoublonnage par clé canonique (dans le fichier et avec l'enquête), et
 * liens de chaque ligne vers la première colonne choisie si `link` est demandé.
 */
export function planImport(rows: string[][], columns: ImportColumn[], existingKeys: Map<string, string>, link: boolean): ImportPlan {
  const create: PlannedEntity[] = []
  const seen = new Set<string>()
  const existing = new Map<string, string>()
  const links = new Map<string, PlannedLink>()
  let ignored = 0
  const anchorCol = columns.findIndex((c) => c.type)
  rows.forEach((row, r) => {
    const keys: Array<{ col: number; key: string }> = []
    columns.forEach((column, c) => {
      if (!column.type) return
      const raw = row[c] ?? ''
      if (!raw.trim()) return
      const value = cellValue(column.type, raw)
      if (!value) {
        ignored++
        return
      }
      const key = canonicalKey(column.type, value.label, value.platform)
      keys.push({ col: c, key })
      const known = existingKeys.get(key)
      if (known) existing.set(key, known)
      else if (!seen.has(key)) create.push({ key, type: column.type, label: value.label, platform: value.platform, row: r, col: c })
      seen.add(key)
    })
    if (!link || anchorCol < 0) return
    const anchor = keys.find((k) => k.col === anchorCol)
    if (!anchor) return
    for (const k of keys) {
      if (k.col === anchorCol || k.key === anchor.key) continue
      const id = `${anchor.key}\u0000${k.key}`
      const label = columns[k.col].header.trim()
      const prev = links.get(id)
      if (!prev) links.set(id, { from: anchor.key, to: k.key, label })
      else if (label && !prev.label.split(' · ').includes(label)) prev.label = prev.label ? `${prev.label} · ${label}` : label
    }
  })
  return { create, existing, links: Array.from(links.values()), ignored }
}

export const GRID_CELL = { width: 220, height: 70 }
const GRID_PER_ROW = 8

/**
 * Positions relatives des entités créées, en grille : une rangée par ligne du fichier quand
 * les colonnes sont reliées (la première colonne à gauche), sinon des rangées de huit.
 * Renvoie aussi l'emprise totale, pour trouver un espace libre assez grand.
 */
export function gridLayout(
  entities: PlannedEntity[],
  columns: ImportColumn[],
  link: boolean
): { positions: Array<{ x: number; y: number }>; width: number; height: number } {
  const { width: W, height: H } = GRID_CELL
  if (!entities.length) return { positions: [], width: 0, height: 0 }
  if (!link) {
    const perRow = Math.min(GRID_PER_ROW, entities.length)
    const positions = entities.map((_, i) => ({ x: (i % perRow) * W, y: Math.floor(i / perRow) * H }))
    return { positions, width: perRow * W, height: Math.ceil(entities.length / perRow) * H }
  }
  const typed = columns.map((c, i) => (c.type ? i : -1)).filter((i) => i >= 0)
  const slot = new Map(typed.map((c, i) => [c, i]))
  const rowSlot = new Map<number, number>()
  const positions = entities.map((e) => {
    if (!rowSlot.has(e.row)) rowSlot.set(e.row, rowSlot.size)
    return { x: (slot.get(e.col) ?? 0) * W, y: rowSlot.get(e.row)! * H }
  })
  return { positions, width: typed.length * W, height: rowSlot.size * H }
}
