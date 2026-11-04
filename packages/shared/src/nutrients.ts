import { z } from 'zod';

/**
 * The nutrients Symbiose tracks for every food item. Values are stored per
 * 100 g of edible food so that changing a portion is an exact rescale.
 */
export const NUTRIENT_KEYS = [
  'kcal',
  'protein',
  'carbs',
  'sugar',
  'addedSugar',
  'fat',
  'satFat',
  'fiber',
  'sodium',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export const NutrientKeySchema = z.enum(NUTRIENT_KEYS);

export const NutrientsSchema = z.object({
  kcal: z.number().min(0),
  protein: z.number().min(0),
  carbs: z.number().min(0),
  sugar: z.number().min(0),
  addedSugar: z.number().min(0),
  fat: z.number().min(0),
  satFat: z.number().min(0),
  fiber: z.number().min(0),
  /** milligrams */
  sodium: z.number().min(0),
});
export type Nutrients = z.infer<typeof NutrientsSchema>;

export type NutrientUnit = 'kcal' | 'g' | 'mg';

export interface NutrientMeta {
  unit: NutrientUnit;
  label: { fr: string; en: string };
  short: { fr: string; en: string };
  /** Upper bound per 100 g, used to sanitize AI and third-party data. */
  maxPer100g: number;
}

export const NUTRIENT_META: Record<NutrientKey, NutrientMeta> = {
  kcal: {
    unit: 'kcal',
    label: { fr: 'Calories', en: 'Calories' },
    short: { fr: 'kcal', en: 'kcal' },
    maxPer100g: 900,
  },
  protein: {
    unit: 'g',
    label: { fr: 'Protéines', en: 'Protein' },
    short: { fr: 'Prot.', en: 'Prot.' },
    maxPer100g: 100,
  },
  carbs: {
    unit: 'g',
    label: { fr: 'Glucides', en: 'Carbs' },
    short: { fr: 'Gluc.', en: 'Carbs' },
    maxPer100g: 100,
  },
  sugar: {
    unit: 'g',
    label: { fr: 'Sucres totaux', en: 'Total sugars' },
    short: { fr: 'Sucres', en: 'Sugars' },
    maxPer100g: 100,
  },
  addedSugar: {
    unit: 'g',
    label: { fr: 'Sucres ajoutés', en: 'Added sugars' },
    short: { fr: 'Sucre ajouté', en: 'Added sugar' },
    maxPer100g: 100,
  },
  fat: {
    unit: 'g',
    label: { fr: 'Lipides', en: 'Fat' },
    short: { fr: 'Lip.', en: 'Fat' },
    maxPer100g: 100,
  },
  satFat: {
    unit: 'g',
    label: { fr: 'Graisses saturées', en: 'Saturated fat' },
    short: { fr: 'Sat.', en: 'Sat.' },
    maxPer100g: 100,
  },
  fiber: {
    unit: 'g',
    label: { fr: 'Fibres', en: 'Fiber' },
    short: { fr: 'Fibres', en: 'Fiber' },
    maxPer100g: 100,
  },
  sodium: {
    unit: 'mg',
    label: { fr: 'Sodium', en: 'Sodium' },
    short: { fr: 'Sodium', en: 'Sodium' },
    // Pure table salt is ~38.8 g of sodium per 100 g.
    maxPer100g: 40000,
  },
};

export function zeroNutrients(): Nutrients {
  return { kcal: 0, protein: 0, carbs: 0, sugar: 0, addedSugar: 0, fat: 0, satFat: 0, fiber: 0, sodium: 0 };
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) out[key] = a[key] + b[key];
  return out;
}

export function sumNutrients(list: Nutrients[]): Nutrients {
  return list.reduce(addNutrients, zeroNutrients());
}

/** Nutrients contained in `grams` of a food described per 100 g. */
export function scaleNutrients(per100g: Nutrients, grams: number): Nutrients {
  const out = zeroNutrients();
  const factor = Math.max(0, grams) / 100;
  for (const key of NUTRIENT_KEYS) out[key] = per100g[key] * factor;
  return out;
}

/**
 * Clamp nutrient values into physically possible ranges and enforce the
 * hierarchy between related values (added sugar ⊂ sugar ⊂ carbs, saturated ⊂ fat).
 * Also reconciles energy with the Atwater factors when the provided kcal is
 * clearly inconsistent with the macros (common with estimated data).
 */
export function sanitizePer100g(input: Partial<Nutrients>): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    const raw = Number(input[key] ?? 0);
    const value = Number.isFinite(raw) ? raw : 0;
    out[key] = Math.min(Math.max(value, 0), NUTRIENT_META[key].maxPer100g);
  }
  // Macros cannot exceed 100 g per 100 g of food combined (water, ash, alcohol aside).
  const macroMass = out.protein + out.carbs + out.fat + out.fiber;
  if (macroMass > 100) {
    const ratio = 100 / macroMass;
    out.protein *= ratio;
    out.carbs *= ratio;
    out.fat *= ratio;
    out.fiber *= ratio;
  }
  out.sugar = Math.min(out.sugar, out.carbs);
  out.addedSugar = Math.min(out.addedSugar, out.sugar);
  out.satFat = Math.min(out.satFat, out.fat);

  const atwater = atwaterKcal(out);
  if (atwater > 20 && Math.abs(out.kcal - atwater) / atwater > 0.35) {
    out.kcal = atwater;
  }
  return out;
}

/** Energy computed from macros (4/4/9 kcal per g, 2 kcal per g of fiber). */
export function atwaterKcal(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat' | 'fiber'>): number {
  return n.protein * 4 + n.carbs * 4 + n.fat * 9 + n.fiber * 2;
}

export function roundNutrient(key: NutrientKey, value: number): number {
  if (key === 'kcal' || key === 'sodium') return Math.round(value);
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
}

export function roundNutrients(n: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) out[key] = roundNutrient(key, n[key]);
  return out;
}
