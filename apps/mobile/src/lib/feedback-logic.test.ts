import { progressFor, type DayHydration, type Meal, type NutrientKey, type NutrientProgress, type TargetKind } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { goodDay, mayPlay, mealCue, mealMilestone, QUIET_MS, reachedGoals, rewardsDue, type RewardLog } from './feedback-logic';

const progress = (nutrient: NutrientKey, consumed: number, value: number, kind: TargetKind): NutrientProgress => progressFor(nutrient, consumed, { value, kind });
const meals = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `m${i}` }) as Meal);
const water = (totalMl: number, goalMl = 2000) => ({ totalMl, goalMl }) as DayHydration;

describe('mayPlay', () => {
  it('plays when nothing played lately', () => {
    expect(mayPlay('pop', 10_000, null)).toBe(true);
    expect(mayPlay('pop', 10_000, { cue: 'rise', at: 10_000 - QUIET_MS })).toBe(true);
  });

  it('lets a bigger reward follow a smaller one', () => {
    expect(mayPlay('chime', 10_400, { cue: 'pop', at: 10_000 })).toBe(true);
  });

  it('keeps a smaller or equal one quiet right after', () => {
    expect(mayPlay('pop', 10_400, { cue: 'chime', at: 10_000 })).toBe(false);
    expect(mayPlay('pop', 10_400, { cue: 'pop', at: 10_000 })).toBe(false);
  });
});

describe('mealCue', () => {
  it('is brighter only for a meal that clearly suits the plan', () => {
    expect(mealCue({ insight: { verdict: 'great' } } as Meal)).toBe('popBright');
    expect(mealCue({ insight: { verdict: 'good' } } as Meal)).toBe('pop');
    expect(mealCue({ insight: { verdict: 'watch' } } as Meal)).toBe('pop');
    expect(mealCue({ insight: null } as Meal)).toBe('pop');
    expect(mealCue(null)).toBe('pop');
  });
});

describe('rewardsDue', () => {
  const empty: RewardLog = { date: '', keys: [] };

  it('celebrates what was just reached, once a day', () => {
    const first = rewardsDue(empty, '2026-10-31', ['protein'], true);
    expect(first.due).toEqual(['protein']);
    const again = rewardsDue(first.log, '2026-10-31', ['protein'], true);
    expect(again.due).toEqual([]);
    expect(again.log).toBe(first.log);
  });

  it('notes quietly what was reached without anything done here', () => {
    const quiet = rewardsDue(empty, '2026-10-31', ['water', 'fiber'], false);
    expect(quiet.due).toEqual([]);
    expect(quiet.log).toEqual({ date: '2026-10-31', keys: ['water', 'fiber'] });
    // Fibre found reached at launch stays quiet; protein, reached after a meal, is celebrated.
    expect(rewardsDue(quiet.log, '2026-10-31', ['water', 'fiber', 'protein'], true).due).toEqual(['protein']);
  });

  it('starts afresh each day', () => {
    const yesterday: RewardLog = { date: '2026-10-30', keys: ['protein', 'water'] };
    const today = rewardsDue(yesterday, '2026-10-31', ['protein'], true);
    expect(today.due).toEqual(['protein']);
    expect(today.log).toEqual({ date: '2026-10-31', keys: ['protein'] });
  });

  it('leaves the log alone when nothing is reached', () => {
    const log: RewardLog = { date: '2026-10-30', keys: ['protein'] };
    expect(rewardsDue(log, '2026-10-31', [], true).log).toBe(log);
  });
});

describe('reachedGoals', () => {
  it('counts minimums and water, never limits or calories', () => {
    const day = {
      progress: [progress('kcal', 2000, 2000, 'target'), progress('protein', 120, 110, 'min'), progress('fiber', 20, 30, 'min'), progress('addedSugar', 10, 50, 'max')],
      hydration: water(2100),
    };
    expect(reachedGoals(day)).toEqual(['protein', 'water']);
  });

  it('ignores water when it is not tracked, and empty targets', () => {
    expect(reachedGoals({ progress: [progress('fiber', 0, 0, 'min')], hydration: null })).toEqual([]);
    expect(reachedGoals({ progress: [], hydration: water(1999) })).toEqual([]);
  });
});

describe('mealMilestone', () => {
  const today = '2026-10-31';
  const before = (count: number, streak: number) => ({ date: today, meals: meals(count), streak });

  it('marks the first meal of a new account', () => {
    expect(mealMilestone(before(0, 0), today, today)).toBe('firstMeal');
    expect(mealMilestone(before(0, 0), today, '2026-10-30')).toBe('firstMeal');
  });

  it('is not a first meal for an older account coming back', () => {
    expect(mealMilestone(before(0, 0), today, '2026-10-20')).toBeNull();
  });

  it('marks the day that makes 7 or 30 days in a row', () => {
    expect(mealMilestone(before(0, 6), today, '2026-01-01')).toBe('week');
    expect(mealMilestone(before(0, 29), today, '2026-01-01')).toBe('month');
    expect(mealMilestone(before(0, 7), today, '2026-01-01')).toBeNull();
  });

  it('only for the meal that opens today', () => {
    expect(mealMilestone(before(1, 6), today, '2026-01-01')).toBeNull();
    expect(mealMilestone({ ...before(0, 6), date: '2026-10-30' }, today, '2026-01-01')).toBeNull();
    expect(mealMilestone(undefined, today, today)).toBeNull();
  });
});

describe('goodDay', () => {
  const sugarDay = (count: number, sugar: number, kcalRatio = 0.9) => ({
    meals: meals(count),
    progress: [progress('kcal', 2000 * kcalRatio, 2000, 'target'), progress('addedSugar', sugar, 50, 'max'), progress('protein', 60, 100, 'min')],
  });

  it('recognises a limit kept on a day really logged', () => {
    expect(goodDay(sugarDay(3, 30), 'addedSugar')).toEqual({ nutrient: 'addedSugar', kind: 'max' });
    expect(goodDay(sugarDay(2, 30, 0.7), 'addedSugar')).toEqual({ nutrient: 'addedSugar', kind: 'max' });
  });

  it('says nothing when the data is thin', () => {
    expect(goodDay(sugarDay(1, 0), 'addedSugar')).toBeNull();
    expect(goodDay(sugarDay(2, 10, 0.3), 'addedSugar')).toBeNull();
  });

  it('says nothing when the limit was passed', () => {
    expect(goodDay(sugarDay(3, 51), 'addedSugar')).toBeNull();
  });

  it('recognises a minimum reached', () => {
    const day = { meals: meals(3), progress: [progress('protein', 105, 100, 'min')] };
    expect(goodDay(day, 'protein')).toEqual({ nutrient: 'protein', kind: 'min' });
  });

  it('never praises calories: a protein or fibre minimum instead, or nothing', () => {
    const day = { meals: meals(3), progress: [progress('kcal', 1900, 2000, 'target'), progress('protein', 80, 100, 'min'), progress('fiber', 31, 30, 'min')] };
    expect(goodDay(day, 'kcal')).toEqual({ nutrient: 'fiber', kind: 'min' });
    expect(goodDay({ ...day, progress: day.progress.slice(0, 2) }, 'kcal')).toBeNull();
  });
});
