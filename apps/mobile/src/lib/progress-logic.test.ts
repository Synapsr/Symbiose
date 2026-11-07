import type { StreakSummary } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { familyRatio, flameDue, flameLine, streakReminders } from './progress-logic';

const today = '2026-11-06';
const copy = { title: (n: number) => `Série de ${n} jours`, later: 'Ta série t’attend', body: 'Un repas suffit.' };
const streak = (patch: Partial<StreakSummary>): StreakSummary => ({ current: 5, best: 5, restDays: 0, nextRestIn: 2, todayLogged: false, week: [], ...patch });
const at = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

describe('familyRatio', () => {
  it('reads like its label: 14 / 28 is half full', () => {
    expect(familyRatio({ family: 'streak', count: 14, next: 28 })).toBe(0.5);
    expect(familyRatio({ family: 'streak', count: 0, next: 3 })).toBe(0);
  });

  it('is full once every step is reached', () => {
    expect(familyRatio({ family: 'cravings', count: 140, next: null })).toBe(1);
  });
});

describe('flameDue', () => {
  it('celebrates the flame once a day, after the day’s first meal', () => {
    expect(flameDue({ today, streak: streak({ todayLogged: true }) }, '2026-11-05')).toBe(true);
    expect(flameDue({ today, streak: streak({ todayLogged: true }) }, today)).toBe(false);
    expect(flameDue({ today, streak: streak({ todayLogged: false }) }, '')).toBe(false);
  });
});

describe('flameLine', () => {
  const families = (next: number | null) => [{ family: 'streak' as const, count: 0, next }];
  const line = (patch: Partial<StreakSummary>, next: number | null = 7, step = false) => flameLine({ streak: streak(patch), families: families(next) }, step);

  it('welcomes a first run, and remembers the record when a new one starts', () => {
    expect(line({ current: 1, best: 1 })).toEqual({ key: 'flame.first' });
    expect(line({ current: 1, best: 12 })).toEqual({ key: 'flame.again', best: 12 });
  });

  it('points at the record, then at the next step past it', () => {
    expect(line({ current: 4, best: 9 })).toEqual({ key: 'flame.toRecord', count: 6 });
    expect(line({ current: 5, best: 5 }, 7)).toEqual({ key: 'flame.recordNext', count: 2, next: 7 });
    expect(line({ current: 400, best: 400 }, null)).toEqual({ key: 'flame.record' });
  });

  it('announces the step when one was just reached', () => {
    expect(line({ current: 7, best: 7 }, 14, true)).toEqual({ key: 'flame.step' });
  });
});

describe('streakReminders', () => {
  it('reminds tonight while the run waits for its meal, and tomorrow when a rest day keeps it', () => {
    const planned = streakReminders(streak({ restDays: 1 }), today, at('12:00'), copy);
    expect(planned.map((r) => [r.id, r.time, r.title])).toEqual([
      ['streak.2026-11-06', '20:30', 'Série de 5 jours'],
      ['streak.2026-11-07', '20:30', 'Ta série t’attend'],
    ]);
  });

  it('says nothing tonight once today counts', () => {
    const planned = streakReminders(streak({ todayLogged: true }), today, at('12:00'), copy);
    expect(planned.map((r) => r.date)).toEqual(['2026-11-07']);
  });

  it('leaves a run of one day alone, and the evening once it has passed', () => {
    expect(streakReminders(streak({ current: 1 }), today, at('12:00'), copy)).toEqual([]);
    expect(streakReminders(streak({}), today, at('21:00'), copy)).toEqual([]);
  });

  it('plans nothing for a run that ends tonight without a rest day, past tonight', () => {
    expect(streakReminders(streak({}), today, at('12:00'), copy).map((r) => r.date)).toEqual([today]);
  });
});
