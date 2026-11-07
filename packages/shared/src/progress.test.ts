import { describe, expect, it } from 'vitest';

import { addDays, dateRange } from './dates';
import { MAX_REST_DAYS, milestoneDue, progressSummary, streakSummary } from './progress';

const today = '2026-11-06';
/** `n` days in a row ending `end` (inclusive). */
const run = (n: number, end = today) => dateRange(addDays(end, -(n - 1)), end);

describe('streakSummary', () => {
  it('starts at zero with nothing logged', () => {
    const s = streakSummary([], today);
    expect(s).toMatchObject({ current: 0, best: 0, restDays: 0, todayLogged: false });
    expect(s.week.map((d) => d.state)).toEqual(['missed', 'missed', 'missed', 'missed', 'missed', 'missed', 'open']);
  });

  it('counts the days in a row, today included', () => {
    expect(streakSummary(run(4), today)).toMatchObject({ current: 4, best: 4, todayLogged: true });
  });

  it('keeps the run while today is still open', () => {
    const s = streakSummary(run(4, addDays(today, -1)), today);
    expect(s).toMatchObject({ current: 4, todayLogged: false });
    expect(s.week.at(-1)).toEqual({ date: today, state: 'open' });
  });

  it('breaks after a missed day without a rest day', () => {
    const days = [...run(5, addDays(today, -3)), addDays(today, -1)];
    expect(streakSummary(days, today)).toMatchObject({ current: 1, best: 5 });
  });

  it('earns a rest day every 7 days and spends it on a missed day', () => {
    // 7 days, a gap, 2 more days: the gap is covered.
    const days = [...run(7, addDays(today, -3)), addDays(today, -1), today];
    const s = streakSummary(days, today);
    expect(s.current).toBe(9);
    expect(s.restDays).toBe(0);
    expect(s.week.find((d) => d.date === addDays(today, -2))?.state).toBe('rest');
  });

  it('keeps at most two rest days, and covers two days in a row with them', () => {
    const full = streakSummary(run(30), today);
    expect(full.restDays).toBe(MAX_REST_DAYS);
    expect(full.nextRestIn).toBe(0);
    const days = [...run(21, addDays(today, -3)), today];
    expect(streakSummary(days, today)).toMatchObject({ current: 22, restDays: 0 });
  });

  it('breaks when the gap is longer than the reserve', () => {
    const days = [...run(14, addDays(today, -4)), today];
    expect(streakSummary(days, today)).toMatchObject({ current: 1, best: 14, restDays: 0 });
  });

  it('says how many days until the next rest day', () => {
    expect(streakSummary(run(3), today).nextRestIn).toBe(4);
    expect(streakSummary(run(7), today).nextRestIn).toBe(7);
  });

  it('says when today’s meal earned a rest day, not when the reserve was already full', () => {
    expect(streakSummary(run(7), today).restEarnedToday).toBe(true);
    expect(streakSummary(run(6), today).restEarnedToday).toBe(false);
    expect(streakSummary(run(8), today).restEarnedToday).toBe(false);
    expect(streakSummary(run(21), today).restEarnedToday).toBe(false);
  });

  it('ignores days after today', () => {
    expect(streakSummary([...run(2), addDays(today, 1)], today).current).toBe(2);
  });
});

describe('progressSummary', () => {
  it('dates each milestone on the day it was reached', () => {
    const days = run(8);
    const p = progressSummary({ loggedDays: days, resisted: [], cravingsLogged: false, today });
    expect(p.reached.map((m) => [m.id, m.reachedAt])).toEqual([
      ['streak.7', addDays(today, -1)],
      ['streak.3', addDays(today, -5)],
    ]);
  });

  it('keeps a streak milestone once reached, and aims the next one past the best run', () => {
    const days = [...run(15, addDays(today, -10)), ...run(2)];
    const p = progressSummary({ loggedDays: days, resisted: [], cravingsLogged: false, today });
    expect(p.reached.filter((m) => m.family === 'streak').map((m) => m.value)).toEqual([14, 7, 3]);
    expect(p.families[0]).toEqual({ family: 'streak', count: 2, next: 30 });
  });

  it('counts every day logged, in a row or not', () => {
    const days = [...run(6, addDays(today, -20)), ...run(4)];
    const p = progressSummary({ loggedDays: days, resisted: [], cravingsLogged: false, today });
    expect(p.families[1]).toEqual({ family: 'days', count: 10, next: 50 });
    expect(p.reached[0]).toMatchObject({ id: 'days.10', reachedAt: today });
  });

  it('shows the cravings once one was logged, and counts the resisted ones', () => {
    const none = progressSummary({ loggedDays: [], resisted: [], cravingsLogged: false, today });
    expect(none.families.map((f) => f.family)).toEqual(['streak', 'days']);
    const some = progressSummary({ loggedDays: [], resisted: [today, today], cravingsLogged: true, today });
    expect(some.families[2]).toEqual({ family: 'cravings', count: 2, next: 5 });
    expect(some.reached).toEqual([]);
    const five = progressSummary({ loggedDays: [], resisted: [...run(4, addDays(today, -1)), today], cravingsLogged: true, today });
    expect(five.reached).toEqual([{ id: 'cravings.5', family: 'cravings', value: 5, reachedAt: today }]);
  });
});

describe('milestoneDue', () => {
  const p = progressSummary({ loggedDays: run(10), resisted: [], cravingsLogged: false, today });

  it('celebrates the biggest milestone of today, once, and notes the others', () => {
    // Today makes 10 days logged; streak 7 and 3 were earlier.
    const first = milestoneDue(p, []);
    expect(first.due?.id).toBe('days.10');
    expect(first.seen.sort()).toEqual(['days.10', 'streak.3', 'streak.7']);
    expect(milestoneDue(p, first.seen).due).toBeNull();
  });

  it('never celebrates an older milestone, even unseen', () => {
    const yesterday = progressSummary({ loggedDays: run(7, addDays(today, -1)), resisted: [], cravingsLogged: false, today });
    expect(milestoneDue(yesterday, []).due).toBeNull();
  });

  it('prefers the streak when two land the same day', () => {
    const perfect = progressSummary({ loggedDays: run(100), resisted: [], cravingsLogged: false, today });
    expect(milestoneDue(perfect, []).due?.id).toBe('streak.100');
  });
});
