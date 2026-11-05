import { schema, type Db } from '@symbiose/core';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';

/** The phone's database: Documents/SQLite/symbiose.db, backed up by iCloud with the phone. */
export const DB_NAME = 'symbiose.db';

let sqlite: SQLiteDatabase | null = null;
let db: Db | null = null;

export function openPhoneDb(): Db {
  if (db) return db;
  sqlite = openDatabaseSync(DB_NAME);
  sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db = drizzle(sqlite, { schema }) as unknown as Db;
  return db;
}

/** The open connection, for what drizzle doesn't do (a consistent copy for a backup). */
export function phoneSqlite(): SQLiteDatabase {
  openPhoneDb();
  return sqlite!;
}

/** Closes the database (before a restore replaces its file). */
export function closePhoneDb(): void {
  sqlite?.closeSync();
  sqlite = null;
  db = null;
}

const dbFile = () => new File(new Directory(Paths.document, 'SQLite'), DB_NAME);

/**
 * Whether this phone already keeps Symbiose's data. The settings can be gone
 * while the data stays (Android restores app files but not the keystore), and
 * the app must then open on that data, not on an empty welcome screen.
 */
export function phoneDataExists(): boolean {
  try {
    return dbFile().exists;
  } catch {
    return false;
  }
}

export function phoneDbFile(): File {
  return dbFile();
}
