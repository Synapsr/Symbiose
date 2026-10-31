import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';

import { openDb } from './index';
import { databaseBehind } from './testing';

const dir = mkdtempSync(join(tmpdir(), 'symbiose-backup-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('database backups before migrations', () => {
  const file = join(dir, 'symbiose.db');
  const backups = join(dir, 'backups');

  it('keeps no copy of a brand-new database', () => {
    openDb(file);
    expect(existsSync(backups)).toBe(false);
  });

  it('copies an existing database before applying a pending migration, and keeps the last three', () => {
    for (let i = 0; i < 4; i++) {
      // A database from before the latest migration.
      databaseBehind(file).close();
      openDb(file);
    }
    const copies = readdirSync(backups);
    expect(copies).toHaveLength(3);
    expect(copies[0]).toMatch(/^symbiose-before-\d{4}_.+\.db$/);

    // A copy is a complete, readable database.
    const copy = new Database(join(backups, copies[0]!), { readonly: true });
    expect(copy.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'meals'").get()).toEqual({ n: 1 });
    copy.close();
  });

  it('keeps no copy when nothing is pending', () => {
    const before = readdirSync(backups).length;
    openDb(file);
    expect(readdirSync(backups)).toHaveLength(before);
  });
});
