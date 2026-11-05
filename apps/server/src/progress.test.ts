import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addDays, toLocalDate, type AuthResponse, type DaySummary, type FoodItemInput, type GoalPlan, type GoalsResponse, type InsightsResponse, type Profile, type User, type WeeklyReview, type WeeklyReviewState } from '@symbiose/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDisabledAi } from '@symbiose/core/ai/claude';
import type { Ai, ReviewInput } from '@symbiose/core/ai/types';
import { createApp } from './app';
import { openDb } from './db';
import type { Config } from './env';
import { PhotoStore } from './services/photos';

const dir = mkdtempSync(join(tmpdir(), 'symbiose-progress-'));
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
  return createApp({ db, ai, photos: new PhotoStore(db, dir), config });
}

function client(app: ReturnType<typeof makeApp>) {
  const request = async <T,>(method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const register = async (email: string) => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
    return ((await res.json()) as AuthResponse).token;
  };
  return { request, register };
}

const profile: Profile = { name: 'Loan', sex: 'male', birthYear: 1995, heightCm: 178, weightKg: 75, activityLevel: 'light', locale: 'fr', timezone: 'Europe/Paris' };

const sugarPlan: GoalPlan = {
  intentions: 'Moins de sucre',
  title: 'Moins de sucre',
  summary: 'On réduit le sucre ajouté.',
  tags: ['reduce_sugar'],
  calorieMode: 'maintain',
  caloriePercent: 0,
  proteinPerKg: 1.2,
  fatPercent: 30,
  rules: [{ nutrient: 'addedSugar', kind: 'max', value: 25, reason: 'OMS' }],
  focus: ['addedSugar'],
  habits: [{ id: 'pas-de-soda', label: 'Pas de soda', kind: 'avoid' }],
  coachTone: 'gentle',
  adjustForActivity: false,
  overrides: {},
  activity: null,
};

const cookie: FoodItemInput = {
  id: 'cookie',
  name: 'Cookie',
  emoji: '🍪',
  portion: '1',
  grams: 40,
  per100g: { kcal: 490, protein: 5.5, carbs: 63, sugar: 34, addedSugar: 32, fat: 23, satFat: 11, fiber: 2.4, sodium: 330 },
  source: 'manual',
};

const today = toLocalDate();
const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('the weekly review, saved', () => {
  const reviews: ReviewInput[] = [];
  let slow: Promise<void> | null = null;
  const ai: Ai = {
    ...createDisabledAi(),
    enabled: true,
    model: 'fake',
    async review(input) {
      reviews.push(input);
      if (slow) await slow;
      return { headline: `Semaine ${reviews.length}`, wins: ['Repas notés chaque jour'], patterns: ['Le sucre arrive vers 16 h'], nextSteps: ['Un en-cas protéiné à 15 h 45'] };
    },
  };
  const app = makeApp(ai);
  const { request: call, register } = client(app);
  let token = '';
  const request = <T,>(method: string, path: string, body?: unknown) => call<T>(method, path, token, body);
  const state = async (to = today) => (await request<WeeklyReviewState>('GET', `/api/insights/review?to=${to}`)).body;
  const meal = (date: string, time = '16:00') => request('POST', '/api/meals', { eatenAt: at(date, time), localDate: date, items: [cookie], title: 'Cookie' });

  beforeAll(async () => {
    token = await register('review@example.com');
    await request('PUT', '/api/me/profile', profile);
    await request('PUT', '/api/goals', { plan: sugarPlan });
  });

  it('has nothing to show before any meal, and only offers it on demand for a couple of days', async () => {
    expect(await state()).toMatchObject({ review: null, status: 'none', ai: true, week: { loggedDays: 0, nutrient: 'addedSugar', adherence: null } });
    expect((await request('POST', '/api/insights/review', { to: today })).status).toBe(409);

    await meal(addDays(today, -1));
    await meal(today);
    const two = await state();
    expect(two.status).toBe('none');
    // The one-line summary: the goal's nutrient over the week.
    expect(two.week).toMatchObject({ loggedDays: 2, nutrient: 'addedSugar', average: 13, adherence: { kind: 'max', target: 25, daysOk: 2, daysLogged: 2 } });
  });

  it('is due once the week has three days of meals, then saved and served without the AI', async () => {
    await meal(addDays(today, -2));
    expect((await state()).status).toBe('due');

    const written = await request<WeeklyReview>('POST', '/api/insights/review', { to: today });
    expect(written.status).toBe(200);
    // Old apps read the review fields at the top level.
    expect(written.body).toMatchObject({ headline: 'Semaine 1', wins: ['Repas notés chaque jour'], from: addDays(today, -6), to: today });

    const calls = reviews.length;
    const saved = await state();
    expect(saved).toMatchObject({ status: 'fresh', review: { headline: 'Semaine 1', generatedAt: written.body.generatedAt } });
    // Leaving and coming back, or another range: the same review, no new AI call.
    await request('GET', '/api/insights?days=30');
    expect((await state()).review?.headline).toBe('Semaine 1');
    expect(reviews).toHaveLength(calls);
  });

  it('keeps the weekly review when another period is reviewed', async () => {
    const month = await request<WeeklyReview>('POST', '/api/insights/review', { days: 30, to: today });
    expect(month.body.from).toBe(addDays(today, -29));
    expect((await state()).review?.headline).toBe('Semaine 1');
  });

  it('turns stale with newer meals during the week, and refreshes only on demand', async () => {
    await tick();
    await meal(today, '19:00');
    const stale = await state();
    expect(stale).toMatchObject({ status: 'stale', review: { headline: 'Semaine 1' } });
    const refreshed = await request<WeeklyReview>('POST', '/api/insights/review', { to: today });
    expect(refreshed.body.headline).toBe(`Semaine ${reviews.length}`);
    expect((await state()).status).toBe('fresh');
  });

  it('is due again in a new week once there are new meals («  prêt lundi »)', async () => {
    const lastWeek = addDays(today, -7);
    for (const days of [8, 9, 10]) await meal(addDays(today, -days));
    const old = await request<WeeklyReview>('POST', '/api/insights/review', { to: lastWeek });
    expect(old.body.to).toBe(lastWeek);
    // Still shown on open while nothing new was logged.
    expect((await state()).status).toBe('stale');
    await tick();
    await meal(today, '20:00');
    expect(await state()).toMatchObject({ status: 'due', review: { to: lastWeek } });

    // Two opens at once share one AI call.
    let release!: () => void;
    slow = new Promise((resolve) => (release = resolve));
    const before = reviews.length;
    const both = Promise.all([request('POST', '/api/insights/review', { to: today }), request('POST', '/api/insights/review', { to: today })]);
    await tick();
    release();
    slow = null;
    const [a, b] = await both;
    expect(reviews).toHaveLength(before + 1);
    expect((a.body as WeeklyReview).headline).toBe((b.body as WeeklyReview).headline);
    expect((await state()).status).toBe('fresh');
  });

  it('forgets a review older than last week', async () => {
    expect(await state(addDays(today, 21))).toMatchObject({ review: null, status: 'none' });
  });

  it('never offers to write one without AI, but still summarises the week', async () => {
    const offline = makeApp(createDisabledAi());
    const { request: offlineCall, register: offlineRegister } = client(offline);
    const other = await offlineRegister('offline@example.com');
    await offlineCall('PUT', '/api/me/profile', other, profile);
    await offlineCall('PUT', '/api/goals', other, { plan: sugarPlan });
    for (const days of [0, 1, 2, 3]) await offlineCall('POST', '/api/meals', other, { eatenAt: at(addDays(today, -days), '16:00'), localDate: addDays(today, -days), items: [cookie] });
    const { body } = await offlineCall<WeeklyReviewState>('GET', `/api/insights/review?to=${today}`, other);
    expect(body).toMatchObject({ review: null, status: 'none', ai: false, week: { loggedDays: 4 } });
  });
});

describe('goals edited by hand', () => {
  let drafts = 0;
  const ai: Ai = {
    ...createDisabledAi(),
    enabled: true,
    model: 'fake',
    async draftPlan() {
      drafts++;
      throw new Error('no AI on a manual edit');
    },
  };
  const app = makeApp(ai);
  const { request: call, register } = client(app);
  let token = '';
  const request = <T,>(method: string, path: string, body?: unknown) => call<T>(method, path, token, body);

  beforeAll(async () => {
    token = await register('goals@example.com');
    await request('PUT', '/api/me/profile', profile);
    await request('PUT', '/api/goals', { plan: sugarPlan });
  });

  it('saves a new number with no AI call, and the day follows', async () => {
    const plan = { ...sugarPlan, rules: [{ ...sugarPlan.rules[0]!, value: 20 }], activity: { weeklyActiveMinutes: 180, dailySteps: 9000, weeklyStrengthSessions: null } };
    const saved = await request<GoalsResponse>('PUT', '/api/goals', { plan });
    expect(saved.status).toBe(200);
    expect(saved.body.targets?.addedSugar).toEqual({ value: 20, kind: 'max' });
    expect(drafts).toBe(0);
    expect((await request<DaySummary>('GET', `/api/days/${today}`)).body.targets.addedSugar.value).toBe(20);
    expect((await request<User>('GET', '/api/me')).body.plan?.activity).toEqual({ weeklyActiveMinutes: 180, dailySteps: 9000, weeklyStrengthSessions: null });
  });

  it('keeps every number within realistic bounds', async () => {
    const plan: GoalPlan = {
      ...sugarPlan,
      rules: [
        { nutrient: 'addedSugar', kind: 'max', value: 500, reason: '' },
        { nutrient: 'protein', kind: 'min', value: 5, reason: '' },
        { nutrient: 'kcal', kind: 'max', value: 800, reason: 'energy is set by the calorie mode' },
      ],
      overrides: { fiber: 400, kcal: 600 },
      activity: { weeklyActiveMinutes: 2000, dailySteps: 100, weeklyStrengthSessions: 0 },
    };
    const saved = (await request<GoalsResponse>('PUT', '/api/goals', { plan })).body;
    expect(saved.plan?.rules.map((r) => [r.nutrient, r.value])).toEqual([
      ['addedSugar', 150],
      ['protein', 30],
    ]);
    expect(saved.plan?.overrides).toEqual({ fiber: 80, kcal: 1200 });
    expect(saved.plan?.activity).toEqual({ weeklyActiveMinutes: 600, dailySteps: 3000, weeklyStrengthSessions: null });
    expect(saved.targets?.fiber.value).toBe(80);
  });

  it('never prescribes energy below the safety floor, whatever the deficit asked', async () => {
    const light: Profile = { ...profile, sex: 'female', weightKg: 48, heightCm: 155, activityLevel: 'sedentary' };
    await request('PUT', '/api/me/profile', light);
    const saved = (await request<GoalsResponse>('PUT', '/api/goals', { plan: { ...sugarPlan, calorieMode: 'deficit', caloriePercent: 25 } })).body;
    expect(saved.energy!.goalKcal).toBeGreaterThanOrEqual(1200);
    expect(saved.energy!.goalKcal).toBeGreaterThanOrEqual(saved.energy!.bmr - 10);
    await request('PUT', '/api/me/profile', profile);
  });
});

describe('the goal metric in insights', () => {
  const app = makeApp({ ...createDisabledAi(), enabled: true, model: 'fake' });
  const { request: call, register } = client(app);
  let token = '';
  const request = <T,>(method: string, path: string, body?: unknown) => call<T>(method, path, token, body);
  const weightPlan: GoalPlan = { ...sugarPlan, tags: ['lose_weight'], calorieMode: 'deficit', caloriePercent: 15, focus: ['kcal', 'protein'], rules: [] };

  beforeAll(async () => {
    token = await register('hero@example.com');
    await request('PUT', '/api/me/profile', profile);
    await request('POST', '/api/meals', { eatenAt: at(today, '12:30'), localDate: today, items: [cookie] });
  });

  it('follows the plan’s first focus, calories included, and never calories once hidden', async () => {
    await request('PUT', '/api/goals', { plan: sugarPlan });
    const sugar = (await request<InsightsResponse>('GET', '/api/insights?days=7')).body;
    expect(sugar.hero).toBe('addedSugar');

    await request('PUT', '/api/goals', { plan: weightPlan });
    const weight = (await request<InsightsResponse>('GET', '/api/insights?days=7')).body;
    expect(weight.hero).toBe('kcal');
    expect(weight.byHour).toMatchObject({ nutrient: 'kcal' });
    expect(weight.byHour.hours[12]).toBe(196);
    expect(weight.adherence.find((a) => a.nutrient === 'kcal')).toMatchObject({ kind: 'target', daysLogged: 1 });
    expect(weight.topSources.kcal?.[0]).toMatchObject({ name: 'Cookie', amount: 196 });

    const hidden = (await request<InsightsResponse>('GET', '/api/insights?days=7&hideCalories=1')).body;
    expect(hidden.hero).toBe('protein');
    expect(hidden.byHour.nutrient).toBe('protein');

    const review = (await request<WeeklyReviewState>('GET', `/api/insights/review?to=${today}&hideCalories=1`)).body;
    expect(review.week.nutrient).toBe('protein');
  });
});

describe('a drinks goal chosen by hand', () => {
  const app = makeApp({ ...createDisabledAi(), enabled: true, model: 'fake' });
  const { request: call, register } = client(app);
  let token = '';
  const request = <T,>(method: string, path: string, body?: unknown) => call<T>(method, path, token, body);
  const goal = async () => (await request<DaySummary>('GET', `/api/days/${today}`)).body.hydration?.goalMl;

  beforeAll(async () => {
    token = await register('water@example.com');
    await request('PUT', '/api/me/profile', { ...profile, trackHydration: true });
  });

  it('replaces the default, survives older profile forms, and comes back to the default with null', async () => {
    expect(await goal()).toBe(2000);
    await request('PUT', '/api/me/profile', { ...profile, trackHydration: true, waterGoalMl: 2600 });
    expect(await goal()).toBe(2600);
    // A profile form that doesn't know the field leaves it alone.
    await request('PUT', '/api/me/profile', profile);
    expect(await goal()).toBe(2600);
    const trend = (await request<InsightsResponse>('GET', '/api/insights?days=7')).body.hydration;
    expect(trend?.days.every((d) => d.goalMl === 2600)).toBe(true);
    await request('PUT', '/api/me/profile', { ...profile, waterGoalMl: null });
    expect(await goal()).toBe(2000);
    expect((await request('PUT', '/api/me/profile', { ...profile, waterGoalMl: 200 })).status).toBe(400);
  });
});
