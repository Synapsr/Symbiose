import type { GoalPlan, NutrientKey } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { dragPosition, HERO_MAX, HERO_ORDER, heroChoice, heroDefaults, heroIndex, heroPages, rubberBand, snapPage, toggleHero } from './hero-logic';

type Plan = Pick<GoalPlan, 'focus' | 'rules'>;
const rule = (nutrient: NutrientKey, kind: 'max' | 'min', value: number) => ({ nutrient, kind, value, reason: '' });
// « Moins de sucre, et perdre 2 kg »: added sugar leads, calories follow, saturated fat is watched.
const sugar: Plan = { focus: ['addedSugar', 'kcal'], rules: [rule('addedSugar', 'max', 25), rule('satFat', 'max', 18)] };

describe('heroPages', () => {
  it('reads the day simply by default: the goal, calories, protein and fibre', () => {
    expect(heroPages(sugar, false)).toEqual(['addedSugar', 'kcal', 'protein', 'fiber']);
  });

  it('adds the plan’s focus, in its order, and never repeats a page', () => {
    expect(heroPages({ focus: ['protein', 'fiber', 'kcal'], rules: [rule('sodium', 'max', 2000)] }, false)).toEqual(['protein', 'fiber', 'kcal']);
    expect(heroPages({ focus: ['fiber', 'sugar'], rules: [] }, false)).toEqual(['fiber', 'sugar', 'kcal', 'protein']);
  });

  it('leads with carbs in blood-sugar mode, without the other sugars unless chosen', () => {
    const plan = { focus: ['carbs', 'fiber'] as NutrientKey[], rules: [rule('fiber', 'min', 30)], tags: ['blood_sugar' as const], carbsPerMeal: 45 };
    expect(heroPages(plan, true)).toEqual(['carbs', 'fiber', 'protein']);
  });

  it('leaves hidden calories out, even when the plan puts them first', () => {
    expect(heroPages(sugar, true)).toEqual(['addedSugar', 'protein', 'fiber']);
    expect(heroPages({ focus: ['kcal'], rules: [] }, true)).toEqual(['protein', 'fiber']);
  });

  it('has calories, protein and fibre before any plan', () => {
    expect(heroPages(null, false)).toEqual(['kcal', 'protein', 'fiber']);
    expect(heroPages(null, true)).toEqual(['protein', 'fiber']);
  });
});

describe('the rings chosen with a long press', () => {
  it('replace the default after the goal, in the choice’s order', () => {
    expect(heroPages(sugar, false, ['fiber', 'sodium', 'protein'])).toEqual(['addedSugar', 'protein', 'fiber', 'sodium']);
  });

  it('keep the sugars side by side after the goal’s: total sugars, then carbs', () => {
    expect(heroPages(sugar, false, ['carbs', 'kcal', 'sugar', 'fiber'])).toEqual(['addedSugar', 'sugar', 'carbs', 'kcal', 'fiber']);
    expect(heroPages({ focus: ['carbs'], rules: [] }, false, ['addedSugar', 'sugar', 'protein'])).toEqual(['carbs', 'sugar', 'addedSugar', 'protein']);
  });

  it('always start with the goal, and still hide hidden calories', () => {
    expect(heroPages(sugar, true, ['kcal', 'protein'])).toEqual(['addedSugar', 'protein']);
    expect(heroPages(sugar, false, [])).toEqual(['addedSugar']);
  });

  it('hold six rings at most', () => {
    expect(HERO_MAX).toBe(6);
    expect(heroPages(sugar, false, [...HERO_ORDER])).toEqual(['addedSugar', 'sugar', 'carbs', 'kcal', 'protein', 'fiber']);
  });

  it('start from the default, without the goal', () => {
    expect(heroDefaults(sugar, false)).toEqual(['kcal', 'protein', 'fiber']);
  });

  it('tick and untick a nutrient, never the goal, and stop at six with the goal', () => {
    expect(toggleHero(['kcal', 'protein'], 'carbs', 'addedSugar')).toEqual(['kcal', 'protein', 'carbs']);
    expect(toggleHero(['kcal', 'protein'], 'kcal', 'addedSugar')).toEqual(['protein']);
    expect(toggleHero(['kcal'], 'addedSugar', 'addedSugar')).toEqual(['kcal']);
    const full: NutrientKey[] = ['kcal', 'protein', 'fiber', 'sugar', 'carbs'];
    expect(toggleHero(full, 'sodium', 'addedSugar')).toEqual(full);
  });
});

describe('heroIndex and heroChoice', () => {
  const pages = heroPages(sugar, false);

  it('opens on the goal until a page is chosen', () => {
    expect(heroIndex(pages, null)).toBe(0);
  });

  it('remembers the chosen page, from one day to the next', () => {
    const saved = heroChoice(pages, 2);
    expect(saved).toEqual({ nutrient: 'protein', goal: 'addedSugar' });
    expect(heroIndex(pages, saved)).toBe(2);
  });

  it('forgets nothing when back on the goal: there is simply no choice to keep', () => {
    expect(heroChoice(pages, 0)).toBeNull();
  });

  it('follows the nutrient, not the position, when the pages change', () => {
    const saved = heroChoice(pages, 2); // protein
    expect(heroIndex(heroPages(sugar, true), saved)).toBe(1);
  });

  it('falls back to the goal when the chosen page is gone (calories hidden since)', () => {
    const saved = heroChoice(pages, 1); // calories
    expect(heroIndex(heroPages(sugar, true), saved)).toBe(0);
  });

  it('opens a new goal on its own nutrient', () => {
    const saved = heroChoice(pages, 2); // protein, chosen under the sugar goal
    const next = heroPages({ focus: ['fiber', 'kcal'], rules: [] }, false);
    expect(heroIndex(next, saved)).toBe(0);
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
