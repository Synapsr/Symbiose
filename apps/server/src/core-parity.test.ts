import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { schema } from '@symbiose/core';
import { migrate as migrateBundled } from '@symbiose/core/db/migrate';
import { MIGRATIONS } from '@symbiose/core/db/migrations';
import { sha256Hex } from '@symbiose/core/hash';
import { decodePhoto } from '@symbiose/core/services/photos';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migrationsFolder, openDb } from './db';

// What the app runs on the phone must give the same results as the server.

function schemaOf(sqlite: Database.Database) {
  return sqlite
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all();
}

describe('core parity with the server', () => {
  it('the bundled migrations are the drizzle/ folder', () => {
    const folder = migrationsFolder();
    const files = readdirSync(folder).filter((name) => name.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((m) => `${m.tag}.sql`)).toEqual(files);
    for (const migration of MIGRATIONS) expect(migration.sql).toBe(readFileSync(join(folder, `${migration.tag}.sql`), 'utf8'));
  });

  it('migrating with the bundle gives the same database as the folder migrator', () => {
    const server = openDb(':memory:');
    const serverSqlite = (server as unknown as { $client: Database.Database }).$client;

    const phoneSqlite = new Database(':memory:');
    phoneSqlite.pragma('foreign_keys = ON');
    migrateBundled(drizzle(phoneSqlite, { schema }));

    expect(schemaOf(phoneSqlite)).toEqual(schemaOf(serverSqlite));
    const applied = (sqlite: Database.Database) => sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all();
    expect(applied(phoneSqlite)).toEqual(applied(serverSqlite));

    // Running it again changes nothing.
    migrateBundled(drizzle(phoneSqlite, { schema }));
    expect(applied(phoneSqlite)).toHaveLength(MIGRATIONS.length);
  });

  it('hashes like Node', () => {
    for (const text of ['', 'abc', 'é è ü 🍫', 'x'.repeat(1000), JSON.stringify({ userId: 'u', insights: { days: 7 } })]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });

  it('reads a photo without decoding it', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
    for (const [bytes, mime] of [
      [jpeg, 'image/jpeg'],
      [png, 'image/png'],
      [webp, 'image/webp'],
    ] as const) {
      const base64 = bytes.toString('base64');
      expect(decodePhoto(base64)).toEqual({ base64, mime, size: bytes.length });
      expect(decodePhoto(`data:${mime};base64,${base64}`).size).toBe(bytes.length);
    }
    expect(() => decodePhoto(Buffer.from('GIF89a').toString('base64'))).toThrow(/JPEG, PNG and WebP/);
    expect(() => decodePhoto('')).toThrow(/empty/);
  });
});
