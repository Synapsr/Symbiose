import { describe, expect, it } from 'vitest';

import { addDays } from './dates';
import {
  afterQuietHours,
  answerOffer,
  cravingWindow,
  firstLine,
  inQuietHours,
  morningTimes,
  nextMonday,
  proactiveOffer,
  recoverySignal,
  resolveProactive,
  usualWakeTimes,
  VitalDayInputSchema,
  type VitalMetric,
} from './proactive';
import type { GoalPlan } from './schemas';

// A Friday: the 14 nights before it hold 4 weekend mornings.
const today = '2026-10-30';
const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
const night = (daysAgo: number, wake: string) => ({ localDate: addDays(today, -daysAgo), wakeTime: at(addDays(today, -daysAgo), wake) });

describe('quiet hours', () => {
  it('wraps over midnight and moves times to their end', () => {
    expect(inQuietHours('23:10', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(inQuietHours('07:00', '22:00', '07:00')).toBe(false);
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(inQuietHours('13:00', '07:00', '07:00')).toBe(false);
    expect(afterQuietHours('06:40', '22:00', '07:00')).toBe('07:00');
    expect(afterQuietHours('07:20', '22:00', '07:00')).toBe('07:20');
  });
});

describe('usual wake time', () => {
  it('needs 5 nights over the last 14 days', () => {
    expect(usualWakeTimes([night(0, '07:00'), night(1, '07:10'), night(2, '06:50'), night(3, '07:05')], today)).toBeNull();
    expect(usualWakeTimes([night(20, '07:00'), night(21, '07:00'), night(22, '07:00'), night(23, '07:00'), night(24, '07:00'), night(0, '07:00')], today)).toBeNull();
  });

  it('takes the median of weekdays, rounded to 5 minutes, unmoved by one late morning', () => {
    const nights = [night(0, '07:02'), night(1, '07:11'), night(2, '06:58'), night(3, '07:20'), night(4, '07:06'), night(7, '11:30')];
    expect(usualWakeTimes(nights, today)).toEqual({ weekday: '07:10', weekend: '07:10', nights: 6 });
  });

  it('keeps a separate weekend time when weekends really differ', () => {
    const weekdays = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((d) => night(d, '06:45'));
    // 2026-10-25/24, 18/17 are Sunday/Saturday.
    const weekends = [5, 6, 12, 13].map((d) => night(d, '09:10'));
    expect(usualWakeTimes([...weekdays, ...weekends], today)).toEqual({ weekday: '06:45', weekend: '09:10', nights: 14 });
    const close = [5, 6, 12, 13].map((d) => night(d, '07:15'));
    expect(usualWakeTimes([...weekdays, ...close], today)?.weekend).toBe('06:45');
  });

  it('does not wrap around midnight for late sleepers', () => {
    const nights = [night(0, '23:50'), night(1, '00:20'), night(2, '00:10'), night(3, '23:55'), night(4, '00:05')];
    expect(usualWakeTimes(nights, today)?.weekday).toBe('00:05');
  });
});

describe('morning time', () => {
  const quiet = { quietStart: '22:00', quietEnd: '07:00' };
  it('follows the wake time + 15 min, the chosen time, or 07:30, never in quiet hours', () => {
    expect(morningTimes({ ...quiet, morningTime: null }, { weekday: '07:05', weekend: '09:10', nights: 14 })).toEqual({ weekday: '07:20', weekend: '09:25', source: 'wake' });
    expect(morningTimes({ ...quiet, morningTime: null }, null)).toEqual({ weekday: '07:30', weekend: '07:30', source: 'default' });
    expect(morningTimes({ ...quiet, morningTime: '08:00' }, { weekday: '07:05', weekend: '07:05', nights: 9 })).toMatchObject({ weekday: '08:00', source: 'manual' });
    expect(morningTimes({ ...quiet, morningTime: null }, { weekday: '06:15', weekend: '06:15', nights: 9 }).weekday).toBe('07:00');
  });
});

describe('craving window', () => {
  const craving = (daysAgo: number, time: string) => ({ at: at(addDays(today, -daysAgo), time), localDate: addDays(today, -daysAgo) });
  const snack = (daysAgo: number, time: string, addedSugar: number) => ({ ...craving(daysAgo, time), addedSugar });

  it('needs 3 craving days in the same slot, and stays a first hint below 5', () => {
    expect(cravingWindow({ cravings: [craving(1, '16:00'), craving(2, '16:10'), craving(2, '16:20')], snacks: [], loggedDays: 4 }, today)).toBeNull();
    const three = cravingWindow({ cravings: [craving(1, '16:00'), craving(2, '16:10'), craving(3, '15:50')], snacks: [], loggedDays: 4 }, today);
    expect(three).toMatchObject({ start: '15:55', notifyAt: '15:40', windowDays: 3, confidence: 'low' });
  });

  it('finds the usual slot and sends the heads-up 15 min before it', () => {
    const cravings = [craving(1, '16:00'), craving(2, '16:10'), craving(3, '15:50'), craving(5, '16:30'), craving(6, '16:20'), craving(8, '21:00')];
    const window = cravingWindow({ cravings, snacks: [], loggedDays: 10 }, today);
    expect(window).toMatchObject({ start: '16:00', end: '16:30', notifyAt: '15:45', source: 'cravings', windowDays: 5 });
    expect(window!.share).toBeCloseTo(0.83, 2);
    expect(window!.confidence).toBe('medium');
  });

  it('counts days, not cravings, and forgets what is older than 28 days', () => {
    const scattered = [craving(1, '09:00'), craving(2, '12:30'), craving(3, '16:00'), craving(4, '19:30'), craving(5, '21:30'), craving(6, '07:00'), craving(7, '15:40')];
    expect(cravingWindow({ cravings: scattered, snacks: [], loggedDays: 10 }, today)).toBeNull();
    const old = [29, 30, 31, 32, 33, 34].map((d) => craving(d, '16:00'));
    expect(cravingWindow({ cravings: old, snacks: [], loggedDays: 10 }, today)).toBeNull();
  });

  it('falls back to a clear peak of added sugar from snacks', () => {
    const snacks = [snack(1, '16:30', 18), snack(2, '16:10', 22), snack(4, '16:45', 15), snack(6, '17:00', 20), snack(9, '10:00', 6), snack(3, '16:20', 1)];
    expect(cravingWindow({ cravings: [], snacks, loggedDays: 12 }, today)).toMatchObject({ source: 'sugar', start: '16:25', notifyAt: '16:10', windowDays: 4, confidence: 'low' });
    expect(cravingWindow({ cravings: [], snacks, loggedDays: 5 }, today)).toBeNull();
  });
});

describe('recovery signal', () => {
  /** 30 days of a metric around a value, with a small spread, then last night's. */
  const series = (metric: VitalMetric, around: number, days: number, lastNight?: number) => {
    const out = Array.from({ length: days }, (_, i) => ({ localDate: addDays(today, -(i + 1)), metric, value: around + ((i % 5) - 2) }));
    if (lastNight !== undefined) out.push({ localDate: today, metric, value: lastNight });
    return out;
  };

  it('says nothing before 14 days, or without last night', () => {
    expect(recoverySignal(series('hrv_sdnn', 50, 13, 30), today)).toMatchObject({ status: null, reasons: ['few_days'] });
    expect(recoverySignal(series('hrv_sdnn', 50, 20), today)).toMatchObject({ status: null, reasons: ['no_reading'] });
  });

  it('reads a usual night as usual', () => {
    const signal = recoverySignal([...series('hrv_sdnn', 50, 30, 49), ...series('resting_hr', 55, 30, 55)], today, { asleepMin: 450 });
    expect(signal).toMatchObject({ status: 'usual', confidence: 'high', reasons: [] });
  });

  it('flags lower HRV and higher resting heart rate, strengthened by a short night', () => {
    const one = recoverySignal([...series('hrv_sdnn', 50, 30, 46), ...series('resting_hr', 55, 30, 55)], today);
    expect(one).toMatchObject({ status: 'lower', reasons: ['hrv_below'] });
    const both = recoverySignal([...series('hrv_sdnn', 50, 30, 42), ...series('resting_hr', 55, 30, 59)], today);
    expect(both).toMatchObject({ status: 'low', reasons: ['hrv_below', 'rhr_above'] });
    const shortNight = recoverySignal([...series('hrv_sdnn', 50, 30, 46), ...series('resting_hr', 55, 30, 55)], today, { asleepMin: 330 });
    expect(shortNight.reasons).toContain('short_night');
    // A short night alone is not a recovery signal.
    expect(recoverySignal(series('hrv_sdnn', 50, 30, 50), today, { asleepMin: 300 }).status).toBe('usual');
  });

  it('trusts one metric less, and young baselines less', () => {
    expect(recoverySignal(series('hrv_sdnn', 50, 30, 42), today).confidence).toBe('medium');
    expect(recoverySignal([...series('hrv_sdnn', 50, 15, 42), ...series('resting_hr', 55, 15, 60)], today).confidence).toBe('low');
  });

  it('never mixes SDNN with RMSSD', () => {
    // Two weeks of RMSSD, last night in SDNN only: no baseline for either.
    const mixed = [...series('hrv_rmssd', 35, 20), { localDate: today, metric: 'hrv_sdnn' as const, value: 20 }];
    expect(recoverySignal(mixed, today).status).toBeNull();
    const rmssd = recoverySignal(series('hrv_rmssd', 35, 20, 34), today);
    expect(rmssd.hrv?.metric).toBe('hrv_rmssd');
  });

  it('rejects implausible readings', () => {
    expect(VitalDayInputSchema.safeParse({ localDate: today, metric: 'resting_hr', value: 400 }).success).toBe(false);
    expect(VitalDayInputSchema.safeParse({ localDate: today, metric: 'hrv_sdnn', value: 42 }).success).toBe(true);
  });
});

describe('settings and helpers', () => {
  const plan = { tags: ['reduce_sugar'], rules: [] } as unknown as GoalPlan;
  it('turns the craving heads-up on by default for sugar goals or logged cravings', () => {
    expect(resolveProactive(undefined, null, 0)).toMatchObject({ enabled: false, morning: true, weekly: true, cravings: false, quietStart: '22:00', quietEnd: '07:00' });
    expect(resolveProactive({ enabled: true }, plan, 0).cravings).toBe(true);
    expect(resolveProactive({ enabled: true }, null, 3).cravings).toBe(true);
    expect(resolveProactive({ enabled: true, cravings: false }, plan, 3).cravings).toBe(false);
  });

  it('finds the next Monday and the first line', () => {
    expect(nextMonday('2026-10-30')).toBe('2026-11-02');
    expect(nextMonday('2026-11-02')).toBe('2026-11-02');
    expect(firstLine('  Nuit de 6 h 10.\nHier : 18 g.')).toBe('Nuit de 6 h 10.');
  });
});

describe('offers', () => {
  const window = { start: '16:00', end: '16:30', notifyAt: '15:45', source: 'cravings' as const, confidence: 'low' as const, windowDays: 3, share: 1 };
  const off = resolveProactive(undefined, null, 0);

  it('offers the craving heads-up first, then the morning check-in, each only once', () => {
    expect(proactiveOffer({ settings: off, cravings: null, sleepNights: 2 })).toBeNull();
    expect(proactiveOffer({ settings: off, cravings: null, sleepNights: 3 })).toBe('morning');
    expect(proactiveOffer({ settings: off, cravings: window, sleepNights: 3 })).toBe('cravings');
    const declined = resolveProactive({ offers: { cravings: false } }, null, 0);
    expect(proactiveOffer({ settings: declined, cravings: window, sleepNights: 3 })).toBe('morning');
    const on = resolveProactive({ enabled: true }, null, 3);
    expect(proactiveOffer({ settings: on, cravings: window, sleepNights: 10 })).toBeNull();
  });

  it('turns on only what was accepted when the coach was off', () => {
    expect(answerOffer(off, 'cravings', true)).toEqual({ offers: { cravings: true }, enabled: true, cravings: true, morning: false, weekly: false });
    expect(answerOffer(off, 'morning', true)).toEqual({ offers: { morning: true }, enabled: true, morning: true, weekly: true, cravings: false });
    expect(answerOffer(off, 'morning', false)).toEqual({ offers: { morning: false } });
    const on = resolveProactive({ enabled: true, morning: true, cravings: false, offers: { morning: true } }, null, 0);
    expect(answerOffer(on, 'cravings', true)).toEqual({ offers: { morning: true, cravings: true }, cravings: true });
  });
});
