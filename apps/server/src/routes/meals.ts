import { randomUUID } from 'node:crypto';

import {
  CreateMealInputSchema,
  DuplicateMealInputSchema,
  LocalDateSchema,
  localHour,
  localTime,
  mealTotals,
  mealTypeForHour,
  RefineMealInputSchema,
  roundNutrients,
  shortId,
  sumNutrients,
  UpdateMealInputSchema,
  type FoodItem,
  type Meal,
} from '@symbiose/shared';
import { and, asc, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import type { MealAnalysis } from '../ai/types';
import type { Db } from '../db';
import { meals, type MealRow } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { nowIso, validate, type Deps } from '../http';
import { decodePhoto } from '../services/photos';
import { buildInsight, itemsFromAnalysis, toMeal } from '../services/meals';
import { resolveUser } from '../services/users';

function getMealRow(db: Db, userId: string, id: string): MealRow {
  const row = db.select().from(meals).where(and(eq(meals.id, id), eq(meals.userId, userId))).get();
  if (!row) throw notFound('Meal');
  return row;
}

/** What was eaten that day, excluding one meal (the one being analysed). */
function totalsBefore(db: Db, userId: string, localDate: string, excludeId?: string) {
  const conditions = [eq(meals.userId, userId), eq(meals.localDate, localDate)];
  if (excludeId) conditions.push(ne(meals.id, excludeId));
  const rows = db.select({ items: meals.items }).from(meals).where(and(...conditions)).all();
  return roundNutrients(sumNutrients(rows.map((r) => mealTotals(r.items))));
}

function ensureFood(analysis: MealAnalysis): void {
  if (!analysis.isFood || analysis.items.length === 0) {
    throw new HttpError(422, 'not_food', 'No food or drink was recognised');
  }
}

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

  app.post('/', bodyLimit({ maxSize: 12 * 1024 * 1024 }), validate('json', CreateMealInputSchema), async (c) => {
    const input = c.req.valid('json');
    const userId = c.get('userId');
    const resolved = resolveUser(db, userId, input.localDate);
    const { plan } = resolved.context;
    const photo = input.photoBase64 ? decodePhoto(input.photoBase64) : null;

    let items: FoodItem[];
    let title: string;
    let mealType = input.mealType ?? mealTypeForHour(localHour(input.eatenAt));
    let analysis: MealAnalysis | undefined;

    if (input.items?.length && !photo && !input.text) {
      items = input.items.map((item) => ({ ...item, id: item.id || shortId() }));
      title = input.title || items.map((i) => i.name).join(', ').slice(0, 120);
    } else {
      analysis = await ai.analyzeMeal({
        ...resolved.context,
        photo: photo ? { base64: photo.buffer.toString('base64'), mime: photo.mime } : null,
        text: input.text ?? null,
        localTime: localTime(input.eatenAt),
        mealTypeHint: mealType,
        dayTotalsBefore: totalsBefore(db, userId, input.localDate),
      });
      ensureFood(analysis);
      items = [...itemsFromAnalysis(analysis), ...(input.items ?? [])];
      title = input.title || analysis.title.slice(0, 120);
      mealType = input.mealType ?? analysis.mealType;
    }

    const photoId = photo ? await photos.save(userId, photo.buffer, photo.mime) : null;
    const now = nowIso();
    const row = db
      .insert(meals)
      .values({
        id: randomUUID(),
        userId,
        eatenAt: input.eatenAt,
        localDate: input.localDate,
        mealType,
        title,
        items,
        photoId,
        inputText: input.text ?? null,
        note: null,
        insight: buildInsight(mealTotals(items), resolved.targets, plan, analysis),
        favorite: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json<Meal>(toMeal(row), 201);
  });

  app.patch('/:id', validate('json', UpdateMealInputSchema), (c) => {
    const userId = c.get('userId');
    const existing = getMealRow(db, userId, c.req.param('id'));
    const input = c.req.valid('json');
    const changes: Partial<MealRow> = { updatedAt: nowIso() };
    if (input.title !== undefined) changes.title = input.title;
    if (input.mealType !== undefined) changes.mealType = input.mealType;
    if (input.eatenAt !== undefined) changes.eatenAt = input.eatenAt;
    if (input.localDate !== undefined) changes.localDate = input.localDate;
    if (input.favorite !== undefined) changes.favorite = input.favorite;
    if (input.note !== undefined) changes.note = input.note;
    if (input.items !== undefined) {
      changes.items = input.items;
      // Keep the AI's words but recompute the numbers; the question is moot once edited.
      const resolved = resolveUser(db, userId, input.localDate ?? existing.localDate);
      const previous = existing.insight;
      const fresh = buildInsight(mealTotals(input.items), resolved.targets, resolved.context.plan);
      changes.insight = previous ? { ...previous, flags: fresh?.flags ?? [], clarification: null } : fresh;
    }
    const row = db.update(meals).set(changes).where(eq(meals.id, existing.id)).returning().get();
    return c.json<Meal>(toMeal(row));
  });

  /** Re-runs the analysis with a correction ("no sugar in the coffee", or an answer to the AI's question). */
  app.post('/:id/refine', validate('json', RefineMealInputSchema), async (c) => {
    const userId = c.get('userId');
    const existing = getMealRow(db, userId, c.req.param('id'));
    const resolved = resolveUser(db, userId, existing.localDate);
    const stored = existing.photoId ? await photos.read(userId, existing.photoId) : null;
    const analysis = await ai.analyzeMeal({
      ...resolved.context,
      photo: stored ? { base64: stored.buffer.toString('base64'), mime: stored.mime as 'image/jpeg' } : null,
      text: existing.inputText,
      localTime: localTime(existing.eatenAt),
      mealTypeHint: existing.mealType,
      dayTotalsBefore: totalsBefore(db, userId, existing.localDate, existing.id),
      previous: { title: existing.title, items: existing.items },
      correction: c.req.valid('json').correction,
    });
    ensureFood(analysis);
    const items = itemsFromAnalysis(analysis);
    const row = db
      .update(meals)
      .set({
        items,
        title: analysis.title.slice(0, 120) || existing.title,
        insight: buildInsight(mealTotals(items), resolved.targets, resolved.context.plan, { ...analysis, clarification: null }),
        updatedAt: nowIso(),
      })
      .where(eq(meals.id, existing.id))
      .returning()
      .get();
    return c.json<Meal>(toMeal(row));
  });

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
    const userId = c.get('userId');
    const existing = getMealRow(db, userId, c.req.param('id'));
    db.delete(meals).where(eq(meals.id, existing.id)).run();
    if (existing.photoId) {
      // Duplicated meals share their photo: only delete it once unused.
      const stillUsed = db.select({ id: meals.id }).from(meals).where(eq(meals.photoId, existing.photoId)).get();
      if (!stillUsed) await photos.remove(userId, existing.photoId);
    }
    return c.body(null, 204);
  });

  return app;
}
