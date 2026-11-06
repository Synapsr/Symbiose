import { describe, expect, it } from 'vitest';

import { countsSteps, daySteps, estimateWorkoutKcal, minutesFromSteps } from './activity';

describe('daySteps', () => {
  it('adds up the sessions added by hand when the health store has nothing', () => {
    expect(daySteps(null, [{ steps: 6000 }, { steps: null }, { steps: 2500 }])).toBe(8500);
    expect(daySteps(undefined, [{ steps: 6000 }])).toBe(6000);
  });

  it('never adds them to the health store: the phone may have counted that walk', () => {
    expect(daySteps(9400, [{ steps: 6000 }])).toBe(9400);
    expect(daySteps(9400, [{ steps: 6000 }, { steps: 2000 }])).toBe(9400);
  });

  it('keeps a walk the store missed (phone left at home, a store saying 0)', () => {
    expect(daySteps(1200, [{ steps: 6000 }])).toBe(6000);
    expect(daySteps(0, [{ steps: 6000 }])).toBe(6000);
  });

  it('is null only when neither says anything', () => {
    expect(daySteps(null, [])).toBeNull();
    expect(daySteps(null, [{ steps: null }])).toBeNull();
    expect(daySteps(0, [])).toBe(0);
    expect(daySteps(4200, [{ steps: null }])).toBe(4200);
  });
});

describe('minutesFromSteps', () => {
  it('estimates a walk or a run from its cadence', () => {
    // 100 steps/min for a moderate walk, 80 for a stroll, 160 for a run.
    expect(minutesFromSteps('walking', 'moderate', 6000)).toBe(60);
    expect(minutesFromSteps('walking', 'light', 6000)).toBe(75);
    expect(minutesFromSteps('walking', 'vigorous', 6000)).toBe(50);
    expect(minutesFromSteps('running', 'moderate', 8000)).toBe(50);
  });

  it('stays within what a session can last', () => {
    expect(minutesFromSteps('running', 'vigorous', 20)).toBe(1);
    expect(minutesFromSteps('walking', 'light', 200_000)).toBe(1440);
  });

  it('feeds the energy estimate like a duration would', () => {
    // (3.5 − 1 MET) × 70 kg × 1 h.
    expect(estimateWorkoutKcal('walking', 'moderate', minutesFromSteps('walking', 'moderate', 6000), 70)).toBe(175);
  });
});

describe('countsSteps', () => {
  it('is for walks and runs only', () => {
    expect(countsSteps('walking')).toBe(true);
    expect(countsSteps('running')).toBe(true);
    expect(countsSteps('cycling')).toBe(false);
    expect(countsSteps('other')).toBe(false);
  });
});
