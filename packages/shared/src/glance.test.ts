import { describe, expect, it } from 'vitest';

import { heroNutrient } from './glance';
import type { GoalPlan, NutrientProgress } from './schemas';
import { progressFor } from './targets';

const plan = (patch: Partial<GoalPlan>): GoalPlan => ({
  intentions: '',
  title: '',
  summary: '',
  tags: [],
  calorieMode: 'maintain',
  caloriePercent: 0,
  proteinPerKg: 1.2,
  fatPercent: 30,
  rules: [],
  focus: ['kcal'],
  habits: [],
  coachTone: 'gentle',
  adjustForActivity: false,
  overrides: {},
  activity: null,
  ...patch,
});

// Server order: calories, then the focus nutrients, then the rest.
const progress: NutrientProgress[] = [
  progressFor('kcal', 1395, { value: 1840, kind: 'target' }),
  progressFor('protein', 65, { value: 120, kind: 'min' }),
  progressFor('fiber', 15, { value: 26, kind: 'min' }),
];

describe('heroNutrient', () => {
  it('follows the first focus nutrient, even when the plan also loses weight', () => {
    const sugarAndWeight = plan({ calorieMode: 'deficit', caloriePercent: 15, focus: ['addedSugar', 'kcal'] });
    expect(heroNutrient(progress, sugarAndWeight, false)).toBe('addedSugar');
    expect(heroNutrient(progress, sugarAndWeight, true)).toBe('addedSugar');
  });

  it('shows calories when the plan puts them first, or without a plan', () => {
    expect(heroNutrient(progress, plan({ calorieMode: 'deficit', focus: ['kcal', 'protein'] }), false)).toBe('kcal');
    expect(heroNutrient(progress, null, false)).toBe('kcal');
  });

  it('falls back to the next focus nutrient when calories are hidden', () => {
    expect(heroNutrient(progress, plan({ focus: ['kcal', 'fiber'] }), true)).toBe('fiber');
    expect(heroNutrient(progress, plan({ focus: ['kcal'] }), true)).toBe('protein');
    expect(heroNutrient(progress, null, true)).toBe('protein');
  });
});
