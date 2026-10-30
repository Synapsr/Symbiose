import { randomUUID } from 'node:crypto';

import {
  CreateMealInputSchema,
  localHour,
  localTime,
  mealFlags,
  mealTotals,
  mealTypeForHour,
  roundNutrients,
  sanitizePer100g,
  shortId,
  sumNutrients,
  type FoodItem,
  type GoalPlan,
  type Meal,
  type MealInsight,
  type Nutrients,
  type Targets,
  UpdateMealInputSchema,
} from '@symbiose/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { z } from 'zod';

import type { MealAnalysis } from '../ai/types';
import type { Db } from '../db';
import { meals, type MealRow } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { nowIso, type Deps } from '../http';
import { bloodPressureBrief } from './blood-pressure';
import { decodePhoto } from './photos';
import { resolveUser } from './users';
import { mealActivity } from './workouts';

/** What logging, refining and deleting a meal needs. */
type MealDeps = Pick<Deps, 'db' | 'ai' | 'photos'>;

export function toMeal(row: MealRow): Meal {
  return {
    id: row.id,
    eatenAt: row.eatenAt,
    localDate: row.localDate,
    mealType: row.mealType,
    title: row.title,
    items: row.items,
    photoId: row.photoId,
    note: row.note,
    insight: row.insight ?? null,
    favorite: row.favorite,
    totals: mealTotals(row.items),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

/** Turns raw AI output into validated, physically plausible food items. */
export function itemsFromAnalysis(analysis: MealAnalysis): FoodItem[] {
  return analysis.items
    .filter((item) => item.name.trim().length > 0)
    .slice(0, 40)
    .map((item) => ({
      id: shortId(),
      name: item.name.trim().slice(0, 120),
      emoji: [...(item.emoji ?? '')].slice(0, 2).join(''),
      portion: (item.portion ?? '').slice(0, 60),
      grams: Math.round(clamp(item.grams, 0, 5000)),
      per100g: sanitizePer100g(item.per100g),
      source: 'ai' as const,
      confidence: Math.round(clamp(item.confidence, 0, 1) * 100) / 100,
      brand: null,
      barcode: null,
    }));
}

/** Combines the AI's qualitative assessment with deterministic, goal-aware flags. */
export function buildInsight(
  totals: Nutrients,
  targets: Targets | null,
  plan: GoalPlan | null,
  ai?: Pick<MealAnalysis, 'verdict' | 'headline' | 'tips' | 'clarification'>,
): MealInsight | null {
  const flags = targets ? mealFlags(totals, targets, plan) : [];
  if (!ai) {
    if (!flags.length) return null;
    const worst = flags.find((f) => f.kind === 'max' && f.share >= 0.5);
    return { verdict: worst ? 'watch' : 'ok', headline: '', tips: [], flags, clarification: null };
  }
  return {
    verdict: ai.verdict,
    headline: ai.headline.slice(0, 240),
    tips: ai.tips.filter(Boolean).slice(0, 2).map((tip) => tip.slice(0, 240)),
    flags,
    clarification:
      ai.clarification && ai.clarification.options.length >= 2
        ? {
            question: ai.clarification.question.slice(0, 160),
            options: ai.clarification.options.slice(0, 4).map((o) => o.slice(0, 40)),
          }
        : null,
  };
}

/** Removes the per-request item ids so foods can be grouped across meals. */
export function stripItem(item: FoodItem): Omit<FoodItem, 'id'> {
  const { id: _id, ...rest } = item;
  return rest;
}

export function getMealRow(db: Db, userId: string, id: string): MealRow {
  const row = db.select().from(meals).where(and(eq(meals.id, id), eq(meals.userId, userId))).get();
  if (!row) throw notFound('Meal');
  return row;
}

/**
 * What was eaten that day before `eatenAt`, excluding one meal (the one being
 * analysed). By time, not by arrival: a lunch logged offline and sent after
 * dinner doesn't count the dinner.
 */
function totalsBefore(db: Db, userId: string, localDate: string, eatenAt: string, excludeId?: string) {
  const conditions = [eq(meals.userId, userId), eq(meals.localDate, localDate)];
  if (excludeId) conditions.push(ne(meals.id, excludeId));
  const rows = db.select({ items: meals.items, eatenAt: meals.eatenAt }).from(meals).where(and(...conditions)).all();
  const before = Date.parse(eatenAt);
  return roundNutrients(sumNutrients(rows.filter((r) => Date.parse(r.eatenAt) < before).map((r) => mealTotals(r.items))));
}

function ensureFood(analysis: MealAnalysis): void {
  if (!analysis.isFood || analysis.items.length === 0) {
    throw new HttpError(422, 'not_food', 'No food or drink was recognised');
  }
}

/** Logs a meal: known items are stored as is, a photo or a description goes through the AI. */
export async function createMeal({ db, ai, photos }: MealDeps, userId: string, input: z.infer<typeof CreateMealInputSchema>): Promise<Meal> {
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
      dayTotalsBefore: totalsBefore(db, userId, input.localDate, input.eatenAt),
      ...mealActivity(db, userId, input.localDate, input.eatenAt),
      bloodPressureCategory: bloodPressureBrief(db, userId, resolved.row.profile ?? null, input.localDate)?.category ?? null,
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
  return toMeal(row);
}

export function updateMeal(db: Db, userId: string, id: string, input: z.infer<typeof UpdateMealInputSchema>): Meal {
  const existing = getMealRow(db, userId, id);
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
  return toMeal(db.update(meals).set(changes).where(eq(meals.id, existing.id)).returning().get());
}

/** Re-runs the analysis with a correction ("no sugar in the coffee", or an answer to the AI's question). */
export async function refineMeal({ db, ai, photos }: MealDeps, userId: string, id: string, correction: string): Promise<Meal> {
  const existing = getMealRow(db, userId, id);
  const resolved = resolveUser(db, userId, existing.localDate);
  const stored = existing.photoId ? await photos.read(userId, existing.photoId) : null;
  const analysis = await ai.analyzeMeal({
    ...resolved.context,
    photo: stored ? { base64: stored.buffer.toString('base64'), mime: stored.mime as 'image/jpeg' } : null,
    text: existing.inputText,
    localTime: localTime(existing.eatenAt),
    mealTypeHint: existing.mealType,
    dayTotalsBefore: totalsBefore(db, userId, existing.localDate, existing.eatenAt, existing.id),
    ...mealActivity(db, userId, existing.localDate, existing.eatenAt),
    bloodPressureCategory: bloodPressureBrief(db, userId, resolved.row.profile ?? null, existing.localDate)?.category ?? null,
    previous: { title: existing.title, items: existing.items },
    correction,
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
  return toMeal(row);
}

export async function deleteMeal({ db, photos }: Pick<MealDeps, 'db' | 'photos'>, userId: string, id: string): Promise<void> {
  const existing = getMealRow(db, userId, id);
  db.delete(meals).where(eq(meals.id, existing.id)).run();
  if (existing.photoId) {
    // Duplicated meals share their photo: only delete it once unused.
    const stillUsed = db.select({ id: meals.id }).from(meals).where(eq(meals.photoId, existing.photoId)).get();
    if (!stillUsed) await photos.remove(userId, existing.photoId);
  }
}
