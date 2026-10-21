// Frise chronologique : lecture des dates des fiches, graduations et formats.
// Toutes les dates sont traitées en UTC pour éviter les décalages d'un jour.

import { getEntityType, isDateKey } from '@shared/entityTypes'
import type { GraphNode, I18nText, Lang } from '@shared/types'

export type DatePrecision = 'year' | 'month' | 'day' | 'time'

export interface ParsedDate {
  t: number
  precision: DatePrecision
}

export interface TimelineEvent {
  id: string
  nodeId: string
  key: string
  t: number
  precision: DatePrecision
  /** Libellé du champ dans le catalogue, sinon `null` (on affiche la clé). */
  field: I18nText | null
  node: GraphNode
}

const MIN_YEAR = 1000
const MAX_YEAR = 9999

function utc(y: number, m = 0, d = 1): number | null {
  if (y < MIN_YEAR || y > MAX_YEAR || m < 0 || m > 11 || d < 1 || d > 31) return null
  const t = Date.UTC(y, m, d)
  const back = new Date(t)
  // Refuse les dates impossibles (31 février...).
  return back.getUTCMonth() === m && back.getUTCDate() === d ? t : null
}

function fromTimestamp(n: number): ParsedDate | null {
  const ms = n >= 1e11 ? n : n * 1000
  const y = new Date(ms).getUTCFullYear()
  return Number.isFinite(ms) && y >= 1970 && y <= MAX_YEAR ? { t: ms, precision: 'time' } : null
}

/** Analyse une valeur de date : ISO, AAAA-MM-JJ, AAAA-MM, AAAA, JJ/MM/AAAA, AAAAMMJJ ou timestamp. */
export function parseDateValue(v: unknown): ParsedDate | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    if (Number.isInteger(v) && v >= MIN_YEAR && v <= MAX_YEAR) return { t: Date.UTC(v, 0, 1), precision: 'year' }
    return v >= 1e8 && v < 1e14 ? fromTimestamp(v) : null
  }
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > 64) return null
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(\d{4})$/))) {
    const t = utc(+m[1])
    return t === null ? null : { t, precision: 'year' }
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) {
    const t = utc(+m[1], +m[2] - 1)
    return t === null ? null : { t, precision: 'month' }
  }
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    const t = utc(+m[1], +m[2] - 1, +m[3])
    return t === null ? null : { t, precision: 'day' }
  }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) {
    // Ordre européen par défaut, américain si le jour ne peut pas être un mois.
    let d = +m[1]
    let mo = +m[2]
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]
    const t = utc(+m[3], mo - 1, d)
    return t === null ? null : { t, precision: 'day' }
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const t = utc(+m[1], +m[2] - 1, +m[3])
    return t === null ? null : { t, precision: 'day' }
  }
  if (/^\d{10}(\.\d+)?$/.test(s) || /^\d{13}$/.test(s)) return fromTimestamp(Number(s))
  if (/^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}/.test(s)) {
    let iso = s.replace(' ', 'T')
    // Sans fuseau explicite, on considère l'heure comme UTC.
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso += 'Z'
    const t = Date.parse(iso)
    return Number.isFinite(t) ? { t, precision: 'time' } : null
  }
  // Formats textuels (RFC 2822, « March 3, 2021 »...) : un jour et une année sur 4 chiffres sont exigés.
  if (/[a-z]/i.test(s) && /\b\d{1,2}\b\D+\b\d{4}\b|\b\d{4}\b\D+\b\d{1,2}\b/.test(s)) {
    const t = Date.parse(s)
    if (!Number.isFinite(t)) return null
    const d = new Date(t)
    if (d.getUTCFullYear() < MIN_YEAR || d.getUTCFullYear() > MAX_YEAR) return null
    if (/\d{1,2}:\d{2}/.test(s)) return { t, precision: 'time' }
    // Sans heure, le navigateur lit une date locale : on la ramène au jour UTC correspondant.
    return { t: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()), precision: 'day' }
  }
  return null
}

const cache = new WeakMap<GraphNode, TimelineEvent[]>()

/** Événements datés d'un nœud (mis en cache par référence de nœud). */
export function nodeEvents(n: GraphNode): TimelineEvent[] {
  const hit = cache.get(n)
  if (hit) return hit
  const out: TimelineEvent[] = []
  if (n.kind === 'entity') {
    const fields = getEntityType(n.type).fields
    for (const [key, value] of Object.entries(n.data)) {
      const def = fields.find((f) => f.key === key)
      if (!isDateKey(key) && def?.kind !== 'date') continue
      const p = parseDateValue(value)
      if (!p) continue
      out.push({ id: `${n.id}:${key}`, nodeId: n.id, key, t: p.t, precision: p.precision, field: def?.label ?? null, node: n })
    }
  }
  cache.set(n, out)
  return out
}

export function collectEvents(nodes: GraphNode[]): TimelineEvent[] {
  const all: TimelineEvent[] = []
  for (const n of nodes) for (const e of nodeEvents(n)) all.push(e)
  return all.sort((a, b) => a.t - b.t)
}

/** Libellé lisible d'une clé sans définition dans le catalogue. */
export function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// Graduations

export type TickKind = 'hour' | 'day' | 'week' | 'month' | 'year'

export interface TickUnit {
  kind: TickKind
  step: number
  /** Durée approximative, pour choisir l'unité. */
  ms: number
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const YEAR = 365.25 * DAY
const MONTH = YEAR / 12

export const MIN_SPAN = 6 * HOUR
export const MAX_SPAN = 3000 * YEAR

const UNITS: TickUnit[] = [
  ...[1, 3, 6, 12].map((step) => ({ kind: 'hour' as const, step, ms: step * HOUR })),
  ...[1, 2].map((step) => ({ kind: 'day' as const, step, ms: step * DAY })),
  { kind: 'week', step: 1, ms: 7 * DAY },
  ...[1, 3, 6].map((step) => ({ kind: 'month' as const, step, ms: step * MONTH })),
  ...[1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].map((step) => ({ kind: 'year' as const, step, ms: step * YEAR }))
]

/** Plus petite unité dont les graduations sont espacées d'au moins `minPx`. */
export function chooseUnit(span: number, width: number, minPx = 76): TickUnit {
  for (const u of UNITS) if ((u.ms / span) * width >= minPx) return u
  return UNITS[UNITS.length - 1]
}

function floorTo(t: number, u: TickUnit): number {
  const d = new Date(t)
  const y = d.getUTCFullYear()
  switch (u.kind) {
    case 'year':
      return Date.UTC(Math.floor(y / u.step) * u.step, 0, 1)
    case 'month': {
      const m = d.getUTCMonth()
      return Date.UTC(y, m - (m % u.step), 1)
    }
    case 'week': {
      // Semaines alignées sur le lundi.
      const day = Date.UTC(y, d.getUTCMonth(), d.getUTCDate())
      return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY
    }
    case 'day':
      return Date.UTC(y, d.getUTCMonth(), d.getUTCDate())
    case 'hour': {
      const h = d.getUTCHours()
      return Date.UTC(y, d.getUTCMonth(), d.getUTCDate(), h - (h % u.step))
    }
  }
}

function addUnit(t: number, u: TickUnit): number {
  const d = new Date(t)
  switch (u.kind) {
    case 'year':
      return Date.UTC(d.getUTCFullYear() + u.step, 0, 1)
    case 'month':
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + u.step, 1)
    case 'week':
      return t + 7 * DAY
    case 'day':
      return t + u.step * DAY
    case 'hour':
      return t + u.step * HOUR
  }
}

export function ticks(start: number, end: number, u: TickUnit): number[] {
  const out: number[] = []
  let t = floorTo(start, u)
  while (t <= end && out.length < 400) {
    if (t >= start) out.push(t)
    t = addUnit(t, u)
  }
  return out
}

// ---------------------------------------------------------------------------
// Formats

const formatters = new Map<string, Intl.DateTimeFormat>()

function fmt(lang: Lang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = lang + JSON.stringify(opts)
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'UTC', ...opts })
    formatters.set(key, f)
  }
  return f
}

/** Libellé d'une graduation ; `major` marque un changement d'année ou de mois. */
export function tickLabel(t: number, u: TickUnit, lang: Lang): { text: string; major: boolean } {
  const d = new Date(t)
  switch (u.kind) {
    case 'year':
      return { text: String(d.getUTCFullYear()), major: d.getUTCFullYear() % (u.step * 5) === 0 }
    case 'month':
      return d.getUTCMonth() === 0
        ? { text: String(d.getUTCFullYear()), major: true }
        : { text: fmt(lang, { month: 'short' }).format(d), major: false }
    case 'week':
    case 'day':
      if (d.getUTCDate() === 1 && d.getUTCMonth() === 0) return { text: String(d.getUTCFullYear()), major: true }
      if (d.getUTCDate() === 1) return { text: fmt(lang, { month: 'short' }).format(d), major: true }
      return { text: fmt(lang, u.kind === 'week' ? { day: 'numeric', month: 'short' } : { day: 'numeric' }).format(d), major: false }
    case 'hour':
      return d.getUTCHours() === 0
        ? { text: fmt(lang, { day: 'numeric', month: 'short' }).format(d), major: true }
        : { text: fmt(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d), major: false }
  }
}

/** Date d'un événement selon sa précision. */
export function formatEventDate(t: number, precision: DatePrecision, lang: Lang): string {
  const d = new Date(t)
  switch (precision) {
    case 'year':
      return String(d.getUTCFullYear())
    case 'month':
      return fmt(lang, { month: 'long', year: 'numeric' }).format(d)
    case 'day':
      return fmt(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
    case 'time':
      return `${fmt(lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)} UTC`
  }
}

/** Date d'une borne de la plage visible, avec une précision adaptée à l'unité. */
export function formatRangeDate(t: number, u: TickUnit, lang: Lang): string {
  if (u.kind === 'year') return String(new Date(t).getUTCFullYear())
  if (u.kind === 'month') return fmt(lang, { month: 'short', year: 'numeric' }).format(new Date(t))
  return fmt(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t))
}

/** Plage qui englobe des instants, avec une marge. */
export function fitDomain(times: number[]): [number, number] {
  if (!times.length) {
    const now = Date.now()
    return [now - 5 * YEAR, now + YEAR / 2]
  }
  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(max - min, 60 * DAY)
  const pad = span * 0.08
  const mid = (min + max) / 2
  return [Math.min(min - pad, mid - span / 2 - pad), Math.max(max + pad, mid + span / 2 + pad)]
}
