import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addDays,
  firstLine,
  toLocalDate,
  type AuthResponse,
  type CoachMessage,
  type CravingNudges,
  type GoalPlan,
  type ProactiveSchedule,
  type Profile,
  type RecoverySignal,
  type User,
  type VitalDay,
} from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDisabledAi } from './ai/claude';
import { createMockAi } from './ai/mock';
import type { Ai, CoachInput, MorningInput, NudgesInput } from './ai/types';
import { createApp } from './app';
import { openDb } from './db';
import { coachMessages, vitals } from './db/schema';
import type { Config } from './env';
import { PhotoStore } from './services/photos';

const dir = mkdtempSync(join(tmpdir(), 'symbiose-proactive-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeApp(ai: Ai) {
  const config: Config = {
    port: 0,
    dataDir: dir,
    publicUrl: null,
    jwtSecret: 'test-secret',
    allowSignup: true,
    anthropicApiKey: null,
    anthropicWorkspaceId: null,
    aiModel: 'fake',
    aiMock: false,
    corsOrigins: ['*'],
  };
  const db = openDb(':memory:');
  return Object.assign(createApp({ db, ai, photos: new PhotoStore(db, dir), config }), { db });
}

const plan: GoalPlan = {
  intentions: 'Moins de sucre l’après-midi',
  title: 'Moins de sucre',
  summary: 'On réduit le sucre ajouté.',
  tags: ['reduce_sugar'],
  calorieMode: 'maintain',
  caloriePercent: 0,
  proteinPerKg: 1.2,
  fatPercent: 30,
  rules: [{ nutrient: 'addedSugar', kind: 'max', value: 25, reason: 'OMS' }],
  focus: ['addedSugar'],
  habits: [],
  coachTone: 'gentle',
  adjustForActivity: false,
  overrides: {},
  activity: null,
};

const profile: Profile = { name: 'Loan', sex: 'male', birthYear: 1995, heightCm: 178, weightKg: 75, activityLevel: 'light', locale: 'fr', timezone: 'Europe/Paris', trackSleep: true };

const today = toLocalDate();
const at = (date: string, time: string) => `${date}T${time}:00+01:00`;

describe('proactive coach', () => {
  const seen = { morning: [] as MorningInput[], nudges: [] as NudgesInput[], coach: [] as CoachInput[] };
  let failMorning = false;
  const mock = createMockAi();
  const app = makeApp({
    ...mock,
    async morning(input, onText) {
      seen.morning.push(input);
      await new Promise((r) => setTimeout(r, 30));
      if (failMorning) throw new Error('boom');
      onText?.('Nuit de 6 h 10.');
      return { text: 'Nuit de 6 h 10.\n\nHier : 30 g de sucres ajoutés.\nUn en-cas protéiné vers 15 h 30.' };
    },
    async cravingNudges(input) {
      seen.nudges.push(input);
      return { lines: ['Un verre d’eau ?', 'Quelques noix prêtes ?', 'Cinq minutes de marche ?', 'x'.repeat(200)] };
    },
    async coach(input) {
      seen.coach.push(input);
      return { reply: 'Parce que ta nuit a été courte.', planChange: null, mealActions: [] };
    },
  });

  const call = async <T,>(method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, text };
  };
  const register = async (email: string) => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
    return ((await res.json()) as AuthResponse).token;
  };
  let owner = '';
  let stranger = '';
  let ownerId = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const schedule = async (date = today) => (await request<ProactiveSchedule>('GET', `/api/proactive?date=${date}`)).body;

  beforeAll(async () => {
    owner = await register('proactive@example.com');
    stranger = await register('other-proactive@example.com');
    ownerId = (await request<User>('PUT', '/api/me/profile', profile)).body.id;
    await request('PUT', '/api/goals', { plan });
    await request('PUT', '/api/me/profile', { ...profile, trackSleep: false }, stranger);
  });

  it('stays off until switched on, with a calm default schedule', async () => {
    const s = await schedule();
    expect(s.settings).toMatchObject({ enabled: false, morning: true, weekly: true, cravings: true, quietStart: '22:00', quietEnd: '07:00' });
    expect(s.morning).toMatchObject({ weekday: '07:30', weekend: '07:30', source: 'default', usualWake: null });
    expect(s.cravings).toBeNull();
    expect(s.today).toBeNull();
    expect((await request('POST', '/api/proactive/morning', { localDate: today })).status).toBe(409);
    expect((await request('POST', '/api/proactive/nudges', { localDate: today })).status).toBe(409);
  });

  it('saves settings as a patch, and an older profile form keeps them', async () => {
    const s = (await request<ProactiveSchedule>('PUT', '/api/proactive/settings', { enabled: true, quietStart: '22:30', localDate: today })).body;
    expect(s.settings).toMatchObject({ enabled: true, morning: true, quietStart: '22:30', quietEnd: '07:00' });
    expect((await request('PUT', '/api/proactive/settings', { morningTime: '7:5' })).status).toBe(400);
    await request('PUT', '/api/me/profile', profile);
    expect((await request<User>('GET', '/api/me')).body.profile?.proactive).toMatchObject({ enabled: true, quietStart: '22:30' });
    // The stranger's settings are theirs.
    expect((await call<ProactiveSchedule>('GET', '/api/proactive', stranger)).body.settings.enabled).toBe(false);
  });

  it('times the check-in from the usual wake time, and finds the usual craving slot', async () => {
    const nights = Array.from({ length: 10 }, (_, i) => {
      const localDate = addDays(today, -i);
      return { localDate, bedtime: at(addDays(localDate, -1), '23:30'), wakeTime: at(localDate, i === 0 ? '06:50' : '07:05'), asleepMin: i === 0 ? 370 : 440, inBedMin: 450 };
    });
    await request('PUT', '/api/sleep', { source: 'healthkit', nights });
    for (const daysAgo of [1, 2, 3, 5, 6, 8]) {
      const date = addDays(today, -daysAgo);
      await request('POST', '/api/cravings', { at: at(date, daysAgo === 8 ? '21:00' : '16:10'), localDate: date, what: 'Chocolat', intensity: 2 });
    }
    const s = await schedule();
    expect(s.morning.usualWake?.nights).toBe(10);
    expect(s.morning.source).toBe('wake');
    expect(s.morning.weekday).toBe('07:20');
    expect(s.cravings).toMatchObject({ source: 'cravings', start: '16:10', notifyAt: '15:55', windowDays: 5 });
    // A craving logged as a meal of the stranger never counts for the owner.
    expect((await call<ProactiveSchedule>('GET', '/api/proactive', stranger)).body.cravings).toBeNull();
  });

  it('writes the morning check-in once a day, even when asked twice at the same time', async () => {
    const before = seen.morning.length;
    const [a, b] = await Promise.all([request<CoachMessage>('POST', '/api/proactive/morning', { localDate: today }), request<CoachMessage>('POST', '/api/proactive/morning', { localDate: today })]);
    expect(a.status).toBe(200);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body).toMatchObject({ role: 'assistant', kind: 'morning', localDate: today });
    // Blank lines are dropped.
    expect(a.body.content).toBe('Nuit de 6 h 10.\nHier : 30 g de sucres ajoutés.\nUn en-cas protéiné vers 15 h 30.');
    const again = await request<CoachMessage>('POST', '/api/proactive/morning', { localDate: today });
    expect(again.body.id).toBe(a.body.id);
    expect(seen.morning.length - before).toBe(1);
    expect((await schedule()).today).toEqual({ messageId: a.body.id, content: a.body.content });
    expect(firstLine(a.body.content)).toBe('Nuit de 6 h 10.');

    // What it was written from: the night against the usual, yesterday, the craving slot.
    const input = seen.morning.at(-1)!;
    expect(input.night).toMatchObject({ asleepMin: 370, usualAsleepMin: 440, wakeTime: '06:50' });
    expect(input.cravingWindow).toEqual({ start: '16:10', end: '16:40' });
    expect(input.yesterday.cravings).toEqual({ total: 1, resisted: 0, what: ['Chocolat'] });
    expect(input.recovery).toBeNull();
  });

  it('streams a new day’s check-in, and only the day’s first one is written', async () => {
    const tomorrow = addDays(today, 1);
    const res = await app.request('/api/proactive/morning/stream', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` }, body: JSON.stringify({ localDate: tomorrow }) });
    const body = await res.text();
    expect(body).toContain('event: delta');
    const done = JSON.parse(/event: done\ndata: (.*)/.exec(body)![1]!) as { message: CoachMessage };
    expect(done.message.localDate).toBe(tomorrow);
    const repeat = await app.request('/api/proactive/morning/stream', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` }, body: JSON.stringify({ localDate: tomorrow }) });
    const repeated = await repeat.text();
    expect(repeated).not.toContain('event: delta');
    expect(repeated).toContain(done.message.id);
  });

  it('writes the check-in from the data when the AI fails', async () => {
    failMorning = true;
    const date = addDays(today, 2);
    const message = (await request<CoachMessage>('POST', '/api/proactive/morning', { localDate: date })).body;
    failMorning = false;
    expect(message.kind).toBe('morning');
    expect(message.content.split('\n').length).toBeGreaterThanOrEqual(2);
    expect(message.content).toMatch(/en-cas protéiné|protéines/);
  });

  it('shows the check-in in the coach thread, and a reply to it reads as one', async () => {
    const thread = (await request<CoachMessage[]>('GET', '/api/coach/messages')).body;
    expect(thread.filter((m) => m.kind === 'morning')).toHaveLength(3);
    await request('POST', '/api/coach/messages', { text: 'pourquoi ?', localDate: today });
    const history = seen.coach.at(-1)!.history;
    expect(history[0]).toEqual({ role: 'user', content: `[Morning check-in for ${today}]` });
    expect(history[1]!.role).toBe('assistant');
    expect(history[1]!.content).toContain('Nuit de 6 h 10.');
    // Turns alternate all the way.
    expect(history.every((turn, i) => turn.role === (i % 2 ? 'assistant' : 'user'))).toBe(true);
  });

  it('writes the week’s nudges once and keeps them', async () => {
    const first = (await request<CravingNudges>('POST', '/api/proactive/nudges', { localDate: today })).body;
    const again = (await request<CravingNudges>('POST', '/api/proactive/nudges', { localDate: today })).body;
    expect(first.lines).toEqual(['Un verre d’eau ?', 'Quelques noix prêtes ?', 'Cinq minutes de marche ?']);
    expect(again).toEqual(first);
    expect(seen.nudges).toHaveLength(1);
    expect(seen.nudges[0]).toMatchObject({ cravingWindow: { start: '16:10', source: 'cravings' }, topCravings: ['chocolat'] });
    // Without a usual slot, there is nothing to anticipate.
    expect((await call('PUT', '/api/proactive/settings', stranger, { enabled: true })).status).toBe(200);
    expect((await call('POST', '/api/proactive/nudges', stranger, { localDate: today })).status).toBe(409);
  });

  it('imports nightly vitals idempotently, never mixing HRV measures, and reads recovery from 14 days', async () => {
    const days = Array.from({ length: 20 }, (_, i) => [
      { localDate: addDays(today, -(i + 1)), metric: 'hrv_sdnn', value: 50 + ((i % 5) - 2) },
      { localDate: addDays(today, -(i + 1)), metric: 'resting_hr', value: 55 + ((i % 3) - 1) },
    ]).flat();
    expect((await request<{ written: number }>('PUT', '/api/vitals', { source: 'healthkit', days })).body.written).toBe(40);
    expect((await request('PUT', '/api/vitals', { source: 'healthkit', days })).status).toBe(200);
    expect(app.db.select().from(vitals).where(eq(vitals.userId, ownerId)).all()).toHaveLength(40);
    expect((await request('PUT', '/api/vitals', { source: 'healthkit', days: [{ localDate: today, metric: 'resting_hr', value: 500 }] })).status).toBe(400);

    // Last night: lower HRV, higher resting heart rate, after a short night.
    await request('PUT', '/api/vitals', { source: 'healthkit', days: [{ localDate: today, metric: 'hrv_sdnn', value: 41, samples: 6 }, { localDate: today, metric: 'resting_hr', value: 60 }] });
    const read = (await request<{ days: VitalDay[]; recovery: RecoverySignal }>('GET', '/api/vitals?days=30')).body;
    expect(read.days).toHaveLength(42);
    expect(read.recovery).toMatchObject({ status: 'low', confidence: 'low', reasons: ['hrv_below', 'rhr_above', 'short_night'] });
    // A first hint on a young baseline stays out of the AI's context.
    await request('POST', '/api/coach/messages', { text: 'Comment je vais ?', localDate: today });
    expect(seen.coach.at(-1)!.recovery).toBeNull();

    // Older history makes it reliable.
    const older = Array.from({ length: 10 }, (_, i) => [
      { localDate: addDays(today, -(i + 21)), metric: 'hrv_sdnn', value: 50 },
      { localDate: addDays(today, -(i + 21)), metric: 'resting_hr', value: 55 },
    ]).flat();
    await request('PUT', '/api/vitals', { source: 'healthkit', days: older });
    await request('POST', '/api/coach/messages', { text: 'Et là ?', localDate: today });
    expect(seen.coach.at(-1)!.recovery).toMatchObject({ status: 'low', confidence: 'high' });

    // Each account only ever sees its own.
    const theirs = (await call<{ days: VitalDay[] }>('GET', '/api/vitals', stranger)).body;
    expect(theirs.days).toEqual([]);
  });

  it('exports the check-ins and vitals, and deletes them with the account', async () => {
    const exported = (await request<{ vitals: VitalDay[]; coach: { kind: string | null }[]; user: User }>('GET', '/api/me/export')).body;
    expect(exported.vitals.length).toBeGreaterThanOrEqual(42);
    expect(exported.coach.filter((m) => m.kind === 'morning')).toHaveLength(3);
    expect(exported.user.profile?.proactive?.enabled).toBe(true);
    expect((await request('DELETE', '/api/me')).status).toBe(204);
    expect(app.db.select().from(vitals).where(eq(vitals.userId, ownerId)).all()).toEqual([]);
    expect(app.db.select().from(coachMessages).where(eq(coachMessages.userId, ownerId)).all()).toEqual([]);
  });
});

describe('proactive coach without the AI', () => {
  const app = makeApp(createDisabledAi());
  it('still writes a check-in from the data, and stock nudges', async () => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'noai@example.com', password: 'password123' }) });
    const { token } = (await res.json()) as AuthResponse;
    const call = (method: string, path: string, body?: unknown) =>
      app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    await call('PUT', '/api/me/profile', { ...profile, locale: 'en', trackSleep: false });
    await call('PUT', '/api/proactive/settings', { enabled: true });
    const message = (await (await call('POST', '/api/proactive/morning', { localDate: today })).json()) as CoachMessage;
    expect(message.content).toBe('Nothing logged yesterday: a fresh, easy start today.\nToday, some protein and vegetables at each meal: simple and filling.');
  });
});

describe('mock AI', () => {
  const ai = createMockAi();
  const base: MorningInput = {
    locale: 'fr',
    profile,
    plan,
    targets: null,
    date: today,
    weekday: 'Friday',
    sleepTracked: true,
    night: { asleepMin: 370, bedtime: '00:40', wakeTime: '06:50', usualAsleepMin: 440 },
    recovery: { status: 'lower', confidence: 'medium', reasons: ['hrv_below', 'short_night'] },
    cravingsAfterShortNights: { short: 1.2, normal: 0.4 },
    yesterday: { date: addDays(today, -1), meals: 3, hero: { nutrient: 'addedSugar', consumed: 31, target: 25, kind: 'max' }, cravings: { total: 2, resisted: 1, what: ['chocolat'] } },
    cravingWindow: { start: '16:00', end: '16:30' },
  };

  it('streams a short, humble check-in that follows the data', async () => {
    let streamed = '';
    const { text } = await ai.morning(base, (delta) => (streamed += delta));
    expect(streamed).toBe(text);
    expect(text.split('\n')).toEqual([
      'Nuit de 6 h 10, 1 h 10 de moins que d’habitude.',
      'Ta récupération semble un peu plus basse que d’habitude : vas-y en douceur.',
      'Hier : 31 g de sucres ajoutés pour une limite de 25 g, 2 envies dont 1 surfée.',
      'Après une nuit courte, l’envie de sucre arrive souvent plus tôt : prévois un en-cas protéiné vers 15 h 30.',
    ]);
    const plain = await ai.morning({ ...base, locale: 'en', night: null, recovery: null, sleepTracked: false });
    expect(plain.text.split('\n')[0]).toBe('Yesterday: 31 g of added sugars against a 25 g limit, 2 cravings, 1 ridden out.');
  });

  it('writes a week of nudges', async () => {
    const { lines } = await ai.cravingNudges({ locale: 'fr', profile, plan, targets: null, cravingWindow: { start: '16:00', end: '16:30', source: 'cravings' }, topCravings: ['chocolat'] });
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines[0]).toContain('16 h 00');
  });
});
