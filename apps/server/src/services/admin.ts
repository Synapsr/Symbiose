import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { addDays, MEAL_SOURCES, type AdminOverview, type AdminPeriod, type AdminRequest, type AiTotals, type MealSource } from '@symbiose/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Ai } from '../ai/types';
import type { Db } from '../db';
import { photos as photosTable, users } from '../db/schema';
import { signupMode, VERSION, type Config } from '../env';
import { costOf, LONG_PROMPT_TOKENS, priceOf } from './ai-prices';
import type { PhotoStore } from './photos';

// ---------------------------------------------------------------- Who is an admin

/** Whether an email is listed in ADMIN_EMAILS, as it is now. */
export function isAdminEmail(config: Pick<Config, 'adminEmails'>, email: string): boolean {
  return (config.adminEmails ?? []).includes(email.trim().toLowerCase());
}

/** Admins are the approved accounts whose email is listed: a pending one waits like anyone else. */
export function isAdmin(config: Pick<Config, 'adminEmails'>, account: { email: string; pending: boolean }): boolean {
  return !account.pending && isAdminEmail(config, account.email);
}

/**
 * The startup log about the admin view. There is no email verification, so
 * anyone could sign up with a listed email before its owner. With sign-up on
 * request, that account would wait for an admin like any other (and never be
 * admin while it waits). With open sign-up, a listed email is refused unless it
 * is the server's first account: each listed email without an account gets a
 * warning saying how to create it.
 */
export function adminSetupLog(db: Db, config: Config): { info: string; warnings: string[] } {
  const listed = config.adminEmails ?? [];
  const onRequest = signupMode(config) === 'request';
  // Emails are stored lowercased (CredentialsSchema), like the list.
  const accounts = listed.length ? db.select({ email: users.email, pending: users.pending }).from(users).where(inArray(users.email, listed)).all() : [];
  const warnings: string[] = [];
  if (onRequest && !accounts.some((account) => !account.pending)) {
    warnings.push("SIGNUP=request, but no email in ADMIN_EMAILS has an approved account yet: requests will wait until one does (the server's first account is always approved).");
  }
  if (!onRequest) {
    const existing = new Set(accounts.map((account) => account.email));
    for (const email of listed.filter((e) => !existing.has(e))) {
      warnings.push(`ADMIN_EMAILS lists ${email}, which has no account yet. Sign-up refuses listed emails (anyone could claim one) unless it is the server's first account: create the account first, then list it.`);
    }
  }
  return {
    info: listed.length ? `Admin view on for ${listed.length} ${listed.length === 1 ? 'email' : 'emails'} (ADMIN_EMAILS)` : 'Admin view off: list admin emails in ADMIN_EMAILS to see how the server is used',
    warnings,
  };
}

// ---------------------------------------------------------------- Requests (sign-up on request)

/** The accounts waiting for an admin, oldest first: email, first name and date, nothing else. */
export function pendingRequests(db: Db): AdminRequest[] {
  return db.select({ id: users.id, email: users.email, name: users.name, requestedAt: users.createdAt }).from(users).where(eq(users.pending, true)).orderBy(users.createdAt).all();
}

/** Lets a waiting account in; false when there is no such request. */
export function approveRequest(db: Db, id: string): boolean {
  return db.update(users).set({ pending: false }).where(and(eq(users.id, id), eq(users.pending, true))).run().changes > 0;
}

/** Refuses a request: the waiting account and everything it saved go. Never touches an approved account. */
export async function refuseRequest({ db, photos }: { db: Db; photos: PhotoStore }, id: string): Promise<boolean> {
  const row = db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.pending, true))).get();
  if (!row) return false;
  for (const photo of db.select({ id: photosTable.id }).from(photosTable).where(eq(photosTable.userId, id)).all()) await photos.remove(id, photo.id);
  db.delete(users).where(and(eq(users.id, id), eq(users.pending, true))).run();
  return true;
}

// ---------------------------------------------------------------- Overview

const emptyTotals = (): AiTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null });

interface UsageGroup {
  date: string;
  feature: string;
  provider: string;
  model: string;
  ok: number;
  error: string | null;
  longPrompt: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function addTo(totals: AiTotals, group: UsageGroup, cost: number | null) {
  totals.calls += group.calls;
  totals.inputTokens += group.inputTokens;
  totals.outputTokens += group.outputTokens;
  totals.cacheReadTokens += group.cacheReadTokens;
  totals.cacheWriteTokens += group.cacheWriteTokens;
  if (cost !== null) totals.costUsd = (totals.costUsd ?? 0) + cost;
}

/** Fractions of a cent stay readable, float noise goes. */
const roundCost = <T extends AiTotals>(totals: T): T => ({ ...totals, costUsd: totals.costUsd === null ? null : Math.round(totals.costUsd * 1e6) / 1e6 });

function aiSection(db: Db, config: Config, since: string, dates: string[]): AdminOverview['ai'] {
  const groups = db.all<UsageGroup>(sql`
    SELECT substr(at, 1, 10) AS date, feature, provider, model, ok, error,
      (input_tokens + cache_read_tokens + cache_write_tokens) > ${LONG_PROMPT_TOKENS} AS longPrompt,
      count(*) AS calls,
      sum(input_tokens) AS inputTokens, sum(output_tokens) AS outputTokens,
      sum(cache_read_tokens) AS cacheReadTokens, sum(cache_write_tokens) AS cacheWriteTokens
    FROM ai_usage WHERE at >= ${since}
    GROUP BY date, feature, provider, model, ok, error, longPrompt`);

  const total = emptyTotals();
  const daily = new Map(dates.map((date) => [date, { date, ...emptyTotals() }]));
  const byFeature = new Map<string, AiTotals & { feature: string }>();
  const byModel = new Map<string, AiTotals & { provider: string; model: string }>();
  const errorCodes = new Map<string, number>();
  let errors = 0;
  let unpricedCalls = 0;

  for (const group of groups) {
    const price = priceOf(group.model, config.aiPrices);
    const cost = price ? costOf(group, group.longPrompt && price.long ? price.long : price) : null;
    if (!price) unpricedCalls += group.calls;
    addTo(total, group, cost);
    const day = daily.get(group.date);
    if (day) addTo(day, group, cost);
    if (!byFeature.has(group.feature)) byFeature.set(group.feature, { feature: group.feature, ...emptyTotals() });
    addTo(byFeature.get(group.feature)!, group, cost);
    const modelKey = `${group.provider}\n${group.model}`;
    if (!byModel.has(modelKey)) byModel.set(modelKey, { provider: group.provider, model: group.model, ...emptyTotals() });
    addTo(byModel.get(modelKey)!, group, cost);
    if (!group.ok) {
      errors += group.calls;
      const code = group.error ?? 'ai_error';
      errorCodes.set(code, (errorCodes.get(code) ?? 0) + group.calls);
    }
  }

  // Nearest-rank percentiles of the answered calls, read straight from the sorted column.
  const answered = total.calls - errors;
  const percentile = (p: number) =>
    answered
      ? (db.get<{ ms: number }>(sql`SELECT duration_ms AS ms FROM ai_usage WHERE at >= ${since} AND ok = 1 ORDER BY duration_ms LIMIT 1 OFFSET ${Math.ceil(p * answered) - 1}`)?.ms ?? null)
      : null;
  const prompt = total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens;
  const mostCalls = (a: AiTotals, b: AiTotals) => b.calls - a.calls;

  return {
    ...roundCost(total),
    errors,
    errorRate: total.calls ? errors / total.calls : 0,
    cacheHitShare: prompt ? total.cacheReadTokens / prompt : null,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
    unpricedCalls,
    daily: [...daily.values()].map(roundCost),
    byFeature: [...byFeature.values()].sort(mostCalls).map(roundCost),
    byModel: [...byModel.values()].sort(mostCalls).map(roundCost),
    topErrors: [...errorCodes.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

function peopleSection(db: Db, now: Date): AdminOverview['people'] {
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const [day, week, month] = [ago(1), ago(7), ago(30)];
  const accounts = db.get<{ accounts: number; pending: number; week: number; month: number }>(sql`
    SELECT count(*) AS accounts, coalesce(sum(pending), 0) AS pending,
      coalesce(sum(created_at >= ${week}), 0) AS week, coalesce(sum(created_at >= ${month}), 0) AS month
    FROM users`)!;
  // Anything an account recorded, or the health store synced from its phone, counts as activity.
  const active = db.get<{ day: number; week: number; month: number }>(sql`
    WITH events(user_id, at) AS (
      SELECT id, created_at FROM users
      UNION ALL SELECT user_id, updated_at FROM meals
      UNION ALL SELECT user_id, created_at FROM cravings
      UNION ALL SELECT user_id, updated_at FROM journal_entries
      UNION ALL SELECT user_id, created_at FROM coach_messages WHERE role = 'user'
      UNION ALL SELECT user_id, updated_at FROM moods
      UNION ALL SELECT user_id, created_at FROM water_logs
      UNION ALL SELECT user_id, updated_at FROM weights
      UNION ALL SELECT user_id, created_at FROM workouts
      UNION ALL SELECT user_id, created_at FROM blood_pressure
      UNION ALL SELECT user_id, updated_at FROM sleep_nights
      UNION ALL SELECT user_id, updated_at FROM activity
      UNION ALL SELECT user_id, updated_at FROM vitals
    )
    SELECT count(DISTINCT CASE WHEN at >= ${day} THEN user_id END) AS day,
      count(DISTINCT CASE WHEN at >= ${week} THEN user_id END) AS week,
      count(DISTINCT user_id) AS month
    FROM events WHERE at >= ${month}`)!;
  return { accounts: accounts.accounts, pending: accounts.pending, active, new: { week: accounts.week, month: accounts.month } };
}

function usageSection(db: Db, since: string, dates: string[]): AdminOverview['usage'] {
  // A relog shares its photo (or its words and title) with an earlier meal; known items say where they came from.
  const meals = db.all<{ date: string; source: MealSource; n: number }>(sql`
    WITH ranked AS (
      SELECT created_at, photo_id, input_text, items,
        CASE
          WHEN photo_id IS NOT NULL THEN row_number() OVER (PARTITION BY photo_id ORDER BY created_at, id)
          WHEN input_text IS NOT NULL THEN row_number() OVER (PARTITION BY user_id, input_text, title ORDER BY created_at, id)
          ELSE 1
        END AS nth
      FROM meals
    )
    SELECT substr(created_at, 1, 10) AS date,
      CASE
        WHEN nth > 1 THEN 'relog'
        WHEN photo_id IS NOT NULL THEN 'photo'
        WHEN input_text IS NOT NULL THEN 'text'
        WHEN EXISTS (SELECT 1 FROM json_each(items) WHERE json_extract(value, '$.source') = 'barcode') THEN 'barcode'
        WHEN EXISTS (SELECT 1 FROM json_each(items) WHERE json_extract(value, '$.source') = 'library') THEN 'library'
        ELSE 'manual'
      END AS source,
      count(*) AS n
    FROM ranked WHERE created_at >= ${since}
    GROUP BY date, source`);
  const others = db.all<{ kind: 'cravings' | 'notes' | 'coachMessages'; date: string; n: number }>(sql`
    SELECT 'cravings' AS kind, substr(created_at, 1, 10) AS date, count(*) AS n FROM cravings WHERE created_at >= ${since} GROUP BY substr(created_at, 1, 10)
    UNION ALL SELECT 'notes', substr(created_at, 1, 10), count(*) FROM journal_entries WHERE created_at >= ${since} GROUP BY substr(created_at, 1, 10)
    UNION ALL SELECT 'coachMessages', substr(created_at, 1, 10), count(*) FROM coach_messages WHERE role = 'user' AND created_at >= ${since} GROUP BY substr(created_at, 1, 10)`);

  const daily = new Map(dates.map((date) => [date, { date, meals: 0, cravings: 0, notes: 0, coachMessages: 0 }]));
  const mealSources = Object.fromEntries(MEAL_SOURCES.map((source) => [source, 0])) as Record<MealSource, number>;
  for (const row of meals) {
    mealSources[row.source] += row.n;
    const day = daily.get(row.date);
    if (day) day.meals += row.n;
  }
  const totals = { cravings: 0, notes: 0, coachMessages: 0 };
  for (const row of others) {
    totals[row.kind] += row.n;
    const day = daily.get(row.date);
    if (day) day[row.kind] += row.n;
  }
  return { meals: Object.values(mealSources).reduce((a, b) => a + b, 0), mealSources, ...totals, daily: [...daily.values()] };
}

/** The copies kept in `backups/` before migrations (see `db/index.ts`). */
function backups(dataDir: string): AdminOverview['system']['backups'] {
  try {
    const dir = join(dataDir, 'backups');
    const times = readdirSync(dir)
      .filter((name) => name.endsWith('.db'))
      .map((name) => statSync(join(dir, name)).mtimeMs);
    return { count: times.length, lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null };
  } catch {
    return { count: 0, lastAt: null };
  }
}

/** The configured provider. */
function aiProvider(config: Config, ai: Ai): string | null {
  if (config.aiMock) return 'mock';
  if (!ai.enabled) return null;
  return config.anthropicApiKey ? 'anthropic' : null;
}

function systemSection(db: Db, ai: Ai, config: Config): AdminOverview['system'] {
  const { dbBytes } = db.get<{ dbBytes: number }>(sql`SELECT page_count * page_size AS dbBytes FROM pragma_page_count(), pragma_page_size()`)!;
  const photos = db.get<{ photos: number; photosBytes: number }>(sql`SELECT count(*) AS photos, coalesce(sum(size), 0) AS photosBytes FROM photos`)!;
  return {
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    dbBytes,
    ...photos,
    backups: backups(config.dataDir),
    ai: { enabled: ai.enabled, provider: aiProvider(config, ai), model: ai.model },
    signup: signupMode(config),
  };
}

/** The server as a whole over the last `days` days (UTC). Counts and totals only. */
export function adminOverview({ db, ai, config }: { db: Db; ai: Ai; config: Config }, days: AdminPeriod, now = new Date()): AdminOverview {
  const to = now.toISOString().slice(0, 10);
  const from = addDays(to, -(days - 1));
  const since = `${from}T00:00:00.000Z`;
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const people = peopleSection(db, now);
  return {
    generatedAt: now.toISOString(),
    days,
    from,
    to,
    ai: aiSection(db, config, since, dates),
    people,
    usage: usageSection(db, since, dates),
    system: systemSection(db, ai, config),
  };
}
