import { resolveProactive, type ProactiveSchedule, type ProactiveSettingsInput } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { morningDue, planNotifications, proactiveLine, type PlanInput } from './proactive-plan';

// Friday 30 October 2026; the coming Monday is 2 November.
const today = '2026-10-30';
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

const window = { start: '16:00', end: '16:30', notifyAt: '15:45', source: 'cravings' as const, confidence: 'medium' as const, windowDays: 6, share: 0.8 };

function schedule(settings: ProactiveSettingsInput, extra: Partial<ProactiveSchedule> = {}): ProactiveSchedule {
  return {
    date: today,
    settings: resolveProactive(settings, null, 4),
    morning: { weekday: '07:20', weekend: '09:25', source: 'wake', usualWake: { weekday: '07:05', weekend: '09:10', nights: 14 } },
    sleepNights: 14,
    cravings: window,
    review: { monday: '2026-11-02', loggedDays: 4 },
    today: null,
    ...extra,
  };
}

const copy: PlanInput['copy'] = {
  morningTitle: 'Ton point du matin est prêt ☀️',
  morningReadyTitle: 'Ton point du matin ☀️',
  morningBody: 'Ta nuit, hier, et une idée pour aujourd’hui.',
  morningReview: 'Ton bilan de la semaine aussi.',
  weeklyTitle: 'Ton bilan de la semaine est prêt',
  weeklyBody: 'Ce qui a marché, et une idée pour la semaine.',
  cravingsTitle: 'Ton créneau sucré approche',
  cravingsFallback: ['A', 'B'],
};

const plan = (s: ProactiveSchedule, extra: Partial<PlanInput> = {}) =>
  planNotifications({ schedule: s, today, nowMinutes: at('06:30'), morningSeen: '', cravingTimes: [], nudges: ['n1', 'n2', 'n3'], copy, ...extra });

describe('notification plan', () => {
  it('plans nothing while the coach is off', () => {
    expect(plan(schedule({ enabled: false }))).toEqual([]);
  });

  it('plans one morning check-in a day by default, at the wake time of the day, a week ahead', () => {
    const list = plan(schedule({ enabled: true }));
    expect(list).toHaveLength(7);
    expect(list.every((n) => n.kind === 'morning')).toBe(true);
    expect(list.map((n) => `${n.date} ${n.time}`).slice(0, 3)).toEqual(['2026-10-30 07:20', '2026-10-31 09:25', '2026-11-01 09:25']);
    expect(list[0]).toMatchObject({ id: 'proactive.morning.2026-10-30', title: copy.morningTitle, body: copy.morningBody, data: { kind: 'morning', date: today } });
  });

  it('says the real first line once the check-in is written, and stays quiet once it was read', () => {
    const written = schedule({ enabled: true }, { today: { messageId: 'm1', content: 'Nuit de 6 h 10.\nHier : 30 g.' } });
    expect(plan(written)[0]).toMatchObject({ title: copy.morningReadyTitle, body: 'Nuit de 6 h 10.' });
    const mornings = (extra: Partial<PlanInput>) => plan(written, extra).filter((n) => n.kind === 'morning');
    expect(mornings({ morningSeen: today })[0]!.date).toBe('2026-10-31');
    expect(mornings({ nowMinutes: at('07:30') })[0]!.date).toBe('2026-10-31');
    // With the morning done, the day's one notification may be the heads-up.
    expect(plan(written, { morningSeen: today })[0]).toMatchObject({ kind: 'cravings', date: today });
  });

  it('shows the words of the check-in and of the nudges, never their Markdown', () => {
    const written = schedule({ enabled: true }, { today: { messageId: 'm1', content: '**Nuit de 6 h 10**, une de moins.\nHier : 30 g.' } });
    expect(plan(written)[0]).toMatchObject({ body: 'Nuit de 6 h 10, une de moins.' });
    const nudged = plan(schedule({ enabled: true, morning: false, weekly: false, cravings: true }), { nudges: ['Un *en-cas* prêt ?'] });
    expect(nudged[0]).toMatchObject({ kind: 'cravings', body: 'Un en-cas prêt ?' });
  });

  it('folds the Monday review into the morning check-in, or sends it alone when mornings are off', () => {
    const monday = plan(schedule({ enabled: true })).find((n) => n.date === '2026-11-02')!;
    expect(monday).toMatchObject({ kind: 'morning', body: `${copy.morningBody} ${copy.morningReview}`, data: { review: true } });
    const alone = plan(schedule({ enabled: true, morning: false, cravings: false }));
    expect(alone).toEqual([expect.objectContaining({ kind: 'weekly', date: '2026-11-02', time: '07:20', title: copy.weeklyTitle })]);
    expect(plan(schedule({ enabled: true, morning: false, cravings: false }, { review: { monday: '2026-11-02', loggedDays: 2 } }))).toEqual([]);
  });

  it('sends the craving heads-up with its actions, a different line each day', () => {
    const list = plan(schedule({ enabled: true, morning: false, weekly: false, cravings: true }));
    expect(list).toHaveLength(7);
    expect(list[0]).toMatchObject({ kind: 'cravings', time: '15:45', category: 'cravingHeadsUp', title: copy.cravingsTitle });
    expect(new Set(list.slice(0, 3).map((n) => n.body)).size).toBe(3);
  });

  it('skips the heads-up after a craving in the hour before it, and in quiet hours', () => {
    const s = schedule({ enabled: true, morning: false, weekly: false, cravings: true });
    expect(plan(s, { cravingTimes: ['14:40'] })[0]!.date).toBe(today);
    expect(plan(s, { cravingTimes: ['14:50'], nowMinutes: at('15:00') })[0]!.date).toBe('2026-10-31');
    expect(plan(schedule({ enabled: true, morning: false, weekly: false, cravings: true, quietStart: '15:00', quietEnd: '18:00' }))).toEqual([]);
  });

  it('keeps to one notification a day unless two are allowed, morning first', () => {
    const one = plan(schedule({ enabled: true, cravings: true }));
    expect(one.map((n) => n.kind)).toEqual(Array(7).fill('morning'));
    const two = plan(schedule({ enabled: true, cravings: true, maxPerDay: 2 }));
    expect(two.filter((n) => n.date === today).map((n) => n.kind)).toEqual(['morning', 'cravings']);
    expect(two).toHaveLength(14);
  });
});

describe('coach line', () => {
  const line = (s: ProactiveSchedule | null, extra: Partial<Parameters<typeof proactiveLine>[0]> = {}) =>
    proactiveLine({ schedule: s, today, nowMinutes: at('08:00'), dismissed: [], cravingTimes: [], morning: null, ...extra });

  it('shows the heads-up around the usual slot, before anything else', () => {
    const s = schedule({ enabled: true, cravings: true }, { today: { messageId: 'm1', content: 'Nuit de 7 h.' } });
    expect(line(s, { nowMinutes: at('15:10') })).toEqual({ kind: 'cravings', start: '16:00' });
    expect(line(s, { nowMinutes: at('14:50') })).toBeNull();
    expect(line(s, { nowMinutes: at('15:10'), cravingTimes: ['15:05'] })).toBeNull();
    expect(line(s, { nowMinutes: at('15:10'), dismissed: ['cravings'] })).toBeNull();
  });

  it('shows the morning check-in from waking until noon, even while it is written', () => {
    const s = schedule({ enabled: true }, { today: { messageId: 'm1', content: 'Nuit de 7 h.' } });
    expect(line(s)).toEqual({ kind: 'morning', messageId: 'm1', text: 'Nuit de 7 h.', writing: false });
    expect(line(s, { nowMinutes: at('12:30') })).toBeNull();
    const writing = line(schedule({ enabled: true }), { morning: { messageId: null, content: '', writing: true } });
    expect(writing).toMatchObject({ kind: 'morning', writing: true });
    expect(morningDue(schedule({ enabled: true }), today, at('06:30'))).toBe(true);
    expect(morningDue(schedule({ enabled: true }), today, at('06:10'))).toBe(false);
    expect(morningDue(s, today, at('08:00'))).toBe(false);
  });

  it('says the Monday review is ready', () => {
    const monday = { ...schedule({ enabled: true, morning: false }), date: '2026-11-02' };
    expect(line(monday, { today: '2026-11-02' })).toEqual({ kind: 'weekly' });
  });

  it('offers what would help, once, and otherwise leaves the usual line', () => {
    expect(line(schedule({}))).toEqual({ kind: 'offer', offer: 'cravings', start: '16:00' });
    expect(line(schedule({ offers: { cravings: false } }))).toEqual({ kind: 'offer', offer: 'morning', start: '16:00' });
    expect(line(schedule({}), { dismissed: ['offer'] })).toBeNull();
    expect(line(schedule({ offers: { cravings: false, morning: false } }))).toBeNull();
    expect(line(null)).toBeNull();
  });
});
