import { asc, gte } from 'drizzle-orm';

import type { Ai, AiUsageListener } from './ai/types';
import { createApp } from './app';
import { singleUser } from './auth';
import type { Db } from './db';
import { migrate } from './db/migrate';
import { aiUsage, users } from './db/schema';
import { nowIso } from './http';
import { newId } from './ids';
import { costOf, priceOf } from './services/ai-prices';
import { createUsageRecorder, pruneAiUsage } from './services/ai-usage';
import { PhotoStore, type PhotoFiles } from './services/photos';

/**
 * The person's row on a phone without a server. Accounts need an email and a
 * password; this one has neither (an address that can't exist, a hash nothing
 * matches), and nothing ever signs in with them.
 */
export const LOCAL_EMAIL = 'local@symbiose.invalid';

/** The phone's one person: the first account in the database (a restored backup brings its own), else a new one. */
export function localUserId(db: Db): string {
  const first = db.select({ id: users.id }).from(users).orderBy(asc(users.createdAt)).limit(1).get();
  if (first) return first.id;
  const id = newId();
  db.insert(users).values({ id, email: LOCAL_EMAIL, passwordHash: '', name: '', isAdmin: false, pending: false, createdAt: nowIso() }).run();
  return id;
}

/** « Ton IA » on the phone: this month's calls and, for models with a known price, about what they cost. */
export interface LocalAiUsage {
  /** First day of the month, UTC (YYYY-MM-DD). */
  since: string;
  calls: number;
  failed: number;
  /** USD; null when no call had a known price (another provider than Claude, or a plan). */
  costUsd: number | null;
}

export function localAiUsage(db: Db, now = new Date()): LocalAiUsage {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = db.select().from(aiUsage).where(gte(aiUsage.at, since)).all();
  let cost = 0;
  let priced = false;
  for (const row of rows) {
    const price = priceOf(row.model);
    if (!price) continue;
    priced = true;
    cost += costOf(row, price);
  }
  return { since: since.slice(0, 10), calls: rows.length, failed: rows.filter((row) => !row.ok).length, costUsd: priced ? cost : null };
}

export interface LocalApiOptions {
  db: Db;
  photoFiles: PhotoFiles;
  /** Builds the AI the person chose; every call it makes is counted for « Ton IA ». */
  createAi: (onUsage: AiUsageListener) => Ai;
  /** Open Food Facts lookups. */
  fetch?: typeof fetch;
}

/**
 * The API for the app on its own: the database is migrated, its one person
 * is every request's user, the photos and the AI are the phone's.
 */
export function createLocalApi({ db, photoFiles, createAi, fetch }: LocalApiOptions) {
  migrate(db);
  pruneAiUsage(db);
  const userId = localUserId(db);
  const ai = createAi(createUsageRecorder(db));
  const photos = new PhotoStore(db, photoFiles);
  const app = createApp(
    { db, ai, photos, auth: singleUser(userId), config: {}, fetch },
    {
      // The phone's own: every AI call counted here is this person's (a server's are everyone's, and only its admins see them).
      routes: (api) => api.get('/api/local/ai-usage', (c) => c.json(localAiUsage(db))),
    },
  );
  return { app, ai, userId, photos };
}
