import {
  addDays,
  focusNutrients,
  foodKey,
  glanceMetric,
  heroNutrient,
  LocalDateSchema,
  mealSpan,
  toLocalDate,
  type Glance,
  type GlanceRelog,
  type Meal,
  type NutrientKey,
} from '@symbiose/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import type { Db } from '../db';
import { meals } from '../db/schema';
import { validate, type Deps } from '../http';
import { daySummary } from '../services/day';
import { toMeal } from '../services/meals';
import { getUserRow } from '../services/users';

const RELOG_LIMIT = 6;

/** Favourites first, then the meals eaten most often over the last 30 days. */
function relogMeals(db: Db, userId: string, date: string, hero: NutrientKey): GlanceRelog[] {
  const recent = db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, addDays(date, -30))))
    .orderBy(desc(meals.eatenAt))
    .limit(300)
    .all()
    .map(toMeal);

  const groups = new Map<string, { meal: Meal; count: number }>();
  for (const meal of recent) {
    const key = foodKey(meal.title);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { meal, count: 1 });
  }
  return [...groups.values()]
    .sort((a, b) => Number(b.meal.favorite) - Number(a.meal.favorite) || b.count - a.count || b.meal.eatenAt.localeCompare(a.meal.eatenAt))
    .slice(0, RELOG_LIMIT)
    .map(({ meal }) => ({
      mealId: meal.id,
      title: meal.title,
      emoji: meal.items[0]?.emoji ?? '',
      mealType: meal.mealType,
      kcal: Math.round(meal.totals.kcal),
      hero: Math.round(meal.totals[hero] * 10) / 10,
    }));
}

export function glanceRoutes({ db, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  /** The key numbers for the watch, widgets and Live Activities. */
  app.get(
    '/',
    validate('query', z.object({ date: LocalDateSchema.optional(), hideCalories: z.enum(['0', '1']).optional() })),
    (c) => {
      const { date = toLocalDate(), hideCalories } = c.req.valid('query');
      const userId = c.get('userId');
      const day = daySummary(db, userId, date);
      const plan = getUserRow(db, userId).plan ?? null;
      const hidden = hideCalories === '1';
      const hero = heroNutrient(day.progress, plan, hidden);
      // The hero, the plan's other focus nutrients, then calories as a backdrop unless hidden.
      const keys = [...new Set<NutrientKey>([hero, ...focusNutrients(plan), ...(hidden ? [] : (['kcal'] as const))])].slice(0, 3);
      const metrics = keys.map((key) => glanceMetric(day.progress.find((p) => p.nutrient === key)!));

      return c.json<Glance>({
        date,
        hero: metrics[0]!,
        metrics,
        meals: day.meals.length,
        // The last course eaten, not when its meal started.
        lastMealAt: day.meals.map((m) => mealSpan(m).end).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null,
        cravings: { total: day.cravings.total, resisted: day.cravings.resisted },
        activity: {
          activeMinutes: day.activityWeek.activeMinutes,
          weeklyGoal: day.activityWeek.goals.weeklyActiveMinutes,
          steps: day.activity?.steps ?? null,
          dailySteps: day.activityWeek.goals.dailySteps,
        },
        relog: relogMeals(db, userId, date, hero),
      });
    },
  );

  return app;
}
