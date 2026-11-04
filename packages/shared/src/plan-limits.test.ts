import { describe, expect, it } from 'vitest';

import { clampActivityGoals, clampRuleValue, ruleStep, sanitizePlan } from './plan-limits';
import type { GoalPlan } from './schemas';
import { goalNutrient } from './targets';

const plan: GoalPlan = {
  intentions: '',
  title: 'Plan',
  summary: '',
  tags: ['reduce_sugar'],
  calorieMode: 'maintain',
  caloriePercent: 0,
  proteinPerKg: 1.2,
  fatPercent: 30,
  rules: [{ nutrient: 'addedSugar', kind: 'max', value: 25, reason: '' }],
  focus: ['addedSugar'],
  habits: [],
  coachTone: 'gentle',
  adjustForActivity: false,
  overrides: {},
  activity: null,
};

describe('plan limits', () => {
  it('keeps hand-edited numbers within realistic bounds', () => {
    expect(clampRuleValue('addedSugar', -5)).toBe(0);
    expect(clampRuleValue('sodium', 9000)).toBe(6000);
    expect(clampRuleValue('fiber', 31.6)).toBe(32);
    expect(ruleStep('sodium')).toBe(100);
    expect(ruleStep('addedSugar')).toBe(5);
    expect(clampActivityGoals({ weeklyActiveMinutes: 20, dailySteps: 0, weeklyStrengthSessions: 9 })).toEqual({ weeklyActiveMinutes: 60, dailySteps: null, weeklyStrengthSessions: 6 });
    expect(clampActivityGoals(null)).toBeNull();
  });

  it('never lets a rule set the energy, nor a manual target fall below the floor', () => {
    const safe = sanitizePlan({ ...plan, rules: [...plan.rules, { nutrient: 'kcal', kind: 'max', value: 900, reason: '' }], overrides: { kcal: 800, protein: 10 } });
    expect(safe.rules.map((r) => r.nutrient)).toEqual(['addedSugar']);
    expect(safe.overrides).toEqual({ kcal: 1200, protein: 30 });
  });

  it('keeps the carbs-per-meal guide within the advice, and leaves it out when the plan has none', () => {
    expect(sanitizePlan({ ...plan, carbsPerMeal: 140 }).carbsPerMeal).toBe(60);
    expect(sanitizePlan({ ...plan, carbsPerMeal: 47 }).carbsPerMeal).toBe(45);
    expect(sanitizePlan({ ...plan, carbsPerMeal: null }).carbsPerMeal).toBeNull();
    expect('carbsPerMeal' in sanitizePlan(plan)).toBe(false);
  });
});

describe('the goal metric', () => {
  it('follows the first focus, calories included, unless they are hidden', () => {
    expect(goalNutrient(plan)).toBe('addedSugar');
    expect(goalNutrient({ focus: ['kcal', 'protein'] })).toBe('kcal');
    expect(goalNutrient({ focus: ['kcal', 'protein'] }, true)).toBe('protein');
    expect(goalNutrient({ focus: ['kcal'] }, true)).toBe('protein');
    expect(goalNutrient(null)).toBe('kcal');
  });
});
