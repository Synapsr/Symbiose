import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addDays,
  toLocalDate,
  toLocalDateTime,
  type AuthResponse,
  type DaySummary,
  type GoalsResponse,
  type InsightsResponse,
  type Meal,
  type Profile,
  type Workout,
} from '@symbiose/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDisabledAi } from './ai/claude';
import type { Ai, CoachInput, MealAnalysis, MealAnalysisInput } from './ai/types';
import { createApp } from './app';
import { openDb } from './db';
import type { Config } from './env';
import { heuristicPlan, planFromDraft } from './services/goals';
import { PhotoStore } from './services/photos';

const dir = mkdtempSync(join(tmpdir(), 'symbiose-test-'));

const croissantAnalysis: MealAnalysis = {
  isFood: true,
  title: 'Croissant et café sucré',
  mealType: 'breakfast',
  items: [
    {
      name: 'Croissant au beurre',
      emoji: '🥐',
      portion: '1 pièce',
      grams: 60,
      confidence: 0.9,
      per100g: { kcal: 406, protein: 8.2, carbs: 45.8, sugar: 11, addedSugar: 9, fat: 21, satFat: 13, fiber: 2.3, sodium: 400 },
    },
    {
      name: 'Café avec 2 sucres',
      emoji: '☕',
      portion: '1 tasse',
      grams: 150,
      confidence: 0.8,
      per100g: { kcal: 28, protein: 0.1, carbs: 6.8, sugar: 6.7, addedSugar: 6.7, fat: 0, satFat: 0, fiber: 0, sodium: 2 },
    },
  ],
  verdict: 'watch',
  headline: '≈16 g de sucres ajoutés, soit 64 % de ta limite du jour.',
  tips: ['Essaie un seul sucre demain.'],
  clarification: { question: 'Le croissant était-il au beurre ?', options: ['Oui', 'Non'] },
};

const calls: string[] = [];
const fakeAi: Ai = {
  enabled: true,
  model: 'fake',
  async analyzeMeal(input) {
    calls.push(`analyze:${input.correction ?? input.text ?? 'photo'}`);
    if (input.text === 'une chaise') return { ...croissantAnalysis, isFood: false, items: [] };
    if (input.correction) {
      return { ...croissantAnalysis, items: [croissantAnalysis.items[0]!], title: 'Croissant et café', clarification: null };
    }
    return croissantAnalysis;
  },
  async draftPlan() {
    return {
      title: 'Moins de sucre',
      summary: 'On réduit le sucre ajouté sans frustration.',
      tags: ['reduce_sugar'],
      calorieMode: 'maintain',
      caloriePercent: 40,
      proteinPerKg: 5,
      fatPercent: 30,
      rules: [
        { nutrient: 'addedSugar', kind: 'max', value: 25, reason: 'OMS' },
        { nutrient: 'sodium', kind: 'max', value: 2, reason: 'unit mistake' },
      ],
      focus: ['addedSugar', 'sugar'],
      habits: [{ id: 'Pas de soda', label: 'Pas de soda', kind: 'avoid' }],
      coachTone: 'gentle',
      adjustForActivity: false,
      activity: { weeklyActiveMinutes: 2000, dailySteps: 500, weeklyStrengthSessions: 12 },
    };
  },
  async coach(input, onText) {
    calls.push(`coach:${input.history.length}`);
    const reply = `Tu as mangé ${input.today.totals.kcal} kcal.`;
    for (const part of ['Tu as mangé ', `${input.today.totals.kcal} kcal.`]) onText?.(part);
    const wantsChange = input.message.includes('objectifs');
    return { reply, planChange: wantsChange ? { intentions: 'Moins de sucre et plus de fibres', rationale: 'Les fibres calment les envies.' } : null };
  },
  async cravingTip() {
    return { tip: "Bois un verre d'eau.", alternative: 'Une pomme' };
  },
  async review() {
    return { headline: 'Bonne semaine', wins: ['a'], patterns: ['b'], nextSteps: ['c'] };
  },
};

function makeApp(ai: Ai, overrides: Partial<Config> = {}) {
  const config: Config = {
    port: 0,
    dataDir: dir,
    publicUrl: null,
    jwtSecret: 'test-secret',
    allowSignup: false,
    anthropicApiKey: null,
    anthropicWorkspaceId: null,
    aiModel: 'fake',
    aiMock: false,
    corsOrigins: ['*'],
    ...overrides,
  };
  const db = openDb(':memory:');
  const photos = new PhotoStore(db, dir);
  const fakeFetch = (async (url: string | URL | Request) => {
    if (String(url).includes('3017620422003')) {
      return new Response(
        JSON.stringify({
          status: 1,
          product: {
            product_name_fr: 'Pâte à tartiner',
            brands: 'Marque',
            serving_quantity: 15,
            ingredients_text_fr: 'Sucre, huile de palme, noisettes 13%',
            nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, sugars_100g: 56.3, fat_100g: 30.9, 'saturated-fat_100g': 10.6, salt_100g: 0.107 },
          },
        }),
      );
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return createApp({ db, ai, photos, config, fetch: fakeFetch });
}

const profile: Profile = {
  name: 'Loan',
  sex: 'male',
  birthYear: 1995,
  heightCm: 178,
  weightKg: 75,
  activityLevel: 'light',
  locale: 'fr',
  timezone: 'Europe/Paris',
};

describe('Symbiose API', () => {
  const app = makeApp(fakeAi);
  let token = '';
  const today = toLocalDate();
  const now = toLocalDateTime();

  const request = async <T,>(method: string, path: string, body?: unknown, auth = true) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };

  beforeAll(async () => {
    const res = await request<AuthResponse>('POST', '/api/auth/register', { email: 'Loan@Example.com', password: 'correct horse', name: 'Loan' }, false);
    expect(res.status).toBe(201);
    expect(res.body.user.isAdmin).toBe(true);
    token = res.body.token;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('exposes server info and health', async () => {
    const info = await request<{ ai: { enabled: boolean }; signupOpen: boolean }>('GET', '/api/info', undefined, false);
    expect(info.body.ai.enabled).toBe(true);
    expect(info.body.signupOpen).toBe(false);
    expect((await app.request('/health')).status).toBe(200);
    const landing = await app.request('/');
    expect(await landing.text()).toContain('<svg');
  });

  it('closes sign-up after the first account and checks credentials', async () => {
    const second = await request('POST', '/api/auth/register', { email: 'other@example.com', password: 'password123' }, false);
    expect(second.status).toBe(403);
    const bad = await request('POST', '/api/auth/login', { email: 'loan@example.com', password: 'nope-nope' }, false);
    expect(bad.status).toBe(401);
    const good = await request<AuthResponse>('POST', '/api/auth/login', { email: 'loan@example.com', password: 'correct horse' }, false);
    expect(good.status).toBe(200);
    expect((await request('GET', '/api/me', undefined, false)).status).toBe(401);
  });

  it('requires a profile before computing a day', async () => {
    expect((await request('GET', `/api/days/${today}`)).status).toBe(409);
    const res = await request('PUT', '/api/me/profile', profile);
    expect(res.status).toBe(200);
  });

  it('drafts a plan from free text, clamps it, and saves it', async () => {
    const draft = await request<GoalsResponse>('POST', '/api/goals/draft', { intentions: "Je veux réduire le sucre, j'en prends par réflexe" });
    expect(draft.status).toBe(200);
    const plan = draft.body.plan!;
    expect(plan.caloriePercent).toBe(0);
    expect(plan.proteinPerKg).toBe(2.4);
    expect(plan.rules.find((r) => r.nutrient === 'sodium')?.value).toBe(500);
    expect(plan.habits[0]?.id).toBe('pas-de-soda');
    expect(plan.activity).toEqual({ weeklyActiveMinutes: 600, dailySteps: 3000, weeklyStrengthSessions: 6 });
    expect(draft.body.targets?.addedSugar).toEqual({ value: 25, kind: 'max' });

    const saved = await request<GoalsResponse>('PUT', '/api/goals', { plan });
    expect(saved.status).toBe(200);
    expect(saved.body.plan?.title).toBe('Moins de sucre');
  });

  let meal: Meal;

  it('logs a meal from text with goal-aware insight', async () => {
    const res = await request<Meal>('POST', '/api/meals', { eatenAt: now, localDate: today, text: 'un croissant et un café avec deux sucres' });
    expect(res.status).toBe(201);
    meal = res.body;
    expect(meal.items).toHaveLength(2);
    expect(meal.totals.addedSugar).toBe(15);
    expect(meal.insight?.flags[0]?.nutrient).toBe('addedSugar');
    expect(meal.insight?.flags[0]?.share).toBeCloseTo(0.6, 2);
    expect(meal.insight?.clarification?.options).toEqual(['Oui', 'Non']);
  });

  it('rejects non-food', async () => {
    const res = await request<{ error: { code: string } }>('POST', '/api/meals', { eatenAt: now, localDate: today, text: 'une chaise' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('not_food');
  });

  it('stores photos and serves them only to their owner', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]).toString('base64');
    const res = await request<Meal>('POST', '/api/meals', { eatenAt: now, localDate: today, photoBase64: jpeg });
    expect(res.status).toBe(201);
    const photo = await app.request(`/api/photos/${res.body.photoId}`, { headers: { authorization: `Bearer ${token}` } });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect((await request('DELETE', `/api/meals/${res.body.id}`)).status).toBe(204);
    const gone = await app.request(`/api/photos/${res.body.photoId}`, { headers: { authorization: `Bearer ${token}` } });
    expect(gone.status).toBe(404);

    const png = await request('POST', '/api/meals', { eatenAt: now, localDate: today, photoBase64: Buffer.from('hello').toString('base64') });
    expect(png.status).toBe(415);
  });

  it('rescales portions exactly when items are edited', async () => {
    const items = meal.items.map((item, i) => (i === 0 ? { ...item, grams: 120 } : item));
    const res = await request<Meal>('PATCH', `/api/meals/${meal.id}`, { items, favorite: true });
    expect(res.status).toBe(200);
    expect(res.body.totals.kcal).toBe(Math.round(406 * 1.2 + 28 * 1.5));
    expect(res.body.favorite).toBe(true);
    expect(res.body.insight?.headline).toContain('sucres ajoutés');
    expect(res.body.insight?.clarification).toBeNull();
  });

  it('refines a meal with a correction', async () => {
    const res = await request<Meal>('POST', `/api/meals/${meal.id}/refine`, { correction: 'pas de café' });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(calls).toContain('analyze:pas de café');
  });

  it('logs barcoded products with inferred added sugar', async () => {
    const product = await request<Meal['items'][number]>('GET', '/api/foods/barcode/3017620422003');
    expect(product.status).toBe(200);
    expect(product.body.grams).toBe(15);
    expect(product.body.per100g.addedSugar).toBe(56.3);
    expect(product.body.per100g.sodium).toBeCloseTo(42.8, 1);
    const logged = await request<Meal>('POST', '/api/meals', { eatenAt: now, localDate: today, items: [product.body] });
    expect(logged.status).toBe(201);
    expect(logged.body.title).toBe('Pâte à tartiner');
    expect((await request('GET', '/api/foods/barcode/0000000000000')).status).toBe(404);
  });

  it('summarizes the day with activity and cravings', async () => {
    const act = await request('PUT', '/api/activity', { localDate: today, steps: 9000, activeKcal: 420, weightKg: 74.2, source: 'healthkit' });
    expect(act.status).toBe(200);
    const craving = await request<{ craving: { id: string; tip: string }; alternative: string }>('POST', '/api/cravings', {
      at: now,
      localDate: today,
      what: 'chocolat',
      intensity: 2,
    });
    expect(craving.status).toBe(201);
    expect(craving.body.alternative).toBe('Une pomme');
    await request('PATCH', `/api/cravings/${craving.body.craving.id}`, { outcome: 'resisted' });

    const day = await request<DaySummary>('GET', `/api/days/${today}`);
    expect(day.status).toBe(200);
    expect(day.body.meals).toHaveLength(2);
    expect(day.body.progress[0]?.nutrient).toBe('kcal');
    expect(day.body.progress[1]?.nutrient).toBe('addedSugar');
    expect(day.body.activity?.steps).toBe(9000);
    expect(day.body.cravings).toMatchObject({ total: 1, resisted: 1 });
    expect(day.body.streak).toBe(1);

    const me = await request<{ profile: Profile }>('GET', '/api/me');
    expect(me.body.profile.weightKg).toBe(74.2);
  });

  it('imports weight history from the health store and shows the trend', async () => {
    const samples = [];
    for (let i = 20; i >= 1; i--) {
      const day = addDays(today, -i);
      // Two readings on some days: the latest one of the day wins.
      samples.push({ localDate: day, measuredAt: `${day}T07:00:00Z`, kg: 76 - (20 - i) * 0.1 });
      if (i % 5 === 0) samples.push({ localDate: day, measuredAt: `${day}T21:00:00Z`, kg: 90 });
    }
    const res = await request<{ written: number }>('PUT', '/api/weights', { source: 'healthkit', samples });
    expect(res.status).toBe(200);
    expect(res.body.written).toBe(20);

    // Today's reading came from the activity sync (74.2); it stays the latest.
    const trend = await request<{ points: { date: string; kg: number }[]; latest: { kg: number }; changeKg: number }>('GET', '/api/weights?days=30');
    expect(trend.body.points).toHaveLength(21);
    expect(trend.body.latest.kg).toBe(74.2);
    expect(trend.body.points.find((p) => p.date === addDays(today, -5))?.kg).toBe(90);
    expect(trend.body.changeKg).toBeLessThan(0);

    const me = await request<{ profile: Profile }>('GET', '/api/me');
    expect(me.body.profile.weightKg).toBe(74.2);

    const insights = await request<{ weight: { points: unknown[]; windowDays: number } }>('GET', '/api/insights?days=7');
    expect(insights.body.weight.windowDays).toBe(30);
    expect(insights.body.weight.points).toHaveLength(21);
  });

  it('duplicates meals and builds the quick-log library', async () => {
    const dup = await request<Meal>('POST', `/api/meals/${meal.id}/duplicate`, { eatenAt: now, localDate: today });
    expect(dup.status).toBe(201);
    expect(dup.body.favorite).toBe(false);
    const lib = await request<{ recentItems: { key: string; count: number }[]; favoriteMeals: Meal[] }>('GET', `/api/foods/library?today=${today}`);
    expect(lib.body.recentItems[0]?.key).toBe('croissant au beurre');
    expect(lib.body.recentItems[0]?.count).toBe(2);
    expect(lib.body.favoriteMeals).toHaveLength(1);
  });

  it('computes insights, reviews and coaching', async () => {
    const insights = await request<{ loggedDays: number; topSources: Record<string, { name: string }[]>; byHour: { nutrient: string } }>('GET', '/api/insights?days=7');
    expect(insights.status).toBe(200);
    expect(insights.body.loggedDays).toBe(1);
    expect(insights.body.byHour.nutrient).toBe('addedSugar');
    expect(insights.body.topSources.addedSugar?.map((s) => s.name)).toEqual(['Croissant au beurre', 'Pâte à tartiner']);

    const review = await request<{ headline: string }>('POST', '/api/insights/review', { days: 7 });
    expect(review.body.headline).toBe('Bonne semaine');

    const first = await request<{ reply: { content: string } }>('POST', '/api/coach/messages', { text: 'Que manger ce soir ?', localDate: today });
    expect(first.status).toBe(200);
    expect(first.body.reply.content).toMatch(/kcal/);
    await request('POST', '/api/coach/messages', { text: 'Et demain ?', localDate: today });
    expect(calls).toContain('coach:2');
    const history = await request<unknown[]>('GET', '/api/coach/messages');
    expect(history.body).toHaveLength(4);
  });

  it('streams coach replies as server-sent events', async () => {
    const res = await app.request('/api/coach/messages/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: 'Ajuste mes objectifs', localDate: today }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    const events = body
      .split('\n\n')
      .filter(Boolean)
      .map((block) => ({
        event: /^event: (.*)$/m.exec(block)?.[1],
        data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as Record<string, any>,
      }));
    const deltas = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(deltas).toMatch(/^Tu as mangé \d+ kcal\.$/);
    const done = events.find((e) => e.event === 'done')!;
    expect(done.data.reply.content).toBe(deltas);
    expect(done.data.reply.suggestion.intentions).toContain('fibres');
    const history = await request<unknown[]>('GET', '/api/coach/messages');
    expect(history.body).toHaveLength(6);
  });

  it('exports and deletes the account', async () => {
    const exported = await request<{ meals: unknown[] }>('GET', '/api/me/export');
    expect(exported.body.meals.length).toBeGreaterThan(0);
    expect((await request('DELETE', '/api/me')).status).toBe(204);
    expect((await request('GET', '/api/me')).status).toBe(404);
  });
});

describe('without AI', () => {
  const app = makeApp(createDisabledAi(), { allowSignup: true });

  it('falls back to keyword plans and still logs manual items', async () => {
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co', password: 'password123' }),
    });
    const { token } = (await reg.json()) as AuthResponse;
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
    await app.request('/api/me/profile', { method: 'PUT', headers, body: JSON.stringify(profile) });

    const draft = await app.request('/api/goals/draft', { method: 'POST', headers, body: JSON.stringify({ intentions: 'Perdre du poids et moins de sucre' }) });
    const body = (await draft.json()) as GoalsResponse & { aiGenerated: boolean };
    expect(body.aiGenerated).toBe(false);
    expect(body.plan?.calorieMode).toBe('deficit');
    expect(body.plan?.focus[0]).toBe('addedSugar');

    const ai = await app.request('/api/meals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ eatenAt: toLocalDateTime(), localDate: toLocalDate(), text: 'une pomme' }),
    });
    expect(ai.status).toBe(424);
  });
});

describe('activity guardrails in plans', () => {
  it('derives them from the goals and clamps what the AI proposes', () => {
    expect(heuristicPlan('Je veux faire une prise de muscle', 'fr').activity).toEqual({ weeklyActiveMinutes: 150, dailySteps: null, weeklyStrengthSessions: 3 });
    expect(heuristicPlan('Perdre du poids', 'fr').activity?.dailySteps).toBe(8000);
    const draft = { ...heuristicPlan('Manger équilibré', 'fr'), activity: { weeklyActiveMinutes: 20, dailySteps: 0, weeklyStrengthSessions: 2.4 } };
    expect(planFromDraft(draft, 'Manger équilibré').activity).toEqual({ weeklyActiveMinutes: 60, dailySteps: null, weeklyStrengthSessions: 2 });
  });
});

describe('physical activity', () => {
  const mealInputs: MealAnalysisInput[] = [];
  const coachInputs: CoachInput[] = [];
  const app = makeApp(
    {
      ...fakeAi,
      async analyzeMeal(input) {
        mealInputs.push(input);
        return croissantAnalysis;
      },
      async coach(input) {
        coachInputs.push(input);
        return { reply: 'ok', planChange: null };
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const yesterday = addDays(today, -1);
  const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
  let owner = '';
  let stranger = '';

  const request = async <T,>(method: string, path: string, body?: unknown, token = owner) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const register = async (email: string) => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    return ((await res.json()) as AuthResponse).token;
  };
  const list = (from: string) => request<Workout[]>('GET', `/api/workouts?from=${from}&to=${today}`);

  beforeAll(async () => {
    owner = await register('runner@example.com');
    stranger = await register('stranger@example.com');
    expect((await request('PUT', '/api/me/profile', { ...profile, weightKg: 80 })).status).toBe(200);
  });

  it('imports workouts from the health store without duplicates', async () => {
    const run = { externalId: 'hk-run', type: 'running', startedAt: at(yesterday, '07:00'), localDate: yesterday, durationMin: 30, activeKcal: 300, source: 'healthkit' };
    const yoga = { ...run, externalId: null, type: 'yoga', startedAt: at(yesterday, '19:00'), durationMin: 20, activeKcal: 50 };
    const first = await request<{ written: number }>('PUT', '/api/workouts', { workouts: [run, yoga] });
    expect(first.body.written).toBe(2);
    const again = await request<{ written: number }>('PUT', '/api/workouts', { workouts: [{ ...run, durationMin: 32, activeKcal: 310 }] });
    expect(again.body.written).toBe(1);

    const stored = await list(yesterday);
    expect(stored.body.map((w) => w.type)).toEqual(['running', 'yoga']);
    expect(stored.body[0]).toMatchObject({ externalId: 'hk-run', durationMin: 32, activeKcal: 310, intensity: null, distanceKm: null });
    expect((await request('GET', `/api/workouts?from=${today}&to=${yesterday}`)).status).toBe(400);
  });

  it('estimates the energy of manual workouts from the profile weight', async () => {
    const manual = { source: 'manual', localDate: today };
    // Running, moderate: (9.8 − 1 MET) × 80 kg × 0.5 h = 352 kcal.
    const run = await request<Workout>('POST', '/api/workouts', { ...manual, type: 'running', startedAt: at(today, '07:00'), durationMin: 30 });
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({ activeKcal: 352, intensity: null, externalId: null });
    // (6 − 1) × 80 × 0.75 = 300 and (2.8 − 1) × 80 × 2/3 = 96.
    const lift = await request<Workout>('POST', '/api/workouts', { ...manual, type: 'strength', intensity: 'vigorous', startedAt: at(today, '18:00'), durationMin: 45 });
    expect(lift.body.activeKcal).toBe(300);
    const stroll = await request<Workout>('POST', '/api/workouts', { ...manual, type: 'walking', intensity: 'light', startedAt: at(today, '12:00'), durationMin: 40 });
    expect(stroll.body.activeKcal).toBe(96);
  });

  it('summarizes the day and the week, and budgets manual workouts only without watch data', async () => {
    await request('PUT', '/api/activity', { localDate: yesterday, steps: 6000, source: 'healthkit' });
    await request('PUT', '/api/activity', { localDate: addDays(today, -2), steps: 9000, source: 'healthkit' });
    const plan = heuristicPlan('Prise de muscle', 'fr');
    expect(plan.adjustForActivity).toBe(true);
    await request('PUT', '/api/goals', { plan });

    const day = await request<DaySummary>('GET', `/api/days/${today}`);
    expect(day.body.workouts.map((w) => w.type)).toEqual(['running', 'walking', 'strength']);
    // 32 + 20 yesterday, 30 + 45 today: the easy stroll doesn't count.
    expect(day.body.activityWeek).toEqual({
      activeMinutes: 127,
      strengthSessions: 1,
      workouts: 5,
      avgSteps: 7500,
      goals: { weeklyActiveMinutes: 150, dailySteps: null, weeklyStrengthSessions: 3 },
    });
    expect(day.body.energy).toMatchObject({ source: 'activity', activeKcal: 748 });

    // The watch total already includes the workouts: it replaces them.
    await request('PUT', '/api/activity', { localDate: today, steps: 3000, activeKcal: 500, source: 'healthkit' });
    const synced = await request<DaySummary>('GET', `/api/days/${today}`);
    expect(synced.body.energy.activeKcal).toBe(500);
    expect(synced.body.activityWeek.avgSteps).toBe(6000);
  });

  it('tells the meal analyst about a recent workout', async () => {
    await request('POST', '/api/meals', { eatenAt: at(today, '19:30'), localDate: today, text: 'poulet riz' });
    expect(mealInputs.at(-1)).toMatchObject({
      recentWorkout: { type: 'strength', durationMin: 45, activeKcal: 300, endedMinutesAgo: 45 },
      activityToday: { steps: 3000, activeKcal: 500, workouts: 3 },
    });
    await request('POST', '/api/meals', { eatenAt: at(today, '23:00'), localDate: today, text: 'tisane' });
    expect(mealInputs.at(-1)?.recentWorkout).toBeNull();

    await request('POST', '/api/coach/messages', { text: 'Et ce soir ?', localDate: today });
    const coach = coachInputs.at(-1)!;
    expect(coach.today.workouts.map((w) => w.type)).toEqual(['running', 'walking', 'strength']);
    expect(coach.week.workouts).toHaveLength(5);
    expect(coach.week.activity.activeMinutes).toBe(127);
  });

  it('relates activity to cravings in insights', async () => {
    const item = { ...croissantAnalysis.items[0]!, id: 'croissant', source: 'manual' };
    for (const date of [yesterday, addDays(today, -3), addDays(today, -4)]) {
      await request('POST', '/api/meals', { eatenAt: at(date, '12:00'), localDate: date, items: [item] });
    }
    const crave = (date: string) => request('POST', '/api/cravings', { at: at(date, '16:00'), localDate: date, what: 'chocolat', intensity: 2 });
    await crave(today);
    await crave(addDays(today, -3));
    await crave(addDays(today, -3));
    await crave(addDays(today, -4));

    const { body } = await request<InsightsResponse>('GET', '/api/insights?days=28');
    expect(body.activity.byType).toEqual([
      { type: 'running', sessions: 2, minutes: 62 },
      { type: 'strength', sessions: 1, minutes: 45 },
      { type: 'walking', sessions: 1, minutes: 40 },
      { type: 'yoga', sessions: 1, minutes: 20 },
    ]);
    expect(body.activity.totalMinutes).toBe(127);
    // 127 min over 28 days ≈ 32 min per week.
    expect(body.activity.weeklyMinutes).toBe(32);
    expect(body.activity.days.find((d) => d.date === today)).toEqual({ date: today, activeMinutes: 75, steps: 3000, workouts: 3 });
    // Workout days: today (1 craving) and yesterday (0); rest days: 2 and 1.
    expect(body.activity.cravingsOnActiveDays).toEqual({ active: 0.5, inactive: 1.5 });
    expect(body.activity.goals.weeklyStrengthSessions).toBe(3);
    // Without a watch total, yesterday's budget counts its workouts.
    expect(body.days.find((d) => d.date === yesterday)?.activeKcal).toBe(360);
  });

  it('only lets the owner delete a workout, and exports workouts', async () => {
    const [first] = (await list(yesterday)).body;
    expect((await request('DELETE', `/api/workouts/${first!.id}`, undefined, stranger)).status).toBe(404);
    expect((await list(yesterday)).body).toHaveLength(5);
    expect((await request('DELETE', `/api/workouts/${first!.id}`)).status).toBe(204);
    expect((await request('DELETE', `/api/workouts/${first!.id}`)).status).toBe(404);

    const exported = await request<{ workouts: Workout[] }>('GET', '/api/me/export');
    expect(exported.body.workouts).toHaveLength(4);
  });
});
