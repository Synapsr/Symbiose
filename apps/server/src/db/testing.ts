import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { migrationsFolder } from './index';

/**
 * Tests only: writes at `file` a database as an update would find it, with
 * every migration but the latest applied (and returns it open, to seed it).
 */
export function databaseBehind(file: string): Database.Database {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  const folder = mkdtempSync(join(tmpdir(), 'symbiose-migrations-'));
  cpSync(migrationsFolder(), folder, { recursive: true });
  const journal = join(folder, 'meta/_journal.json');
  const entries = JSON.parse(readFileSync(journal, 'utf8')) as { entries: unknown[] };
  writeFileSync(journal, JSON.stringify({ ...entries, entries: entries.entries.slice(0, -1) }));
  const sqlite = new Database(file);
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  rmSync(folder, { recursive: true, force: true });
  return sqlite;
}
