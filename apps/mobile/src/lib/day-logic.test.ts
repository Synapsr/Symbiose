import { computeProgress, zeroNutrients, type DaySummary, type Meal, type Targets } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { momentOn, withoutMeal } from './day-logic';
import { keepTogether } from './format';

describe('momentOn', () => {
  const now = new Date(2026, 9, 30, 16, 5);

  it('is now for today', () => {
    expect(momentOn('2026-10-30', now)).toBe(now);
  });

  it('is this time of day on a past day', () => {
    const at = momentOn('2026-10-28', now);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 9, 28, 16, 5]);
  });
});

describe('withoutMeal', () => {
  const targets = Object.fromEntries(
    Object.keys(zeroNutrients()).map((key) => [key, { value: key === 'addedSugar' ? 25 : 100, kind: key === 'addedSugar' ? 'max' : 'target' }]),
  ) as Targets;
  const totals = { ...zeroNutrients(), kcal: 900, addedSugar: 40 };
  const coca = { id: 'coca', totals: { ...zeroNutrients(), kcal: 140, addedSugar: 35 } } as Meal;
  const day = { totals, progress: computeProgress(totals, targets), meals: [coca, { id: 'soup' } as Meal] } as DaySummary;

  it('takes the meal out of the list, the totals and the progress', () => {
    const after = withoutMeal(day, coca);
    expect(after.meals.map((m) => m.id)).toEqual(['soup']);
    expect(after.totals.kcal).toBe(760);
    const sugar = after.progress.find((p) => p.nutrient === 'addedSugar')!;
    expect(sugar.consumed).toBe(5);
    expect(sugar.status).toBe('on_track');
  });

  it('never goes below zero', () => {
    expect(withoutMeal({ ...day, totals: zeroNutrients() }, coca).totals.addedSugar).toBe(0);
  });
});

describe('keepTogether', () => {
  it('keeps French punctuation with its word', () => {
    expect(keepTogether('Comment tu t’appelles ?')).toBe('Comment tu t’appelles ?');
    expect(keepTogether('Pour l’écrire, touche « + ».')).toBe('Pour l’écrire, touche « + ».');
    expect(keepTogether('Pas de drame : on avance', true)).toBe('Pas de drame : on avance');
  });

  it('leaves times and English alone', () => {
    expect(keepTogether('20:15 · Dîner')).toBe('20:15 · Dîner');
    expect(keepTogether('Clear the conversation?')).toBe('Clear the conversation?');
  });
});
