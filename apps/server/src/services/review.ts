import { createHash } from 'node:crypto';

import { addDays, goalNutrient, startOfWeek, type Review, type WeeklyReview, type WeeklyReviewState } from '@symbiose/shared';
import { and, eq, gt, gte, lte } from 'drizzle-orm';

import type { Ai } from '../ai/types';
import type { Db } from '../db';
import { aiCache, meals } from '../db/schema';
import { HttpError } from '../errors';
import { nowIso } from '../http';
import { bloodPressureBrief } from './blood-pressure';
import { computeInsights } from './day';
import { energyExpenditureBrief } from './expenditure';
import { journalBrief } from './journal';
import { resolveUser } from './users';

/** « Bilan de la semaine »: the 7 days ending today. */
export const REVIEW_DAYS = 7;
/** A review appears by itself once the week has this many days with meals; before that, only on demand. */
export const AUTO_REVIEW_MIN_DAYS = 3;

/** The saved weekly review of a person: one row in `ai_cache`, replaced by the next one. */
const savedKey = (userId: string) => `weekly-review:${userId}`;

interface Saved {
  review: WeeklyReview;
  /** Hash of what it was written from: when it changes, there is newer data. */
  inputsKey: string;
}

/** Everything a review is written from, and the hash that caches it. */
function reviewInputs(db: Db, ai: Ai, userId: string, to: string, days: number) {
  const insights = computeInsights(db, userId, addDays(to, -(days - 1)), to);
  const resolved = resolveUser(db, userId, to);
  const bloodPressure = bloodPressureBrief(db, userId, resolved.row.profile ?? null, to);
  const journal = journalBrief(db, userId, insights.from, to);
  const key = createHash('sha256')
    .update(JSON.stringify({ userId, insights, bloodPressure, journal, plan: resolved.row.plan, model: ai.model }))
    .digest('hex');
  return { insights, resolved, bloodPressure, journal, key };
}

/** Two opens at once (or a double tap) share one AI call. */
const inFlight = new Map<string, Promise<Review>>();

/**
 * Writes the review of the `days` ending on `to`, reusing the cached one when nothing changed. The
 * 7-day review is saved as the person's weekly review, so it survives navigation and range changes.
 */
export async function generateReview(db: Db, ai: Ai, userId: string, to: string, days = REVIEW_DAYS): Promise<WeeklyReview> {
  const inputs = reviewInputs(db, ai, userId, to, days);
  const { insights, resolved, bloodPressure, journal, key } = inputs;
  if (insights.loggedDays === 0) throw new HttpError(409, 'not_enough_data', 'Log a few meals first');

  const cached = db.select().from(aiCache).where(eq(aiCache.key, key)).get();
  let review: Review;
  if (cached) {
    review = cached.value as Review;
  } else {
    let pending = inFlight.get(key);
    if (!pending) {
      pending = ai.review({ ...resolved.context, insights, bloodPressure, energyExpenditure: energyExpenditureBrief(insights.adaptiveEnergy), journal });
      inFlight.set(key, pending);
      void pending.then(
        () => inFlight.delete(key),
        () => inFlight.delete(key),
      );
    }
    review = await pending;
    db.insert(aiCache).values({ key, userId, value: review, createdAt: nowIso() }).onConflictDoNothing().run();
  }

  const weekly: WeeklyReview = {
    headline: review.headline,
    wins: review.wins,
    patterns: review.patterns,
    nextSteps: review.nextSteps,
    from: insights.from,
    to,
    generatedAt: nowIso(),
  };
  if (days === REVIEW_DAYS) {
    const value: Saved = { review: weekly, inputsKey: key };
    db.insert(aiCache)
      .values({ key: savedKey(userId), userId, value, createdAt: weekly.generatedAt })
      .onConflictDoUpdate({ target: aiCache.key, set: { value, createdAt: weekly.generatedAt } })
      .run();
  }
  return weekly;
}

export function savedReview(db: Db, userId: string): Saved | null {
  const row = db.select().from(aiCache).where(eq(aiCache.key, savedKey(userId))).get();
  return row ? (row.value as Saved) : null;
}

/** Meals added or changed after a moment, within the days a review covers. */
function mealsChangedSince(db: Db, userId: string, since: string, from: string, to: string): boolean {
  return Boolean(
    db
      .select({ id: meals.id })
      .from(meals)
      .where(and(eq(meals.userId, userId), gt(meals.updatedAt, since), gte(meals.localDate, from), lte(meals.localDate, to)))
      .limit(1)
      .get(),
  );
}

/**
 * The saved weekly review and what to do with it on open. A review from this week or the last one
 * is shown; once a new week has new meals, it is due again (« prêt lundi »). Nothing is generated here.
 */
export function weeklyReviewState(db: Db, ai: Ai, userId: string, to: string, options: { hideCalories?: boolean } = {}): WeeklyReviewState {
  const { insights, resolved, key } = reviewInputs(db, ai, userId, to, REVIEW_DAYS);
  const saved = savedReview(db, userId);
  const thisWeek = startOfWeek(to);
  // Older than last week: it no longer says anything about now.
  const recent = saved && saved.review.to >= addDays(thisWeek, -7) && saved.review.to <= to ? saved : null;
  const enough = insights.loggedDays >= AUTO_REVIEW_MIN_DAYS;

  let status: WeeklyReviewState['status'];
  if (!recent) status = ai.enabled && enough ? 'due' : 'none';
  else if (recent.inputsKey === key) status = 'fresh';
  else if (ai.enabled && startOfWeek(recent.review.to) < thisWeek && insights.loggedDays > 0 && mealsChangedSince(db, userId, recent.review.generatedAt, insights.from, to)) status = 'due';
  else status = 'stale';

  const nutrient = goalNutrient(resolved.row.plan ?? null, options.hideCalories);
  const adherence = insights.adherence.find((a) => a.nutrient === nutrient);
  return {
    review: recent?.review ?? null,
    status,
    ai: ai.enabled,
    week: {
      from: insights.from,
      to,
      loggedDays: insights.loggedDays,
      nutrient,
      average: insights.averages[nutrient],
      adherence: adherence ? { kind: adherence.kind, target: adherence.target, daysOk: adherence.daysOk, daysLogged: adherence.daysLogged } : null,
    },
  };
}
