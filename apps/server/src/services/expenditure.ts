import {
  ADAPTIVE_STEP_KCAL,
  adaptiveCheckpoints,
  adaptiveShift,
  addDays,
  bmrMifflin,
  computeEnergy,
  estimateExpenditure,
  EXPENDITURE_WINDOW_DAYS,
  isTrusted,
  mealTotals,
  type AdaptiveEnergy,
  type ExpenditureEstimate,
  type GoalPlan,
  type Profile,
  type Workout,
} from '@symbiose/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { EnergyExpenditureBrief } from '../ai/types';
import type { Db } from '../db';
import { activity, meals, weights } from '../db/schema';
import { workoutsBetween, workoutsKcal } from './workouts';

export interface AdaptiveEnergyHistory {
  /** The shift added to the formula's maintenance on `date` (0 unless opted in and trusted). */
  shiftOn(date: string): number;
  /** The measure as of `date` (data up to the day before), with the opt-in. */
  asOf(date: string): AdaptiveEnergy;
}

/**
 * Everything adaptive energy reads for dates in [from, to], loaded once:
 * logged kcal per day, weigh-ins and active energy, from the first weekly
 * check-in's window on.
 */
export function adaptiveEnergyHistory(db: Db, userId: string, profile: Profile, plan: GoalPlan | null, from: string, to: string): AdaptiveEnergyHistory {
  const since = plan?.adaptiveEnergy?.since ?? null;
  const firstCheckpoint = since && to >= since ? adaptiveCheckpoints(from > since ? from : since, since)[0] : undefined;
  const start = addDays(firstCheckpoint && firstCheckpoint < from ? firstCheckpoint : from, -EXPENDITURE_WINDOW_DAYS);
  const end = addDays(to, -1);

  const intake = new Map<string, number>();
  const mealRows = db
    .select({ date: meals.localDate, items: meals.items })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, start), lte(meals.localDate, end)))
    .all();
  for (const row of mealRows) intake.set(row.date, (intake.get(row.date) ?? 0) + mealTotals(row.items).kcal);
  const points = db
    .select({ date: weights.localDate, kg: weights.kg })
    .from(weights)
    .where(and(eq(weights.userId, userId), gte(weights.localDate, start), lte(weights.localDate, end)))
    .orderBy(asc(weights.localDate))
    .all();
  // Active energy as the daily budget sees it: the watch's total, else the logged workouts.
  const watch = new Map(
    db
      .select({ date: activity.localDate, kcal: activity.activeKcal })
      .from(activity)
      .where(and(eq(activity.userId, userId), gte(activity.localDate, start), lte(activity.localDate, end)))
      .all()
      .map((row) => [row.date, row.kcal]),
  );
  const sessions = new Map<string, Workout[]>();
  for (const workout of workoutsBetween(db, userId, start, end)) sessions.set(workout.localDate, [...(sessions.get(workout.localDate) ?? []), workout]);

  const bmr = bmrMifflin(profile);
  const estimates = new Map<string, ExpenditureEstimate>();
  const estimate = (date: string) => {
    let result = estimates.get(date);
    if (!result) {
      result = estimateExpenditure({
        end: addDays(date, -1),
        intake,
        weights: points,
        // The formula alone: no adaptive shift.
        formulaFor: (day) => computeEnergy(profile, plan, { activeKcal: watch.get(day) ?? workoutsKcal(sessions.get(day) ?? []) }).tdee,
        bmr,
      });
      estimates.set(date, result);
    }
    return result;
  };

  const shiftOn = (date: string) => {
    if (!since) return 0;
    return adaptiveShift(
      adaptiveCheckpoints(date, since).map((checkpoint) => {
        const measure = estimate(checkpoint);
        return isTrusted(measure) ? measure.estimate! - measure.formula : null;
      }),
    );
  };

  return {
    shiftOn,
    asOf: (date) => ({ ...estimate(date), enabled: Boolean(since), appliedKcal: shiftOn(date), stepKcal: ADAPTIVE_STEP_KCAL }),
  };
}

/** The shift for a single day, for a person who opted in. */
export function adaptiveShiftOn(db: Db, userId: string, profile: Profile, plan: GoalPlan | null, date: string): number {
  if (!plan?.adaptiveEnergy) return 0;
  return adaptiveEnergyHistory(db, userId, profile, plan, date, date).shiftOn(date);
}

/** What the AI is told: present once there is an estimate, or when the person opted in. */
export function energyExpenditureBrief(adaptive: AdaptiveEnergy | undefined): EnergyExpenditureBrief | null {
  if (!adaptive || (adaptive.estimate === null && !adaptive.enabled)) return null;
  return {
    estimateKcal: adaptive.estimate,
    formulaKcal: adaptive.formula,
    confidence: adaptive.confidence,
    windowDays: adaptive.window.days,
    completeDays: adaptive.data.completeDays,
    weighIns: adaptive.data.weighIns,
    trendKgPerWeek: adaptive.data.trendKgPerWeek,
    autoAdjust: adaptive.enabled,
    appliedKcal: adaptive.appliedKcal,
    ...(adaptive.estimate === null ? { missing: adaptive.missing } : {}),
  };
}
