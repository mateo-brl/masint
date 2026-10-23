import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { canonicalKey } from '@shared/canonical'

export type DB = Database.Database

/** Migration : script SQL, ou fonction quand le calcul ne peut pas se faire en SQL. */
type Migration = string | ((db: DB) => void)

/** Longueur maximale du texte des propriétés indexé pour un nœud. */
const SEARCH_DATA_MAX = 20000

/**
 * Texte des propriétés d'un nœud pour l'index : valeurs textuelles et numériques seulement (ni
 * clés, ni ponctuation JSON), sans les champs internes `__` (json_tree écrit `$."__image"`).
 */
function searchDataSql(col: string): string {
  return `CASE WHEN json_valid(${col}) THEN COALESCE((SELECT substr(group_concat(value, ' '), 1, ${SEARCH_DATA_MAX}) FROM json_tree(${col})
    WHERE type IN ('text', 'integer', 'real') AND fullkey NOT GLOB '$.__*' AND fullkey NOT GLOB '$."__*'), '') ELSE '' END`
}

/**
 * Index plein texte : `node_text` garde le texte indexé de chaque nœud non supprimé (hors
 * dessins), `node_fts` l'indexe (contenu externe, sans copie). Les deux sont tenus à jour par
 * des déclencheurs : toute écriture (saisie, module, import d'archive, fusion, suppression en
 * cascade d'une enquête) est prise en compte. Un déplacement de nœud ne touche pas l'index.
 * Découpage en trigrammes : une partie de valeur suffit (« 9981234 », « exempl »), sans tenir
 * compte de la casse ni des accents. Rejouable sans erreur (base remise à une version antérieure).
 */
function searchIndexMigration(): string {
  const row = (r: string): string => `${r}.id, ${r}.investigation_id, ${r}.label, ${searchDataSql(`${r}.data`)}, ${r}.notes`
  return `
  CREATE INDEX IF NOT EXISTS idx_nodes_dedup_key ON nodes(dedup_key);

  CREATE TABLE IF NOT EXISTS node_text (
    id INTEGER PRIMARY KEY,
    node_id TEXT NOT NULL UNIQUE,
    investigation_id TEXT NOT NULL,
    label TEXT NOT NULL,
    data TEXT NOT NULL,
    notes TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
    label, data, notes,
    content = 'node_text', content_rowid = 'id',
    tokenize = 'trigram remove_diacritics 1'
  );

  CREATE TRIGGER IF NOT EXISTS node_text_ai AFTER INSERT ON node_text BEGIN
    INSERT INTO node_fts(rowid, label, data, notes) VALUES (new.id, new.label, new.data, new.notes);
  END;
  CREATE TRIGGER IF NOT EXISTS node_text_ad AFTER DELETE ON node_text BEGIN
    INSERT INTO node_fts(node_fts, rowid, label, data, notes) VALUES ('delete', old.id, old.label, old.data, old.notes);
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_search_ai AFTER INSERT ON nodes WHEN new.deleted_at IS NULL AND new.kind != 'drawing' BEGIN
    INSERT INTO node_text(node_id, investigation_id, label, data, notes) SELECT ${row('new')};
  END;
  CREATE TRIGGER IF NOT EXISTS nodes_search_au AFTER UPDATE ON nodes
    WHEN old.label IS NOT new.label OR old.data IS NOT new.data OR old.notes IS NOT new.notes OR old.kind IS NOT new.kind
      OR old.deleted_at IS NOT new.deleted_at OR old.investigation_id IS NOT new.investigation_id
  BEGIN
    DELETE FROM node_text WHERE node_id = old.id;
    INSERT INTO node_text(node_id, investigation_id, label, data, notes) SELECT ${row('new')} WHERE new.deleted_at IS NULL AND new.kind != 'drawing';
  END;
  CREATE TRIGGER IF NOT EXISTS nodes_search_ad AFTER DELETE ON nodes BEGIN
    DELETE FROM node_text WHERE node_id = old.id;
  END;

  INSERT OR IGNORE INTO node_text(node_id, investigation_id, label, data, notes)
    SELECT ${row('n')} FROM nodes n WHERE n.deleted_at IS NULL AND n.kind != 'drawing';
  `
}

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
  // Preuves : captures de pages (image pleine page, archive MHTML, contexte JSON). Les trois
  // fichiers sont des pièces jointes de l'enquête ; le manifeste scelle leurs empreintes.
  `
  CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    node_id TEXT,
    url TEXT NOT NULL,
    final_url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    captured_at TEXT NOT NULL,
    screenshot_attachment TEXT NOT NULL,
    mhtml_attachment TEXT NOT NULL,
    meta_attachment TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_captures_node ON captures(investigation_id, node_id);
  `,
  // Journal d'activité : ajout seul, chaque entrée scellée par l'empreinte de la précédente.
  // Les déclencheurs refusent toute modification et toute suppression, sauf celle de l'enquête
  // entière (cascade : l'enquête n'existe déjà plus quand ses entrées sont supprimées).
  `
  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    investigation_id TEXT NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_seq ON activity(investigation_id, seq);
  CREATE TRIGGER IF NOT EXISTS activity_no_update BEFORE UPDATE ON activity
  BEGIN
    SELECT RAISE(ABORT, 'journal d''activité en ajout seul');
  END;
  CREATE TRIGGER IF NOT EXISTS activity_no_delete BEFORE DELETE ON activity
  WHEN EXISTS (SELECT 1 FROM investigations WHERE id = OLD.investigation_id)
  BEGIN
    SELECT RAISE(ABORT, 'journal d''activité en ajout seul');
  END;
  `,
  // Dernier résultat de la recherche assistée de chaque recherche manuelle (JSON).
  (db) => addColumn(db, 'suggestions', 'assist_result', 'TEXT'),
  // Provenance fine (observations par module, corroboration) et profondeur des nœuds.
  (db) => addObservations(db),
  // Recherche globale (index plein texte des nœuds) et corrélation entre enquêtes (index sur
  // la seule clé canonique, pour retrouver une entité dans toutes les enquêtes).
  searchIndexMigration()
]

/**
 * Ajoute une colonne si elle manque : une migration rejouée (base remise à une version
 * antérieure, migrations réordonnées) ne doit pas échouer.
 */
function addColumn(db: DB, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

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
 * Migration de la provenance : table `observations` (quel module a vu quel nœud, lien ou
 * propriété, lors de quelle exécution) et colonne `hop` des nœuds (profondeur depuis une saisie).
 *
 * Reprise de l'existant, sans exécution connue (`run_id` vide) : un nœud créé par un module
 * est observé par ce module (`source`), un lien posé par un module l'est par le sien
 * (`source_module`). Un nœud créé par un module reçoit la profondeur 1, faute de mieux.
 */
export function addObservations(db: DB): void {
  // Rejouable : une base déjà migrée (version remise en arrière) n'est pas modifiée deux fois.
  const columns = db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === 'hop')) {
    addColumn(db, 'nodes', 'hop', 'INTEGER NOT NULL DEFAULT 0')
    db.exec("UPDATE nodes SET hop = 1 WHERE kind = 'entity' AND source != 'manual'")
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
