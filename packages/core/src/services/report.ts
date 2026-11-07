import {
  activityGoalsFor,
  addDays,
  ageFromBirthYear,
  computeTargets,
  dateRange,
  daySteps,
  daysBetween,
  itemNutrients,
  localTime,
  REPORT_WEIGHT_LEAD_DAYS,
  roundNutrients,
  sumNutrients,
  transitSummary,
  type ReportData,
  type ReportDay,
  type ReportMeal,
  type Workout,
} from '@symbiose/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { activity, cravings, meals, weights } from '../db/schema';
import { readingsBetween } from './blood-pressure';
import { adaptiveEnergyHistory } from './expenditure';
import { hydrationTrend } from './hydration';
import { firstTransitDate, journalBetween } from './journal';
import { toMeal } from './meals';
import { moodNoteIds, visibleMoodTrend } from './mood';
import { sleepTrend } from './sleep';
import { requireProfile, resolveUser } from './users';
import { activeMinutes, workoutsBetween, workoutsKcal } from './workouts';

/**
 * Everything the PDF report draws for a period, in one answer: each day with
 * its own targets, the meals and their foods, the weigh-ins (with a run-up
 * for the trend), and the modules the person turned on. The phone lays it out.
 */
export function reportFor(db: Db, userId: string, from: string, to: string): ReportData {
  const resolved = resolveUser(db, userId, to);
  requireProfile(resolved);
  const profile = resolved.row.profile!;
  const plan = resolved.row.plan ?? null;
  const adaptive = adaptiveEnergyHistory(db, userId, profile, plan, from, to);

  const rangeMeals = db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, from), lte(meals.localDate, to)))
    .orderBy(asc(meals.eatenAt))
    .all()
    .map(toMeal)
    // Timestamps may mix offsets: within a day, compare instants.
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || Date.parse(a.eatenAt) - Date.parse(b.eatenAt));
  const activityRows = new Map(
    db
      .select()
      .from(activity)
      .where(and(eq(activity.userId, userId), gte(activity.localDate, from), lte(activity.localDate, to)))
      .all()
      .map((row) => [row.localDate, row]),
  );
  const workouts = workoutsBetween(db, userId, from, to);
  const workoutsByDay = new Map<string, Workout[]>();
  for (const workout of workouts) workoutsByDay.set(workout.localDate, [...(workoutsByDay.get(workout.localDate) ?? []), workout]);
  const mealsByDay = new Map<string, typeof rangeMeals>();
  for (const meal of rangeMeals) mealsByDay.set(meal.localDate, [...(mealsByDay.get(meal.localDate) ?? []), meal]);

  const days: ReportDay[] = dateRange(from, to).map((date) => {
    const dayMeals = mealsByDay.get(date) ?? [];
    const activeKcal = activityRows.get(date)?.activeKcal ?? workoutsKcal(workoutsByDay.get(date) ?? []);
    const { targets } = computeTargets(profile, plan, { activeKcal, adaptiveKcal: adaptive.shiftOn(date) });
    return { date, logged: dayMeals.length > 0, meals: dayMeals.length, totals: roundNutrients(sumNutrients(dayMeals.map((m) => m.totals))), targets };
  });

  const reportMeals: ReportMeal[] = rangeMeals.map((meal) => ({
    localDate: meal.localDate,
    time: localTime(meal.eatenAt),
    mealType: meal.mealType,
    title: meal.title,
    items: meal.items.map((item) => ({ name: item.name, grams: Math.round(item.grams), nutrients: roundNutrients(itemNutrients(item)) })),
    totals: meal.totals,
  }));

  const notes = journalBetween(db, userId, { from, to, limit: 2000 });
  const readAsMood = moodNoteIds(db, userId, from, to);
  const periodDays = daysBetween(from, to) + 1;

  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    person: {
      name: profile.name,
      sex: profile.sex,
      age: ageFromBirthYear(profile.birthYear, new Date(`${to}T12:00:00`)),
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      activityLevel: profile.activityLevel,
    },
    plan,
    targets: resolved.targets,
    days,
    meals: reportMeals,
    weights: db
      .select({ date: weights.localDate, kg: weights.kg })
      .from(weights)
      .where(and(eq(weights.userId, userId), gte(weights.localDate, addDays(from, -REPORT_WEIGHT_LEAD_DAYS)), lte(weights.localDate, to)))
      .orderBy(asc(weights.localDate))
      .all(),
    bloodPressure: profile.trackBloodPressure ? readingsBetween(db, userId, from, to) : null,
    activity: {
      goals: activityGoalsFor(plan),
      days: dateRange(from, to).map((date) => {
        const dayWorkouts = workoutsByDay.get(date) ?? [];
        return { date, activeMinutes: activeMinutes(dayWorkouts), steps: daySteps(activityRows.get(date)?.steps, dayWorkouts) };
      }),
    },
    workouts,
    sleep: profile.trackSleep ? sleepTrend(db, userId, from, to) : null,
    hydration: profile.trackHydration ? hydrationTrend(db, userId, profile, from, to) : null,
    mood: visibleMoodTrend(db, userId, profile, plan, to, periodDays),
    cravings: db
      .select()
      .from(cravings)
      .where(and(eq(cravings.userId, userId), gte(cravings.localDate, from), lte(cravings.localDate, to)))
      .all()
      .sort((a, b) => a.localDate.localeCompare(b.localDate) || Date.parse(a.at) - Date.parse(b.at))
      .map((c) => ({ localDate: c.localDate, time: localTime(c.at), what: c.what, intensity: c.intensity, outcome: c.outcome })),
    journal: notes.filter((entry) => !readAsMood.has(entry.id)).reverse(),
    transit: transitSummary(notes, to, periodDays, firstTransitDate(db, userId)),
  };
}
