import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BackupImportError, importBackup, sealBackup, type AuthEnv, type Db, type Sql } from '@symbiose/core';
import { users } from '@symbiose/core/db/schema';
import { HttpError } from '@symbiose/core/errors';
import { limitBody } from '@symbiose/core/http';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { requireAuth } from '../auth';
import { openDb } from '../db';
import type { ServerDeps } from '../http';

/** A backup carries the photos: well beyond the API's JSON limit. */
export const BACKUP_BODY_LIMIT = 512 * 1024 * 1024;

/** better-sqlite3 behind the backup's few calls; it binds Buffers, not plain Uint8Arrays. */
export function sqlOf(sqlite: Database.Database): Sql {
  const params = (values: unknown[] = []) => values.map((v) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v));
  return {
    exec: (sql) => void sqlite.exec(sql),
    run: (sql, values) => void sqlite.prepare(sql).run(...params(values)),
    all: <T>(sql: string, values?: unknown[]) => sqlite.prepare(sql).all(...params(values)) as T[],
  };
}

/** The connection under drizzle: the backup needs VACUUM INTO and ATTACH. */
const sqliteOf = (db: Db) => (db as unknown as { $client: Database.Database }).$client;

const MESSAGES: Record<BackupImportError['code'], string> = {
  not_a_backup: 'This file is not a Symbiose backup',
  newer_format: 'This backup comes from a newer version of Symbiose: update the server first',
  newer_app: 'This backup comes from a newer version of Symbiose: update the server first',
  account_not_empty: 'This account already has data: restore with replace=1 to replace it',
  ids_taken: 'This backup is already on this server, in another account',
};

/**
 * The account as one file, and back: what lets someone move between this
 * server and a phone without a server (the app's « Passer sur un serveur »,
 * « Ramener mes données sur ce téléphone »). Same format as the phone's.
 */
export function backupRoutes({ db, photos, config }: ServerDeps) {
  const app = new Hono<AuthEnv>();
  const auth = requireAuth(config.jwtSecret);

  app.get('/backup', auth, async (c) => {
    const userId = c.get('userId');
    const dir = mkdtempSync(join(tmpdir(), 'symbiose-backup-'));
    try {
      const file = join(dir, 'backup.symbiose');
      sqliteOf(db).prepare('VACUUM INTO ?').run(file);
      const copy = new Database(file);
      try {
        await sealBackup(sqlOf(copy), { userId, origin: 'server', readPhoto: async (id) => (await photos.readBytes(userId, id))?.bytes ?? null });
      } finally {
        copy.close();
      }
      const bytes = readFileSync(file);
      c.header('Content-Type', 'application/vnd.symbiose.backup');
      c.header('Content-Disposition', `attachment; filename="symbiose-${new Date().toISOString().slice(0, 10)}.symbiose"`);
      c.header('Cache-Control', 'no-store');
      return c.body(new Uint8Array(bytes));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** The body is the backup file. `?replace=1` replaces what the account already has. */
  app.post('/restore', auth, limitBody(BACKUP_BODY_LIMIT), async (c) => {
    const userId = c.get('userId');
    // A waiting account stores nothing (sign-up on request).
    if (db.select({ pending: users.pending }).from(users).where(eq(users.id, userId)).get()?.pending) {
      throw new HttpError(403, 'account_pending', 'This account is waiting for an admin to approve it');
    }
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.length === 0) throw new HttpError(400, 'not_a_backup', MESSAGES.not_a_backup);
    const dir = mkdtempSync(join(tmpdir(), 'symbiose-restore-'));
    const sqlite = sqliteOf(db);
    try {
      const file = join(dir, 'restore.symbiose');
      writeFileSync(file, body);
      // An older backup gets this server's migrations, as an older database would.
      try {
        const upgraded = openDb(file);
        (upgraded as unknown as { $client: Database.Database }).$client.close();
      } catch {
        throw new HttpError(400, 'not_a_backup', MESSAGES.not_a_backup);
      }
      sqlite.prepare('ATTACH DATABASE ? AS backup').run(file);
      try {
        const counts = await importBackup(sqlOf(sqlite), {
          userId,
          replace: c.req.query('replace') === '1',
          writePhoto: (id, data) => photos.restoreFile(id, data),
        });
        return c.json({ restored: counts });
      } catch (error) {
        if (error instanceof BackupImportError) {
          throw new HttpError(error.code === 'account_not_empty' || error.code === 'ids_taken' ? 409 : 400, error.code, MESSAGES[error.code]);
        }
        throw error;
      } finally {
        sqlite.prepare('DETACH DATABASE backup').run();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return app;
}
