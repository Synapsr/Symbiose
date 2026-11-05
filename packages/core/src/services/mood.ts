import {
  addDays,
  computeTargets,
  dayMoods,
  mealTotals,
  moodLink,
  moodPersistentlyLow,
  SHORT_NIGHT_MIN,
  type DayMood,
  type GoalPlan,
  type MoodCheckIn,
  type MoodDay,
  type MoodInput,
  type MoodTrend,
  type Profile,
} from '@symbiose/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { cravings, journalEntries, meals, moods, type MoodRow } from '../db/schema';
import { toJournalEntry } from './journal';
import { nightsBetween } from './sleep';

export function toMood(row: MoodRow): MoodCheckIn {
  return { localDate: row.localDate, at: row.at, mood: row.mood, note: row.note, updatedAt: row.updatedAt };
}

/** One check-in per day: checking in again during the day replaces the mood, the note and the time. */
export function saveMood(db: Db, userId: string, input: Required<MoodInput>): MoodCheckIn {
  const values = { at: input.at, mood: input.mood, note: input.note || null, updatedAt: new Date().toISOString() };
  const row = db
    .insert(moods)
    .values({ userId, localDate: input.localDate, ...values })
    .onConflictDoUpdate({ target: [moods.userId, moods.localDate], set: values })
    .returning()
    .get();
  return toMood(row);
}

/** The check-ins themselves, one per day; newest first when listed for the history. */
export function checkInsBetween(db: Db, userId: string, from: string, to: string, order: 'oldest' | 'newest' = 'oldest'): MoodCheckIn[] {
  return db
    .select()
    .from(moods)
    .where(and(eq(moods.userId, userId), gte(moods.localDate, from), lte(moods.localDate, to)))
    .orderBy(order === 'oldest' ? asc(moods.localDate) : desc(moods.localDate))
    .all()
    .map(toMood);
}

/** The day's check-in, the one Today and « + » show and change. */
export function moodOf(db: Db, userId: string, date: string): MoodCheckIn | null {
  return checkInsBetween(db, userId, date, date)[0] ?? null;
}

/**
 * The one reader of mood (trends, « Les jours où… », the coach, the review):
 * a mood per day, the check-in, or on a day without one the latest face of
 * the older « Ressenti » notes. Oldest first.
 */
export function moodsBetween(db: Db, userId: string, from: string, to: string): DayMood[] {
  const notes = db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, userId), eq(journalEntries.kind, 'feeling'), gte(journalEntries.localDate, from), lte(journalEntries.localDate, to)))
    .all()
    .map(toJournalEntry);
  return dayMoods(checkInsBetween(db, userId, from, to), notes);
}

/** The older « Ressenti » notes read as a day's mood between two days: the journal brief leaves them to the mood, so the AI reads each once. */
export function moodNoteIds(db: Db, userId: string, from: string, to: string): Set<string> {
  return new Set(moodsBetween(db, userId, from, to).flatMap((m) => (m.noteId ? [m.noteId] : [])));
}

/**
 * What each check-in day had around it: a short night before it (only when
 * sleep is tracked), a craving, added sugar over the person's limit (only on
 * days with meals). Unknown stays null so it never counts as "without".
 */
function moodDays(db: Db, userId: string, profile: Profile, plan: GoalPlan | null, checkIns: DayMood[]): MoodDay[] {
  if (!checkIns.length) return [];
  const from = checkIns[0]!.localDate;
  const to = checkIns.at(-1)!.localDate;
  const nights = profile.trackSleep ? new Map(nightsBetween(db, userId, from, to).map((n) => [n.localDate, n.asleepMin])) : null;
  const cravingDays = new Set(
    db
      .select({ localDate: cravings.localDate })
      .from(cravings)
      .where(and(eq(cravings.userId, userId), gte(cravings.localDate, from), lte(cravings.localDate, to)))
      .all()
      .map((r) => r.localDate),
  );
  const sugar = new Map<string, number>();
  const mealRows = db
    .select({ localDate: meals.localDate, items: meals.items })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, from), lte(meals.localDate, to)))
    .all();
  for (const meal of mealRows) sugar.set(meal.localDate, (sugar.get(meal.localDate) ?? 0) + mealTotals(meal.items).addedSugar);
  const limit = computeTargets(profile, plan).targets.addedSugar.value;

  return checkIns.map((c) => {
    const asleep = nights?.get(c.localDate);
    const added = sugar.get(c.localDate);
    return {
      mood: c.mood,
      shortSleep: asleep === undefined ? null : asleep < SHORT_NIGHT_MIN,
      craving: cravingDays.has(c.localDate),
      sugarOver: added === undefined ? null : added > limit,
    };
  });
}

/** Moods over the window, with « Les jours où… » once there is enough data, and whether very low moods persist. */
export function moodTrend(db: Db, userId: string, profile: Profile, plan: GoalPlan | null, to: string, windowDays: number): MoodTrend {
  const dayList = moodsBetween(db, userId, addDays(to, -(windowDays - 1)), to);
  const days = dayList.map((m) => ({ date: m.localDate, mood: m.mood, ...(m.note ? { note: m.note } : {}) }));
  const last = dayList.at(-1);
  return {
    days,
    average: days.length ? Math.round((days.reduce((sum, d) => sum + d.mood, 0) / days.length) * 10) / 10 : null,
    latest: last ? { localDate: last.localDate, at: last.at, mood: last.mood, note: last.note, updatedAt: last.updatedAt } : null,
    link: moodLink(moodDays(db, userId, profile, plan, dayList)),
    persistentLow: moodPersistentlyLow(days, to),
    windowDays,
  };
}

/**
 * The trend for insights and the AI: there when the Humeur module is on, and
 * whenever a mood was logged (a face in « + » is a mood, switch or not).
 */
export function visibleMoodTrend(db: Db, userId: string, profile: Profile, plan: GoalPlan | null, to: string, windowDays: number): MoodTrend | null {
  const trend = moodTrend(db, userId, profile, plan, to, windowDays);
  return profile.trackMood || trend.days.length ? trend : null;
}
