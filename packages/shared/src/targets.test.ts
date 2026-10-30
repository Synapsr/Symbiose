import { describe, expect, it } from 'vitest';

import { addDays, dateRange, localHour, mealTypeForHour, startOfWeek, toLocalDateTime } from './dates';
import { mealTotals } from './meals';
import { sanitizePer100g, scaleNutrients, zeroNutrients } from './nutrients';
import type { GoalPlan, Profile } from './schemas';
import { bmrMifflin, computeEnergy, computeTargets, mealFlags, progressFor } from './targets';

const now = new Date('2026-10-30T12:00:00Z');

const profile: Profile = {
  name: 'Test',
  sex: 'male',
  birthYear: 1996,
  heightCm: 180,
  weightKg: 80,
  activityLevel: 'moderate',
  locale: 'fr',
  timezone: 'Europe/Paris',
};

const basePlan: GoalPlan = {
  intentions: 'Réduire le sucre',
  title: 'Moins de sucre',
  summary: '',
  tags: ['reduce_sugar'],
  calorieMode: 'maintain',
  caloriePercent: 0,
  proteinPerKg: 1.2,
  fatPercent: 30,
  rules: [{ nutrient: 'addedSugar', kind: 'max', value: 25, reason: 'OMS' }],
  focus: ['addedSugar', 'sugar'],
  habits: [],
  coachTone: 'gentle',
  adjustForActivity: false,
  overrides: {},
};

describe('energy', () => {
  it('computes Mifflin-St Jeor BMR', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(bmrMifflin(profile, now)).toBe(1780);
  });

  it('uses the activity multiplier for maintenance', () => {
    const energy = computeEnergy(profile, basePlan, { now });
    expect(energy.tdee).toBe(Math.round(1780 * 1.55));
    expect(energy.goalKcal).toBe(2760);
    expect(energy.source).toBe('profile');
  });

  it('applies a deficit but never goes below basal needs', () => {
    const energy = computeEnergy(profile, { ...basePlan, calorieMode: 'deficit', caloriePercent: 20 }, { now });
    expect(energy.goalKcal).toBe(2210);

    const sedentary = { ...profile, activityLevel: 'sedentary' as const };
    const deep = computeEnergy(sedentary, { ...basePlan, calorieMode: 'deficit', caloriePercent: 25 }, { now });
    expect(deep.goalKcal).toBeGreaterThanOrEqual(1780);
  });

  it('switches to measured activity when enabled', () => {
    const plan = { ...basePlan, adjustForActivity: true };
    const energy = computeEnergy(profile, plan, { now, activeKcal: 500 });
    expect(energy.source).toBe('activity');
    expect(energy.tdee).toBe(Math.round(1780 * 1.2 + 500 * 0.8));
  });

  it('honours a manual calorie override', () => {
    const energy = computeEnergy(profile, { ...basePlan, overrides: { kcal: 2000 } }, { now });
    expect(energy.goalKcal).toBe(2000);
  });
});

describe('targets', () => {
  it('derives macros and applies plan rules', () => {
    const { targets } = computeTargets(profile, basePlan, { now });
    expect(targets.protein).toEqual({ value: 96, kind: 'min' });
    expect(targets.addedSugar).toEqual({ value: 25, kind: 'max' });
    expect(targets.sodium.kind).toBe('max');
    const kcalFromMacros = targets.protein.value * 4 + targets.carbs.value * 4 + targets.fat.value * 9;
    expect(Math.abs(kcalFromMacros - targets.kcal.value)).toBeLessThan(15);
  });

  it('reports progress status by target kind', () => {
    expect(progressFor('addedSugar', 30, { value: 25, kind: 'max' }).status).toBe('over');
    expect(progressFor('addedSugar', 10, { value: 25, kind: 'max' }).status).toBe('on_track');
    expect(progressFor('protein', 100, { value: 96, kind: 'min' }).status).toBe('reached');
  });

  it('flags the share of the daily budget used by a meal', () => {
    const { targets } = computeTargets(profile, basePlan, { now });
    const totals = { ...zeroNutrients(), addedSugar: 12.5, sugar: 20 };
    const flags = mealFlags(totals, targets, basePlan);
    expect(flags[0]).toEqual({ nutrient: 'addedSugar', share: 0.5, kind: 'max' });
  });
});

describe('nutrients', () => {
  it('scales per-100g values to a portion', () => {
    const per100g = { ...zeroNutrients(), kcal: 400, sugar: 10 };
    expect(scaleNutrients(per100g, 50)).toMatchObject({ kcal: 200, sugar: 5 });
  });

  it('sanitizes impossible values', () => {
    const clean = sanitizePer100g({ kcal: 250, protein: 10, carbs: 20, sugar: 40, addedSugar: 60, fat: 15, satFat: 30, fiber: 2 });
    expect(clean.sugar).toBe(20);
    expect(clean.addedSugar).toBe(20);
    expect(clean.satFat).toBe(15);
  });

  it('reconciles energy with macros when wildly inconsistent', () => {
    const clean = sanitizePer100g({ kcal: 900, protein: 10, carbs: 10, fat: 1 });
    expect(clean.kcal).toBe(89);
  });

  it('totals a meal', () => {
    const totals = mealTotals([
      { grams: 60, per100g: { ...zeroNutrients(), kcal: 406, sugar: 11 } },
      { grams: 200, per100g: { ...zeroNutrients(), kcal: 46, sugar: 4.8 } },
    ]);
    expect(totals.kcal).toBe(336);
    expect(totals.sugar).toBe(16);
  });
});

describe('dates', () => {
  it('does calendar arithmetic without time zone drift', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dateRange('2026-10-29', '2026-11-01')).toHaveLength(4);
    expect(startOfWeek('2026-10-30')).toBe('2026-10-26');
  });

  it('formats local timestamps with offsets', () => {
    const value = toLocalDateTime(new Date());
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(localHour('2026-10-30T16:05:00+01:00')).toBe(16);
    expect(mealTypeForHour(8)).toBe('breakfast');
    expect(mealTypeForHour(16)).toBe('snack');
  });
});
