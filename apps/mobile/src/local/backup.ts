import { backupProblem, readBackupMeta, sealBackup, unsealBackup, type BackupProblem, type Sql } from '@symbiose/core';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseSync, type SQLiteBindValue, type SQLiteDatabase } from 'expo-sqlite';

import { closePhoneDb, DB_NAME, phoneSqlite } from './db';
import { localApi, resetLocalApi } from './host';
import { phonePhotoFiles, photoFolder } from './photos';

/**
 * Backups on the phone (packages/core/src/backup.ts): one SQLite file with
 * the photos inside, the same as a server's. Made in the cache, then handed
 * to the share sheet (Drive, iCloud Drive, Files, an email); restored by
 * swapping the phone's database for it.
 */

export class BackupError extends Error {
  constructor(readonly problem: BackupProblem | 'failed') {
    super(problem);
  }
}

/** expo-sqlite behind the backup's few calls. */
export function sqlOf(db: SQLiteDatabase): Sql {
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params = []) => void db.runSync(sql, params as SQLiteBindValue[]),
    all: <T>(sql: string, params: unknown[] = []) => db.getAllSync<T>(sql, params as SQLiteBindValue[]),
  };
}

/** A file URI as the path SQLite wants. */
const pathOf = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

const sqliteFolder = () => new Directory(Paths.document, 'SQLite');

/** Makes a backup of everything on this phone; returns the file, ready to share. */
export async function makePhoneBackup(now = new Date()): Promise<File> {
  // Opened and migrated, with its person: what the backup will hold.
  const { userId } = await localApi();
  const folder = new Directory(Paths.cache, 'backups');
  if (folder.exists) folder.delete();
  folder.create({ intermediates: true, idempotent: true });
  const name = `symbiose-${now.toISOString().slice(0, 10)}.symbiose`;
  const file = new File(folder, name);
  // A consistent copy while the app goes on: SQLite's own.
  phoneSqlite().runSync('VACUUM INTO ?', [pathOf(file.uri)]);
  const copy = openDatabaseSync(name, {}, pathOf(folder.uri));
  try {
    await sealBackup(sqlOf(copy), { userId, origin: 'phone', readPhoto: (id) => phonePhotoFiles.readBytes(id), now });
  } finally {
    copy.closeSync();
  }
  return file;
}

/** Opens a file to see whether it is a backup this version can restore. */
export function checkBackup(source: File): BackupProblem | null {
  const folder = new Directory(Paths.cache, 'restore');
  if (folder.exists) folder.delete();
  folder.create({ intermediates: true, idempotent: true });
  const copy = new File(folder, 'check.symbiose');
  source.copy(copy);
  try {
    const db = openDatabaseSync('check.symbiose', {}, pathOf(folder.uri));
    try {
      return backupProblem(readBackupMeta(sqlOf(db)));
    } finally {
      db.closeSync();
    }
  } catch {
    return 'not_a_backup';
  } finally {
    if (folder.exists) folder.delete();
  }
}

/**
 * Replaces the phone's data with a backup's. The data it replaces is kept
 * aside (`symbiose.previous.db`) until the next restore, in case.
 */
export async function restorePhoneBackup(source: File): Promise<void> {
  const problem = checkBackup(source);
  if (problem) throw new BackupError(problem);

  closePhoneDb();
  resetLocalApi();
  const folder = sqliteFolder();
  folder.create({ intermediates: true, idempotent: true });
  const current = new File(folder, DB_NAME);
  const previous = new File(folder, 'symbiose.previous.db');
  if (previous.exists) previous.delete();
  if (current.exists) current.move(previous);
  // A journal left by the old database must never be replayed into the new one.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const leftover = new File(folder, `${DB_NAME}${suffix}`);
    if (leftover.exists) leftover.delete();
  }
  try {
    source.copy(new File(folder, DB_NAME));
    const sqlite = phoneSqlite();
    await unsealBackup(sqlOf(sqlite), (id, data) => phonePhotoFiles.writeBytes(id, data));
    // Migrated to this version, with the backup's person.
    resetLocalApi();
    await localApi();
  } catch (error) {
    // Back to the data as it was: nothing lost.
    closePhoneDb();
    resetLocalApi();
    const failed = new File(folder, DB_NAME);
    if (failed.exists) failed.delete();
    if (previous.exists) previous.move(new File(folder, DB_NAME));
    throw error instanceof BackupError ? error : new BackupError('failed');
  }
  // Photos of the replaced data that the backup doesn't have.
  const kept = new Set(phoneSqlite().getAllSync<{ id: string }>('SELECT id FROM photos').map((row) => row.id));
  const photos = photoFolder();
  if (photos.exists) {
    for (const entry of photos.list()) {
      if (entry instanceof File && !kept.has(entry.name.replace(/\.jpg$/, ''))) entry.delete();
    }
  }
}

/** Everything Symbiose keeps on this phone: the database, its copies, the photos. */
export function erasePhoneData(): void {
  closePhoneDb();
  resetLocalApi();
  const folder = sqliteFolder();
  for (const name of [DB_NAME, `${DB_NAME}-wal`, `${DB_NAME}-shm`, `${DB_NAME}-journal`, 'symbiose.previous.db']) {
    const file = new File(folder, name);
    if (file.exists) file.delete();
  }
  const photos = photoFolder();
  if (photos.exists) photos.delete();
}
