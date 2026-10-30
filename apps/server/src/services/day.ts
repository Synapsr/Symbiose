import {
  addDays,
  computeProgress,
  computeTargets,
  dateRange,
  focusNutrients,
  foodKey,
  itemNutrients,
  localHour,
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
} from '@symbiose/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { activity, cravings, meals, type ActivityRow, type CravingRow } from '../db/schema';
import { toMeal } from './meals';
import { requireProfile, resolveUser } from './users';
import { weightTrend } from './weights';

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

  return {
    date,
    targets: resolved.targets,
    energy: resolved.energy,
    totals,
    progress: computeProgress(totals, resolved.targets, order),
    meals: dayMeals,
    activity: activityRow ? toActivity(activityRow) : null,
    cravings: {
      total: dayCravings.length,
      resisted: dayCravings.filter((c) => c.outcome === 'resisted').length,
      items: dayCravings,
    },
    streak: streakFor(db, userId, date),
  };
}

export function computeInsights(db: Db, userId: string, from: string, to: string): InsightsResponse {
  const resolved = resolveUser(db, userId, to);
  requireProfile(resolved);
  const profile = resolved.row.profile!;
  const plan = resolved.row.plan ?? null;
  const focus = focusNutrients(plan);

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

  const activityByDay = new Map(activityRows.map((row) => [row.localDate, row]));
  // Weight is shown over at least 30 days: a week is too short to see a trend.
  const weight = weightTrend(db, userId, to, Math.max(dateRange(from, to).length, 30));
  const weightByDay = new Map(weight.points.map((p) => [p.date, p.kg]));
  const mealsByDay = new Map<string, typeof rangeMeals>();
  for (const meal of rangeMeals) mealsByDay.set(meal.localDate, [...(mealsByDay.get(meal.localDate) ?? []), meal]);

  const watched = new Set<NutrientKey>(focus);
  for (const rule of plan?.rules ?? []) watched.add(rule.nutrient);
  watched.delete('kcal');

  const days: InsightsDay[] = [];
  const adherence = new Map<NutrientKey, { kind: 'target' | 'min' | 'max'; target: number; ok: number; logged: number }>();

  for (const date of dateRange(from, to)) {
    const dayMeals = mealsByDay.get(date) ?? [];
    const act = activityByDay.get(date);
    const { targets } = computeTargets(profile, plan, { activeKcal: act?.activeKcal ?? null });
    const totals = roundNutrients(sumNutrients(dayMeals.map((m) => m.totals)));
    const logged = dayMeals.length > 0;
    days.push({
      date,
      logged,
      totals,
      kcalTarget: targets.kcal.value,
      activeKcal: act?.activeKcal ?? null,
      weightKg: weightByDay.get(date) ?? null,
    });
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

  // When during the day the primary focus nutrient is eaten.
  const primary = focus[0] ?? 'kcal';
  const hours = Array.from({ length: 24 }, () => 0);
  for (const meal of rangeMeals) hours[localHour(meal.eatenAt)]! += meal.totals[primary];

  const whatCounts = new Map<string, { label: string; count: number }>();
  for (const c of rangeCravings) {
    const k = foodKey(c.what);
    const entry = whatCounts.get(k) ?? { label: c.what, count: 0 };
    entry.count++;
    whatCounts.set(k, entry);
  }

  return {
    from,
    to,
    days,
    loggedDays: loggedDays.length,
    averages,
    focus,
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
      else groups.set(key, { key, item, count: 1, lastUsed: meal.eatenAt });
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
