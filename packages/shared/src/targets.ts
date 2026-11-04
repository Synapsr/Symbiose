import { PAL_MIN } from './expenditure';
import { NUTRIENT_KEYS, type NutrientKey, type Nutrients } from './nutrients';
import { carbsPerMeal, sugarGoal } from './sugars';
import type {
  ActivityLevel,
  EnergyBreakdown,
  GoalPlan,
  MealFlag,
  NutrientProgress,
  Profile,
  Sex,
  Target,
  Targets,
} from './schemas';

export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

/**
 * Wearables tend to overestimate active energy. Only this share of it is
 * credited back to the budget when "adjust for activity" is on.
 */
export const ACTIVE_ENERGY_CREDIT = 0.8;

const CALORIE_FLOOR: Record<Sex, number> = { female: 1200, male: 1500, other: 1350 };

export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  return Math.max(0, now.getFullYear() - birthYear);
}

/** Basal metabolic rate, Mifflin–St Jeor (1990). */
export function bmrMifflin(profile: Pick<Profile, 'sex' | 'birthYear' | 'heightCm' | 'weightKg'>, now = new Date()): number {
  const age = ageFromBirthYear(profile.birthYear, now);
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * age;
  const sexOffset = profile.sex === 'male' ? 5 : profile.sex === 'female' ? -161 : -78;
  return base + sexOffset;
}

export interface EnergyOptions {
  /** Active energy measured today by a watch / phone, if any. */
  activeKcal?: number | null;
  /** Shift from the measured expenditure (`adaptiveShift`); used only when the plan opted in. */
  adaptiveKcal?: number | null;
  now?: Date;
}

export function computeEnergy(profile: Profile, plan: GoalPlan | null, options: EnergyOptions = {}): EnergyBreakdown {
  const bmr = bmrMifflin(profile, options.now);
  const measured = options.activeKcal ?? null;
  const useActivity = Boolean(plan?.adjustForActivity) && measured !== null;

  const formulaTdee = useActivity
    ? bmr * ACTIVITY_MULTIPLIER.sedentary + (measured ?? 0) * ACTIVE_ENERGY_CREDIT
    : bmr * ACTIVITY_MULTIPLIER[profile.activityLevel];
  // The measured expenditure recalibrates the formula; daily activity still moves it.
  const shift = plan?.adaptiveEnergy ? (options.adaptiveKcal ?? 0) : 0;
  const tdee = shift ? Math.max(formulaTdee + shift, bmr * PAL_MIN) : formulaTdee;

  let goal = tdee;
  if (plan) {
    const pct = Math.min(Math.max(plan.caloriePercent, 0), 25) / 100;
    if (plan.calorieMode === 'deficit') goal = tdee * (1 - pct);
    if (plan.calorieMode === 'surplus') goal = tdee * (1 + Math.min(pct, 0.2));
  }
  // Never prescribe below basal needs or a sex-specific safety floor, nor below
  // what the formula alone would allow when the measure lowers maintenance.
  const floor = Math.max(CALORIE_FLOOR[profile.sex], bmr);
  if (plan?.calorieMode === 'deficit' || tdee < formulaTdee) goal = Math.max(goal, Math.min(floor, formulaTdee));

  const override = plan?.overrides?.kcal;
  const goalKcal = roundTo(override ?? goal, 10);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    source: useActivity ? 'activity' : 'profile',
    activeKcal: measured,
    goalKcal,
    adaptiveKcal: Math.round(tdee - formulaTdee),
  };
}

/**
 * Daily targets for every tracked nutrient. Defaults follow WHO / EFSA
 * guidance; the plan's rules refine them and user overrides win.
 */
export function computeTargets(profile: Profile, plan: GoalPlan | null, options: EnergyOptions = {}): { targets: Targets; energy: EnergyBreakdown } {
  const energy = computeEnergy(profile, plan, options);
  const kcal = energy.goalKcal;

  const proteinPerKg = plan?.proteinPerKg ?? 1.0;
  const fatShare = (plan?.fatPercent ?? 30) / 100;

  const protein = Math.round(profile.weightKg * proteinPerKg);
  const fat = Math.round((kcal * fatShare) / 9);
  const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));

  const targets: Targets = {
    kcal: { value: kcal, kind: 'target' },
    protein: { value: protein, kind: 'min' },
    carbs: carbsTarget(kcal, carbs, plan),
    fat: { value: fat, kind: 'target' },
    // EFSA: ≥25 g/day; US DGA: 14 g per 1000 kcal.
    fiber: { value: Math.max(25, Math.round((kcal / 1000) * 14)), kind: 'min' },
    // UK reference intake for total sugars: 90 g at 2000 kcal.
    sugar: { value: Math.round(kcal * 0.045), kind: 'max' },
    // WHO: free sugars < 10 % of energy.
    addedSugar: { value: Math.round((kcal * 0.1) / 4), kind: 'max' },
    // WHO: saturated fat < 10 % of energy.
    satFat: { value: Math.round((kcal * 0.1) / 9), kind: 'max' },
    // WHO: < 2000 mg sodium (5 g salt).
    sodium: { value: 2000, kind: 'max' },
  };

  for (const rule of plan?.rules ?? []) {
    if (rule.nutrient === 'kcal') continue; // energy is driven by calorieMode
    targets[rule.nutrient] = { value: rule.value, kind: rule.kind };
  }
  for (const key of NUTRIENT_KEYS) {
    const override = plan?.overrides?.[key];
    if (override !== undefined && key !== 'kcal') targets[key] = { ...targets[key], value: override };
  }
  return { targets, energy };
}

/**
 * Carbohydrates fill the energy left by protein and fat. When the plan is about
 * sugar they become a « repère » instead, within reference intakes:
 * - sugar goal: the energy left, kept within EFSA's 45–60 % of energy (the EU
 *   label's reference intake, 260 g at 2000 kcal, is 52 %);
 * - blood-sugar mode: at most 45 % of energy, the low end of EFSA's range and
 *   within ANSES' 40–55 %; the rest of the budget can come from protein, fat and fibre.
 */
function carbsTarget(kcal: number, residual: number, plan: GoalPlan | null): Target {
  const share = (pct: number) => Math.round((kcal * pct) / 4);
  if (carbsPerMeal(plan) !== null) return { value: Math.max(50, Math.min(residual, share(0.45))), kind: 'max' };
  if (sugarGoal(plan)) return { value: Math.min(Math.max(residual, share(0.45)), share(0.6)), kind: 'max' };
  return { value: residual, kind: 'target' };
}

export function progressFor(nutrient: NutrientKey, consumed: number, target: Target): NutrientProgress {
  const ratio = target.value > 0 ? consumed / target.value : 0;
  let status: NutrientProgress['status'];
  if (target.kind === 'max') {
    status = ratio > 1 ? 'over' : ratio >= 0.85 ? 'reached' : 'on_track';
  } else if (target.kind === 'min') {
    status = ratio >= 1 ? 'reached' : 'under';
  } else {
    status = ratio > 1.1 ? 'over' : ratio >= 0.9 ? 'reached' : 'under';
  }
  return { nutrient, consumed, target, ratio, status };
}

export function computeProgress(totals: Nutrients, targets: Targets, order: readonly NutrientKey[] = NUTRIENT_KEYS): NutrientProgress[] {
  return order.map((key) => progressFor(key, totals[key], targets[key]));
}

/**
 * Deterministic, goal-aware flags for a single meal: how much of each focus /
 * limited nutrient's daily budget this meal uses.
 */
export function mealFlags(totals: Nutrients, targets: Targets, plan: GoalPlan | null): MealFlag[] {
  const watched = new Set<NutrientKey>(plan?.focus ?? ['kcal']);
  for (const rule of plan?.rules ?? []) watched.add(rule.nutrient);
  const flags: MealFlag[] = [];
  for (const key of watched) {
    const target = targets[key];
    if (!target || target.value <= 0) continue;
    flags.push({ nutrient: key, share: totals[key] / target.value, kind: target.kind });
  }
  return flags.sort((a, b) => b.share - a.share).slice(0, 4);
}

/** The nutrients to put first in the UI for a plan. */
export function focusNutrients(plan: GoalPlan | null): NutrientKey[] {
  const focus = plan?.focus?.length ? plan.focus : (['protein'] as NutrientKey[]);
  return focus.filter((key) => key !== 'kcal');
}

/**
 * The goal's headline nutrient, for Trends (and the same rule as the Today hero): the plan's first
 * focus, so calories lead only when the plan puts them first; never calories when they're hidden.
 */
export function goalNutrient(plan: Pick<GoalPlan, 'focus'> | null, hideCalories = false): NutrientKey {
  const first = plan?.focus[0] ?? 'kcal';
  if (first !== 'kcal' || !hideCalories) return first;
  return plan?.focus.find((key) => key !== 'kcal') ?? 'protein';
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
