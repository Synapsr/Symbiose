import type { GoalPlan, NutrientKey } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { dragPosition, heroBars, heroChoice, heroIndex, heroPages, rubberBand, snapPage } from './hero-logic';

type Plan = Pick<GoalPlan, 'focus' | 'rules'>;
const rule = (nutrient: NutrientKey, kind: 'max' | 'min', value: number) => ({ nutrient, kind, value, reason: '' });
// « Moins de sucre, et perdre 2 kg »: added sugar leads, calories follow, saturated fat is watched.
const sugar: Plan = { focus: ['addedSugar', 'kcal'], rules: [rule('addedSugar', 'max', 25), rule('satFat', 'max', 18)] };

describe('heroPages', () => {
  it('opens on the goal, then the focus, calories, the rules, protein and fibre', () => {
    const plan: Plan = { focus: ['protein', 'kcal'], rules: [rule('satFat', 'max', 18)] };
    expect(heroPages(plan, false)).toEqual(['protein', 'kcal', 'satFat', 'fiber']);
  });

  it('follows added sugars with total sugars, then carbs, when the goal is about sugar', () => {
    expect(heroPages(sugar, false)).toEqual(['addedSugar', 'sugar', 'carbs', 'kcal', 'satFat', 'protein', 'fiber']);
  });

  it('gathers the sugar family where it first appears, even after calories', () => {
    const plan: Plan = { focus: ['kcal', 'addedSugar'], rules: [rule('carbs', 'max', 200), rule('sugar', 'max', 60)] };
    expect(heroPages(plan, false)).toEqual(['kcal', 'addedSugar', 'sugar', 'carbs', 'protein', 'fiber']);
  });

  it('opens on total sugars then carbs when total sugars are the goal, added sugars only if the plan names them', () => {
    expect(heroPages({ focus: ['sugar'], rules: [] }, false)).toEqual(['sugar', 'carbs', 'kcal', 'protein', 'fiber']);
    expect(heroPages({ focus: ['sugar'], rules: [rule('addedSugar', 'max', 25)] }, false)).toEqual(['sugar', 'carbs', 'addedSugar', 'kcal', 'protein', 'fiber']);
  });

  it('leads with carbs, then total sugars, in blood-sugar mode', () => {
    const plan = { focus: ['carbs', 'fiber'] as NutrientKey[], rules: [rule('fiber', 'min', 30)], tags: ['blood_sugar' as const], carbsPerMeal: 45 };
    expect(heroPages(plan, true)).toEqual(['carbs', 'sugar', 'fiber', 'protein']);
  });

  it('leaves the sugar family alone when the goal is not about sugar', () => {
    const plan: Plan = { focus: ['protein'], rules: [rule('sugar', 'max', 50)] };
    expect(heroPages(plan, false)).toEqual(['protein', 'kcal', 'sugar', 'fiber']);
  });

  it('keeps the plan’s focus order and never repeats a page', () => {
    const plan: Plan = { focus: ['protein', 'fiber', 'kcal'], rules: [rule('protein', 'min', 120), rule('sodium', 'max', 2000)] };
    expect(heroPages(plan, false)).toEqual(['protein', 'fiber', 'kcal', 'sodium']);
  });

  it('puts calories right after the focus when the plan does not name them', () => {
    const plan: Plan = { focus: ['fiber'], rules: [rule('sugar', 'max', 50)] };
    expect(heroPages(plan, false)).toEqual(['fiber', 'kcal', 'sugar', 'protein']);
  });

  it('leaves hidden calories out, even when the plan puts them first', () => {
    expect(heroPages(sugar, true)).toEqual(['addedSugar', 'sugar', 'carbs', 'satFat', 'protein', 'fiber']);
    expect(heroPages({ focus: ['kcal'], rules: [] }, true)).toEqual(['protein', 'fiber']);
  });

  it('has calories, protein and fibre before any plan', () => {
    expect(heroPages(null, false)).toEqual(['kcal', 'protein', 'fiber']);
    expect(heroPages(null, true)).toEqual(['protein', 'fiber']);
  });
});

describe('heroIndex and heroChoice', () => {
  const pages = heroPages(sugar, false);

  it('opens on the goal until a page is chosen', () => {
    expect(heroIndex(pages, null)).toBe(0);
  });

  it('remembers the chosen page, from one day to the next', () => {
    const saved = heroChoice(pages, 1);
    expect(saved).toEqual({ nutrient: 'sugar', goal: 'addedSugar' });
    expect(heroIndex(pages, saved)).toBe(1);
  });

  it('forgets nothing when back on the goal: there is simply no choice to keep', () => {
    expect(heroChoice(pages, 0)).toBeNull();
  });

  it('follows the nutrient, not the position, when the pages change', () => {
    const saved = heroChoice(pages, 5); // protein
    expect(heroIndex(heroPages(sugar, true), saved)).toBe(4);
  });

  it('falls back to the goal when the chosen page is gone (calories hidden since)', () => {
    const saved = heroChoice(pages, 3); // calories
    expect(heroIndex(heroPages(sugar, true), saved)).toBe(0);
  });

  it('opens a new goal on its own nutrient', () => {
    const saved = heroChoice(pages, 5); // protein, chosen under the sugar goal
    const next = heroPages({ focus: ['fiber', 'kcal'], rules: [] }, false);
    expect(heroIndex(next, saved)).toBe(0);
  });
});

describe('heroBars', () => {
  const pages = heroPages(sugar, false);

  it('shows the next pages beside the goal’s ring: total sugars and carbs around added sugars', () => {
    expect(heroBars(pages, 'addedSugar')).toEqual(['sugar', 'carbs', 'kcal']);
  });

  it('keeps the goal as the first bar on every other page', () => {
    expect(heroBars(pages, 'kcal')).toEqual(['addedSugar', 'sugar', 'carbs']);
    expect(heroBars(pages, 'fiber')).toEqual(['addedSugar', 'sugar', 'carbs']);
  });

  it('shows fewer bars when there are fewer pages', () => {
    expect(heroBars(heroPages(null, true), 'protein')).toEqual(['fiber']);
  });
});

describe('snapPage', () => {
  it('comes back after a short, slow drag', () => {
    expect(snapPage(1.3, 0, 1, 5)).toBe(1);
    expect(snapPage(0.75, -0.2, 1, 5)).toBe(1);
  });

  it('turns the page after a slow drag past a third of it', () => {
    expect(snapPage(1.4, 0, 1, 5)).toBe(2);
    expect(snapPage(0.6, 0.2, 1, 5)).toBe(0);
  });

  it('turns the page on a flick, even short of half way', () => {
    expect(snapPage(1.15, 2, 1, 5)).toBe(2);
    expect(snapPage(0.85, -2, 1, 5)).toBe(0);
  });

  it('comes back when the flick goes against the drag', () => {
    expect(snapPage(1.3, -2, 1, 5)).toBe(1);
  });

  it('turns one page per swipe and stays within the pages', () => {
    expect(snapPage(2.9, 5, 1, 5)).toBe(2);
    expect(snapPage(-0.2, -3, 0, 5)).toBe(0);
    expect(snapPage(4.2, 3, 4, 5)).toBe(4);
  });
});

describe('dragPosition', () => {
  it('follows the finger between the first and the last page', () => {
    expect(dragPosition(1, 0.5, 4)).toBe(1.5);
  });

  it('holds back past the ends, less and less', () => {
    const a = dragPosition(0, -0.2, 4);
    const b = dragPosition(0, -0.6, 4);
    expect(a).toBeLessThan(0);
    expect(a).toBeGreaterThan(-0.2);
    // The next 0.4 page of finger moves the card by much less, but still a little.
    expect(b).toBeLessThan(a);
    expect(a - b).toBeLessThan(0.2);
    expect(dragPosition(3, 0.3, 4)).toBeCloseTo(3 + rubberBand(0.3));
  });
});
