import { NUTRIENT_META, type NutrientKey, type NutrientUnit } from './nutrients';
import type { GoalPlan, MealType, NutrientProgress, TargetKind } from './schemas';
import { goalNutrient } from './targets';

/**
 * The goal decides the hero metric: the plan's first focus nutrient (added
 * sugar for « moins de sucre, et perdre 2 kg »), calories when the plan puts
 * them first or there is no plan yet. Calories then sit on the hero's
 * secondary line. Hidden calories fall back to the next focus nutrient.
 * It is `goalNutrient`, Trends' rule: Today, Trends, the watch and the widgets agree.
 */
export function heroNutrient(_progress: NutrientProgress[], plan: GoalPlan | null, hideCalories: boolean): NutrientKey {
  return goalNutrient(plan, hideCalories);
}

export interface GlanceMetric {
  nutrient: NutrientKey;
  unit: NutrientUnit;
  consumed: number;
  target: number;
  kind: TargetKind;
  /** target − consumed; negative once a max is passed. */
  remaining: number;
  status: NutrientProgress['status'];
}

/** A meal to log again in one tap. */
export interface GlanceRelog {
  mealId: string;
  title: string;
  emoji: string;
  mealType: MealType;
  kcal: number;
  /** Amount of the hero nutrient, in its unit. */
  hero: number;
}

/**
 * What the watch, widgets and Live Activities show: small, precomputed and
 * cheap to fetch, so native code stays a thin renderer.
 */
export interface Glance {
  date: string;
  hero: GlanceMetric;
  /** The hero first, then the plan's other focus nutrients (three at most). */
  metrics: GlanceMetric[];
  meals: number;
  lastMealAt: string | null;
  cravings: { total: number; resisted: number };
  activity: { activeMinutes: number; weeklyGoal: number; steps: number | null; dailySteps: number | null };
  /** Favourites first, then the meals eaten most often lately. */
  relog: GlanceRelog[];
}

export function glanceMetric(progress: NutrientProgress): GlanceMetric {
  return {
    nutrient: progress.nutrient,
    unit: NUTRIENT_META[progress.nutrient].unit,
    consumed: progress.consumed,
    target: progress.target.value,
    kind: progress.target.kind,
    remaining: Math.round((progress.target.value - progress.consumed) * 10) / 10,
    status: progress.status,
  };
}
