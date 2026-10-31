import {
  CreateMealInputSchema,
  DuplicateMealInputSchema,
  LocalDateSchema,
  MergeMealInputSchema,
  RefineMealInputSchema,
  UpdateMealInputSchema,
  type Meal,
  type SeparateCourseResult,
} from '@symbiose/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { meals } from '../db/schema';
import { validate, type Deps } from '../http';
import { createMeal, deleteCourse, deleteMeal, duplicateMeal, getMealRow, mergeMeal, refineMeal, separateCourse, toMeal, updateMeal } from '../services/meals';

export function mealRoutes({ db, ai, photos, config }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));
  const deps = { db, ai, photos };

  app.get('/', validate('query', z.object({ date: LocalDateSchema })), (c) => {
    const rows = db
      .select()
      .from(meals)
      .where(and(eq(meals.userId, c.get('userId')), eq(meals.localDate, c.req.valid('query').date)))
      .orderBy(asc(meals.eatenAt))
      .all();
    return c.json<Meal[]>(rows.map(toMeal));
  });

  app.get('/:id', (c) => c.json<Meal>(toMeal(getMealRow(db, c.get('userId'), c.req.param('id')))));

  /** A new meal, or with `course` the next course of the meal it follows (same response: the whole meal). */
  app.post('/', bodyLimit({ maxSize: 12 * 1024 * 1024 }), validate('json', CreateMealInputSchema), async (c) =>
    c.json<Meal>(await createMeal(deps, c.get('userId'), c.req.valid('json')), 201),
  );

  app.patch('/:id', validate('json', UpdateMealInputSchema), async (c) =>
    c.json<Meal>(await updateMeal(deps, c.get('userId'), c.req.param('id'), c.req.valid('json'))),
  );

  /** Re-runs the analysis of the whole meal with a correction ("no sugar in the coffee", or an answer to the AI's question). */
  app.post('/:id/refine', validate('json', RefineMealInputSchema), async (c) =>
    c.json<Meal>(await refineMeal(deps, c.get('userId'), c.req.param('id'), c.req.valid('json').correction)),
  );

  /** "Same as yesterday": copies a meal to a new time, or into the meal it follows. */
  app.post('/:id/duplicate', validate('json', DuplicateMealInputSchema), async (c) =>
    c.json<Meal>(await duplicateMeal(deps, c.get('userId'), c.req.param('id'), c.req.valid('json')), 201),
  );

  /** « Séparer »: the course becomes a meal of its own. */
  app.post('/:id/courses/:courseId/separate', async (c) =>
    c.json<SeparateCourseResult>(await separateCourse(deps, c.get('userId'), c.req.param('id'), c.req.param('courseId'))),
  );

  app.delete('/:id/courses/:courseId', async (c) => c.json<Meal>(await deleteCourse(deps, c.get('userId'), c.req.param('id'), c.req.param('courseId'))));

  /** Joins another meal of the day as courses of this one (« Séparer », undone). */
  app.post('/:id/merge', validate('json', MergeMealInputSchema), async (c) =>
    c.json<Meal>(await mergeMeal(deps, c.get('userId'), c.req.param('id'), c.req.valid('json').mealId)),
  );

  app.delete('/:id', async (c) => {
    await deleteMeal(deps, c.get('userId'), c.req.param('id'));
    return c.body(null, 204);
  });

  return app;
}
