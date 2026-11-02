import type { GoalPlan, NutrientKey } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { dragPosition, heroBars, heroChoice, heroIndex, heroPages, rubberBand, snapPage } from './hero-logic';

type Plan = Pick<GoalPlan, 'focus' | 'rules'>;
const rule = (nutrient: NutrientKey, kind: 'max' | 'min', value: number) => ({ nutrient, kind, value, reason: '' });
// « Moins de sucre, et perdre 2 kg »: added sugar leads, calories follow, saturated fat is watched.
const sugar: Plan = { focus: ['addedSugar', 'kcal'], rules: [rule('addedSugar', 'max', 25), rule('satFat', 'max', 18)] };

describe('heroPages', () => {
  it('opens on the goal, then the focus, calories, the rules, protein and fibre', () => {
    expect(heroPages(sugar, false)).toEqual(['addedSugar', 'kcal', 'satFat', 'protein', 'fiber']);
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
    expect(heroPages(sugar, true)).toEqual(['addedSugar', 'satFat', 'protein', 'fiber']);
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
    expect(saved).toEqual({ nutrient: 'kcal', goal: 'addedSugar' });
    expect(heroIndex(pages, saved)).toBe(1);
  });

  it('forgets nothing when back on the goal: there is simply no choice to keep', () => {
    expect(heroChoice(pages, 0)).toBeNull();
  });

  it('follows the nutrient, not the position, when the pages change', () => {
    const saved = heroChoice(pages, 3); // protein
    expect(heroIndex(heroPages(sugar, true), saved)).toBe(2);
  });

  it('falls back to the goal when the chosen page is gone (calories hidden since)', () => {
    const saved = heroChoice(pages, 1); // calories
    expect(heroIndex(heroPages(sugar, true), saved)).toBe(0);
  });

  it('opens a new goal on its own nutrient', () => {
    const saved = heroChoice(pages, 3); // protein, chosen under the sugar goal
    const next = heroPages({ focus: ['fiber', 'kcal'], rules: [] }, false);
    expect(heroIndex(next, saved)).toBe(0);
  });
});

describe('heroBars', () => {
  const pages = heroPages(sugar, false);

  it('shows the next pages beside the goal’s ring, calories first as before', () => {
    expect(heroBars(pages, 'addedSugar')).toEqual(['kcal', 'satFat', 'protein']);
  });

  it('keeps the goal as the first bar on every other page', () => {
    expect(heroBars(pages, 'kcal')).toEqual(['addedSugar', 'satFat', 'protein']);
    expect(heroBars(pages, 'fiber')).toEqual(['addedSugar', 'kcal', 'satFat']);
  });

  it('shows fewer bars when there are fewer pages', () => {
    expect(heroBars(heroPages(null, true), 'protein')).toEqual(['fiber']);
  });
});

describe('snapPage', () => {
  it('settles on the nearest page after a slow release', () => {
    expect(snapPage(1.4, 0, 1, 5)).toBe(1);
    expect(snapPage(1.6, 0.2, 1, 5)).toBe(2);
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
