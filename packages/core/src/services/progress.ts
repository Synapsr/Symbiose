import { progressSummary, streakSummary, type ProgressSummary } from '@symbiose/shared';
import { and, desc, eq, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { cravings, meals } from '../db/schema';

/** How far back the streak looks: almost three years of days with a meal. */
const MAX_DAYS = 1000;

/** The local days with at least one meal, up to `date`, the most recent first. */
export function loggedDays(db: Db, userId: string, date: string): string[] {
  return db
    .selectDistinct({ day: meals.localDate })
    .from(meals)
    .where(and(eq(meals.userId, userId), lte(meals.localDate, date)))
    .orderBy(desc(meals.localDate))
    .limit(MAX_DAYS)
    .all()
    .map((r) => r.day);
}

/** The streak ending at `date` (a rest day holds it, today doesn't break it yet). */
export function streakFor(db: Db, userId: string, date: string): number {
  return streakSummary(loggedDays(db, userId, date), date).current;
}

/** « Ta progression »: the streak, its rest days, the milestones reached and the next ones. */
export function progressFor(db: Db, userId: string, today: string): ProgressSummary {
  const rows = db
    .select({ localDate: cravings.localDate, outcome: cravings.outcome })
    .from(cravings)
    .where(and(eq(cravings.userId, userId), lte(cravings.localDate, today)))
    .all();
  return progressSummary({
    loggedDays: loggedDays(db, userId, today),
    resisted: rows.filter((r) => r.outcome === 'resisted').map((r) => r.localDate),
    cravingsLogged: rows.length > 0,
    today,
  });
}
