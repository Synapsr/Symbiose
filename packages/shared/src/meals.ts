import { roundNutrients, scaleNutrients, sumNutrients, type Nutrients } from './nutrients';
import type { FoodItem } from './schemas';

export function itemNutrients(item: Pick<FoodItem, 'per100g' | 'grams'>): Nutrients {
  return scaleNutrients(item.per100g, item.grams);
}

export function mealTotals(items: Pick<FoodItem, 'per100g' | 'grams'>[]): Nutrients {
  return roundNutrients(sumNutrients(items.map(itemNutrients)));
}

/** Normalized key used to group identical foods across meals. */
export function foodKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let counter = 0;
/** Short unique id, good enough for client-side item ids. */
export function shortId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
