import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { canonicalKey } from '@shared/canonical'

export type DB = Database.Database

/** Migration : script SQL, ou fonction quand le calcul ne peut pas se faire en SQL. */
type Migration = string | ((db: DB) => void)

// Chaque ligne porte un identifiant UUID, `updated_at` et `deleted_at` :
// ce sont les briques nécessaires à une future synchronisation entre postes.
const MIGRATIONS: Migration[] = [
  `
  CREATE TABLE investigations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#e5484d',
    notes TEXT NOT NULL DEFAULT '',
    viewport TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'entity',
    type TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    platform TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    image_id TEXT,
    x REAL NOT NULL DEFAULT 0,
    y REAL NOT NULL DEFAULT 0,
    width REAL,
    height REAL,
    style TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'manual',
    dedup_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX idx_nodes_inv ON nodes(investigation_id);
  CREATE INDEX idx_nodes_dedup ON nodes(investigation_id, dedup_key);

  CREATE TABLE edges (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    style TEXT NOT NULL DEFAULT '{}',
    source_module TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX idx_edges_inv ON edges(investigation_id);

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    origin TEXT,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_att_inv ON attachments(investigation_id);

  CREATE TABLE module_runs (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL,
    found INTEGER,
    result_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    raw TEXT,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX idx_runs_node ON module_runs(investigation_id, node_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE secrets (
    id TEXT PRIMARY KEY,
    value BLOB NOT NULL,
    encrypted INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
  `,
  // 2 : résultats à vérifier (hypothèses et recherches manuelles), hors du graphe.
  `
  CREATE TABLE suggestions (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    platform TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    link_label TEXT NOT NULL DEFAULT '',
    url TEXT,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    dedup_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sugg_node ON suggestions(investigation_id, node_id);
  CREATE UNIQUE INDEX idx_sugg_dedup ON suggestions(investigation_id, node_id, kind, dedup_key);
  `,
  // 3 : clés de dédoublonnage canoniques (numéros en E.164, plateforme ignorée pour les emails...).
  (db) => recomputeDedupKeys(db),
  // 4 : provenance fine (observations par module, corroboration) et profondeur des nœuds.
  (db) => addObservations(db)
]

export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Contenu supprimé (enquête, nœud, pièce jointe) écrasé par des zéros, pas seulement libéré.
  db.pragma('secure_delete = ON')
  migrate(db)
  closeInterruptedRuns(db)
  return db
}

/**
 * Langue enregistrée, lue avant le démarrage d'Electron (lecture seule, sans créer la base) :
 * elle fixe la langue de Chromium, que l'on ne peut plus changer ensuite.
 */
export function readStoredLang(file: string): 'fr' | 'en' | null {
  if (!existsSync(file)) return null
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined
      const lang = row ? (JSON.parse(row.value) as { lang?: unknown }).lang : null
      return lang === 'fr' || lang === 'en' ? lang : null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** Message des exécutions interrompues par la fermeture de l'application. */
export const INTERRUPTED_RUN = 'Interrompu : MASINT a été fermé pendant l’exécution'

/**
 * Exécutions restées « en cours » ou « en attente » après une fermeture de l'application
 * pendant un module : elles ne se termineront jamais, on les marque annulées au démarrage.
 */
export function closeInterruptedRuns(db: DB, at = Date.now()): number {
  return db
    .prepare("UPDATE module_runs SET status = 'cancelled', error = COALESCE(error, ?), finished_at = COALESCE(finished_at, ?) WHERE status IN ('running', 'queued')")
    .run(INTERRUPTED_RUN, at).changes
}

/**
 * Au-delà, le VACUUM attend la fermeture de l'application. Mesuré en test : 240 ms pour
 * 16 Mo de données restantes, 590 ms pour 48 Mo, 1,5 s pour 128 Mo (environ 85 Mo/s).
 * 32 Mo garde une marge sous la seconde sur une machine deux fois plus lente.
 */
const VACUUM_NOW_MAX_BYTES = 32 * 1024 * 1024

export interface CompactResult {
  /** Durées mesurées en millisecondes. */
  checkpointMs: number
  vacuumMs: number | null
  /** Compactage reporté à la fermeture : base trop grosse pour le faire sans bloquer. */
  deferred: boolean
  bytesBefore: number
  bytesAfter: number
}

let vacuumPending = false

function dbBytes(db: DB): number {
  const pages = db.pragma('page_count', { simple: true }) as number
  const size = db.pragma('page_size', { simple: true }) as number
  return pages * size
}

/**
 * Après une suppression : vide le journal WAL dans la base (et le tronque), puis reconstruit
 * le fichier (VACUUM) pour qu'il ne garde ni pages libres ni anciennes copies de pages.
 * Sur une grosse base, le VACUUM bloquerait plus d'une seconde : il est reporté à la
 * fermeture (`vacuumIfPending`).
 */
export function compactDatabase(db: DB, opts: { maxBytes?: number; force?: boolean } = {}): CompactResult {
  const t0 = performance.now()
  db.pragma('wal_checkpoint(TRUNCATE)')
  const checkpointMs = performance.now() - t0
  const bytesBefore = dbBytes(db)
  if (!opts.force && bytesBefore > (opts.maxBytes ?? VACUUM_NOW_MAX_BYTES)) {
    vacuumPending = true
    return { checkpointMs, vacuumMs: null, deferred: true, bytesBefore, bytesAfter: bytesBefore }
  }
  const t1 = performance.now()
  db.exec('VACUUM')
  // En mode WAL, le VACUUM réécrit toute la base dans le journal : on le vide de nouveau.
  db.pragma('wal_checkpoint(TRUNCATE)')
  vacuumPending = false
  return { checkpointMs, vacuumMs: performance.now() - t1, deferred: false, bytesBefore, bytesAfter: dbBytes(db) }
}

/** Planifie le compactage après la réponse à l'interface (suppression d'une enquête). */
export function compactLater(db: DB, delayMs = 250): void {
  setTimeout(() => {
    if (!db.open) return
    try {
      const r = compactDatabase(db)
      const mb = (n: number): string => (n / 1048576).toFixed(1)
      console.log(
        `[db] compactage : checkpoint ${r.checkpointMs.toFixed(0)} ms, ` +
          (r.deferred ? `VACUUM reporté à la fermeture (${mb(r.bytesBefore)} Mo)` : `VACUUM ${r.vacuumMs!.toFixed(0)} ms, ${mb(r.bytesBefore)} → ${mb(r.bytesAfter)} Mo`)
      )
    } catch (e) {
      console.error('[db] compactage impossible', e)
    }
  }, delayMs)
}

/** À la fermeture : compactage reporté d'une grosse base. */
export function vacuumIfPending(db: DB): void {
  if (!vacuumPending || !db.open) return
  try {
    const r = compactDatabase(db, { force: true })
    console.log(`[db] VACUUM à la fermeture : ${r.vacuumMs?.toFixed(0)} ms`)
  } catch (e) {
    console.error('[db] compactage impossible', e)
  }
}

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number
  for (let v = version; v < MIGRATIONS.length; v++) {
    const m = MIGRATIONS[v]
    db.transaction(() => {
      if (typeof m === 'string') db.exec(m)
      else m(db)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

/**
 * Migration 4 : table `observations` (quel module a vu quel nœud, lien ou propriété, lors de
 * quelle exécution) et colonne `hop` des nœuds (profondeur depuis une saisie).
 *
 * Reprise de l'existant, sans exécution connue (`run_id` vide) : un nœud créé par un module
 * est observé par ce module (`source`), un lien posé par un module l'est par le sien
 * (`source_module`). Un nœud créé par un module reçoit la profondeur 1, faute de mieux.
 */
export function addObservations(db: DB): void {
  // Rejouable : une base déjà migrée (version remise en arrière) n'est pas modifiée deux fois.
  const columns = db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === 'hop')) {
    db.exec(`
      ALTER TABLE nodes ADD COLUMN hop INTEGER NOT NULL DEFAULT 0;
      UPDATE nodes SET hop = 1 WHERE kind = 'entity' AND source != 'manual';
    `)
  }
  const existed = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'observations'").get()
  db.exec(`
    -- Identifiant déjà enrichi récemment, toutes enquêtes confondues (enchaînement).
    CREATE INDEX IF NOT EXISTS idx_nodes_key ON nodes(dedup_key);

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL,
      edge_id TEXT,
      property TEXT,
      run_id TEXT NOT NULL DEFAULT '',
      module_id TEXT NOT NULL,
      source_url TEXT,
      observed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obs_node ON observations(investigation_id, node_id);
    CREATE INDEX IF NOT EXISTS idx_obs_edge ON observations(edge_id) WHERE edge_id IS NOT NULL;
  `)
  if (existed) return
  const insert = db.prepare(
    `INSERT INTO observations (id, investigation_id, node_id, edge_id, property, run_id, module_id, source_url, observed_at)
     VALUES (?, ?, ?, ?, NULL, '', ?, NULL, ?)`
  )
  const edges = db
    .prepare("SELECT id, investigation_id, target, source_module, created_at FROM edges WHERE source_module != 'manual' AND deleted_at IS NULL")
    .all() as Array<{ id: string; investigation_id: string; target: string; source_module: string; created_at: number }>
  const seen = new Set<string>()
  for (const e of edges) {
    insert.run(randomUUID(), e.investigation_id, e.target, e.id, e.source_module, e.created_at)
    seen.add(`${e.target}|${e.source_module}`)
  }
  const nodes = db
    .prepare("SELECT id, investigation_id, source, created_at FROM nodes WHERE kind = 'entity' AND source != 'manual' AND deleted_at IS NULL")
    .all() as Array<{ id: string; investigation_id: string; source: string; created_at: number }>
  for (const n of nodes) if (!seen.has(`${n.id}|${n.source}`)) insert.run(randomUUID(), n.investigation_id, n.id, null, n.source, n.created_at)
}

/**
 * Recalcule les clés de dédoublonnage avec les règles de `@shared/canonical`.
 *
 * Deux nœuds d'une même enquête qui partagent désormais une clé (« 06 39 98 12 34 » saisi à la
 * main et « +33639981234 » trouvé par un module) ne sont pas fusionnés d'office : l'index des
 * nœuds n'est pas unique, les deux restent et le plus ancien sert de référence au
 * dédoublonnage. L'index des résultats à vérifier est unique : en cas de collision, la clé du
 * plus récent est suffixée de son identifiant pour garder l'index valide.
 */
export function recomputeDedupKeys(db: DB): void {
  const nodes = db.prepare("SELECT id, type, label, platform FROM nodes WHERE kind = 'entity'").all() as Array<{
    id: string
    type: string
    label: string
    platform: string | null
  }>
  const setNode = db.prepare('UPDATE nodes SET dedup_key = ? WHERE id = ?')
  for (const n of nodes) setNode.run(canonicalKey(n.type, n.label, n.platform), n.id)

  const suggestions = db
    .prepare("SELECT id, investigation_id, node_id, type, label, platform FROM suggestions WHERE kind = 'entity' ORDER BY created_at, rowid")
    .all() as Array<{ id: string; investigation_id: string; node_id: string; type: string; label: string; platform: string | null }>
  const setSuggestion = db.prepare('UPDATE suggestions SET dedup_key = ? WHERE id = ?')
  // Deux passes : des clés provisoires uniques d'abord, pour ne jamais violer l'index en chemin.
  for (const s of suggestions) setSuggestion.run(`migration:${s.id}`, s.id)
  const taken = new Set<string>()
  for (const s of suggestions) {
    const key = canonicalKey(s.type, s.label, s.platform)
    const scope = JSON.stringify([s.investigation_id, s.node_id, key])
    setSuggestion.run(taken.has(scope) ? `${key}#${s.id}` : key, s.id)
    taken.add(scope)
  }
}
