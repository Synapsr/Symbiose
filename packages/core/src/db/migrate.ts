import type { SQLiteSession, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

import { sha256Hex } from '../hash';
import type { Db } from './index';
import { MIGRATIONS } from './migrations';

/**
 * Applies the migrations bundled with the core (db/migrations.ts), as the
 * server's folder migrator would: same statements, same hashes, same
 * timestamps in `__drizzle_migrations`. The app runs it on the phone's
 * database; a backup made on one host migrates the same way on the other.
 */
export function migrate(db: Db): void {
  const migrations = MIGRATIONS.map((migration) => ({
    sql: migration.sql.split('--> statement-breakpoint'),
    bps: migration.breakpoints,
    folderMillis: migration.when,
    hash: sha256Hex(migration.sql),
  }));
  // drizzle keeps its dialect and session internal; its own migrators reach them the same way.
  const internals = db as unknown as { dialect: SQLiteSyncDialect; session: SQLiteSession<'sync', unknown, Record<string, unknown>, never> };
  internals.dialect.migrate(migrations, internals.session);
}

/** The tag of the newest migration this build knows (`0010_meal_courses`): what a backup was made with. */
export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1]!;
