// LeakCheck, API Pro v2 (clé de l'utilisateur) : lignes des fuites qui contiennent un email ou
// un numéro. Seuls l'email, le pseudo, le nom, la date de naissance et l'adresse sont gardés.
// Les mots de passe, empreintes, sels et tout autre champ secret sont retirés dès la lecture de
// la réponse (avant même de construire l'objet JSON) : ils ne sont ni lus ni stockés, ni dans
// les propriétés, ni dans les suggestions, ni dans la réponse brute archivée.
//
// Documentation : https://docs.leakcheck.io/pro-api/lookup (GET /api/v2/query/{valeur}?type=,
// en-tête X-API-Key ; codes d'erreur dans https://docs.leakcheck.io/errors).

import { ModuleError, type ModuleContext, type ModuleOutput, type OutEntity } from '@shared/modules'
import type { PropValue } from '@shared/types'

export const LEAKCHECK_KEY = { id: 'leakcheck', label: 'LeakCheck API key (Pro API v2)', url: 'https://leakcheck.io/settings' }

const API = 'https://leakcheck.io/api/v2/query/'

/** Champs gardés d'une ligne de fuite. */
const KEPT = ['email', 'username', 'name', 'first_name', 'last_name', 'dob', 'address'] as const
type Kept = (typeof KEPT)[number]

/** Clés secrètes retirées pendant la lecture du JSON (mots de passe, empreintes, sels, jetons...). */
const SECRET = /pass|pwd|hash|salt|secret|token|api_?key|cvv|ssn|credit|card|iban|pin$/i

export interface LeakRow extends Partial<Record<Kept, string>> {
  /** Nom de la fuite. */
  source: string
  /** Date de la fuite (`2019-07`) ou de la collecte d'un infostealer. */
  date?: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

/**
 * Lecture de la réponse : les clés secrètes sont écartées par le `reviver` de `JSON.parse`, puis
 * chaque ligne est réduite aux champs gardés.
 */
export function readLeakcheck(text: string): { found: number; quota?: number; rows: LeakRow[]; error?: string; success: boolean } {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text, (key, value) => (key && SECRET.test(key) ? undefined : value)) as Record<string, unknown>
  } catch {
    throw new ModuleError('LeakCheck : réponse illisible', 'unavailable')
  }
  const rows = (Array.isArray(json.result) ? json.result : []).map(sanitizeRow).filter((r): r is LeakRow => !!r)
  const quota = typeof json.quota === 'number' ? json.quota : undefined
  return { success: json.success === true, found: typeof json.found === 'number' ? json.found : rows.length, ...(quota !== undefined ? { quota } : {}), rows, ...(json.error ? { error: str(json.error) } : {}) }
}

/** Ligne réduite aux champs gardés ; tout le reste est ignoré. */
export function sanitizeRow(row: unknown): LeakRow | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const r = row as Record<string, unknown>
  const src = r.source && typeof r.source === 'object' ? (r.source as Record<string, unknown>) : {}
  const out: LeakRow = { source: (str(src.name) || str(r.source) || 'LeakCheck').slice(0, 120) }
  const date = str(src.breach_date) || str(r.collected)
  if (date) out.date = date.slice(0, 40)
  for (const k of KEPT) {
    const v = str(r[k])
    if (v) out[k] = v.slice(0, 300)
  }
  return out
}

/** Erreur explicite selon le statut et le message de LeakCheck. */
export function leakcheckError(status: number, message: string): ModuleError {
  const m = message || `HTTP ${status}`
  if (status === 401 || /x-api-key/i.test(m)) return new ModuleError(`LeakCheck : clé API manquante ou refusée (${m})`, 'auth')
  if (status === 429 || /limit reached|too many/i.test(m)) return new ModuleError(`LeakCheck : quota atteint (${m})`, 'rate_limited')
  if (status === 403) return new ModuleError(`LeakCheck : abonnement requis (${m})`, 'auth')
  if (status === 400 || status === 422) return new ModuleError(`LeakCheck : requête refusée (${m})`, 'invalid_input')
  if (status >= 500) return new ModuleError(`LeakCheck : service indisponible (HTTP ${status})`, 'unavailable')
  return new ModuleError(`LeakCheck : ${m}`, 'other')
}

const MAX_ENTITIES = 20

/** Date de naissance lisible (`1990-04-01`, `01/04/1990`) ; autre format gardé tel quel. */
function birthDate(v: string): string {
  const fr = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : v
}

/** « la fuite X (2019-07) », « les fuites X (2019-07) et Y ». */
function leaksText(sources: string[], lang: 'fr' | 'en'): string {
  const list = sources.length > 1 ? `${sources.slice(0, -1).join(', ')} ${lang === 'fr' ? 'et' : 'and'} ${sources[sources.length - 1]}` : sources[0]
  if (lang === 'fr') return `${sources.length > 1 ? 'les fuites' : 'la fuite'} ${list}`
  return `${sources.length > 1 ? 'the leaks' : 'the leak'} ${list}`
}

/**
 * Suggestions à vérifier (emails, pseudos, noms) avec la fuite qui les associe à la valeur
 * cherchée : « présent avec ce numéro dans la fuite X (2019-07) ». Au plus 20.
 */
export function leakOutput(rows: LeakRow[], query: { kind: 'phone' | 'email'; value: string }, lang: 'fr' | 'en'): ModuleOutput {
  const fr = lang === 'fr'
  const withWhat = query.kind === 'phone' ? (fr ? 'avec ce numéro' : 'with this number') : fr ? 'avec cette adresse' : 'with this address'
  type Item = { type: 'email' | 'username' | 'person'; label: string; sources: string[]; data: Record<string, PropValue> }
  const items = new Map<string, Item>()
  const add = (type: Item['type'], label: string, source: string, extra: { dob?: string; address?: string } = {}): void => {
    const clean = label.replace(/\s+/g, ' ').trim()
    if (!clean || clean.length > 120) return
    const key = `${type}|${clean.toLowerCase()}`
    const item = items.get(key) ?? { type, label: clean, sources: [], data: {} }
    if (!item.sources.includes(source)) item.sources.push(source)
    if (extra.dob && item.data.birth_date === undefined) item.data.birth_date = birthDate(extra.dob)
    if (extra.address && item.data.address === undefined) item.data.address = extra.address
    items.set(key, item)
  }
  const self = query.value.trim().toLowerCase()
  for (const r of rows) {
    const source = r.date ? `${r.source} (${r.date})` : r.source
    if (r.email && r.email.toLowerCase() !== self && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(r.email)) add('email', r.email.toLowerCase(), source)
    if (r.username && r.username.toLowerCase() !== self && !/\s/.test(r.username)) add('username', r.username, source)
    const name = r.name || [r.first_name, r.last_name].filter(Boolean).join(' ')
    if (name && /\p{L}/u.test(name) && !name.includes('@')) add('person', name, source, { dob: r.dob, address: r.address })
  }
  const entities: OutEntity[] = [...items.values()].slice(0, MAX_ENTITIES).map((it) => ({
    type: it.type,
    label: it.label,
    // Une fuite associe des champs sans garantie : la même ligne peut mêler plusieurs personnes.
    review: true,
    reviewReason: `${fr ? 'présent' : 'found'} ${withWhat} ${fr ? 'dans' : 'in'} ${leaksText(it.sources, lang)}`,
    strength: 'weak',
    linkLabel: it.type === 'email' ? (fr ? 'email (fuite)' : 'email (leak)') : it.type === 'username' ? (fr ? 'pseudo (fuite)' : 'username (leak)') : fr ? 'nom (fuite)' : 'name (leak)',
    data: { leak_sources: it.sources, ...it.data }
  }))
  const sources = Array.from(new Set(rows.map((r) => (r.date ? `${r.source} (${r.date})` : r.source))))
  return {
    properties: { leakcheck_rows: rows.length, ...(sources.length ? { leakcheck_sources: sources.slice(0, 50) } : {}) },
    entities,
    raw: { found: rows.length, rows }
  }
}

/** Requête à l'API Pro v2 et suggestions. La clé n'apparaît ni dans l'URL ni dans la réponse brute. */
export async function leakcheckPro(ctx: ModuleContext, query: { kind: 'phone' | 'email'; value: string }, apiValue: string): Promise<ModuleOutput> {
  const key = ctx.key(LEAKCHECK_KEY.id)
  if (!key) throw new ModuleError('LeakCheck : clé API absente du coffre', 'auth')
  const res = await ctx.fetch(`${API}${encodeURIComponent(apiValue)}`, {
    query: { type: query.kind, limit: 100 },
    headers: { accept: 'application/json', 'x-api-key': key },
    timeoutMs: 30000
  })
  const parsed = readLeakcheck(await res.text())
  if (!res.ok || !parsed.success) throw leakcheckError(res.status, parsed.error ?? '')
  if (!parsed.rows.length) return { properties: { leakcheck_rows: 0 }, raw: { found: 0 } }
  const out = leakOutput(parsed.rows, query, ctx.lang)
  return { ...out, raw: { ...(out.raw as object), ...(parsed.quota !== undefined ? { quota: parsed.quota } : {}) } }
}
