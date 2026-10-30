import type { NutrientKey } from './nutrients';
import type { ActivityGoals, GoalPlan } from './schemas';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

/** Realistic daily bounds for rule values, in each nutrient's unit. */
export const RULE_BOUNDS: Record<Exclude<NutrientKey, 'kcal'>, [number, number]> = {
  protein: [30, 350],
  carbs: [20, 600],
  sugar: [10, 250],
  addedSugar: [0, 150],
  fat: [20, 250],
  satFat: [5, 80],
  fiber: [10, 80],
  sodium: [500, 6000],
};

/** Bounds of the activity guardrails; steps and strength sessions are optional (null). */
export const ACTIVITY_BOUNDS = {
  weeklyActiveMinutes: [60, 600],
  dailySteps: [3000, 20_000],
  weeklyStrengthSessions: [1, 6],
} as const satisfies Record<keyof ActivityGoals, readonly [number, number]>;

/** What one tap of a stepper moves: 5 g for most, finer for saturated fat, 100 mg for sodium. */
export function ruleStep(nutrient: Exclude<NutrientKey, 'kcal'>): number {
  if (nutrient === 'sodium') return 100;
  if (nutrient === 'satFat') return 1;
  return 5;
}

export const ACTIVITY_STEPS: Record<keyof ActivityGoals, number> = { weeklyActiveMinutes: 10, dailySteps: 500, weeklyStrengthSessions: 1 };

export function clampRuleValue(nutrient: Exclude<NutrientKey, 'kcal'>, value: number): number {
  const [min, max] = RULE_BOUNDS[nutrient];
  return Math.round(clamp(value, min, max));
}

/** Zero or missing means "no goal" for the optional guardrails. */
const optionalGoal = (value: number | null, [min, max]: readonly [number, number]) => (value && value > 0 ? Math.round(clamp(value, min, max)) : null);

export function clampActivityGoals(activity: ActivityGoals | null): ActivityGoals | null {
  if (!activity) return null;
  return {
    weeklyActiveMinutes: Math.round(clamp(activity.weeklyActiveMinutes, ...ACTIVITY_BOUNDS.weeklyActiveMinutes)),
    dailySteps: optionalGoal(activity.dailySteps, ACTIVITY_BOUNDS.dailySteps),
    weeklyStrengthSessions: optionalGoal(activity.weeklyStrengthSessions, ACTIVITY_BOUNDS.weeklyStrengthSessions),
  };
}

/** Lowest manual calorie target accepted; the sex-specific floors of `computeEnergy` start here. */
const KCAL_OVERRIDE_BOUNDS = [1200, 6000] as const;

/**
 * A plan edited by hand, made safe: rule values and manual targets within realistic bounds, energy
 * never set by a rule (`calorieMode` drives it), activity guardrails within bounds. The energy
 * safety floors themselves live in `computeEnergy`.
 */
export function sanitizePlan(plan: GoalPlan): GoalPlan {
  const overrides: GoalPlan['overrides'] = {};
  for (const [key, value] of Object.entries(plan.overrides ?? {}) as [NutrientKey, number | undefined][]) {
    if (value === undefined) continue;
    overrides[key] = key === 'kcal' ? Math.round(clamp(value, ...KCAL_OVERRIDE_BOUNDS)) : clampRuleValue(key, value);
  }
  return {
    ...plan,
    rules: plan.rules.filter((rule) => rule.nutrient !== 'kcal').map((rule) => ({ ...rule, value: clampRuleValue(rule.nutrient as Exclude<NutrientKey, 'kcal'>, rule.value) })),
    overrides,
    activity: clampActivityGoals(plan.activity),
  };
}
