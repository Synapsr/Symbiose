import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addDays,
  toLocalDate,
  toLocalDateTime,
  type AuthResponse,
  type BloodPressureReading,
  type BloodPressureTrend,
  type CoachMealActionResult,
  type CoachMealProposal,
  type CoachMessage,
  type DaySummary,
  type Glance,
  type GoalPlan,
  type GoalsResponse,
  type InsightsResponse,
  type JournalEntry,
  type JournalEntryInput,
  type Meal,
  type MoodCheckIn,
  type Profile,
  type SleepTrend,
  type User,
  type WaterEntry,
  type Workout,
} from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDisabledAi } from './ai/claude';
import { createMockAi } from './ai/mock';
import type { Ai, CoachInput, CravingInput, MealAnalysis, MealAnalysisInput, PlanDraftInput, ReviewInput } from './ai/types';
import { createApp } from './app';
import { openDb } from './db';
import { coachMessages, journalEntries, moods, sleepNights, waterLogs } from './db/schema';
import type { Config } from './env';
import { JSON_BODY_LIMIT, MEAL_BODY_LIMIT } from './http';
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
    return { reply, planChange: wantsChange ? { intentions: 'Moins de sucre et plus de fibres', rationale: 'Les fibres calment les envies.' } : null, mealActions: [] };
  },
  async cravingTip() {
    return { tip: "Bois un verre d'eau.", alternative: 'Une pomme' };
  },
  async review() {
    return { headline: 'Bonne semaine', wins: ['a'], patterns: ['b'], nextSteps: ['c'] };
  },
  async morning() {
    return { text: 'Nuit de 7 h.\nHier : 12 g de sucres ajoutés.\nUn en-cas protéiné vers 15 h 30.' };
  },
  async cravingNudges() {
    return { lines: ['Un verre d’eau ?', 'Quelques noix ?', 'Cinq minutes de marche ?'] };
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
  // The database stays reachable for the tests that simulate stored data.
  return Object.assign(createApp({ db, ai, photos, config, fetch: fakeFetch }), { db });
}

/** JSON request helpers for the suites that juggle several accounts. */
function clientFor(app: ReturnType<typeof makeApp>) {
  return {
    async request<T>(method: string, path: string, token: string, body?: unknown) {
      const res = await app.request(path, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
    },
    async register(email: string) {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' }),
      });
      return ((await res.json()) as AuthResponse).token;
    },
  };
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
    // Admins come from ADMIN_EMAILS, not from being first.
    expect(res.body.user.isAdmin).toBe(false);
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

  it('caps request bodies, with room for a meal photo', async () => {
    // The biggest body the app sends, a full drinks import with the longest ids, stays well under the limit.
    const entries = Array.from({ length: 5000 }, (_, i) => ({ externalId: String(i).padStart(120, 'x'), at: now, localDate: today, ml: 3000 }));
    expect(JSON.stringify({ source: 'healthkit', entries }).length).toBeLessThan(JSON_BODY_LIMIT / 1.5);

    const oversized = await request<{ error: { code: string } }>('PUT', '/api/hydration', { source: 'healthkit', pad: 'x'.repeat(JSON_BODY_LIMIT) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('too_large');

    // A photo bigger than any other body gets through to the photo checks (not a JPEG here).
    const photo = await request('POST', '/api/meals', { eatenAt: now, localDate: today, photoBase64: Buffer.alloc(3 * 1024 * 1024, 1).toString('base64') });
    expect(photo.status).toBe(415);
    const tooBig = await request<{ error: { code: string } }>('POST', '/api/meals', { eatenAt: now, localDate: today, photoBase64: 'A'.repeat(MEAL_BODY_LIMIT) });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe('too_large');
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

  it('gives the watch and widgets their key numbers and meals to re-log', async () => {
    const day = await request<DaySummary>('GET', `/api/days/${today}`);
    const glance = await request<Glance>('GET', `/api/glance?date=${today}`);
    expect(glance.status).toBe(200);
    // A sugar plan at maintenance: added sugar is the hero, calories stay in the background.
    expect(glance.body.hero).toMatchObject({ nutrient: 'addedSugar', unit: 'g', kind: 'max', target: 25, consumed: day.body.totals.addedSugar });
    expect(glance.body.metrics.map((m) => m.nutrient)).toEqual(['addedSugar', 'sugar', 'kcal']);
    expect(glance.body.meals).toBe(day.body.meals.length);
    const titles = glance.body.relog.map((r) => r.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    expect(glance.body.relog.length).toBeLessThanOrEqual(6);

    const hidden = await request<Glance>('GET', `/api/glance?date=${today}&hideCalories=1`);
    expect(hidden.body.metrics.map((m) => m.nutrient)).not.toContain('kcal');
    expect((await request('GET', '/api/glance', undefined, false)).status).toBe(401);
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
    expect(done.data.reply.mealActions).toEqual([]);
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
        return { reply: 'ok', planChange: null, mealActions: [] };
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const yesterday = addDays(today, -1);
  const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
  let owner = '';
  let stranger = '';

  const { request: call, register } = clientFor(app);
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
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

describe('blood pressure', () => {
  const seen = { meal: [] as MealAnalysisInput[], coach: [] as CoachInput[], review: [] as ReviewInput[], plan: [] as PlanDraftInput[] };
  const app = makeApp(
    {
      ...fakeAi,
      async analyzeMeal(input) {
        seen.meal.push(input);
        return croissantAnalysis;
      },
      async draftPlan(input) {
        seen.plan.push(input);
        return fakeAi.draftPlan(input);
      },
      async coach(input) {
        seen.coach.push(input);
        return { reply: 'ok', planChange: null, mealActions: [] };
      },
      async review(input) {
        seen.review.push(input);
        return fakeAi.review(input);
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
  const { request: call, register } = clientFor(app);
  let owner = '';
  let stranger = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const reading = (externalId: string, daysAgo: number, time: string, systolic: number, diastolic: number) => {
    const localDate = addDays(today, -daysAgo);
    return { externalId, measuredAt: at(localDate, time), localDate, systolic, diastolic };
  };

  /** Hits every AI feature once, so `seen` holds what each one was told. */
  const askEverything = async () => {
    await request('POST', '/api/meals', { eatenAt: at(today, '12:00'), localDate: today, text: 'jambon beurre' });
    await request('POST', '/api/coach/messages', { text: 'Ça va ?', localDate: today });
    await request('POST', '/api/insights/review', { days: 7 });
    await request('POST', '/api/goals/draft', { intentions: 'Manger moins salé' });
    return { meal: seen.meal.at(-1)!, coach: seen.coach.at(-1)!, review: seen.review.at(-1)!, plan: seen.plan.at(-1)! };
  };

  beforeAll(async () => {
    owner = await register('cuff@example.com');
    stranger = await register('other-cuff@example.com');
    expect((await request('PUT', '/api/me/profile', profile)).status).toBe(200);
  });

  it('imports readings without duplicates, whatever the opt-in', async () => {
    const first = await request<{ written: number }>('PUT', '/api/blood-pressure', {
      source: 'healthkit',
      readings: [
        { ...reading('hk-1', 2, '07:00', 150, 95), pulse: 70 },
        reading('hk-2', 1, '07:00', 146, 92),
        reading('hk-3', 0, '07:00', 142, 91),
        reading('hk-4', 0, '21:00', 138, 89),
      ],
    });
    expect(first.body.written).toBe(4);
    const again = await request<{ written: number }>('PUT', '/api/blood-pressure', { source: 'healthkit', readings: [{ ...reading('hk-1', 2, '07:00', 152, 95), pulse: 70 }] });
    expect(again.body.written).toBe(1);

    const trend = await request<BloodPressureTrend>('GET', '/api/blood-pressure?days=30');
    expect(trend.body.points).toEqual([
      { date: addDays(today, -2), systolic: 152, diastolic: 95 },
      { date: addDays(today, -1), systolic: 146, diastolic: 92 },
      { date: today, systolic: 140, diastolic: 90 },
    ]);
    expect(trend.body.latest).toMatchObject({ externalId: 'hk-4', systolic: 138, diastolic: 89, pulse: null, source: 'healthkit' });
    // Four readings this week: the category comes from their average, not the last one.
    expect(trend.body.average7).toEqual({ systolic: 145, diastolic: 92 });
    expect(trend.body.category).toBe('grade1');

    // With fewer than 3 readings in the week, the latest one is classified.
    await request('PUT', '/api/blood-pressure', { source: 'health_connect', readings: [reading('hc-1', 0, '08:00', 165, 85)] }, stranger);
    const sparse = await request<BloodPressureTrend>('GET', '/api/blood-pressure', undefined, stranger);
    expect(sparse.body).toMatchObject({ category: 'grade2', windowDays: 90 });
  });

  it('keeps blood pressure out of insights and the AI while tracking is off', async () => {
    const insights = await request<InsightsResponse>('GET', '/api/insights?days=7');
    expect(insights.body.bloodPressure).toBeNull();
    const told = await askEverything();
    expect(told.meal.bloodPressureCategory).toBeNull();
    expect(told.coach.bloodPressure).toBeNull();
    expect(told.review.bloodPressure).toBeNull();
    expect(told.plan.bloodPressure).toBeNull();
  });

  it('shares the trend with insights and the AI once tracking is on', async () => {
    await request('PUT', '/api/me/profile', { ...profile, trackBloodPressure: true });
    const insights = await request<InsightsResponse>('GET', '/api/insights?days=7');
    expect(insights.body.bloodPressure).toMatchObject({ category: 'grade1', average7: { systolic: 145, diastolic: 92 }, windowDays: 30 });

    const told = await askEverything();
    const brief = {
      average7: { systolic: 145, diastolic: 92 },
      category: 'grade1',
      latest: { date: today, systolic: 138, diastolic: 89, pulse: null },
      readings: 4,
      severeLast7Days: 0,
    };
    expect(told.coach.bloodPressure).toEqual(brief);
    expect(told.review.bloodPressure).toEqual(brief);
    expect(told.plan.bloodPressure).toEqual(brief);
    expect(told.meal.bloodPressureCategory).toBe('grade1');

    // A profile form that doesn't know the opt-in leaves it alone.
    await request('PUT', '/api/me/profile', profile);
    expect((await request<{ profile: Profile }>('GET', '/api/me')).body.profile.trackBloodPressure).toBe(true);
  });

  it('counts severe readings, and deletes manual readings only for their owner', async () => {
    const manual = await request<BloodPressureReading>('POST', '/api/blood-pressure', { measuredAt: at(today, '22:00'), localDate: today, systolic: 182, diastolic: 100 });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({ source: 'manual', externalId: null, pulse: null });
    const swapped = await request('POST', '/api/blood-pressure', { measuredAt: at(today, '22:05'), localDate: today, systolic: 80, diastolic: 120 });
    expect(swapped.status).toBe(400);

    await request('POST', '/api/coach/messages', { text: 'Et ma tension ?', localDate: today });
    expect(seen.coach.at(-1)?.bloodPressure).toMatchObject({ severeLast7Days: 1, readings: 5 });

    const exported = await request<{ bloodPressure: BloodPressureReading[] }>('GET', '/api/me/export');
    expect(exported.body.bloodPressure).toHaveLength(5);
    const hk = exported.body.bloodPressure.find((r) => r.externalId === 'hk-1')!;

    expect((await request('DELETE', `/api/blood-pressure/${manual.body.id}`, undefined, stranger)).status).toBe(404);
    expect((await request<{ error: { code: string } }>('DELETE', `/api/blood-pressure/${hk.id}`)).body.error.code).toBe('imported_reading');
    expect((await request('DELETE', `/api/blood-pressure/${manual.body.id}`)).status).toBe(204);
    expect((await request('DELETE', `/api/blood-pressure/${manual.body.id}`)).status).toBe(404);

    // An explicit false turns it off.
    await request('PUT', '/api/me/profile', { ...profile, trackBloodPressure: false });
    expect((await request<InsightsResponse>('GET', '/api/insights?days=7')).body.bloodPressure).toBeNull();
  });
});

describe('coach meal actions', () => {
  const mock = createMockAi();
  const coachInputs: CoachInput[] = [];
  /** Replaces what the coach proposes, to test the server's own checks. */
  let forged: CoachMealProposal | null = null;
  const app = makeApp(
    {
      ...mock,
      async coach(input, onText) {
        coachInputs.push(input);
        const output = await mock.coach(input, onText);
        return forged ? { ...output, mealActions: [forged] } : output;
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const yesterday = addDays(today, -1);
  const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
  const now = at(today, '18:05');
  const { request: call, register } = clientFor(app);
  let owner = '';
  let stranger = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const ask = async (text: string) => (await request<{ reply: CoachMessage }>('POST', '/api/coach/messages', { text, localDate: today })).body.reply;
  const apply = (message: CoachMessage, token = owner) => request<CoachMealActionResult>('POST', `/api/coach/messages/${message.id}/meal-actions/0/apply`, { now }, token);
  const dismiss = (message: CoachMessage) => request<CoachMessage>('POST', `/api/coach/messages/${message.id}/meal-actions/0/dismiss`);
  const mealsOn = async (date: string) => (await request<Meal[]>('GET', `/api/meals?date=${date}`)).body;
  const manualMeal = (localDate: string, time: string, title: string) => ({
    eatenAt: at(localDate, time),
    localDate,
    title,
    items: [{ id: 'm1', name: title, grams: 100, source: 'manual', per100g: { kcal: 250, protein: 12, carbs: 30, sugar: 5, addedSugar: 2, fat: 8, satFat: 3, fiber: 2, sodium: 300 } }],
  });

  let breakfast: Meal;
  let strangerMeal: Meal;
  let addReply: CoachMessage;
  let added: Meal;
  let latestId = '';

  beforeAll(async () => {
    owner = await register('chef@example.com');
    stranger = await register('neighbour@example.com');
    for (const token of [owner, stranger]) expect((await request('PUT', '/api/me/profile', profile, token)).status).toBe(200);
    await request('POST', '/api/meals', manualMeal(addDays(today, -3), '20:00', 'Raclette'));
    breakfast = (await request<Meal>('POST', '/api/meals', manualMeal(yesterday, '08:10', 'Tartines'))).body;
    strangerMeal = (await request<Meal>('POST', '/api/meals', manualMeal(today, '12:00', 'Pizza'), stranger)).body;
  });

  it('shows the coach the meals of the last 3 days with their ids and key numbers', async () => {
    await ask('Que manger ce soir ?');
    expect(coachInputs.at(-1)!.recentMeals).toEqual([{ id: breakfast.id, date: yesterday, time: '08:10', type: 'breakfast', title: 'Tartines', kcal: 250, protein: 12 }]);
  });

  it('proposes an add and logs the meal only once confirmed', async () => {
    addReply = await ask('Ajoute un yaourt et une pomme à 16h');
    expect(addReply.mealActions).toEqual([
      { action: 'add', mealId: null, description: 'un yaourt et une pomme à 16h', mealType: null, localDate: today, time: '16:00', summary: 'Ajouter : un yaourt et une pomme à 16h', status: 'proposed', resultMealId: null },
    ]);
    expect(await mealsOn(today)).toEqual([]);

    const res = await apply(addReply);
    expect(res.status).toBe(200);
    added = res.body.meal!;
    expect(added.eatenAt).toBe(at(today, '16:00'));
    expect(added.items.map((i) => i.name)).toEqual(['Pomme', 'Yaourt aux fruits']);
    expect(res.body.message.mealActions[0]).toMatchObject({ status: 'applied', resultMealId: added.id });
    expect((await mealsOn(today)).map((m) => m.id)).toEqual([added.id]);
  });

  it('applies an action only once, even when confirmed twice at the same time', async () => {
    const again = await apply(addReply);
    expect(again.status).toBe(200);
    expect(again.body.meal?.id).toBe(added.id);

    const reply = await ask('Ajoute une salade');
    const [first, second] = await Promise.all([apply(reply), apply(reply)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    latestId = (first.body.meal ?? second.body.meal)!.id;
    expect((await mealsOn(today)).map((m) => m.id)).toEqual([added.id, latestId]);
  });

  it('carries meal actions in the streamed reply', async () => {
    const res = await app.request('/api/coach/messages/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${owner}` },
      body: JSON.stringify({ text: 'J’ai mangé une pomme', localDate: today }),
    });
    const done = /event: done\ndata: (.*)/.exec(await res.text())?.[1];
    expect((JSON.parse(done!) as { reply: CoachMessage }).reply.mealActions[0]).toMatchObject({ action: 'add', description: 'une pomme', status: 'proposed' });
  });

  it('edits the latest meal once confirmed', async () => {
    const reply = await ask('Corrige : c’était du coca, vers 17h');
    expect(reply.mealActions[0]).toMatchObject({ action: 'edit', mealId: latestId, time: '17:00' });
    const res = await apply(reply);
    expect(res.status).toBe(200);
    expect(res.body.meal).toMatchObject({ id: latestId, eatenAt: at(today, '17:00') });
    expect(res.body.meal?.items.map((i) => i.name)).toContain('Coca-Cola');
    expect(res.body.message.mealActions[0]).toMatchObject({ status: 'applied', resultMealId: latestId });
  });

  it('deletes the latest meal once confirmed', async () => {
    const reply = await ask('Supprime mon dernier repas');
    expect(reply.mealActions[0]).toMatchObject({ action: 'delete', mealId: latestId, description: '' });
    const res = await apply(reply);
    expect(res.status).toBe(200);
    expect(res.body.meal).toBeNull();
    expect(res.body.message.mealActions[0]).toMatchObject({ status: 'applied', resultMealId: null });
    expect((await request('GET', `/api/meals/${latestId}`)).status).toBe(404);
  });

  it('dismisses a proposal without touching the meals', async () => {
    const reply = await ask('Ajoute un croissant');
    const res = await dismiss(reply);
    expect(res.status).toBe(200);
    expect(res.body.mealActions[0]?.status).toBe('dismissed');
    expect((await dismiss(reply)).status).toBe(200);
    expect((await apply(reply)).status).toBe(409);
    expect((await dismiss(addReply)).status).toBe(409);
    expect((await mealsOn(today)).map((m) => m.id)).toEqual([added.id]);
    const history = await request<CoachMessage[]>('GET', '/api/coach/messages');
    expect(history.body.find((m) => m.id === reply.id)?.mealActions[0]?.status).toBe('dismissed');
  });

  it('never touches the meals or proposals of another account', async () => {
    // The coach can only target the meals it was shown.
    forged = { action: 'delete', mealId: strangerMeal.id, description: '', mealType: null, localDate: null, time: null, summary: 'Supprimer : Pizza' };
    const refused = await ask('Supprime la pizza');
    forged = null;
    expect(refused.mealActions).toEqual([]);

    // A stored proposal is checked again when confirmed.
    const reply = await ask('Ajoute un café');
    for (const action of ['edit', 'delete'] as const) {
      const tampered = { ...reply.mealActions[0]!, action, mealId: strangerMeal.id, description: action === 'edit' ? 'sans sucre' : '' };
      app.db.update(coachMessages).set({ mealActions: [tampered] }).where(eq(coachMessages.id, reply.id)).run();
      expect((await apply(reply)).status).toBe(404);
    }
    expect((await request<Meal>('GET', `/api/meals/${strangerMeal.id}`, undefined, stranger)).body.title).toBe('Pizza');
    // Nor can another account confirm someone else's proposal.
    expect((await apply(reply, stranger)).status).toBe(404);
  });

  it('still lists messages saved before meal actions existed', async () => {
    const me = await request<User>('GET', '/api/me');
    app.db.insert(coachMessages).values({ id: 'legacy', userId: me.body.id, role: 'assistant', content: 'Ancien message', suggestion: null, createdAt: '2020-01-01T00:00:00.000Z' }).run();
    const history = await request<CoachMessage[]>('GET', '/api/coach/messages');
    expect(history.status).toBe(200);
    expect(history.body[0]).toMatchObject({ id: 'legacy', suggestion: null, mealActions: [] });
  });
});

describe('adaptive energy', () => {
  const seen = { coach: [] as CoachInput[], review: [] as ReviewInput[] };
  const app = makeApp(
    {
      ...fakeAi,
      async coach(input) {
        seen.coach.push(input);
        return { reply: 'ok', planChange: null, mealActions: [] };
      },
      async review(input) {
        seen.review.push(input);
        return fakeAi.review(input);
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const { request: call, register } = clientFor(app);
  let owner = '';
  let newcomer = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const plan: GoalPlan = {
    intentions: 'Garder la forme',
    title: 'En forme',
    summary: '',
    tags: ['maintain'],
    calorieMode: 'maintain',
    caloriePercent: 0,
    proteinPerKg: 1.2,
    fatPercent: 30,
    rules: [],
    focus: ['kcal'],
    habits: [],
    coachTone: 'gentle',
    adjustForActivity: false,
    overrides: {},
    activity: null,
  };
  /** A day's food as one known item (200 kcal per 100 g), so no AI is involved. */
  const logDay = (date: string, kcal: number, token = owner) =>
    request(
      'POST',
      '/api/meals',
      {
        eatenAt: `${date}T12:30:00+01:00`,
        localDate: date,
        mealType: 'lunch',
        items: [{ id: 'plate', name: 'Assiette', grams: kcal / 2, source: 'manual', per100g: { kcal: 200, protein: 10, carbs: 25, sugar: 3, addedSugar: 0, fat: 6.7, satFat: 2, fiber: 3, sodium: 200 } }],
      },
      token,
    );
  const insights = async (token = owner) => (await request<InsightsResponse>('GET', '/api/insights?days=7', undefined, token)).body.adaptiveEnergy!;
  const day = async (token = owner) => (await request<DaySummary>('GET', `/api/days/${today}`, undefined, token)).body;
  const optIn = (since: string | null) => request<GoalsResponse>('PUT', '/api/goals', { plan: { ...plan, adaptiveEnergy: since ? { since } : null } });

  beforeAll(async () => {
    owner = await register('scale@example.com');
    newcomer = await register('new-scale@example.com');
    for (const token of [owner, newcomer]) {
      expect((await request('PUT', '/api/me/profile', profile, token)).status).toBe(200);
      expect((await request('PUT', '/api/goals', { plan }, token)).status).toBe(200);
    }
    // 8 weeks of 2 300 kcal a day while losing 0.5 kg a week: about 2 850 kcal burned.
    const samples = [];
    for (let i = 56; i >= 1; i--) {
      const date = addDays(today, -i);
      expect((await logDay(date, 2300)).status).toBe(201);
      samples.push({ localDate: date, measuredAt: `${date}T07:00:00Z`, kg: Math.round((82 - (0.5 / 7) * (56 - i)) * 10) / 10 });
    }
    expect((await request('PUT', '/api/weights', { source: 'healthkit', samples })).status).toBe(200);
    // The newcomer only has 3 days.
    for (let i = 3; i >= 1; i--) {
      const date = addDays(today, -i);
      await logDay(date, 2100, newcomer);
      await request('PUT', '/api/weights', { source: 'manual', samples: [{ localDate: date, measuredAt: `${date}T07:00:00Z`, kg: 70 }] }, newcomer);
    }
  });

  it('measures expenditure from the logged meals and the weight trend', async () => {
    const adaptive = await insights();
    expect(adaptive).toMatchObject({ enabled: false, appliedKcal: 0, stepKcal: 100, reasons: [], clamped: false });
    expect(adaptive.window).toEqual({ from: addDays(today, -28), to: addDays(today, -1), days: 28 });
    expect(adaptive.data).toMatchObject({ loggedDays: 28, completeDays: 28, weighIns: 28, avgIntake: 2300, trendKgPerWeek: -0.5 });
    expect(adaptive.estimate).toBeGreaterThan(2780);
    expect(adaptive.estimate).toBeLessThan(2920);
    expect(['medium', 'high']).toContain(adaptive.confidence);
    // Compared with the formula the budget uses today (Mifflin–St Jeor at the latest weight × 1.375).
    const { energy } = await day();
    expect(adaptive.formula).toBe(energy.tdee);
    expect(adaptive.difference).toBe(adaptive.estimate! - adaptive.formula);
    expect(energy.adaptiveKcal).toBe(0);

    const goals = await request<GoalsResponse>('GET', `/api/goals?date=${today}`);
    expect(goals.body.adaptiveEnergy).toMatchObject({ estimate: adaptive.estimate, enabled: false });
  });

  it('says what is missing when there is not enough data yet', async () => {
    const adaptive = await insights(newcomer);
    expect(adaptive.estimate).toBeNull();
    expect(adaptive.reasons).toEqual(['few_days', 'few_complete_days', 'few_weigh_ins']);
    expect(adaptive.missing).toEqual({ days: 11, completeDays: 6, weighIns: 3 });
    // Nothing to tell the AI until there is an estimate or the person opted in.
    await request('POST', '/api/coach/messages', { text: 'Combien je brûle ?', localDate: today }, newcomer);
    expect(seen.coach.at(-1)!.energyExpenditure).toBeNull();
  });

  it('moves the budget by at most 100 kcal a week once opted in', async () => {
    const before = await day();
    expect((await optIn(today)).status).toBe(200);
    // First week: one step toward the measure.
    const first = await day();
    expect(first.energy.adaptiveKcal).toBe(100);
    expect(first.energy.tdee).toBe(before.energy.tdee + 100);
    expect(first.targets.kcal.value).toBe(Math.round((before.energy.tdee + 100) / 10) * 10);

    // Opted in two weeks ago: three weekly steps.
    await optIn(addDays(today, -14));
    const third = await day();
    expect(third.energy.adaptiveKcal).toBe(300);
    expect(await insights()).toMatchObject({ enabled: true, appliedKcal: 300 });
    // Insights budget each day the same way as the day itself.
    expect((await request<InsightsResponse>('GET', '/api/insights?days=7')).body.days.at(-1)!.kcalTarget).toBe(third.targets.kcal.value);
  });

  it('keeps the opt-in across plan changes until it is turned off', async () => {
    // A client that doesn't know the field leaves it alone.
    await request('PUT', '/api/goals', { plan: { ...plan, title: 'Nouveau titre' } });
    expect((await request<User>('GET', '/api/me')).body.plan?.adaptiveEnergy).toEqual({ since: addDays(today, -14) });
    // A new draft keeps it, and its preview budget already includes the shift.
    const draft = await request<GoalsResponse>('POST', '/api/goals/draft', { intentions: 'Je veux garder la forme' });
    expect(draft.body.plan?.adaptiveEnergy).toEqual({ since: addDays(today, -14) });
    expect(draft.body.energy?.adaptiveKcal).toBe(300);

    await optIn(null);
    expect((await day()).energy.adaptiveKcal).toBe(0);
    expect((await insights()).enabled).toBe(false);
  });

  it('never goes below the safety floor, even when the measure is low', async () => {
    // Someone who notes only part of what they eat: 1 600 kcal a day for a stable weight.
    const light = await register('light-logger@example.com');
    await request('PUT', '/api/me/profile', profile, light);
    await request('PUT', '/api/goals', { plan: { ...plan, calorieMode: 'deficit', caloriePercent: 25, adaptiveEnergy: { since: addDays(today, -42) } } }, light);
    const samples = [];
    for (let i = 42; i >= 1; i--) {
      const date = addDays(today, -i);
      await logDay(date, 1600, light);
      samples.push({ localDate: date, measuredAt: `${date}T07:00:00Z`, kg: 75 });
    }
    await request('PUT', '/api/weights', { source: 'healthkit', samples }, light);
    const adaptive = await insights(light);
    // Pulled back to 1.1 × BMR, and not fully trusted.
    expect(adaptive).toMatchObject({ clamped: true, confidence: 'medium' });
    const { energy } = await day(light);
    expect(energy.adaptiveKcal).toBeLessThan(-300);
    // The deficit never takes the budget under basal needs.
    expect(energy.goalKcal).toBeGreaterThanOrEqual(energy.bmr - 5);
  });

  it('tells the coach and the review, with what the budget does', async () => {
    await optIn(addDays(today, -14));
    const adaptive = await insights();
    await request('POST', '/api/coach/messages', { text: 'Pourquoi mon budget a bougé ?', localDate: today });
    const brief = seen.coach.at(-1)!.energyExpenditure!;
    expect(brief).toEqual({
      estimateKcal: adaptive.estimate,
      formulaKcal: adaptive.formula,
      confidence: adaptive.confidence,
      windowDays: 28,
      completeDays: 28,
      weighIns: 28,
      trendKgPerWeek: -0.5,
      autoAdjust: true,
      appliedKcal: 300,
    });

    await request('POST', '/api/insights/review', { days: 7 });
    expect(seen.review.at(-1)!.energyExpenditure).toEqual(brief);

    // Opted in without enough data: the coach knows what's missing.
    await request('PUT', '/api/goals', { plan: { ...plan, adaptiveEnergy: { since: today } } }, newcomer);
    await request('POST', '/api/coach/messages', { text: 'Et moi ?', localDate: today }, newcomer);
    expect(seen.coach.at(-1)!.energyExpenditure).toMatchObject({ estimateKcal: null, autoAdjust: true, appliedKcal: 0, missing: { days: 11, completeDays: 6, weighIns: 3 } });
  });
});

describe('life modules', () => {
  const seen = { coach: [] as CoachInput[], review: [] as ReviewInput[], craving: [] as CravingInput[] };
  const app = makeApp(
    {
      ...fakeAi,
      async coach(input) {
        seen.coach.push(input);
        return { reply: 'ok', planChange: null, mealActions: [] };
      },
      async review(input) {
        seen.review.push(input);
        return fakeAi.review(input);
      },
      async cravingTip(input) {
        seen.craving.push(input);
        return fakeAi.cravingTip(input);
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const yesterday = addDays(today, -1);
  const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
  const { request: call, register } = clientFor(app);
  let owner = '';
  let stranger = '';
  let ownerId = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const her: Profile = { ...profile, sex: 'female', weightKg: 62 };
  const track = (modules: Partial<Profile>, token = owner) => request('PUT', '/api/me/profile', { ...her, ...modules }, token);
  /** A night that ends at 07:00 `daysAgo` days ago, after `asleepMin` minutes asleep. */
  const night = (daysAgo: number, asleepMin: number, bed = '23:30') => {
    const localDate = addDays(today, -daysAgo);
    const bedDate = bed < '12:00' ? localDate : addDays(localDate, -1);
    return { localDate, bedtime: at(bedDate, bed), wakeTime: at(localDate, '07:00'), asleepMin, inBedMin: asleepMin + 20 };
  };
  const day = async () => (await request<DaySummary>('GET', `/api/days/${today}`)).body;
  const insights = async () => (await request<InsightsResponse>('GET', '/api/insights?days=7')).body;
  const askCoach = async () => {
    await request('POST', '/api/coach/messages', { text: 'Comment je vais ?', localDate: today });
    return seen.coach.at(-1)!;
  };

  beforeAll(async () => {
    owner = await register('life@example.com');
    stranger = await register('other-life@example.com');
    ownerId = (await request<User>('PUT', '/api/me/profile', her)).body.id;
    await request('PUT', '/api/me/profile', her, stranger);
  });

  it('imports nights from the health store, one per wake-up day, without duplicates', async () => {
    const first = await request<{ written: number }>('PUT', '/api/sleep', {
      source: 'healthkit',
      nights: [night(2, 420, '23:00'), night(1, 360, '00:30'), night(0, 450)],
    });
    expect(first.body.written).toBe(3);
    // The watch synced more of last night: importing it again replaces it.
    await request('PUT', '/api/sleep', { source: 'healthkit', nights: [night(0, 470)] });

    const trend = await request<SleepTrend>('GET', '/api/sleep?days=7');
    expect(trend.body.nights.map((n) => [n.localDate, n.asleepMin])).toEqual([
      [addDays(today, -2), 420],
      [yesterday, 360],
      [today, 470],
    ]);
    expect(trend.body).toMatchObject({ averageMin: 417, bedtime: '23:40', wakeTime: '07:00', cravingsAfterShortNights: null, windowDays: 7 });
    // Middles of the night at 03:00, 03:45 and 03:15: a spread of about 19 minutes.
    expect(trend.body.regularityMin).toBe(19);
    expect((await request('PUT', '/api/sleep', { source: 'healthkit', nights: [{ ...night(0, 470), asleepMin: 2000 }] })).status).toBe(400);
  });

  it('keeps the modules out of the day, insights and the AI while they are off', async () => {
    expect((await request<WaterEntry>('POST', '/api/hydration', { at: at(today, '08:00'), localDate: today, ml: 250 })).status).toBe(201);

    const summary = await day();
    expect([summary.sleep, summary.hydration, summary.mood]).toEqual([null, null, null]);
    const stats = await insights();
    expect([stats.sleep, stats.hydration, stats.mood]).toEqual([null, null, null]);
    expect((await askCoach()).life).toEqual({});
  });

  it('counts a mood logged from « + » whatever the Humeur switch, which only adds the pill on Today', async () => {
    expect((await request('PUT', '/api/mood', { at: at(today, '09:00'), localDate: today, mood: 2 })).status).toBe(200);
    expect((await day()).mood).toMatchObject({ mood: 2, at: at(today, '09:00') });
    expect((await insights()).mood).toMatchObject({ days: [{ date: today, mood: 2 }], average: 2 });
    expect(Object.keys((await askCoach()).life)).toEqual(['mood']);
    await request('POST', '/api/cravings', { at: at(today, '16:00'), localDate: today, what: 'chocolat', intensity: 2 });
    expect(seen.craving.at(-1)?.life).toEqual({ mood: expect.objectContaining({ today: { mood: 2, note: null, time: '09:00' } }) });
  });

  it('sets a drinks goal from the profile and the workouts, logs glasses and imports drinks once', async () => {
    await track({ trackHydration: true });
    expect((await day()).hydration).toMatchObject({ totalMl: 250, goalMl: 1600 });

    const glass = await request<WaterEntry>('POST', '/api/hydration', { at: at(today, '10:00'), localDate: today, ml: 500, externalId: 'ignored' });
    expect(glass.body).toMatchObject({ ml: 500, source: 'manual', externalId: null });
    const imported = {
      source: 'healthkit',
      entries: [
        { externalId: 'hk-w1', at: at(today, '11:00'), localDate: today, ml: 330 },
        { externalId: 'hk-w2', at: at(yesterday, '12:00'), localDate: yesterday, ml: 1700 },
      ],
    };
    expect((await request<{ written: number }>('PUT', '/api/hydration', imported)).body.written).toBe(2);
    await request('PUT', '/api/hydration', imported);
    // A 320 kcal run adds about as many ml, rounded to 50.
    await request('POST', '/api/workouts', { type: 'running', startedAt: at(today, '07:00'), localDate: today, durationMin: 30, activeKcal: 320, source: 'manual' });
    const hydration = (await day()).hydration!;
    expect(hydration).toMatchObject({ totalMl: 1080, goalMl: 1900 });
    expect(hydration.entries.map((e) => e.ml)).toEqual([250, 500, 330]);

    expect((await request('DELETE', `/api/hydration/${glass.body.id}`, undefined, stranger)).status).toBe(404);
    const hk = hydration.entries.find((e) => e.externalId === 'hk-w1')!;
    expect((await request<{ error: { code: string } }>('DELETE', `/api/hydration/${hk.id}`)).body.error.code).toBe('imported_drink');
    expect((await request('DELETE', `/api/hydration/${glass.body.id}`)).status).toBe(204);
    expect((await day()).hydration?.totalMl).toBe(580);

    const trend = (await insights()).hydration!;
    expect(trend.days).toHaveLength(7);
    expect(trend).toMatchObject({ averageMl: 1140, daysLogged: 2, daysReached: 1, windowDays: 7 });
  });

  it('keeps one mood check-in per day, the latest one', async () => {
    await track({ trackHydration: true, trackMood: true });
    expect((await day()).mood).toMatchObject({ mood: 2, note: null, at: at(today, '09:00') });
    const update = await request<MoodCheckIn>('PUT', '/api/mood', { at: at(today, '18:00'), localDate: today, mood: 4, note: '  Bonne journée ' });
    expect(update.body).toMatchObject({ localDate: today, mood: 4, note: 'Bonne journée', at: at(today, '18:00') });
    expect((await day()).mood).toMatchObject({ mood: 4, note: 'Bonne journée' });
    expect((await request('PUT', '/api/mood', { at: at(today, '18:05'), localDate: today, mood: 6 })).status).toBe(400);

    expect((await request('DELETE', `/api/mood/${today}`)).status).toBe(204);
    expect((await request('DELETE', `/api/mood/${today}`)).status).toBe(404);
    expect((await day()).mood).toBeNull();
    await request('PUT', '/api/mood', { at: at(today, '18:00'), localDate: today, mood: 4, note: 'Bonne journée' });
  });

  it('relates mood and cravings to short nights, humbly, and tells the AI', async () => {
    await track({ trackHydration: true, trackMood: true, trackSleep: true });
    // Short nights on odd days, with a low mood and a craving; good nights on even days.
    const nights = [1, 2, 3, 4, 5, 6].map((d) => night(d, d % 2 ? 300 : 480));
    await request('PUT', '/api/sleep', { source: 'health_connect', nights: [...nights, night(0, 450)] });
    for (const d of [1, 2, 3, 4, 5, 6]) {
      const date = addDays(today, -d);
      await request('PUT', '/api/mood', { at: at(date, '20:00'), localDate: date, mood: d % 2 ? 2 : 4 });
      if (d % 2) await request('POST', '/api/cravings', { at: at(date, '16:00'), localDate: date, what: 'sucre', intensity: 2 });
    }

    expect((await day()).sleep).toMatchObject({ localDate: today, asleepMin: 450, source: 'health_connect' });
    const stats = await insights();
    // One craving after each short night; today's single craving over four good nights.
    expect(stats.sleep).toMatchObject({ averageMin: 399, cravingsAfterShortNights: { short: 1, normal: 0.3 } });
    expect(stats.mood).toMatchObject({
      average: 3.1,
      persistentLow: false,
      windowDays: 30,
      link: { factor: 'shortSleep', withAvg: 2, withoutAvg: 4, withDays: 3, withoutDays: 4 },
    });

    const life = (await askCoach()).life;
    expect(life.sleep).toEqual({
      lastNight: { date: today, asleepMin: 450, bedtime: '23:30', wakeTime: '07:00' },
      average7Min: 399,
      nights7: 7,
      shortNights7: 3,
      cravingsAfterShortNights: { short: 1, normal: 0.3 },
    });
    expect(life.hydration).toEqual({ todayMl: 580, goalMl: 1900, average7Ml: 1700, daysReached7: 1 });
    expect(life.mood).toMatchObject({ today: { mood: 4, note: 'Bonne journée', time: '18:00' }, average7: 3.1, persistentLow: false, link: { factor: 'shortSleep' } });
    expect(life.mood?.last7).toHaveLength(7);

    await request('POST', '/api/cravings', { at: at(today, '17:00'), localDate: today, what: 'gâteau', intensity: 3 });
    expect(seen.craving.at(-1)?.life).toMatchObject({ sleep: { lastNight: { asleepMin: 450 } }, hydration: { todayMl: 580 }, mood: { today: { mood: 4 } } });

    // The review sees the trends through the insights.
    const item = { ...croissantAnalysis.items[0]!, id: 'croissant', source: 'manual' };
    await request('POST', '/api/meals', { eatenAt: at(today, '08:00'), localDate: today, items: [item] });
    await request('POST', '/api/insights/review', { days: 7 });
    expect(seen.review.at(-1)?.insights.mood?.link?.factor).toBe('shortSleep');
    expect(seen.review.at(-1)?.insights.sleep?.nights).toHaveLength(7);
  });

  it('gently flags very low moods only when they last', async () => {
    await track({ trackMood: true }, stranger);
    for (const d of [5, 3, 2, 1]) await request('PUT', '/api/mood', { at: at(addDays(today, -d), '21:00'), localDate: addDays(today, -d), mood: 1 }, stranger);
    await request('PUT', '/api/mood', { at: at(today, '09:00'), localDate: today, mood: 2 }, stranger);
    expect((await request<InsightsResponse>('GET', '/api/insights?days=7', undefined, stranger)).body.mood).toMatchObject({ persistentLow: true, link: null });
    await request('POST', '/api/coach/messages', { text: 'Bof', localDate: today }, stranger);
    expect(seen.coach.at(-1)?.life.mood?.persistentLow).toBe(true);
    // A better day: four very low days still, but the latest isn't low anymore.
    await request('PUT', '/api/mood', { at: at(today, '19:00'), localDate: today, mood: 4 }, stranger);
    expect((await request<InsightsResponse>('GET', '/api/insights?days=7', undefined, stranger)).body.mood?.persistentLow).toBe(false);
  });

  it('keeps the switches when an older profile form saves, exports everything and deletes it with the account', async () => {
    await request('PUT', '/api/me/profile', her);
    expect((await request<User>('GET', '/api/me')).body.profile).toMatchObject({ trackSleep: true, trackHydration: true, trackMood: true });
    await track({ trackSleep: false, trackHydration: true, trackMood: true });
    expect((await day()).sleep).toBeNull();
    expect((await askCoach()).life.sleep).toBeUndefined();

    const exported = await request<{ sleep: unknown[]; hydration: WaterEntry[]; mood: MoodCheckIn[] }>('GET', '/api/me/export');
    expect(exported.body.sleep).toHaveLength(7);
    expect(exported.body.hydration).toHaveLength(3);
    expect(exported.body.mood).toHaveLength(7);

    expect((await request('DELETE', '/api/me')).status).toBe(204);
    for (const table of [sleepNights, waterLogs, moods]) expect(app.db.select().from(table).where(eq(table.userId, ownerId)).all()).toEqual([]);
  });
});

describe('meals sent late from the offline queue', () => {
  const mealInputs: MealAnalysisInput[] = [];
  const app = makeApp(
    {
      ...fakeAi,
      async analyzeMeal(input) {
        mealInputs.push(input);
        return croissantAnalysis;
      },
    },
    { allowSignup: true },
  );
  const { request: call, register } = clientFor(app);
  let token = '';
  const request = <T,>(method: string, path: string, body?: unknown) => call<T>(method, path, token, body);
  const day = '2026-10-30';

  beforeAll(async () => {
    token = await register('offline@example.com');
    expect((await request('PUT', '/api/me/profile', profile)).status).toBe(200);
  });

  it('keeps the exact capture time, which is what the app matches a lost response on', async () => {
    const eatenAt = `${day}T12:30:07+01:00`;
    expect((await request<Meal>('POST', '/api/meals', { eatenAt, localDate: day, text: 'une salade' })).status).toBe(201);
    const listed = await request<Meal[]>('GET', `/api/meals?date=${day}`);
    expect(listed.body.filter((m) => m.eatenAt === eatenAt)).toHaveLength(1);
  });

  it('analyses a late meal with only what was eaten before it', async () => {
    await request('POST', '/api/meals', { eatenAt: `${day}T20:00:00+01:00`, localDate: day, text: 'le dîner' });
    // The breakfast captured offline arrives after dinner.
    await request('POST', '/api/meals', { eatenAt: `${day}T08:00:00+01:00`, localDate: day, text: 'le petit-déjeuner' });
    const breakfast = mealInputs.find((i) => i.text === 'le petit-déjeuner')!;
    expect(breakfast.dayTotalsBefore.kcal).toBe(0);
    const dinner = mealInputs.find((i) => i.text === 'le dîner')!;
    expect(dinner.dayTotalsBefore.kcal).toBeGreaterThan(0); // the 12:30 salad
    await request('POST', '/api/meals', { eatenAt: `${day}T22:00:00+01:00`, localDate: day, text: 'une tisane' });
    const late = mealInputs.find((i) => i.text === 'une tisane')!;
    expect(late.dayTotalsBefore.kcal).toBeGreaterThan(dinner.dayTotalsBefore.kcal);
  });
});

describe('health journal', () => {
  const seen = { coach: [] as CoachInput[], review: [] as ReviewInput[] };
  const app = makeApp(
    {
      ...fakeAi,
      async coach(input) {
        seen.coach.push(input);
        return { reply: 'ok', planChange: null, mealActions: [] };
      },
      async review(input) {
        seen.review.push(input);
        return fakeAi.review(input);
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
  const { request: call, register } = clientFor(app);
  let owner = '';
  let stranger = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const note = (daysAgo: number, time: string, fields: Partial<JournalEntryInput>, token = owner) => {
    const localDate = addDays(today, -daysAgo);
    return request<JournalEntry>('POST', '/api/journal', { at: at(localDate, time), localDate, ...fields }, token);
  };

  beforeAll(async () => {
    owner = await register('carnet@example.com');
    stranger = await register('other-carnet@example.com');
    for (const token of [owner, stranger]) expect((await request('PUT', '/api/me/profile', profile, token)).status).toBe(200);
    await request('POST', '/api/meals', { eatenAt: at(today, '12:00'), localDate: today, text: 'croissant' });
  });

  it('writes notes in a few taps and lists them newest first, by days and kind', async () => {
    const transit = await note(0, '08:10', { kind: 'transit' });
    expect(transit.status).toBe(201);
    expect(transit.body).toMatchObject({ kind: 'transit', text: '', data: {}, localDate: today });
    // Fields that don't belong to the kind are dropped.
    const detailed = await note(1, '07:45', { kind: 'transit', text: '  Un peu long  ', data: { bristol: 2, ease: 'difficult', feeling: 2 } });
    expect(detailed.body).toMatchObject({ text: 'Un peu long', data: { bristol: 2, ease: 'difficult' } });
    expect(detailed.body.data).not.toHaveProperty('feeling');
    // Older apps still write « Ressenti » notes: they are kept, and read as the day's mood.
    expect((await note(0, '15:00', { kind: 'feeling', data: { feeling: 4 } })).status).toBe(201);
    expect((await note(2, '21:00', { text: 'Dîner tard, ventre gonflé' })).body.kind).toBe('other');
    // Words, or a face for a feeling: an empty note isn't one.
    expect((await note(0, '16:00', { kind: 'symptom' })).status).toBe(400);
    expect((await note(0, '16:00', { kind: 'feeling' })).status).toBe(400);

    const day = (date: string) => (date === today ? 0 : date === addDays(today, -1) ? 1 : 2);
    const all = await request<JournalEntry[]>('GET', '/api/journal');
    expect(all.body.map((e) => `${day(e.localDate)}:${e.kind}`)).toEqual(['0:feeling', '0:transit', '1:transit', '2:other']);
    expect((await request<JournalEntry[]>('GET', `/api/journal?kind=transit&from=${addDays(today, -1)}&to=${today}`)).body).toHaveLength(2);
    expect((await request<JournalEntry[]>('GET', `/api/journal?from=${today}&to=${today}`)).body).toHaveLength(2);
    expect((await request('GET', `/api/journal?from=${today}&to=${addDays(today, -1)}`)).status).toBe(400);
    expect((await request<JournalEntry[]>('GET', '/api/journal', undefined, stranger)).body).toEqual([]);
  });

  it('edits and deletes only the owner’s notes', async () => {
    const created = (await note(0, '18:00', { kind: 'symptom', text: 'Mal de tête' })).body;
    expect((await request('PATCH', `/api/journal/${created.id}`, { text: 'Pirate' }, stranger)).status).toBe(404);
    expect((await request('DELETE', `/api/journal/${created.id}`, undefined, stranger)).status).toBe(404);

    // Becoming a feeling, it keeps its words and takes a face.
    const edited = await request<JournalEntry>('PATCH', `/api/journal/${created.id}`, { kind: 'feeling', data: { feeling: 2, bristol: 4 } });
    expect(edited.body).toMatchObject({ kind: 'feeling', text: 'Mal de tête', data: { feeling: 2 } });
    expect(edited.body.data).not.toHaveProperty('bristol');
    const moved = await request<JournalEntry>('PATCH', `/api/journal/${created.id}`, { at: at(addDays(today, -1), '09:00'), localDate: addDays(today, -1) });
    expect(moved.body.localDate).toBe(addDays(today, -1));
    expect((await request('PATCH', `/api/journal/${created.id}`, { at: at(today, '09:00') })).status).toBe(400);
    // A symptom without words says nothing.
    expect((await request('PATCH', `/api/journal/${created.id}`, { kind: 'symptom', text: '' })).status).toBe(400);

    expect((await request('DELETE', `/api/journal/${created.id}`)).status).toBe(204);
    expect((await request('DELETE', `/api/journal/${created.id}`)).status).toBe(404);
  });

  it('tells the coach the last 14 days, compact, with the transit frequency', async () => {
    await note(20, '08:00', { kind: 'transit', text: 'Trop ancien pour le coach' });
    await note(3, '22:00', { kind: 'medication', text: 'x'.repeat(1000) });
    await request('POST', '/api/coach/messages', { text: 'Mon ventre ?', localDate: today });
    const journal = seen.coach.at(-1)!.journal!;
    // Today's « Ressenti » face is the day's mood: the coach reads it there, once.
    expect(journal.entries.map((e) => e.kind)).toEqual(['medication', 'other', 'transit', 'transit']);
    expect(seen.coach.at(-1)!.life.mood).toMatchObject({ today: { mood: 4, note: null, time: '15:00' }, last7: [{ date: today, mood: 4 }] });
    expect(journal.entries[1]).toEqual({ date: addDays(today, -2), time: '21:00', kind: 'other', text: 'Dîner tard, ventre gonflé' });
    expect(journal.entries[2]).toEqual({ date: addDays(today, -1), time: '07:45', kind: 'transit', consistency: 'hard', bristol: 2, ease: 'difficult', text: 'Un peu long' });
    expect(journal.entries[0]!.text).toHaveLength(280);
    // Counted over the whole window: transits were tracked before it started.
    expect(journal.transit).toMatchObject({ days: 14, total: 2, perDay: 0.1, daysSinceLast: 0, longestGap: 12, difficult: 1, painful: 0 });
    expect(journal.omitted).toBe(0);

    // Past the overall cap, the oldest notes are left out.
    for (let i = 0; i < 30; i++) await note(4 + (i % 8), '12:00', { text: `Note ${i} ${'y'.repeat(400)}` });
    await request('POST', '/api/coach/messages', { text: 'Et maintenant ?', localDate: today });
    const capped = seen.coach.at(-1)!.journal!;
    expect(capped.omitted).toBeGreaterThan(0);
    expect(JSON.stringify(capped.entries).length).toBeLessThanOrEqual(6100);
    expect(capped.entries.at(-1)).toMatchObject({ kind: 'transit', date: today });

    // No notes, no journal.
    await request('POST', '/api/coach/messages', { text: 'Salut', localDate: today }, stranger);
    expect(seen.coach.at(-1)!.journal).toBeNull();
  });

  it('gives the review the period’s notes, and a new note refreshes it', async () => {
    await request('POST', '/api/insights/review', { days: 7 });
    const reviews = seen.review.length;
    expect(seen.review.at(-1)!.journal!.entries.every((e) => e.date >= addDays(today, -6))).toBe(true);
    expect(seen.review.at(-1)!.journal!.transit).toMatchObject({ days: 7, total: 2 });
    await request('POST', '/api/insights/review', { days: 7 });
    expect(seen.review).toHaveLength(reviews);
    await note(0, '19:00', { kind: 'transit', data: { bristol: 4, ease: 'easy' } });
    await request('POST', '/api/insights/review', { days: 7 });
    expect(seen.review).toHaveLength(reviews + 1);
  });

  it('exports the notes and deletes them with the account', async () => {
    const exported = await request<{ journal: JournalEntry[] }>('GET', '/api/me/export');
    expect(exported.body.journal.length).toBeGreaterThan(30);
    const userId = (await request<User>('GET', '/api/me')).body.id;
    expect((await request('DELETE', '/api/me')).status).toBe(204);
    expect(app.db.select().from(journalEntries).where(eq(journalEntries.userId, userId)).all()).toEqual([]);
  });
});

describe('one mood: check-ins and the older « Ressenti » notes', () => {
  const seen = { coach: [] as CoachInput[], review: [] as ReviewInput[] };
  const app = makeApp(
    {
      ...fakeAi,
      async coach(input) {
        seen.coach.push(input);
        return { reply: 'ok', planChange: null, mealActions: [] };
      },
      async review(input) {
        seen.review.push(input);
        return fakeAi.review(input);
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const at = (date: string, time: string) => `${date}T${time}:00+01:00`;
  const { request: call, register } = clientFor(app);
  let owner = '';
  let stranger = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const ago = (days: number) => addDays(today, -days);
  const feeling = (daysAgo: number, time: string, face: number | undefined, text = '') =>
    request<JournalEntry>('POST', '/api/journal', { at: at(ago(daysAgo), time), localDate: ago(daysAgo), kind: 'feeling', text, data: face === undefined ? {} : { feeling: face } });
  const checkIn = (daysAgo: number, mood: number, note: string | null = null) => request<MoodCheckIn>('PUT', '/api/mood', { at: at(ago(daysAgo), '20:00'), localDate: ago(daysAgo), mood, note });
  let shadowed = '';

  beforeAll(async () => {
    owner = await register('humeur@example.com');
    stranger = await register('other-humeur@example.com');
    // The Humeur switch stays off: these moods were noted in the journal, the way « Ressenti » used to work.
    for (const token of [owner, stranger]) expect((await request('PUT', '/api/me/profile', profile, token)).status).toBe(200);
    // Low on craving days, good on the others: enough for « Les jours où ».
    for (const d of [1, 2, 3, 4, 5, 6]) {
      await feeling(d, '08:00', 5, 'Matin');
      await feeling(d, '21:00', d % 2 ? 2 : 4, d === 1 ? 'Journée lourde' : '');
      if (d % 2) await request('POST', '/api/cravings', { at: at(ago(d), '16:00'), localDate: ago(d), what: 'sucre', intensity: 2 });
    }
    // A day with both: the check-in wins, the note stays a note.
    shadowed = (await feeling(0, '07:30', 1, 'Réveil difficile')).body.id;
    await checkIn(0, 4, 'Bonne journée');
    // Words without a face carry no mood.
    await feeling(2, '12:00', undefined, 'Un peu à plat');
    await request('POST', '/api/meals', { eatenAt: at(today, '12:00'), localDate: today, text: 'croissant' });
  });

  it('reads a mood a day: the check-in, else the latest face noted, with its words', async () => {
    const trend = (await request<{ days: { date: string; mood: number; note?: string }[]; link: unknown }>('GET', '/api/mood?days=7')).body;
    expect(trend.days).toEqual([
      { date: ago(6), mood: 4 },
      { date: ago(5), mood: 2 },
      { date: ago(4), mood: 4 },
      { date: ago(3), mood: 2 },
      { date: ago(2), mood: 4 },
      { date: ago(1), mood: 2, note: 'Journée lourde' },
      { date: today, mood: 4, note: 'Bonne journée' },
    ]);
    expect(trend.link).toMatchObject({ factor: 'craving', withAvg: 2, withoutAvg: 4 });
    // Today and « + » change the check-in itself: an older note is never edited from there.
    expect((await request<DaySummary>('GET', `/api/days/${ago(1)}`)).body.mood).toBeNull();
    expect((await request<DaySummary>('GET', `/api/days/${today}`)).body.mood).toMatchObject({ mood: 4, note: 'Bonne journée' });
    // « Historique » lists the check-ins next to the notes, newest first.
    const listed = await request<MoodCheckIn[]>('GET', `/api/mood/check-ins?from=${ago(6)}&to=${today}`);
    expect(listed.body.map((c) => [c.localDate, c.mood])).toEqual([[today, 4]]);
    expect((await request('GET', `/api/mood/check-ins?from=${today}&to=${ago(1)}`)).status).toBe(400);
    expect((await request<MoodCheckIn[]>('GET', `/api/mood/check-ins?from=${ago(6)}&to=${today}`, undefined, stranger)).body).toEqual([]);
  });

  it('shows it in Progrès with « Les jours où », switch or not', async () => {
    const insights = (await request<InsightsResponse>('GET', '/api/insights?days=7')).body;
    expect(insights.mood).toMatchObject({ average: 3.1, link: { factor: 'craving' } });
    expect(insights.mood?.days).toHaveLength(7);
    expect((await request<InsightsResponse>('GET', '/api/insights?days=7', undefined, stranger)).body.mood).toBeNull();
  });

  it('tells the coach each mood once, in `life.mood` with its words, never again as a note', async () => {
    await request('POST', '/api/coach/messages', { text: 'Comment je vais ?', localDate: today });
    const input = seen.coach.at(-1)!;
    expect(input.life.mood).toMatchObject({ today: { mood: 4, note: 'Bonne journée', time: '20:00' }, average7: 3.1, link: { factor: 'craving' } });
    expect(input.life.mood?.last7.find((d) => d.date === ago(1))).toEqual({ date: ago(1), mood: 2, note: 'Journée lourde' });
    // Left in the journal: the faces that weren't the day's mood, and words without a face.
    const notes = input.journal!.entries;
    expect(notes.filter((e) => e.kind === 'feeling')).toHaveLength(8);
    expect(notes.find((e) => e.date === today)).toEqual({ date: today, time: '07:30', kind: 'feeling', feeling: 1, text: 'Réveil difficile' });
    expect(notes.find((e) => e.date === ago(2) && e.time === '12:00')).toEqual({ date: ago(2), time: '12:00', kind: 'feeling', text: 'Un peu à plat' });
    expect(notes.some((e) => e.time === '21:00')).toBe(false);
  });

  it('gives the review the same moods once: in the days, with their words, not in the journal', async () => {
    await request('POST', '/api/insights/review', { days: 7 });
    const input = seen.review.at(-1)!;
    expect(input.insights.mood?.days.find((d) => d.date === ago(1))).toEqual({ date: ago(1), mood: 2, note: 'Journée lourde' });
    expect(input.journal!.entries.some((e) => e.kind === 'feeling' && e.time === '21:00')).toBe(false);
    expect(input.journal!.entries.filter((e) => e.kind === 'feeling')).toHaveLength(8);
  });

  it('keeps every older note: nothing is moved or lost', async () => {
    const notes = await request<JournalEntry[]>('GET', '/api/journal?kind=feeling');
    expect(notes.body).toHaveLength(14);
    expect(notes.body.find((e) => e.id === shadowed)).toMatchObject({ data: { feeling: 1 }, text: 'Réveil difficile' });
  });
});

describe('instant cravings', () => {
  const seen: CravingInput[] = [];
  let failNext = false;
  const app = makeApp(
    {
      ...fakeAi,
      async cravingTip(input, onText) {
        seen.push(input);
        if (failNext) {
          failNext = false;
          onText?.('Bois ');
          throw new Error('overloaded');
        }
        const alternative = input.what ? `Moins de ${input.what}` : 'Un fruit';
        for (const part of ['Bois un verre ', "d'eau.", '\n', alternative]) onText?.(part);
        return { tip: "Bois un verre d'eau.", alternative };
      },
    },
    { allowSignup: true },
  );
  const today = toLocalDate();
  const now = toLocalDateTime();
  const { request: call, register } = clientFor(app);
  let owner = '';
  let stranger = '';
  const request = <T,>(method: string, path: string, body?: unknown, token = owner) => call<T>(method, path, token, body);
  const stream = async (id: string, body: unknown = {}, token = owner) => {
    const res = await app.request(`/api/cravings/${id}/tip/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.headers.get('content-type')?.includes('text/event-stream')) return { status: res.status, deltas: '', done: undefined, error: null };
    const events = (await res.text())
      .split('\n\n')
      .filter(Boolean)
      .map((block) => ({ event: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null') as Record<string, any> }));
    return {
      status: res.status,
      deltas: events
        .filter((e) => e.event === 'delta')
        .map((e) => e.data.text)
        .join(''),
      done: events.find((e) => e.event === 'done')?.data as { craving: { id: string; tip: string; what: string }; alternative: string } | undefined,
      error: events.find((e) => e.event === 'error')?.data ?? null,
    };
  };

  beforeAll(async () => {
    owner = await register('envie@example.com');
    stranger = await register('other-envie@example.com');
    for (const token of [owner, stranger]) expect((await request('PUT', '/api/me/profile', profile, token)).status).toBe(200);
  });

  it('saves the craving at once, with nothing said yet and no AI call', async () => {
    const created = await request<{ craving: { id: string }; alternative: string | null }>('POST', '/api/cravings', { at: now, localDate: today, tip: 'stream' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ craving: expect.objectContaining({ what: '', intensity: null, tip: null, outcome: 'pending' }), alternative: null });
    expect(seen).toHaveLength(0);
    const day = await request<DaySummary>('GET', `/api/days/${today}`);
    expect(day.body.cravings).toMatchObject({ total: 1, resisted: 0, items: [{ what: '', intensity: null }] });
  });

  it('streams the advice for the chip just tapped, saves the tip, then settles in one tap', async () => {
    const { body } = await request<{ craving: { id: string } }>('POST', '/api/cravings', { at: now, localDate: today, tip: 'stream' });
    const id = body.craving.id;
    const tip = await stream(id, { what: 'Chocolat' });
    expect(tip.status).toBe(200);
    expect(tip.deltas).toBe("Bois un verre d'eau.\nMoins de Chocolat");
    expect(tip.done).toEqual({ craving: expect.objectContaining({ id, tip: "Bois un verre d'eau.", what: '' }), alternative: 'Moins de Chocolat' });
    expect(seen.at(-1)).toMatchObject({ what: 'Chocolat', intensity: null });

    // The chip, the optional intensity and the outcome are saved as they come.
    expect((await request('PATCH', `/api/cravings/${id}`, {})).status).toBe(400);
    expect((await request('PATCH', `/api/cravings/${id}`, { intensity: 4 })).status).toBe(400);
    expect((await request('PATCH', `/api/cravings/${id}`, { what: 'Chocolat', intensity: 3 })).body).toMatchObject({ what: 'Chocolat', intensity: 3, outcome: 'pending' });
    expect((await request('PATCH', `/api/cravings/${id}`, { outcome: 'resisted' })).body).toMatchObject({ what: 'Chocolat', intensity: 3, outcome: 'resisted', tip: "Bois un verre d'eau." });
    expect((await request('PATCH', `/api/cravings/${id}`, { outcome: 'gave_in' }, stranger)).status).toBe(404);
    expect((await stream(id, {}, stranger)).status).toBe(404);

    // A craving with nothing said counts, without an empty word among the top ones.
    const insights = await request<InsightsResponse>('GET', '/api/insights?days=7');
    expect(insights.body.cravings).toMatchObject({ total: 2, resisted: 1, topWhat: ['Chocolat'] });
  });

  it('falls back to a kind tip when the AI fails mid-way', async () => {
    const { body } = await request<{ craving: { id: string } }>('POST', '/api/cravings', { at: now, localDate: today, tip: 'stream' });
    failNext = true;
    const tip = await stream(body.craving.id);
    expect(tip.error).toBeNull();
    expect(tip.done?.craving.tip).toMatch(/eau|activité/);
    expect(tip.done?.alternative).toBeTruthy();
  });

  it('still answers older apps with the advice inline', async () => {
    const res = await request('POST', '/api/cravings', { at: now, localDate: today, what: 'chips', intensity: 2 });
    expect(res.body).toMatchObject({ craving: { tip: "Bois un verre d'eau.", intensity: 2 }, alternative: 'Moins de chips' });
  });
});
