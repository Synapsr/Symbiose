import { addDays, foodKey, localTime, refersToPast, type FoodItem, type MealReference } from '@symbiose/shared';
import { and, desc, eq, gte, lte } from 'drizzle-orm';

import type { MealAnalysisInput } from '../ai/types';
import type { Db } from '../db';
import { meals, type MealRow } from '../db/schema';
import { itemLine } from './courses';

/**
 * « Le reste du gratin d'hier soir », « comme mardi midi »: when words refer
 * to an earlier meal, the analyst gets the last week's meals in a compact
 * form (a title and items with grams, about 30 tokens a meal, a few hundred
 * in all), and names the one it reused. Only then, so the usual capture costs
 * nothing more, whatever the provider. The values per 100 g never travel:
 * the server copies them from the meal reused, exactly as they were logged.
 */

const DAYS = 7;
const MAX_MEALS = 24;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const weekday = (localDate: string) => WEEKDAYS[new Date(`${localDate}T12:00:00Z`).getUTCDay()]!;

export interface MealHistory {
  input: NonNullable<MealAnalysisInput['history']>;
  refs: Map<string, MealRow>;
}

/** The meals eaten before `before` over the last week, newest first, when one of `words` refers to the past; null otherwise. */
export function historyFor(db: Db, userId: string, words: (string | null | undefined)[], localDate: string, before: string, excludeId?: string): MealHistory | null {
  if (!words.some(refersToPast)) return null;
  const rows = db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, addDays(localDate, -DAYS)), lte(meals.localDate, localDate)))
    .orderBy(desc(meals.eatenAt))
    .all()
    .filter((row) => row.id !== excludeId && Date.parse(row.eatenAt) < Date.parse(before))
    .slice(0, MAX_MEALS);
  if (!rows.length) return null;
  const refs = new Map<string, MealRow>();
  const list = rows.map((row, i) => {
    const ref = `h${i + 1}`;
    refs.set(ref, row);
    return { ref, when: `${weekday(row.localDate)} ${row.localDate} ${localTime(row.eatenAt)}`, type: row.mealType, title: row.title, items: itemLine(row.items) };
  });
  return { input: { today: `${weekday(localDate)} ${localDate}`, meals: list }, refs };
}

/** The logged item an analysed one reuses: same name, or one name inside the other ("Gratin" in "Reste de gratin"). */
function sameFood(name: string, logged: FoodItem[]): FoodItem | undefined {
  const key = foodKey(name);
  return (
    logged.find((item) => foodKey(item.name) === key) ??
    logged.find((item) => {
      const other = foodKey(item.name);
      return key.length >= 4 && other.length >= 4 && (other.includes(key) || key.includes(other));
    })
  );
}

/**
 * Applies what the AI said it reused: each item it recognises gets the values
 * per 100 g it was logged with (a barcode's exact numbers stay exact), with
 * the grams the AI chose (a half portion stays half). `reused` lists those items.
 */
export function reusePast(items: FoodItem[], ref: string | null | undefined, history: MealHistory | null): { items: FoodItem[]; basedOn: MealReference | null; reused: Set<string> } {
  const source = ref ? history?.refs.get(ref) : undefined;
  if (!source) return { items, basedOn: null, reused: new Set() };
  const reused = new Set<string>();
  const out = items.map((item) => {
    const match = sameFood(item.name, source.items);
    if (!match) return item;
    reused.add(item.id);
    return { ...item, emoji: item.emoji || match.emoji, per100g: match.per100g, confidence: Math.max(item.confidence ?? 0, 0.9), brand: match.brand, barcode: match.barcode };
  });
  return { items: out, basedOn: { mealId: source.id, localDate: source.localDate, mealType: source.mealType, title: source.title }, reused };
}
