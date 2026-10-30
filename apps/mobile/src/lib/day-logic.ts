import { NUTRIENT_KEYS, progressFor, toLocalDate, type DaySummary, type Meal } from '@symbiose/shared';

/** Now, or this time of day on a past day: what a quick entry (a glass, a mood, a weigh-in) is dated at. */
export function momentOn(date: string, now = new Date()): Date {
  if (date >= toLocalDate(now)) return now;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes());
}

/** The day as if a meal had never been eaten: its totals leave the hero at once, before the server agrees. */
export function withoutMeal(day: DaySummary, meal: Pick<Meal, 'id' | 'totals'>): DaySummary {
  const totals = { ...day.totals };
  for (const key of NUTRIENT_KEYS) totals[key] = Math.max(0, totals[key] - meal.totals[key]);
  return {
    ...day,
    totals,
    meals: day.meals.filter((m) => m.id !== meal.id),
    progress: day.progress.map((p) => progressFor(p.nutrient, totals[p.nutrient], p.target)),
  };
}
