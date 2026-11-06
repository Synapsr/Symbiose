import {
  activityGoalsFor,
  addDays,
  computeProgress,
  computeTargets,
  courseItems,
  dateRange,
  daySteps,
  focusNutrients,
  foodKey,
  goalNutrient,
  itemNutrients,
  localHour,
  mealCourses,
  mealTotals,
  NUTRIENT_KEYS,
  roundNutrients,
  sumNutrients,
  type Craving,
  type DayActivity,
  type DaySummary,
  type InsightsDay,
  type InsightsResponse,
  type LibraryResponse,
  type NutrientKey,
  type NutrientSource,
  type FoodSuggestion,
  type InsightsActivity,
  type Workout,
  type WorkoutType,
} from '@symbiose/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { activity, cravings, meals, type ActivityRow, type CravingRow } from '../db/schema';
import { stripItem, toMeal } from './meals';
import { requireProfile, resolveUser } from './users';
import { visibleTrend } from './blood-pressure';
import { adaptiveEnergyHistory } from './expenditure';
import { dayHydration, hydrationTrend } from './hydration';
import { moodOf, visibleMoodTrend } from './mood';
import { nightOf, sleepTrend } from './sleep';
import { weightTrend } from './weights';
import { activeMinutes, activityWeek, workoutsBetween, workoutsKcal } from './workouts';

export function toActivity(row: ActivityRow): DayActivity {
  return {
    localDate: row.localDate,
    steps: row.steps,
    activeKcal: row.activeKcal,
    restingKcal: row.restingKcal,
    weightKg: row.weightKg,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

/**
 * A day's activity with its steps as `daySteps` counts them, so a walk added by
 * hand shows on a day the health store missed it. Without a row from the
 * store, those steps come alone (source « manual », the rest unknown).
 */
function dayActivity(row: ActivityRow | undefined, date: string, workouts: Workout[]): DayActivity | null {
  const steps = daySteps(row?.steps, workouts);
  if (row) return { ...toActivity(row), steps };
  if (steps === null) return null;
  const updatedAt = workouts.map((w) => w.createdAt).sort().at(-1)!;
  return { localDate: date, steps, activeKcal: null, restingKcal: null, weightKg: null, source: 'manual', updatedAt };
}

export function toCraving(row: CravingRow): Craving {
  return {
    id: row.id,
    at: row.at,
    localDate: row.localDate,
    what: row.what,
    intensity: row.intensity,
    outcome: row.outcome,
    tip: row.tip,
    createdAt: row.createdAt,
  };
}

/** Consecutive days with at least one logged meal, ending at `date` (today doesn't break it yet). */
export function streakFor(db: Db, userId: string, date: string): number {
  const rows = db
    .selectDistinct({ day: meals.localDate })
    .from(meals)
    .where(and(eq(meals.userId, userId), lte(meals.localDate, date)))
    .orderBy(desc(meals.localDate))
    .limit(1000)
    .all();
  const days = new Set(rows.map((r) => r.day));
  let cursor = days.has(date) ? date : addDays(date, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function daySummary(db: Db, userId: string, date: string): DaySummary {
  const resolved = resolveUser(db, userId, date);
  requireProfile(resolved);

  const dayMeals = db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.localDate, date)))
    .orderBy(asc(meals.eatenAt))
    .all()
    .map(toMeal);
  const totals = roundNutrients(sumNutrients(dayMeals.map((m) => m.totals)));

  const focus = focusNutrients(resolved.row.plan ?? null);
  const order: NutrientKey[] = ['kcal', ...focus, ...NUTRIENT_KEYS.filter((k) => k !== 'kcal' && !focus.includes(k))];

  const activityRow = db
    .select()
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.localDate, date)))
    .get();
  const dayCravings = db
    .select()
    .from(cravings)
    .where(and(eq(cravings.userId, userId), eq(cravings.localDate, date)))
    .orderBy(asc(cravings.at))
    .all()
    .map(toCraving);

  const dayWorkouts = workoutsBetween(db, userId, date, date);
  const profile = resolved.row.profile!;
  return {
    date,
    targets: resolved.targets,
    energy: resolved.energy,
    totals,
    progress: computeProgress(totals, resolved.targets, order),
    meals: dayMeals,
    activity: dayActivity(activityRow, date, dayWorkouts),
    workouts: dayWorkouts,
    activityWeek: activityWeek(db, userId, date, resolved.row.plan ?? null),
    cravings: {
      total: dayCravings.length,
      resisted: dayCravings.filter((c) => c.outcome === 'resisted').length,
      items: dayCravings,
    },
    streak: streakFor(db, userId, date),
    sleep: profile.trackSleep ? nightOf(db, userId, date) : null,
    hydration: profile.trackHydration ? dayHydration(db, userId, profile, date) : null,
    // The day's check-in whatever the switch: « + » shows it, and Today lists it when the pill is off.
    mood: moodOf(db, userId, date),
  };
}

export function computeInsights(db: Db, userId: string, from: string, to: string, options: { hideCalories?: boolean } = {}): InsightsResponse {
  const resolved = resolveUser(db, userId, to);
  requireProfile(resolved);
  const profile = resolved.row.profile!;
  const plan = resolved.row.plan ?? null;
  const focus = focusNutrients(plan);
  // The goal's headline nutrient, calories included when the plan puts them first.
  const hero = goalNutrient(plan, options.hideCalories);

  const rangeMeals = db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, from), lte(meals.localDate, to)))
    .orderBy(asc(meals.eatenAt))
    .all()
    .map(toMeal);
  const activityRows = db
    .select()
    .from(activity)
    .where(and(eq(activity.userId, userId), gte(activity.localDate, from), lte(activity.localDate, to)))
    .all();
  const rangeCravings = db
    .select()
    .from(cravings)
    .where(and(eq(cravings.userId, userId), gte(cravings.localDate, from), lte(cravings.localDate, to)))
    .all();
  const rangeWorkouts = workoutsBetween(db, userId, from, to);
  const adaptive = adaptiveEnergyHistory(db, userId, profile, plan, from, to);

  const activityByDay = new Map(activityRows.map((row) => [row.localDate, row]));
  const workoutsByDay = new Map<string, Workout[]>();
  for (const workout of rangeWorkouts) workoutsByDay.set(workout.localDate, [...(workoutsByDay.get(workout.localDate) ?? []), workout]);
  // Weight and blood pressure are shown over at least 30 days: a week is too short to see a trend.
  const trendDays = Math.max(dateRange(from, to).length, 30);
  const weight = weightTrend(db, userId, to, trendDays);
  const weightByDay = new Map(weight.points.map((p) => [p.date, p.kg]));
  const mealsByDay = new Map<string, typeof rangeMeals>();
  for (const meal of rangeMeals) mealsByDay.set(meal.localDate, [...(mealsByDay.get(meal.localDate) ?? []), meal]);

  const watched = new Set<NutrientKey>(focus);
  for (const rule of plan?.rules ?? []) watched.add(rule.nutrient);
  watched.delete('kcal');
  watched.add(hero);

  const days: InsightsDay[] = [];
  const activityDays: InsightsActivity['days'] = [];
  const adherence = new Map<NutrientKey, { kind: 'target' | 'min' | 'max'; target: number; ok: number; logged: number }>();

  for (const date of dateRange(from, to)) {
    const dayMeals = mealsByDay.get(date) ?? [];
    const act = activityByDay.get(date);
    const dayWorkouts = workoutsByDay.get(date) ?? [];
    const activeKcal = act?.activeKcal ?? workoutsKcal(dayWorkouts);
    const { targets } = computeTargets(profile, plan, { activeKcal, adaptiveKcal: adaptive.shiftOn(date) });
    const totals = roundNutrients(sumNutrients(dayMeals.map((m) => m.totals)));
    const logged = dayMeals.length > 0;
    days.push({
      date,
      logged,
      totals,
      kcalTarget: targets.kcal.value,
      activeKcal,
      weightKg: weightByDay.get(date) ?? null,
    });
    activityDays.push({ date, activeMinutes: activeMinutes(dayWorkouts), steps: daySteps(act?.steps, dayWorkouts), workouts: dayWorkouts.length });
    if (!logged) continue;
    for (const key of watched) {
      const target = targets[key];
      const entry = adherence.get(key) ?? { kind: target.kind, target: target.value, ok: 0, logged: 0 };
      entry.logged++;
      const ok = target.kind === 'max' ? totals[key] <= target.value : target.kind === 'min' ? totals[key] >= target.value : Math.abs(totals[key] - target.value) <= target.value * 0.1;
      if (ok) entry.ok++;
      adherence.set(key, entry);
    }
  }

  const loggedDays = days.filter((d) => d.logged);
  const averages = roundNutrients(sumNutrients(loggedDays.map((d) => d.totals)));
  if (loggedDays.length) for (const key of NUTRIENT_KEYS) averages[key] = Math.round((averages[key] / loggedDays.length) * 10) / 10;

  // Which foods bring the nutrients the person cares about.
  const topSources: Partial<Record<NutrientKey, NutrientSource[]>> = {};
  for (const key of watched) {
    const groups = new Map<string, NutrientSource>();
    for (const meal of rangeMeals) {
      for (const item of meal.items) {
        const amount = itemNutrients(item)[key];
        if (amount <= 0) continue;
        const k = foodKey(item.name);
        const entry = groups.get(k) ?? { name: item.name, emoji: item.emoji, amount: 0, count: 0 };
        entry.amount += amount;
        entry.count++;
        groups.set(k, entry);
      }
    }
    topSources[key] = [...groups.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((s) => ({ ...s, amount: Math.round(s.amount * 10) / 10 }));
  }

  // When during the day the headline nutrient is eaten.
  const primary = hero;
  const hours = Array.from({ length: 24 }, () => 0);
  // Each course at its own hour: dessert at 21:00 counts at 21:00, not when dinner started.
  for (const meal of rangeMeals) {
    for (const course of mealCourses(meal)) hours[localHour(course.eatenAt)]! += mealTotals(courseItems(meal, course.id))[primary];
  }

  const whatCounts = new Map<string, { label: string; count: number }>();
  for (const c of rangeCravings) {
    if (!c.what) continue;
    const k = foodKey(c.what);
    const entry = whatCounts.get(k) ?? { label: c.what, count: 0 };
    entry.count++;
    whatCounts.set(k, entry);
  }

  const byType = new Map<WorkoutType, InsightsActivity['byType'][number]>();
  for (const workout of rangeWorkouts) {
    const entry = byType.get(workout.type) ?? { type: workout.type, sessions: 0, minutes: 0 };
    entry.sessions++;
    entry.minutes += workout.durationMin;
    byType.set(workout.type, entry);
  }
  // Sum of the rounded daily minutes, so it matches the daily chart.
  const totalMinutes = activityDays.reduce((sum, d) => sum + d.activeMinutes, 0);

  const cravingsByDay = new Map<string, number>();
  for (const c of rangeCravings) cravingsByDay.set(c.localDate, (cravingsByDay.get(c.localDate) ?? 0) + 1);
  const cravingsPerDay = (list: InsightsDay[]) => Math.round((list.reduce((sum, d) => sum + (cravingsByDay.get(d.date) ?? 0), 0) / list.length) * 10) / 10;
  const activeDays = loggedDays.filter((d) => workoutsByDay.has(d.date));
  const restDays = loggedDays.filter((d) => !workoutsByDay.has(d.date));

  return {
    from,
    to,
    days,
    loggedDays: loggedDays.length,
    averages,
    focus,
    hero,
    adherence: [...adherence.entries()].map(([nutrient, a]) => ({
      nutrient,
      kind: a.kind,
      target: a.target,
      daysOk: a.ok,
      daysLogged: a.logged,
    })),
    topSources,
    byHour: { nutrient: primary, hours: hours.map((h) => Math.round(h * 10) / 10) },
    cravings: {
      total: rangeCravings.length,
      resisted: rangeCravings.filter((c) => c.outcome === 'resisted').length,
      topWhat: [...whatCounts.values()].sort((a, b) => b.count - a.count).slice(0, 3).map((w) => w.label),
    },
    weight,
    activity: {
      goals: activityGoalsFor(plan),
      days: activityDays,
      byType: [...byType.values()].map((t) => ({ ...t, minutes: Math.round(t.minutes) })).sort((a, b) => b.minutes - a.minutes),
      totalMinutes,
      weeklyMinutes: Math.round((totalMinutes / days.length) * 7),
      cravingsOnActiveDays: activeDays.length >= 2 && restDays.length >= 2 ? { active: cravingsPerDay(activeDays), inactive: cravingsPerDay(restDays) } : null,
    },
    bloodPressure: visibleTrend(db, userId, profile, to, trendDays),
    adaptiveEnergy: adaptive.asOf(to),
    // Sleep and hydration follow the window; mood needs 30 days to say anything.
    sleep: profile.trackSleep ? sleepTrend(db, userId, from, to) : null,
    hydration: profile.trackHydration ? hydrationTrend(db, userId, profile, from, to) : null,
    mood: visibleMoodTrend(db, userId, profile, plan, to, trendDays),
    streak: streakFor(db, userId, to),
  };
}

/** Foods eaten recently (for one-tap re-logging) and favourite meals. */
export function library(db: Db, userId: string, today: string): LibraryResponse {
  const since = addDays(today, -60);
  const recentMeals = db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, since)))
    .orderBy(desc(meals.eatenAt))
    .limit(400)
    .all()
    .map(toMeal);

  const groups = new Map<string, FoodSuggestion>();
  for (const meal of recentMeals) {
    for (const item of meal.items) {
      const key = foodKey(item.name);
      const existing = groups.get(key);
      if (existing) existing.count++;
      // Without its course: it goes back into any meal.
      else groups.set(key, { key, item: { ...stripItem(item), id: item.id }, count: 1, lastUsed: meal.eatenAt });
    }
  }
  const favorites = db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.favorite, true)))
    .orderBy(desc(meals.eatenAt))
    .limit(60)
    .all()
    .map(toMeal);
  const seenTitles = new Set<string>();
  const favoriteMeals = favorites.filter((m) => {
    const key = foodKey(m.title);
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  return {
    recentItems: [...groups.values()]
      .sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed))
      .slice(0, 30),
    favoriteMeals: favoriteMeals.slice(0, 20),
  };
}
