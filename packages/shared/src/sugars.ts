import { itemNutrients, mealTotals } from './meals';
import type { NutrientKey } from './nutrients';
import type { FoodItem, FruitSugar, GoalPlan, MealType } from './schemas';

/**
 * Sugars and carbohydrates beyond added sugar: the nested amounts a meal
 * holds (added ⊂ total sugars ⊂ carbs), the blood-sugar mode (carbs per meal)
 * and the « juice » signal. Pure and deterministic, shared by the server (AI
 * context, meal insights) and the app.
 */

// ---------------------------------------------------------------- Blood-sugar mode

/**
 * Words that put a goal in blood-sugar mode: prediabetes, type 2 diabetes,
 * glycaemia, insulin resistance, HbA1c. Matched without accents or case.
 */
const BLOOD_SUGAR_WORDS = /pre-?diab|diabet|glycem|glycaem|insulino|insulin[ -]?resist|resistance a l'insuline|hba1c|hemoglobine glyquee|blood[ -]?sugar|taux de sucre|sucre dans le sang/;

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’]/g, "'");

/** Their words talk about blood sugar (« prédiabétique », « glycémie », « diabète de type 2 »…). */
export function mentionsBloodSugar(text: string): boolean {
  return BLOOD_SUGAR_WORDS.test(plain(text));
}

/**
 * The carbs-per-meal guide, in g. CDC « Carb counting » (Diabetes, 2024): about
 * 45–60 g per meal is a common starting point for adults; the default is its
 * lower end, the bounds stay within that advice with some room for small
 * eaters. A guide to spread carbs, never a prescription: their doctor or
 * dietitian may set another.
 */
export const CARBS_PER_MEAL = { default: 45, min: 30, max: 60 } as const;

export function clampCarbsPerMeal(value: number): number {
  const v = Number.isFinite(value) ? value : CARBS_PER_MEAL.default;
  return Math.round(Math.min(Math.max(v, CARBS_PER_MEAL.min), CARBS_PER_MEAL.max) / 5) * 5;
}

type BloodSugarPlan = Partial<Pick<GoalPlan, 'tags' | 'carbsPerMeal'>>;

/** The plan's carbs-per-meal guide, or null outside blood-sugar mode. A `blood_sugar` tag alone gets the default. */
export function carbsPerMeal(plan: BloodSugarPlan | null | undefined): number | null {
  if (!plan) return null;
  if (typeof plan.carbsPerMeal === 'number' && plan.carbsPerMeal > 0) return clampCarbsPerMeal(plan.carbsPerMeal);
  return plan.tags?.includes('blood_sugar') ? CARBS_PER_MEAL.default : null;
}

/** Snacks get a smaller guide: CDC suggests 15–20 g, so about 40 % of a meal's, within 15–25 g. */
export function carbsGuideFor(mealType: MealType, perMeal: number): number {
  if (mealType !== 'snack') return perMeal;
  return Math.min(Math.max(Math.round((perMeal * 0.4) / 5) * 5, 15), 25);
}

export type CarbLoadLevel = 'within' | 'above' | 'high';

/** A meal's carbs against its guide: within it (5 g of slack), above, or a big single load (half as much again). */
export function carbLoadLevel(carbs: number, guide: number): CarbLoadLevel {
  if (carbs <= guide + 5) return 'within';
  return carbs >= guide * 1.5 ? 'high' : 'above';
}

export interface CarbLoad {
  carbs: number;
  guide: number;
  level: CarbLoadLevel;
}

/** One meal's carbs in blood-sugar mode, or null outside it. */
export function mealCarbLoad(meal: { mealType: MealType; totals: { carbs: number } }, plan: BloodSugarPlan | null | undefined): CarbLoad | null {
  const perMeal = carbsPerMeal(plan);
  if (perMeal === null) return null;
  const guide = carbsGuideFor(meal.mealType, perMeal);
  const carbs = Math.round(meal.totals.carbs);
  return { carbs, guide, level: carbLoadLevel(carbs, guide) };
}

/** The plan is about sugar: added or total sugars in its focus, or blood-sugar mode. */
export function sugarGoal(plan: (Pick<GoalPlan, 'focus'> & BloodSugarPlan) | null | undefined): boolean {
  if (!plan) return false;
  return plan.focus.some((key) => key === 'addedSugar' || key === 'sugar') || carbsPerMeal(plan) !== null;
}

/**
 * A limit the app derived from reference intakes rather than one the plan set:
 * total sugars, and carbs once they turn into a « repère ». Said « repère », never « limite ».
 */
export function isReferenceTarget(plan: Pick<GoalPlan, 'rules'> | null | undefined, key: NutrientKey): boolean {
  return (key === 'sugar' || key === 'carbs') && !plan?.rules.some((r) => r.nutrient === key);
}

/** The nested order of the sugar family, inside out: added ⊂ total sugars ⊂ carbs. */
export const SUGAR_FAMILY: readonly NutrientKey[] = ['addedSugar', 'sugar', 'carbs'];

// ---------------------------------------------------------------- Juice, smoothies, dried fruit

/** Fruit in forms whose sugar comes fast and without the fruit's fibre: juice, smoothies, nectar, dried fruit. */
const FRUIT_SUGAR_NAMES =
  /\bjus\b|juice|smoothie|nectar|fruits? secs?|\bdattes?\b|\bdates?\b|raisins? secs?|abricots? secs?|figues? seches?|pruneaux?|cranberr(?:y|ies) sechee?s?|dried|canneberges? sechees?/;

/** Dried fruit unnamed as such: very sweet with no added sugar (raisins ~60 g, dates ~65 g of sugars per 100 g). */
const DRIED_FRUIT_SUGAR_PER_100G = 40;

function fruitSugarItem(item: Pick<FoodItem, 'name' | 'per100g'>): boolean {
  if (FRUIT_SUGAR_NAMES.test(plain(item.name))) return true;
  const { sugar, addedSugar, fiber } = item.per100g;
  return sugar - addedSugar >= DRIED_FRUIT_SUGAR_PER_100G && fiber > 0;
}

/** Sugars from juice, smoothies and dried fruit in a list of items, with their names. */
export function fruitSugar(items: Pick<FoodItem, 'name' | 'grams' | 'per100g'>[]): FruitSugar & { addedElsewhere: number } {
  let grams = 0;
  let addedInFruit = 0;
  const sources: string[] = [];
  for (const item of items) {
    if (!fruitSugarItem(item)) continue;
    const n = itemNutrients(item);
    if (n.sugar < 1) continue;
    grams += n.sugar;
    addedInFruit += n.addedSugar;
    if (!sources.includes(item.name) && sources.length < 3) sources.push(item.name);
  }
  const added = mealTotals(items).addedSugar;
  return { grams: Math.round(grams), sources, addedElsewhere: Math.max(0, Math.round(added - addedInFruit)) };
}

/**
 * The gentle signal: lots of sugar from juice, smoothies or dried fruit while
 * other added sugars stay low. A glass of orange juice (25 cl) holds about
 * 20–22 g of sugars, about two thirds of a can of soda: a meal flags from
 * 20 g, a day from 30 g. Whole fruit never flags.
 */
export const FRUIT_SUGAR_SIGNAL = { meal: 20, day: 30 } as const;

export function fruitSugarSignal(items: Pick<FoodItem, 'name' | 'grams' | 'per100g'>[], scope: keyof typeof FRUIT_SUGAR_SIGNAL): FruitSugar | null {
  const found = fruitSugar(items);
  if (found.grams < FRUIT_SUGAR_SIGNAL[scope] || found.addedElsewhere >= found.grams) return null;
  return { grams: found.grams, sources: found.sources };
}
