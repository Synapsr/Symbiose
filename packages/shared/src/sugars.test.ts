import { describe, expect, it } from 'vitest';

import { zeroNutrients, type Nutrients } from './nutrients';
import type { FoodItem, GoalPlan, Profile } from './schemas';
import {
  CARBS_PER_MEAL,
  carbLoadLevel,
  carbsGuideFor,
  carbsPerMeal,
  clampCarbsPerMeal,
  fruitSugar,
  fruitSugarSignal,
  mealCarbLoad,
  mentionsBloodSugar,
  isReferenceTarget,
  sugarGoal,
} from './sugars';
import { computeTargets } from './targets';

const per100 = (n: Partial<Nutrients>): Nutrients => ({ ...zeroNutrients(), ...n });
const item = (name: string, grams: number, n: Partial<Nutrients>): FoodItem => ({
  id: name,
  name,
  emoji: '',
  portion: '',
  grams,
  per100g: per100(n),
  source: 'ai',
  confidence: 0.8,
  brand: null,
  barcode: null,
});

const orangeJuice = item('Jus d’orange', 250, { kcal: 45, carbs: 10.4, sugar: 8.4, fiber: 0.2 });
const smoothie = item('Smoothie mangue-banane', 250, { kcal: 60, carbs: 13.5, sugar: 11, fiber: 1.1 });
const raisins = item('Raisins secs', 40, { kcal: 299, carbs: 79, sugar: 59, fiber: 3.7 });
const apple = item('Pomme', 150, { kcal: 53, carbs: 11.6, sugar: 10.4, fiber: 2.4 });
const soda = item('Coca-Cola', 330, { kcal: 42, carbs: 10.6, sugar: 10.6, addedSugar: 10.6 });
const toast = item('Tartine beurre', 60, { kcal: 300, carbs: 50, sugar: 4, addedSugar: 2, fiber: 3 });

describe('mentionsBloodSugar', () => {
  it.each([
    'Je suis prédiabétique, je veux faire attention',
    'Ma glycémie à jeun est un peu haute',
    'Diabète de type 2 depuis l’an dernier',
    'Mon médecin parle d’insulinorésistance',
    'résistance à l’insuline',
    'Mon HbA1c est à 6,1',
    'I am prediabetic',
    'keep my blood sugar steady',
    'type 2 diabetes',
  ])('hears « %s »', (text) => {
    expect(mentionsBloodSugar(text)).toBe(true);
  });

  it.each(['Moins de sucre ajouté', 'Perdre 3 kg', 'Arrêter les sodas', 'More protein'])('leaves « %s » alone', (text) => {
    expect(mentionsBloodSugar(text)).toBe(false);
  });
});

describe('carbs per meal', () => {
  it('is off without a guide or the blood-sugar tag', () => {
    expect(carbsPerMeal(null)).toBeNull();
    expect(carbsPerMeal({ tags: ['reduce_sugar'] })).toBeNull();
    expect(carbsPerMeal({ tags: ['reduce_sugar'], carbsPerMeal: null })).toBeNull();
  });

  it('takes the plan’s guide within bounds, or the default with the tag alone', () => {
    expect(carbsPerMeal({ tags: ['blood_sugar'] })).toBe(CARBS_PER_MEAL.default);
    expect(carbsPerMeal({ tags: [], carbsPerMeal: 50 })).toBe(50);
    expect(carbsPerMeal({ tags: [], carbsPerMeal: 110 })).toBe(CARBS_PER_MEAL.max);
    expect(clampCarbsPerMeal(12)).toBe(CARBS_PER_MEAL.min);
    expect(clampCarbsPerMeal(Number.NaN)).toBe(CARBS_PER_MEAL.default);
  });

  it('gives snacks a smaller guide, 15 to 25 g', () => {
    expect(carbsGuideFor('lunch', 45)).toBe(45);
    expect(carbsGuideFor('snack', 45)).toBe(20);
    expect(carbsGuideFor('snack', 30)).toBe(15);
    expect(carbsGuideFor('snack', 60)).toBe(25);
  });

  it('calls a meal within its guide, above it, or a big single load', () => {
    expect(carbLoadLevel(48, 45)).toBe('within');
    expect(carbLoadLevel(58, 45)).toBe('above');
    expect(carbLoadLevel(70, 45)).toBe('high');
  });

  it('measures one meal only in blood-sugar mode', () => {
    const plan = { tags: ['blood_sugar' as const], carbsPerMeal: 45 };
    expect(mealCarbLoad({ mealType: 'dinner', totals: { carbs: 72.4 } }, plan)).toEqual({ carbs: 72, guide: 45, level: 'high' });
    expect(mealCarbLoad({ mealType: 'snack', totals: { carbs: 18 } }, plan)).toEqual({ carbs: 18, guide: 20, level: 'within' });
    expect(mealCarbLoad({ mealType: 'dinner', totals: { carbs: 72 } }, { tags: ['reduce_sugar'] })).toBeNull();
  });

  it('counts as a sugar goal, like added or total sugars in the focus', () => {
    expect(sugarGoal({ focus: ['addedSugar'] })).toBe(true);
    expect(sugarGoal({ focus: ['sugar', 'kcal'] })).toBe(true);
    expect(sugarGoal({ focus: ['carbs', 'fiber'], tags: ['blood_sugar'] })).toBe(true);
    expect(sugarGoal({ focus: ['protein'] })).toBe(false);
    expect(sugarGoal(null)).toBe(false);
  });
});

describe('isReferenceTarget', () => {
  it('calls total sugars and carbs a « repère » unless the plan set a rule for them', () => {
    expect(isReferenceTarget({ rules: [] }, 'sugar')).toBe(true);
    expect(isReferenceTarget(null, 'carbs')).toBe(true);
    expect(isReferenceTarget({ rules: [{ nutrient: 'carbs', kind: 'max', value: 180, reason: '' }] }, 'carbs')).toBe(false);
    expect(isReferenceTarget({ rules: [] }, 'addedSugar')).toBe(false);
  });
});

describe('fruit sugar', () => {
  it('adds up juice, smoothies and dried fruit, not whole fruit', () => {
    expect(fruitSugar([orangeJuice, apple, raisins])).toEqual({ grams: 45, sources: ['Jus d’orange', 'Raisins secs'], addedElsewhere: 0 });
  });

  it('recognises very sweet dried fruit by its numbers when its name does not say', () => {
    expect(fruitSugar([item('Dattes Medjool', 50, { carbs: 75, sugar: 66, fiber: 6.7 })]).grams).toBe(33);
    expect(fruitSugar([item('Mélange du randonneur', 50, { carbs: 50, sugar: 45, fiber: 5 })]).grams).toBe(23);
  });

  it('flags a meal from 20 g and a day from 30 g when added sugars stay low', () => {
    expect(fruitSugarSignal([orangeJuice, toast], 'meal')).toEqual({ grams: 21, sources: ['Jus d’orange'] });
    expect(fruitSugarSignal([orangeJuice, toast], 'day')).toBeNull();
    expect(fruitSugarSignal([orangeJuice, smoothie], 'day')).toEqual({ grams: 49, sources: ['Jus d’orange', 'Smoothie mangue-banane'] });
  });

  it('stays quiet for whole fruit, and when added sugar is the bigger story', () => {
    expect(fruitSugarSignal([apple, apple], 'meal')).toBeNull();
    expect(fruitSugarSignal([orangeJuice, soda], 'meal')).toBeNull();
  });

  it('still flags juice the analyst counted as free sugar', () => {
    const counted = item('Orange juice', 300, { kcal: 45, carbs: 10.4, sugar: 8.4, addedSugar: 8.4, fiber: 0.2 });
    expect(fruitSugarSignal([counted, toast], 'meal')).toEqual({ grams: 25, sources: ['Orange juice'] });
  });
});

describe('carbs and sugars targets', () => {
  const profile: Profile = { name: 'T', sex: 'female', birthYear: 1970, heightCm: 165, weightKg: 70, activityLevel: 'light', locale: 'fr', timezone: 'Europe/Paris' };
  const plan = (patch: Partial<GoalPlan>): GoalPlan => ({
    intentions: '',
    title: '',
    summary: '',
    tags: [],
    calorieMode: 'maintain',
    caloriePercent: 0,
    proteinPerKg: 1,
    fatPercent: 30,
    rules: [],
    focus: ['protein'],
    habits: [],
    coachTone: 'gentle',
    adjustForActivity: false,
    overrides: {},
    activity: null,
    ...patch,
  });
  const now = new Date('2026-11-04T12:00:00Z');

  it('keeps carbs as the energy left when sugar is not the goal', () => {
    const { targets } = computeTargets(profile, plan({}), { now });
    expect(targets.carbs.kind).toBe('target');
  });

  it('turns carbs into a « repère » within 45–60 % of energy for a sugar goal, macros still adding up', () => {
    const { targets, energy } = computeTargets(profile, plan({ focus: ['addedSugar'] }), { now });
    expect(targets.carbs.kind).toBe('max');
    expect(targets.carbs.value * 4).toBeGreaterThanOrEqual(energy.goalKcal * 0.45 - 4);
    expect(targets.carbs.value * 4).toBeLessThanOrEqual(energy.goalKcal * 0.6 + 4);
    expect(Math.abs(targets.protein.value * 4 + targets.carbs.value * 4 + targets.fat.value * 9 - energy.goalKcal)).toBeLessThan(15);
    // A very high protein share leaves less: the repère never drops under 45 % of energy.
    const lean = computeTargets(profile, plan({ focus: ['addedSugar'], proteinPerKg: 2.4, fatPercent: 45 }), { now });
    expect(lean.targets.carbs.value).toBe(Math.round((lean.energy.goalKcal * 0.45) / 4));
    // Total sugars: 90 g at 2000 kcal, the label's reference intake.
    expect(targets.sugar).toEqual({ value: Math.round(energy.goalKcal * 0.045), kind: 'max' });
  });

  it('keeps carbs to 45 % of energy in blood-sugar mode, a rule still winning', () => {
    const bloodSugar = plan({ tags: ['blood_sugar'], focus: ['carbs', 'fiber', 'sugar'], carbsPerMeal: 45 });
    const { targets, energy } = computeTargets(profile, bloodSugar, { now });
    expect(targets.carbs).toEqual({ value: Math.round((energy.goalKcal * 0.45) / 4), kind: 'max' });
    const ruled = computeTargets(profile, { ...bloodSugar, rules: [{ nutrient: 'carbs', kind: 'max', value: 160, reason: '' }] }, { now });
    expect(ruled.targets.carbs).toEqual({ value: 160, kind: 'max' });
  });
});
