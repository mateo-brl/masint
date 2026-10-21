// Fonctions pures partagées par les exports : échappement, dates, propriétés.
// Aucune dépendance au DOM, pour rester testables sous Node.

import { getEntityType } from '@shared/entityTypes'
import { getPlatform } from '@shared/platforms'
import type { GraphNode, Lang, PropValue } from '@shared/types'
import strings from '../../locales/export'
import { propertyLabel } from '@shared/propertyLabels'

export type ExportStrings = (typeof strings)['fr']

export function exportStrings(lang: Lang): ExportStrings {
  return strings[lang] ?? strings.fr
}

/** Remplace les `{{clé}}` d'un texte traduit. */
export function fmt(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''))
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

/** JSON insérable dans une balise `<script>` sans pouvoir la refermer. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** URL http(s) affichable comme lien, sinon `null`. */
export function safeHttpUrl(value: string): string | null {
  const v = value.trim()
  if (!/^https?:\/\/[^\s<>"']+$/i.test(v)) return null
  try {
    return new URL(v).href
  } catch {
    return null
  }
}

/** Seules les images en data URL sont acceptées dans les documents exportés. */
export function isImageDataUrl(value: string | null | undefined): value is string {
  return !!value && /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value)
}

/** Nom de fichier sans caractères interdits sous Windows ni Linux. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim()
  return cleaned || 'enquete'
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Date locale au format `AAAA-MM-JJ`, pour les noms de fichiers. */
export function fileStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function exportFileName(investigationName: string, date: Date, suffix: string, ext: string): string {
  const base = safeFileName(investigationName)
  return `${base}${suffix ? `_${suffix}` : ''}_${fileStamp(date)}.${ext}`
}

/** Date et heure locales `AAAA-MM-JJ HH:MM:SS`, lisibles par Excel. */
export function isoLocal(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${fileStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const locale = (lang: Lang): string => (lang === 'en' ? 'en-GB' : 'fr-FR')

/** Date et heure longues avec fuseau horaire, pour les mentions de traçabilité. */
export function formatDateTime(ts: number | Date | null | undefined, lang: Lang, withZone = false): string {
  if (ts === null || ts === undefined) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  // `dateStyle` ne se combine pas avec `timeZoneName` : composants explicites.
  return new Intl.DateTimeFormat(locale(lang), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(withZone ? { timeZoneName: 'short' } : {})
  }).format(d)
}

export function formatShortDateTime(ts: number | null | undefined, lang: Lang): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: 'short', timeStyle: 'medium' }).format(d)
}

export function formatDate(ts: number | null | undefined, lang: Lang): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: 'long' }).format(d)
}

export function formatNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang)).format(n)
}

/** Valeur de propriété en texte. */
export function formatValue(value: PropValue | undefined, lang: Lang): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') {
    const s = exportStrings(lang).report.doc
    return value ? s.yes : s.no
  }
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function isEmptyValue(value: PropValue | undefined): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/** `first_name` → `First name`. */
export function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : key
}

export function fieldLabel(type: string, key: string, lang: Lang): string {
  const f = getEntityType(type).fields.find((x) => x.key === key)
  return f ? f.label[lang] : propertyLabel(key, lang)
}

export interface PropRow {
  key: string
  label: string
  value: string
}

/** Propriétés renseignées d'un nœud : d'abord les champs du type, puis les autres clés. */
export function orderedProps(node: GraphNode, lang: Lang): PropRow[] {
  const def = getEntityType(node.type)
  const keys = Object.keys(node.data ?? {}).filter((k) => !k.startsWith('_') && !isEmptyValue(node.data[k]))
  const known = def.fields.map((f) => f.key).filter((k) => keys.includes(k))
  const rest = keys.filter((k) => !known.includes(k))
  return [...known, ...rest].map((key) => ({ key, label: fieldLabel(node.type, key, lang), value: formatValue(node.data[key], lang) }))
}

export function typeLabel(type: string, lang: Lang): string {
  return getEntityType(type).label[lang]
}

export function platformName(platform: string | null | undefined): string {
  if (!platform) return ''
  return getPlatform(platform)?.name ?? platform
}

/** Texte lisible sur une couleur de fond (même règle que l'interface). */
export function textOn(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#fff'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? '#111' : '#fff'
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase()
}

/** Couleur CSS sûre (hexadécimale ou variable), sinon la valeur de repli. */
export function safeColor(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  if (/^var\(--[a-z0-9-]+\)$/i.test(value)) return value
  if (/^rgba?\([\d\s.,%/]+\)$/i.test(value)) return value
  return fallback
}

/** Sous-titre d'un nœud, identique à l'affichage du canevas. */
export { nodeSubtitle } from '@shared/subtitle'
