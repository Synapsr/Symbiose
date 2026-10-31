import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

/** Works from src/ (tsx, vitest) and from the bundled dist/ alike. */
function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, '../drizzle'), join(here, '../../drizzle')]) {
    if (existsSync(join(candidate, 'meta/_journal.json'))) return candidate;
  }
  throw new Error('Could not locate the drizzle migrations folder');
}

const BACKUPS_KEPT = 3;

/**
 * Before applying new migrations to an existing database, keep a copy of it
 * in `backups/` next to the file (the last few only). Self-hosters get a way
 * back from any migration without setting up anything.
 */
function backupBeforeMigrating(sqlite: Database.Database, file: string, folder: string) {
  if (file === ':memory:') return;
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const tracked = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!tracked) return; // a brand-new database: nothing to protect
  const { applied } = sqlite.prepare('SELECT count(*) AS applied FROM __drizzle_migrations').get() as { applied: number };
  if (applied >= journal.entries.length) return;

  const dir = join(dirname(file), 'backups');
  mkdirSync(dir, { recursive: true });
  const next = journal.entries[applied]?.tag ?? 'next';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `${basename(file, '.db')}-before-${next}-${stamp}.db`);
  sqlite.prepare('VACUUM INTO ?').run(target);
  console.log(`Database backed up before migrating: ${target}`);

  const old = readdirSync(dir)
    .filter((name) => name.endsWith('.db'))
    .sort()
    .slice(0, -BACKUPS_KEPT);
  for (const name of old) rmSync(join(dir, name));
}

export function openDb(file: string): Db {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  const folder = migrationsFolder();
  backupBeforeMigrating(sqlite, file, folder);
  migrate(db, { migrationsFolder: folder });
  return db;
}

export { schema };
