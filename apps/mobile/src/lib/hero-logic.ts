/**
 * Today's hero card turns like pages: the goal's nutrient first, then the
 * others. Kept free of React Native so it can be unit tested on its own
 * (`pnpm --filter @symbiose/mobile test`); the snapping helpers are worklets,
 * run on the UI thread by the card's swipe.
 */
import { goalNutrient, SUGAR_FAMILY, sugarGoal, type GoalPlan, type NutrientKey } from '@symbiose/shared';

type HeroPlan = Pick<GoalPlan, 'focus' | 'rules'> & Partial<Pick<GoalPlan, 'tags' | 'carbsPerMeal'>>;

/**
 * The pages, in one order used everywhere on the card: the plan's focus (the
 * goal first), calories, the plan's other rules, then protein and fibre.
 * Hidden calories stay hidden.
 * A sugar goal keeps the sugar family together where it first appears, nested
 * order: added sugars, total sugars, then carbs (carbs, total, added when
 * carbs lead, as in blood-sugar mode). Total sugars and carbs are always there.
 */
export function heroPages(plan: HeroPlan | null, hideCalories: boolean): NutrientKey[] {
  const goal = goalNutrient(plan, hideCalories);
  const keys = [...new Set<NutrientKey>([goal, ...(plan?.focus ?? []), 'kcal', ...(plan?.rules.map((r) => r.nutrient) ?? []), 'protein', 'fiber'])];
  const pages = sugarGoal(plan) ? withSugarFamily(keys) : keys;
  return pages.filter((key) => !(hideCalories && key === 'kcal'));
}

/** The sugar family gathered at its first page, inside out from there; added sugars only when the plan names them. */
function withSugarFamily(keys: NutrientKey[]): NutrientKey[] {
  const at = keys.findIndex((key) => SUGAR_FAMILY.includes(key));
  const first = keys[at];
  if (!first) return keys;
  const order = first === 'carbs' ? [...SUGAR_FAMILY].reverse() : [...SUGAR_FAMILY.slice(SUGAR_FAMILY.indexOf(first)), ...SUGAR_FAMILY.slice(0, SUGAR_FAMILY.indexOf(first))];
  const family = order.filter((key) => key !== 'addedSugar' || keys.includes(key));
  const rest = keys.filter((key) => !SUGAR_FAMILY.includes(key));
  return [...rest.slice(0, at), ...family, ...rest.slice(at)];
}

/**
 * The page chosen by a swipe, remembered across days: it is a way of looking
 * at the day, not a daily answer. It holds while the goal stays the same; a
 * new goal opens on its own nutrient.
 */
export interface HeroChoice {
  nutrient: NutrientKey;
  /** The goal's nutrient when the choice was made. */
  goal: NutrientKey;
}

/** The page to show: the remembered one while it still exists under the same goal, the goal's page otherwise. */
export function heroIndex(pages: readonly NutrientKey[], saved: HeroChoice | null, goal: NutrientKey = pages[0] ?? 'kcal'): number {
  if (!saved || saved.goal !== goal) return 0;
  return Math.max(0, pages.indexOf(saved.nutrient));
}

/** What to remember once a page is chosen: nothing when back on the goal's page. */
export function heroChoice(pages: readonly NutrientKey[], index: number, goal: NutrientKey = pages[0] ?? 'kcal'): HeroChoice | null {
  const nutrient = pages[index];
  return nutrient && nutrient !== goal ? { nutrient, goal } : null;
}

/** The quiet bars beside a page's ring: the other pages in the same order (the goal leads them), three at most. */
export function heroBars(pages: readonly NutrientKey[], current: NutrientKey, max = 3): NutrientKey[] {
  return pages.filter((key) => key !== current).slice(0, max);
}

/** A release faster than this (in pages per second) is a flick: its direction decides. */
export const FLICK = 0.6;
/** A slower release turns the page once the card has followed the finger this far (a small card asks for less than half). */
export const COMMIT = 0.35;

/**
 * Where a released swipe settles. `position` is the strip's place in pages
 * (1.3: a third of the way from the second page to the third), `velocity` the
 * finger's speed in pages per second towards the next page, `from` the page
 * the swipe started on. One page per swipe, as native paging does.
 */
export function snapPage(position: number, velocity: number, from: number, count: number): number {
  'worklet';
  const delta = position - from;
  let target = from;
  if (Math.abs(velocity) > FLICK) target = velocity > 0 ? Math.ceil(position) : Math.floor(position);
  else if (Math.abs(delta) > COMMIT) target = from + Math.sign(delta);
  target = Math.min(Math.max(target, from - 1), from + 1);
  return Math.min(Math.max(target, 0), count - 1);
}

/** Past the first or last page the card follows the finger less and less (iOS' rubber band), in pages. */
export function rubberBand(overshoot: number): number {
  'worklet';
  const sign = overshoot < 0 ? -1 : 1;
  return sign * (1 - 1 / (Math.abs(overshoot) * 0.55 + 1));
}

/** The strip's place for a finger that moved `pages` from `start`, held back past the ends. */
export function dragPosition(start: number, pages: number, count: number): number {
  'worklet';
  const p = start + pages;
  if (p < 0) return rubberBand(p);
  if (p > count - 1) return count - 1 + rubberBand(p - (count - 1));
  return p;
}
