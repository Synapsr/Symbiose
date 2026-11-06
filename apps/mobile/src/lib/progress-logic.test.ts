import type { StreakSummary } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { familyRatio, streakReminders } from './progress-logic';

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
