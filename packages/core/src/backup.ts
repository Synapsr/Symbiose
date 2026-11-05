import { VERSION } from './config';
import { MIGRATIONS } from './db/migrations';

/**
 * A Symbiose backup is one SQLite file: a copy of the database with one
 * person's rows, their photos inside (`backup_photos`) and what made it
 * (`backup_meta`). The same file comes from the phone and from a server, and
 * goes back to either: the phone swaps its database for it, a server imports
 * its rows into an account. Any SQLite tool can open it.
 *
 * Both hosts run this code through `Sql` (expo-sqlite on the phone,
 * better-sqlite3 on the server).
 */

export const BACKUP_FORMAT = 1;
export const BACKUP_EXTENSION = 'symbiose';

/** The few calls the backup needs from a SQLite connection. */
export interface Sql {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  all<T>(sql: string, params?: unknown[]): T[];
}

export interface BackupMeta {
  format: number;
  app: string;
  appVersion: string;
  origin: 'phone' | 'server';
  createdAt: string;
  /** `created_at` of the newest migration applied: drizzle-kit's timestamp. */
  migration: number;
  /** Rows per table, to check nothing went missing on the way. */
  counts: Record<string, number>;
}

/** Tables a backup never carries: drizzle's bookkeeping, the server-wide AI statistics, the backup's own. */
const SKIPPED = new Set(['__drizzle_migrations', 'ai_usage', 'backup_meta', 'backup_photos', 'sqlite_sequence']);

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The person's tables, in the order rows can be inserted (users first). */
export function dataTables(db: Sql, schema = 'main'): string[] {
  const names = db
    .all<{ name: string }>(`SELECT name FROM ${quote(schema)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map((row) => row.name)
    .filter((name) => !SKIPPED.has(name));
  return ['users', ...names.filter((name) => name !== 'users')].filter((name) => names.includes(name));
}

function columns(db: Sql, table: string, schema = 'main'): string[] {
  return db.all<{ name: string }>(`PRAGMA ${quote(schema)}.table_info(${quote(table)})`).map((row) => row.name);
}

export function rowCounts(db: Sql, schema = 'main'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of dataTables(db, schema)) {
    counts[table] = db.all<{ n: number }>(`SELECT count(*) AS n FROM ${quote(schema)}.${quote(table)}`)[0]?.n ?? 0;
  }
  return counts;
}

function newestMigration(db: Sql, schema = 'main'): number {
  try {
    return Number(db.all<{ at: number }>(`SELECT max(created_at) AS at FROM ${quote(schema)}.__drizzle_migrations`)[0]?.at ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Turns a copy of the database (`VACUUM INTO`) into a backup of one person:
 * every other account and the server-wide statistics go, the photos come in.
 */
export async function sealBackup(
  copy: Sql,
  options: { userId: string; origin: BackupMeta['origin']; readPhoto: (id: string) => Promise<Uint8Array | null>; now?: Date },
): Promise<BackupMeta> {
  copy.exec('PRAGMA foreign_keys = ON');
  // Every other account's rows go with it (ON DELETE CASCADE).
  copy.run('DELETE FROM users WHERE id <> ?', [options.userId]);
  copy.exec('DELETE FROM ai_usage');
  copy.exec('CREATE TABLE backup_photos (id TEXT PRIMARY KEY NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL)');
  copy.exec('CREATE TABLE backup_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)');
  for (const photo of copy.all<{ id: string; mime: string }>('SELECT id, mime FROM photos')) {
    const data = await options.readPhoto(photo.id);
    // A photo whose file is gone stays out; its row says it existed.
    if (data) copy.run('INSERT INTO backup_photos (id, mime, data) VALUES (?, ?, ?)', [photo.id, photo.mime, data]);
  }
  const meta: BackupMeta = {
    format: BACKUP_FORMAT,
    app: 'symbiose',
    appVersion: VERSION,
    origin: options.origin,
    createdAt: (options.now ?? new Date()).toISOString(),
    migration: newestMigration(copy),
    counts: rowCounts(copy),
  };
  for (const [key, value] of Object.entries(meta)) copy.run('INSERT INTO backup_meta (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  copy.exec('VACUUM');
  return meta;
}

/** What a file says about itself, or null when it isn't a Symbiose backup. */
export function readBackupMeta(db: Sql, schema = 'main'): BackupMeta | null {
  try {
    const rows = db.all<{ key: string; value: string }>(`SELECT key, value FROM ${quote(schema)}.backup_meta`);
    const meta = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value) as unknown])) as Partial<BackupMeta>;
    return meta.app === 'symbiose' && typeof meta.format === 'number' ? (meta as BackupMeta) : null;
  } catch {
    return null;
  }
}

export type BackupProblem = 'not_a_backup' | 'newer_format' | 'newer_app';

/** Whether this build can open a backup: one made by a newer version of Symbiose waits for an update. */
export function backupProblem(meta: BackupMeta | null): BackupProblem | null {
  if (!meta) return 'not_a_backup';
  if (meta.format > BACKUP_FORMAT) return 'newer_format';
  const newestKnown = MIGRATIONS[MIGRATIONS.length - 1]?.when ?? 0;
  if (meta.migration > newestKnown) return 'newer_app';
  return null;
}

/**
 * Makes a backup file the phone's database again: its photos go back to
 * files, its own tables go. The migrations of this build run afterwards, as
 * for any older database.
 */
export async function unsealBackup(db: Sql, writePhoto: (id: string, data: Uint8Array) => Promise<void>): Promise<void> {
  for (const photo of db.all<{ id: string; data: Uint8Array }>('SELECT id, data FROM backup_photos')) await writePhoto(photo.id, photo.data);
  db.exec('DROP TABLE IF EXISTS backup_photos');
  db.exec('DROP TABLE IF EXISTS backup_meta');
}

export class BackupImportError extends Error {
  constructor(readonly code: 'not_a_backup' | 'newer_format' | 'newer_app' | 'account_not_empty' | 'ids_taken') {
    super(code);
  }
}

/**
 * A server: copies a backup's rows into an account. The backup is attached as
 * `backup` and already migrated to this server's schema. Its person becomes
 * the account: every `user_id` is the account's, the profile and the plan are
 * the backup's, the email and the password stay the account's.
 */
export async function importBackup(
  db: Sql,
  options: { userId: string; replace: boolean; writePhoto: (id: string, data: Uint8Array) => Promise<void> },
): Promise<Record<string, number>> {
  const problem = backupProblem(readBackupMeta(db, 'backup'));
  if (problem) throw new BackupImportError(problem);
  const tables = dataTables(db, 'backup').filter((table) => table !== 'users' && dataTables(db).includes(table));

  const owned = (table: string) => columns(db, table).includes('user_id');
  const hasData = tables.some((table) => owned(table) && (db.all<{ n: number }>(`SELECT count(*) AS n FROM main.${quote(table)} WHERE user_id = ?`, [options.userId])[0]?.n ?? 0) > 0);
  if (hasData && !options.replace) throw new BackupImportError('account_not_empty');

  db.exec('BEGIN');
  try {
    if (options.replace) for (const table of tables) if (owned(table)) db.run(`DELETE FROM main.${quote(table)} WHERE user_id = ?`, [options.userId]);
    // Ids are unique across accounts: the same backup can't land twice on one server.
    for (const table of tables) {
      if (!columns(db, table).includes('id')) continue;
      const taken = db.all(`SELECT 1 FROM main.${quote(table)} WHERE id IN (SELECT id FROM backup.${quote(table)}) LIMIT 1`);
      if (taken.length) throw new BackupImportError('ids_taken');
    }
    const person = db.all<{ name: string; profile: string | null; plan: string | null }>('SELECT name, profile, plan FROM backup.users LIMIT 1')[0];
    if (person) db.run('UPDATE main.users SET name = ?, profile = ?, plan = ? WHERE id = ?', [person.name, person.profile, person.plan, options.userId]);
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const shared = columns(db, table, 'backup').filter((column) => columns(db, table).includes(column));
      const select = shared.map((column) => (column === 'user_id' ? '?' : quote(column))).join(', ');
      db.run(`INSERT INTO main.${quote(table)} (${shared.map(quote).join(', ')}) SELECT ${select} FROM backup.${quote(table)}`, shared.includes('user_id') ? [options.userId] : []);
      counts[table] = db.all<{ n: number }>(`SELECT count(*) AS n FROM backup.${quote(table)}`)[0]?.n ?? 0;
    }
    db.exec('COMMIT');
    for (const photo of db.all<{ id: string; data: Uint8Array }>('SELECT id, data FROM backup.backup_photos')) await options.writePhoto(photo.id, photo.data);
    return counts;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
