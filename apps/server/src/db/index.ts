import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

export function openDb(file: string): Db {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

export { schema };
