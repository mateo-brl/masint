// Base des sites Maigret : copie embarquée (resources/data/maigret-sites.json, réduite par
// build/scripts/maigret-db.mjs) et copie mise à jour à la demande dans le dossier utilisateur.
// La mise à jour lit db_meta.json du dépôt Maigret, télécharge la base, vérifie son empreinte
// SHA-256 et son schéma, puis l'écrit à côté de la base de l'application. En cas de problème, la
// base embarquée reste utilisée.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { FetchOptions } from '@shared/modules'
import { convertPythonRegex, type MaigretData, type MaigretEntry } from './_maigret'

export const DB_META_URL = 'https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/db_meta.json'
export const DB_FILE = 'maigret-sites.json'
const META_FILE = 'maigret-sites.meta.json'

/** Taille maximale acceptée pour la base téléchargée (environ 3,2 Mo en octobre 2026). */
export const MAX_DB_BYTES = 20 * 1024 * 1024
const MAX_META_BYTES = 64 * 1024
/** Nombre minimal de sites pour accepter une base (une base tronquée viderait la recherche). */
const MIN_SITES = 1000

/** Hôtes de GitHub autorisés pour `data_url`. */
export const ALLOWED_DATA_HOSTS = ['raw.githubusercontent.com', 'github.com', 'objects.githubusercontent.com', 'media.githubusercontent.com']

export interface DbMeta {
  updated_at: string | null
  /** Empreinte SHA-256 du fichier `data.json` d'origine. */
  sha256: string | null
  sites_count?: number
  data_url?: string
  downloaded_at?: string
}

export interface LoadedDb {
  data: MaigretData
  meta: DbMeta
  source: 'bundled' | 'user'
}

interface Paths {
  /** Dossier des données embarquées (`resources/data`). */
  bundledDir?: string
  /** Dossier des données de l'utilisateur (copie mise à jour, cache de santé). */
  userDir?: string
  /** Nombre minimal de sites d'une base acceptée (tests : petites bases). */
  minSites?: number
}

let paths: Paths = {}
let loaded: LoadedDb | null = null
let version = 0

/** Fixe les dossiers (appelé au démarrage par le processus principal ; les tests s'en passent). */
export function configureSiteData(p: Paths): void {
  paths = { ...p }
  loaded = null
  version++
}

export function userDir(): string | undefined {
  return paths.userDir
}

/** Numéro de version de la base chargée : change à chaque rechargement (caches à invalider). */
export function dbVersion(): number {
  return version
}

function bundledPath(): string {
  // Sans configuration (tests, scripts) : depuis la racine du projet ou à côté du code compilé.
  const here = typeof __dirname === 'string' ? __dirname : process.cwd()
  const candidates = [
    ...(paths.bundledDir ? [join(paths.bundledDir, DB_FILE)] : []),
    resolve(process.cwd(), 'resources/data', DB_FILE),
    resolve(here, '../../resources/data', DB_FILE),
    resolve(here, '../../../../resources/data', DB_FILE)
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

export const sha256 = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex')

/**
 * Vérifie la structure d'une base Maigret (complète ou réduite) : objets `sites` et `engines`,
 * entrées dont les champs utilisés ont le bon type. Renvoie un message d'erreur, ou null.
 */
export function validateMaigretData(json: unknown, minSites = MIN_SITES): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return 'base illisible'
  const d = json as Record<string, unknown>
  if (!d.sites || typeof d.sites !== 'object' || Array.isArray(d.sites)) return 'champ « sites » absent'
  if (d.engines !== undefined && (typeof d.engines !== 'object' || d.engines === null || Array.isArray(d.engines))) return 'champ « engines » invalide'
  const sites = Object.entries(d.sites as Record<string, unknown>)
  if (sites.length < minSites) return `base trop petite (${sites.length} sites)`
  const isStrList = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'))
  const isStrMap = (v: unknown): boolean => v === undefined || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string'))
  const isStr = (v: unknown): boolean => v === undefined || typeof v === 'string'
  const check = (name: string, e: unknown): string | null => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return `entrée « ${name} » invalide`
    const s = e as MaigretEntry
    const ok =
      isStr(s.url) &&
      isStr(s.urlMain) &&
      isStr(s.urlSubpath) &&
      isStr(s.urlProbe) &&
      isStr(s.checkType) &&
      isStr(s.regexCheck) &&
      isStr(s.requestMethod) &&
      isStr(s.engine) &&
      isStrList(s.presenseStrs) &&
      isStrList(s.absenceStrs) &&
      isStrList(s.tags) &&
      isStrMap(s.errors) &&
      isStrMap(s.headers) &&
      (s.alexaRank === undefined || typeof s.alexaRank === 'number') &&
      (s.requestPayload === undefined || (typeof s.requestPayload === 'object' && s.requestPayload !== null))
    return ok ? null : `entrée « ${name} » invalide`
  }
  for (const [name, e] of sites) {
    const err = check(name, e)
    if (err) return err
  }
  for (const [name, e] of Object.entries((d.engines ?? {}) as Record<string, unknown>)) {
    const site = (e as { site?: unknown } | null)?.site
    if (site !== undefined) {
      const err = check(`moteur ${name}`, site)
      if (err) return err
    }
  }
  return null
}

/** Nombre d'expressions `regexCheck` qui ne passent pas la conversion (contrôle sauté pour ces sites). */
export function unconvertedRegexCount(data: MaigretData): number {
  return Object.values(data.sites).filter((s) => s.regexCheck && !convertPythonRegex(s.regexCheck)).length
}

function readBundled(): LoadedDb {
  const raw = JSON.parse(readFileSync(bundledPath(), 'utf8')) as MaigretData & { $meta?: DbMeta }
  return { data: raw, meta: { updated_at: raw.$meta?.updated_at ?? null, sha256: raw.$meta?.sha256 ?? null, sites_count: raw.$meta?.sites_count }, source: 'bundled' }
}

/** Copie de l'utilisateur, si elle existe, correspond à son empreinte et passe la validation. */
function readUser(): LoadedDb | null {
  if (!paths.userDir) return null
  const file = join(paths.userDir, DB_FILE)
  const metaFile = join(paths.userDir, META_FILE)
  if (!existsSync(file) || !existsSync(metaFile)) return null
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as DbMeta
    const buf = readFileSync(file)
    if (!meta.sha256 || sha256(buf) !== meta.sha256) return null
    const data = JSON.parse(buf.toString('utf8')) as MaigretData
    if (validateMaigretData(data, paths.minSites)) return null
    return { data, meta, source: 'user' }
  } catch {
    return null
  }
}

/** Base utilisée : la copie mise à jour si elle est plus récente que la base embarquée. */
export function loadDb(): LoadedDb {
  if (!loaded) {
    const bundled = readBundled()
    const user = readUser()
    loaded = user && (user.meta.updated_at ?? '') >= (bundled.meta.updated_at ?? '') ? user : bundled
  }
  return loaded
}

/** Oublie la base chargée (après une mise à jour). */
export function reloadDb(): void {
  loaded = null
  version++
}

export interface DbInfo {
  source: 'bundled' | 'user'
  updatedAt: string | null
  sites: number
}

export function dbInfo(): DbInfo {
  const db = loadDb()
  return { source: db.source, updatedAt: db.meta.updated_at, sites: Object.keys(db.data.sites).length }
}

// Mise à jour ------------------------------------------------------------------

export type FetchLike = (url: string, init?: FetchOptions) => Promise<Response>

export interface UpdateOutcome {
  status: 'updated' | 'current'
  updatedAt: string | null
  sites: number
  /** Expressions regexCheck non convertibles (le contrôle de format est sauté pour ces sites). */
  regexSkipped?: number
}

export class DbUpdateError extends Error {}

/** `data_url` acceptée : HTTPS, sur un hôte de GitHub. */
export function isAllowedDataUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ALLOWED_DATA_HOSTS.includes(u.hostname.toLowerCase()) && !u.username && !u.password
  } catch {
    return false
  }
}

/** Lit au plus `max` octets ; au-delà, la lecture est interrompue et une erreur levée. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > max) throw new DbUpdateError(`fichier trop volumineux (${declared} octets)`)
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      throw new DbUpdateError(`fichier trop volumineux (plus de ${max} octets)`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

interface RemoteMeta {
  updated_at: string
  data_url: string
  data_sha256: string
  sites_count?: number
  version?: number
}

/** Vérifie les champs de db_meta.json. */
export function parseRemoteMeta(json: unknown): RemoteMeta {
  const m = (json ?? {}) as Record<string, unknown>
  if (typeof m.version === 'number' && m.version > 1) throw new DbUpdateError(`format de base ${m.version} non pris en charge`)
  if (typeof m.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(m.updated_at)) throw new DbUpdateError('date de mise à jour absente')
  if (typeof m.data_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(m.data_sha256)) throw new DbUpdateError('empreinte SHA-256 absente')
  if (typeof m.data_url !== 'string' || !isAllowedDataUrl(m.data_url)) throw new DbUpdateError('adresse de téléchargement refusée (HTTPS sur GitHub uniquement)')
  return {
    updated_at: m.updated_at,
    data_url: m.data_url,
    data_sha256: m.data_sha256.toLowerCase(),
    sites_count: typeof m.sites_count === 'number' ? m.sites_count : undefined
  }
}

/**
 * Télécharge la dernière base Maigret si elle est plus récente que celle utilisée, vérifie son
 * empreinte et son schéma, puis l'écrit dans le dossier utilisateur. Toutes les requêtes passent
 * par `fetchFn` (proxy ou Tor de l'utilisateur).
 */
export async function updateDb(fetchFn: FetchLike, opts: { metaUrl?: string; force?: boolean } = {}): Promise<UpdateOutcome> {
  const dir = paths.userDir
  if (!dir) throw new DbUpdateError('dossier utilisateur non configuré')
  const metaRes = await fetchFn(opts.metaUrl ?? DB_META_URL, { timeoutMs: 20000, headers: { accept: 'application/json' } })
  if (!metaRes.ok) throw new DbUpdateError(`db_meta.json : HTTP ${metaRes.status}`)
  let metaJson: unknown
  try {
    metaJson = JSON.parse((await readCapped(metaRes, MAX_META_BYTES)).toString('utf8'))
  } catch (e) {
    throw e instanceof DbUpdateError ? e : new DbUpdateError('db_meta.json illisible')
  }
  const meta = parseRemoteMeta(metaJson)

  const current = loadDb()
  if (!opts.force && current.meta.sha256 === meta.data_sha256) {
    return { status: 'current', updatedAt: current.meta.updated_at, sites: Object.keys(current.data.sites).length }
  }
  if (!opts.force && (current.meta.updated_at ?? '') > meta.updated_at) {
    return { status: 'current', updatedAt: current.meta.updated_at, sites: Object.keys(current.data.sites).length }
  }

  const res = await fetchFn(meta.data_url, { timeoutMs: 120000, redirect: 'follow' })
  if (!res.ok) throw new DbUpdateError(`téléchargement de la base : HTTP ${res.status}`)
  // Redirection éventuelle : la destination finale doit rester sur GitHub.
  if (res.url && !isAllowedDataUrl(res.url)) throw new DbUpdateError('redirection vers un hôte refusé')
  const buf = await readCapped(res, MAX_DB_BYTES)
  const hash = sha256(buf)
  if (hash !== meta.data_sha256) throw new DbUpdateError('empreinte SHA-256 différente de celle annoncée : base refusée')
  let data: MaigretData
  try {
    data = JSON.parse(buf.toString('utf8')) as MaigretData
  } catch {
    throw new DbUpdateError('base illisible (JSON invalide)')
  }
  const invalid = validateMaigretData(data, paths.minSites)
  if (invalid) throw new DbUpdateError(`base refusée : ${invalid}`)

  mkdirSync(dir, { recursive: true })
  const file = join(dir, DB_FILE)
  writeFileSync(`${file}.tmp`, buf)
  renameSync(`${file}.tmp`, file)
  const stored: DbMeta = {
    updated_at: meta.updated_at,
    sha256: hash,
    sites_count: meta.sites_count ?? Object.keys(data.sites).length,
    data_url: meta.data_url,
    downloaded_at: new Date().toISOString()
  }
  writeFileSync(join(dir, META_FILE), JSON.stringify(stored, null, 2))
  reloadDb()
  return { status: 'updated', updatedAt: meta.updated_at, sites: Object.keys(data.sites).length, regexSkipped: unconvertedRegexCount(data) }
}
