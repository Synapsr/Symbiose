import { describe, expect, it } from 'vitest';

import { daySteps } from './activity';

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
