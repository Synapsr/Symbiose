/**
 * When a reward is earned, kept free of React Native so it can be unit tested
 * on its own (`pnpm --filter @symbiose/mobile test`). Rewards celebrate effort
 * and real progress, never a limit passed, a weight, a deletion or an error;
 * and they stay rare: each one at most once a day.
 */
import { addDays, type DaySummary, type Meal, type NutrientKey } from '@symbiose/shared';

/** The family of sounds (`assets/sounds`, made by `scripts/sounds/synth.mjs`), from the quietest to the biggest. */
export type Cue = 'pop' | 'popBright' | 'chime' | 'bloom' | 'rise';

const RANK: Record<Cue, number> = { pop: 0, popBright: 1, chime: 2, bloom: 3, rise: 4 };

/** Rewards this close make one: a bigger one still follows a smaller one (« noté », then « objectif atteint »), never the other way round. */
export const QUIET_MS = 1500;

export function mayPlay(cue: Cue, now: number, last: { cue: Cue; at: number } | null): boolean {
  if (!last || now - last.at >= QUIET_MS) return true;
  return RANK[cue] > RANK[last.cue];
}

/** « C'est noté », a little brighter when the meal clearly suits the plan. */
export function mealCue(meal: Pick<Meal, 'insight'> | null | undefined): Cue {
  return meal?.insight?.verdict === 'great' ? 'popBright' : 'pop';
}

/** After something the person did in the app, rewards may follow for this long (the day's totals take a moment to refresh). */
export const LIVE_MS = 20_000;

// ---------------------------------------------------------------- Once a day

/** What was celebrated, or found already reached, on `date`. */
export interface RewardLog {
  date: string;
  keys: string[];
}

/**
 * The rewards due now among those `reached`: not yet given today, and only
 * `live`, right after something the person did here. Whatever is reached
 * otherwise (the app opened on a goal already met, a drink synced from
 * another app) is noted quietly: each reward is given at most once a day.
 * The log comes back unchanged (the same object) when there is nothing new.
 */
export function rewardsDue(log: RewardLog, date: string, reached: readonly string[], live: boolean): { due: string[]; log: RewardLog } {
  const seen = log.date === date ? log.keys : [];
  const fresh = reached.filter((key) => !seen.includes(key));
  if (!fresh.length) return { due: [], log };
  return { due: live ? fresh : [], log: { date, keys: [...seen, ...fresh] } };
}

// ---------------------------------------------------------------- What counts

/**
 * The day's goals reached: every minimum (protein, fibre, any « at least » of
 * the plan) and the water goal. Never a limit, never calories: staying under
 * is not a finish line, and eating more is not a reward.
 */
export function reachedGoals(day: Pick<DaySummary, 'progress' | 'hydration'>): string[] {
  const goals: string[] = day.progress.filter((p) => p.target.kind === 'min' && p.target.value > 0 && p.consumed >= p.target.value).map((p) => p.nutrient);
  if (day.hydration && day.hydration.goalMl > 0 && day.hydration.totalMl >= day.hydration.goalMl) goals.push('water');
  return goals;
}

export type Milestone = 'firstMeal' | 'week' | 'month';

/**
 * A meal that opens today can mark a milestone: the first meal of an account
 * that is a day or two old, or the day that makes 7 (or 30) days logged in a
 * row. `before` is today as it stood before the meal; `joined`, the local day
 * the account was created.
 */
export function mealMilestone(before: Pick<DaySummary, 'date' | 'meals' | 'streak'> | undefined, today: string, joined: string): Milestone | null {
  if (!before || before.date !== today || before.meals.length > 0) return null;
  // Today has no meal yet, so the streak counts up to yesterday.
  if (before.streak === 0 && joined >= addDays(today, -1)) return 'firstMeal';
  if (before.streak === 6) return 'week';
  if (before.streak === 29) return 'month';
  return null;
}

export interface GoodDay {
  nutrient: NutrientKey;
  kind: 'max' | 'min';
}

/**
 * Yesterday, recognised the next morning, only when the data is clear: a day
 * really logged (three meals, or two that make most of the energy budget) and
 * its headline nutrient on the right side, a limit kept or a minimum reached.
 * With calories as the headline, a protein or fibre minimum reached instead:
 * calories are never what gets praised.
 */
export function goodDay(day: Pick<DaySummary, 'meals' | 'progress'>, hero: NutrientKey): GoodDay | null {
  const kcal = day.progress.find((p) => p.nutrient === 'kcal');
  const logged = day.meals.length >= 3 || (day.meals.length >= 2 && (kcal?.ratio ?? 0) >= 0.6);
  if (!logged) return null;
  if (hero !== 'kcal') {
    const main = day.progress.find((p) => p.nutrient === hero);
    if (main?.target.kind === 'max' && main.consumed <= main.target.value) return { nutrient: hero, kind: 'max' };
    if (main?.target.kind === 'min' && main.target.value > 0 && main.consumed >= main.target.value) return { nutrient: hero, kind: 'min' };
    return null;
  }
  const min = day.progress.find((p) => (p.nutrient === 'protein' || p.nutrient === 'fiber') && p.target.kind === 'min' && p.target.value > 0 && p.consumed >= p.target.value);
  return min ? { nutrient: min.nutrient, kind: 'min' } : null;
}
