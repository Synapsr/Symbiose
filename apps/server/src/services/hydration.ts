import { randomUUID } from 'node:crypto';

import { dateRange, hydrationGoalMl, type DayHydration, type HydrationTrend, type Sex, type WaterEntry, type WaterSource } from '@symbiose/shared';
import { and, eq, gte, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { waterLogs, type WaterLogRow } from '../db/schema';
import { workoutsBetween, workoutsKcal } from './workouts';

export type WaterFields = Omit<WaterEntry, 'id' | 'source' | 'createdAt'>;

export function toWaterEntry(row: WaterLogRow): WaterEntry {
  return { id: row.id, externalId: row.externalId, at: row.at, localDate: row.localDate, ml: row.ml, source: row.source, createdAt: row.createdAt };
}

/** Inserts drinks; one already imported (same health-store id) is updated instead. */
export function addWater(db: Db, userId: string, entries: WaterFields[], source: WaterSource): WaterEntry[] {
  const createdAt = new Date().toISOString();
  return db.transaction((tx) =>
    entries.map((entry) => {
      const fields = { ...entry, ml: Math.round(entry.ml), source };
      const values = { id: randomUUID(), userId, ...fields, createdAt };
      const row = fields.externalId
        ? tx.insert(waterLogs).values(values).onConflictDoUpdate({ target: [waterLogs.userId, waterLogs.externalId], set: fields }).returning().get()
        : tx.insert(waterLogs).values(values).returning().get();
      return toWaterEntry(row);
    }),
  );
}

/** Drinks between two days, in the order they were drunk. */
export function waterBetween(db: Db, userId: string, from: string, to: string): WaterEntry[] {
  return db
    .select()
    .from(waterLogs)
    .where(and(eq(waterLogs.userId, userId), gte(waterLogs.localDate, from), lte(waterLogs.localDate, to)))
    .all()
    .map(toWaterEntry)
    // Timestamps may mix offsets: compare instants, not strings.
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The day's drinks against its goal, which grows a little with the day's workouts. */
export function dayHydration(db: Db, userId: string, sex: Sex, date: string): DayHydration {
  const entries = waterBetween(db, userId, date, date);
  return {
    totalMl: entries.reduce((sum, e) => sum + e.ml, 0),
    goalMl: hydrationGoalMl(sex, workoutsKcal(workoutsBetween(db, userId, date, date))),
    entries,
  };
}

export function hydrationTrend(db: Db, userId: string, sex: Sex, from: string, to: string): HydrationTrend {
  const totals = new Map<string, number>();
  for (const entry of waterBetween(db, userId, from, to)) totals.set(entry.localDate, (totals.get(entry.localDate) ?? 0) + entry.ml);
  const kcal = new Map<string, number>();
  for (const workout of workoutsBetween(db, userId, from, to)) kcal.set(workout.localDate, (kcal.get(workout.localDate) ?? 0) + (workout.activeKcal ?? 0));

  const days = dateRange(from, to).map((date) => ({ date, ml: totals.get(date) ?? 0, goalMl: hydrationGoalMl(sex, kcal.get(date) ?? 0) }));
  const logged = days.filter((d) => d.ml > 0);
  return {
    days,
    averageMl: logged.length ? Math.round(logged.reduce((sum, d) => sum + d.ml, 0) / logged.length / 10) * 10 : null,
    daysLogged: logged.length,
    daysReached: days.filter((d) => d.ml >= d.goalMl).length,
    windowDays: days.length,
  };
}
