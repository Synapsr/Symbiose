import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

/**
 * The database, synchronous like both drivers the core runs on: better-sqlite3
 * on the server, expo-sqlite in the app.
 */
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
