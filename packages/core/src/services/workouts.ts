import { activityGoalsFor, addDays, countsAsActive, dateRange, daySteps, type ActivityWeek, type GoalPlan, type Workout } from '@symbiose/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { ActivityToday, MealAnalysisInput } from '../ai/types';
import type { Db } from '../db';
import { activity, workouts, type WorkoutRow } from '../db/schema';
import { newId } from '../ids';

export type WorkoutFields = Omit<Workout, 'id' | 'createdAt'>;

const RECOVERY_WINDOW_MS = 3 * 3600_000;

export function toWorkout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    externalId: row.externalId,
    type: row.type,
    startedAt: row.startedAt,
    localDate: row.localDate,
    durationMin: row.durationMin,
    intensity: row.intensity,
    activeKcal: row.activeKcal,
    distanceKm: row.distanceKm,
    avgHeartRate: row.avgHeartRate,
    steps: row.steps,
    source: row.source,
    createdAt: row.createdAt,
  };
}

/** Inserts workouts; one already imported (same health-store id) is updated instead. */
export function upsertWorkouts(db: Db, userId: string, list: WorkoutFields[]): Workout[] {
  const createdAt = new Date().toISOString();
  return db.transaction((tx) =>
    list.map((fields) => {
      const values = { id: newId(), userId, ...fields, createdAt };
      const row = fields.externalId
        ? tx.insert(workouts).values(values).onConflictDoUpdate({ target: [workouts.userId, workouts.externalId], set: fields }).returning().get()
        : tx.insert(workouts).values(values).returning().get();
      return toWorkout(row);
    }),
  );
}

export function workoutsBetween(db: Db, userId: string, from: string, to: string): Workout[] {
  return db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, userId), gte(workouts.localDate, from), lte(workouts.localDate, to)))
    .orderBy(asc(workouts.startedAt))
    .all()
    .map(toWorkout);
}

export function activeMinutes(list: Pick<Workout, 'type' | 'intensity' | 'durationMin'>[]): number {
  return Math.round(list.filter(countsAsActive).reduce((sum, w) => sum + w.durationMin, 0));
}

/**
 * Energy of the logged workouts, for days without the watch's daily total.
 * Never add it to that total: the watch already counts its workouts.
 */
export function workoutsKcal(list: Pick<Workout, 'activeKcal'>[]): number | null {
  const known = list.flatMap((w) => (w.activeKcal === null ? [] : [w.activeKcal]));
  return known.length ? Math.round(known.reduce((sum, kcal) => sum + kcal, 0)) : null;
}

/** Rolling 7 days ending on `date`. */
export function activityWeek(db: Db, userId: string, date: string, plan: GoalPlan | null): ActivityWeek {
  const from = addDays(date, -6);
  const list = workoutsBetween(db, userId, from, date);
  const stored = new Map(
    db
      .select({ localDate: activity.localDate, steps: activity.steps })
      .from(activity)
      .where(and(eq(activity.userId, userId), gte(activity.localDate, from), lte(activity.localDate, date)))
      .all()
      .map((row) => [row.localDate, row.steps]),
  );
  const steps = dateRange(from, date).flatMap((day) => {
    const count = daySteps(stored.get(day), list.filter((w) => w.localDate === day));
    return count === null ? [] : [count];
  });
  return {
    activeMinutes: activeMinutes(list),
    strengthSessions: list.filter((w) => w.type === 'strength').length,
    workouts: list.length,
    avgSteps: steps.length ? Math.round(steps.reduce((sum, n) => sum + n, 0) / steps.length) : null,
    goals: activityGoalsFor(plan),
  };
}

/** A day's movement as the AI sees it; null when nothing was tracked. */
export function activityToday(db: Db, userId: string, date: string): ActivityToday | null {
  const row = db
    .select()
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.localDate, date)))
    .get();
  const list = workoutsBetween(db, userId, date, date);
  if (!row && !list.length) return null;
  const watchKcal = row?.activeKcal ?? null;
  return {
    steps: daySteps(row?.steps, list),
    activeKcal: watchKcal === null ? workoutsKcal(list) : Math.round(watchKcal),
    workouts: list.length,
  };
}

/** Activity context for a meal: the session that ended in the 3 hours before it, and the day so far. */
export function mealActivity(db: Db, userId: string, localDate: string, eatenAt: string): Pick<MealAnalysisInput, 'recentWorkout' | 'activityToday'> {
  const eaten = Date.parse(eatenAt);
  let recent: { workout: Workout; end: number } | null = null;
  // Yesterday too: a late-evening session can precede a meal after midnight.
  for (const workout of workoutsBetween(db, userId, addDays(localDate, -1), localDate)) {
    const end = Date.parse(workout.startedAt) + workout.durationMin * 60_000;
    if (end > eaten || eaten - end > RECOVERY_WINDOW_MS) continue;
    if (!recent || end > recent.end) recent = { workout, end };
  }
  return {
    recentWorkout: recent
      ? {
          type: recent.workout.type,
          durationMin: Math.round(recent.workout.durationMin),
          activeKcal: recent.workout.activeKcal === null ? null : Math.round(recent.workout.activeKcal),
          endedMinutesAgo: Math.round((eaten - recent.end) / 60_000),
        }
      : null,
    activityToday: activityToday(db, userId, localDate),
  };
}
