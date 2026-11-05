import { addDays, fruitSugarSignal, localTime, mealCarbLoad, mealTotals, type GoalPlan } from '@symbiose/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { SugarsBrief } from '../ai/types';
import type { Db } from '../db';
import { meals } from '../db/schema';

/**
 * Sugars beyond added sugar, for the coach: the « juice » signal (today and
 * over the last 7 days) and, in blood-sugar mode, each of today's meals'
 * carbs against the per-meal guide. Deterministic, so the coach doesn't have
 * to notice; null when there's nothing to say.
 */
export function sugarsBrief(db: Db, userId: string, plan: GoalPlan | null, date: string): SugarsBrief | null {
  const rows = db
    .select({ localDate: meals.localDate, eatenAt: meals.eatenAt, mealType: meals.mealType, title: meals.title, items: meals.items })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, addDays(date, -6)), lte(meals.localDate, date)))
    .orderBy(asc(meals.eatenAt))
    .all();
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) byDay.set(row.localDate, [...(byDay.get(row.localDate) ?? []), row]);

  const brief: SugarsBrief = {};
  const signal = (day: string) => fruitSugarSignal((byDay.get(day) ?? []).flatMap((r) => r.items), 'day');
  const today = signal(date);
  const days = [...byDay.keys()].filter((day) => signal(day) !== null).length;
  if (today) brief.fruitSugarToday = today;
  if (days) brief.fruitSugarDays7 = days;

  const todays = (byDay.get(date) ?? []).flatMap((row) => {
    const totals = mealTotals(row.items);
    const load = mealCarbLoad({ mealType: row.mealType, totals }, plan);
    return load ? [{ time: localTime(row.eatenAt), type: row.mealType, title: row.title, ...load, fiber: Math.round(totals.fiber), protein: Math.round(totals.protein) }] : [];
  });
  if (todays.length) brief.carbsByMeal = todays;

  return Object.keys(brief).length ? brief : null;
}
