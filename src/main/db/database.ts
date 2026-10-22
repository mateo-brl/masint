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
  (db) => recomputeDedupKeys(db)
]

export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
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
