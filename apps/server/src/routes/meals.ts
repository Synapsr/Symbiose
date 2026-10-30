import { randomUUID } from 'node:crypto';

import {
  CreateMealInputSchema,
  DuplicateMealInputSchema,
  LocalDateSchema,
  mealTotals,
  RefineMealInputSchema,
  shortId,
  UpdateMealInputSchema,
  type Meal,
} from '@symbiose/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { meals } from '../db/schema';
import { nowIso, validate, type Deps } from '../http';
import { buildInsight, createMeal, deleteMeal, getMealRow, refineMeal, toMeal, updateMeal } from '../services/meals';
import { resolveUser } from '../services/users';

export function mealRoutes({ db, ai, photos, config }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

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

  app.post('/', bodyLimit({ maxSize: 12 * 1024 * 1024 }), validate('json', CreateMealInputSchema), async (c) =>
    c.json<Meal>(await createMeal({ db, ai, photos }, c.get('userId'), c.req.valid('json')), 201),
  );

  app.patch('/:id', validate('json', UpdateMealInputSchema), (c) =>
    c.json<Meal>(updateMeal(db, c.get('userId'), c.req.param('id'), c.req.valid('json'))),
  );

  /** Re-runs the analysis with a correction ("no sugar in the coffee", or an answer to the AI's question). */
  app.post('/:id/refine', validate('json', RefineMealInputSchema), async (c) =>
    c.json<Meal>(await refineMeal({ db, ai, photos }, c.get('userId'), c.req.param('id'), c.req.valid('json').correction)),
  );

  /** "Same as yesterday": copies a meal to a new time. */
  app.post('/:id/duplicate', validate('json', DuplicateMealInputSchema), (c) => {
    const userId = c.get('userId');
    const source = getMealRow(db, userId, c.req.param('id'));
    const input = c.req.valid('json');
    const resolved = resolveUser(db, userId, input.localDate);
    const items = source.items.map((item) => ({ ...item, id: shortId() }));
    const now = nowIso();
    const row = db
      .insert(meals)
      .values({
        ...source,
        id: randomUUID(),
        eatenAt: input.eatenAt,
        localDate: input.localDate,
        mealType: input.mealType ?? source.mealType,
        items,
        favorite: false,
        insight: source.insight
          ? { ...source.insight, flags: buildInsight(mealTotals(items), resolved.targets, resolved.context.plan)?.flags ?? [], clarification: null }
          : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json<Meal>(toMeal(row), 201);
  });

  app.delete('/:id', async (c) => {
    await deleteMeal({ db, photos }, c.get('userId'), c.req.param('id'));
    return c.body(null, 204);
  });

  return app;
}
