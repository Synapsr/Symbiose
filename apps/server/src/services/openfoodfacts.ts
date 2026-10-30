import { sanitizePer100g, shortId, type FoodItem } from '@symbiose/shared';

import { VERSION } from '../env';

/** Ingredients that indicate sugar was added during manufacturing. */
const ADDED_SUGAR_PATTERN =
  /\b(sucre|sugar|sirop|syrup|glucose|fructose|dextrose|saccharose|sucrose|maltose|miel|honey|mélasse|molasses|caramel|maltodextrin|maltodextrine|concentrated? (fruit )?juice|jus concentr)/i;

interface OffProduct {
  product_name?: string;
  product_name_fr?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  serving_quantity?: number | string;
  serving_size?: string;
  ingredients_text?: string;
  ingredients_text_fr?: string;
  nutriments?: Record<string, number | string | undefined>;
}

const num = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

export function productToItem(code: string, product: OffProduct, locale: 'fr' | 'en'): FoodItem | null {
  const n = product.nutriments ?? {};
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) !== undefined ? num(n['energy_100g'])! / 4.184 : undefined);
  if (kcal === undefined) return null;

  const sugar = num(n['sugars_100g']) ?? 0;
  const ingredients = `${product.ingredients_text_fr ?? ''} ${product.ingredients_text ?? ''}`;
  // OFF rarely reports added sugars; when it doesn't, infer them from the ingredient list.
  const addedSugar = num(n['added-sugars_100g']) ?? (ADDED_SUGAR_PATTERN.test(ingredients) ? sugar : 0);
  const sodiumG = num(n['sodium_100g']) ?? (num(n['salt_100g']) !== undefined ? num(n['salt_100g'])! / 2.5 : 0);

  const per100g = sanitizePer100g({
    kcal,
    protein: num(n['proteins_100g']) ?? 0,
    carbs: num(n['carbohydrates_100g']) ?? 0,
    sugar,
    addedSugar,
    fat: num(n['fat_100g']) ?? 0,
    satFat: num(n['saturated-fat_100g']) ?? 0,
    fiber: num(n['fiber_100g']) ?? 0,
    sodium: sodiumG * 1000,
  });

  const name =
    (locale === 'fr' ? product.product_name_fr : product.product_name_en) ||
    product.product_name ||
    product.generic_name ||
    code;
  const serving = num(product.serving_quantity);
  return {
    id: shortId(),
    name: name.trim().slice(0, 120),
    emoji: '',
    portion: product.serving_size?.slice(0, 60) ?? '',
    grams: serving && serving > 0 && serving < 2000 ? Math.round(serving) : 100,
    per100g,
    source: 'barcode',
    confidence: null,
    brand: product.brands?.split(',')[0]?.trim().slice(0, 80) || null,
    barcode: code,
  };
}

const cache = new Map<string, { at: number; item: FoodItem | null }>();
const TTL = 24 * 60 * 60 * 1000;

export async function lookupBarcode(code: string, locale: 'fr' | 'en', fetchImpl: typeof fetch = fetch): Promise<FoodItem | null> {
  const cached = cache.get(code);
  if (cached && Date.now() - cached.at < TTL) return cached.item ? { ...cached.item, id: shortId() } : null;

  const fields = 'product_name,product_name_fr,product_name_en,generic_name,brands,serving_quantity,serving_size,ingredients_text,ingredients_text_fr,nutriments';
  const res = await fetchImpl(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`, {
    headers: { 'User-Agent': `Symbiose/${VERSION} (https://github.com/Synapsr/Symbiose)` },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) {
    cache.set(code, { at: Date.now(), item: null });
    return null;
  }
  if (!res.ok) throw new Error(`Open Food Facts answered ${res.status}`);
  const body = (await res.json()) as { status?: number; product?: OffProduct };
  const item = body.status === 1 && body.product ? productToItem(code, body.product, locale) : null;
  cache.set(code, { at: Date.now(), item });
  if (cache.size > 2000) cache.clear();
  return item;
}
