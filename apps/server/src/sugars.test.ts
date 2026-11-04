import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AuthResponse, CoachMessage, DaySummary, GoalsResponse, Meal, Profile } from '@symbiose/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMockAi } from './ai/mock';
import { coachText } from './ai/shared';
import type { Ai, CoachInput, PlanDraft, PlanDraftInput } from './ai/types';
import { createApp } from './app';
import { openDb } from './db';
import type { Config } from './env';
import { heuristicPlan, planFromDraft } from './services/goals';
import { PhotoStore } from './services/photos';

/**
 * Sugars beyond added sugar: the blood-sugar mode the planner builds from
 * their words (carbs per meal, fibre, total sugars, a doctor's note), the
 * targets it gets, and the « juice » signal fed to meal insights and the coach.
 */

const dir = mkdtempSync(join(tmpdir(), 'symbiose-sugars-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** What a planner might answer for « prédiabétique, perdre 5 kg »: a steep deficit, no blood-sugar fields. */
const steepDraft: PlanDraft = {
  title: 'Perdre 5 kg',
  summary: 'Un déficit franc.',
  tags: ['lose_weight'],
  calorieMode: 'deficit',
  caloriePercent: 20,
  proteinPerKg: 1.6,
  fatPercent: 30,
  rules: [{ nutrient: 'fiber', kind: 'min', value: 30, reason: 'ANSES' }],
  focus: ['kcal', 'fiber'],
  habits: [],
  coachTone: 'gentle',
  adjustForActivity: true,
  activity: { weeklyActiveMinutes: 150, dailySteps: 8000, weeklyStrengthSessions: null },
};

describe('blood-sugar plans', () => {
  it('turns on from their words, whatever the planner answered, with a gentle deficit at most', () => {
    const plan = planFromDraft(steepDraft, 'Je suis prédiabétique et je voudrais perdre 5 kg');
    expect(plan.tags).toContain('blood_sugar');
    expect(plan.carbsPerMeal).toBe(45);
    expect(plan.focus).toEqual(['carbs', 'kcal', 'fiber']);
    expect(plan.caloriePercent).toBe(10);
  });

  it('keeps the planner’s guide within the advice, and stays off for other goals', () => {
    expect(planFromDraft({ ...steepDraft, tags: ['blood_sugar'], carbsPerMeal: 90 }, 'Stabiliser ma glycémie').carbsPerMeal).toBe(60);
    expect(planFromDraft({ ...steepDraft, carbsPerMeal: 35 }, 'Ma glycémie à jeun est haute').carbsPerMeal).toBe(35);
    const other = planFromDraft({ ...steepDraft, carbsPerMeal: null }, 'Perdre 5 kg');
    expect(other.carbsPerMeal).toBeUndefined();
    expect(other.caloriePercent).toBe(20);
    expect(other.tags).not.toContain('blood_sugar');
  });

  it('builds one without AI: carbs, fibre and total sugars first, practical habits', () => {
    const plan = heuristicPlan('Diabète de type 2, je veux surveiller mon taux de sucre', 'fr');
    expect(plan.tags.slice(0, 2)).toEqual(['blood_sugar', 'reduce_sugar']);
    expect(plan.focus).toEqual(['carbs', 'fiber', 'sugar']);
    expect(plan.carbsPerMeal).toBe(45);
    expect(plan.rules).toContainEqual(expect.objectContaining({ nutrient: 'fiber', kind: 'min', value: 30 }));
    expect(plan.habits.map((h) => h.id)).toEqual(expect.arrayContaining(['veggies-first', 'walk-after-meals']));
    expect(heuristicPlan('Moins de sucre ajouté', 'fr').carbsPerMeal).toBeUndefined();
  });
});

describe('sugars through the API', () => {
  const mock = createMockAi();
  const planInputs: PlanDraftInput[] = [];
  const coachInputs: CoachInput[] = [];
  const ai: Ai = {
    ...mock,
    async draftPlan(input) {
      planInputs.push(input);
      return mock.draftPlan(input);
    },
    async coach(input) {
      coachInputs.push(input);
      return mock.coach(input);
    },
  };
  const config: Config = { port: 0, dataDir: dir, publicUrl: null, jwtSecret: 'test-secret', allowSignup: true, anthropicApiKey: null, anthropicWorkspaceId: null, aiModel: 'fake', aiMock: false, corsOrigins: ['*'] };
  const db = openDb(':memory:');
  const app = createApp({ db, ai, photos: new PhotoStore(db, dir), config, fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch });
  const profile: Profile = { name: 'Anne', sex: 'female', birthYear: 1968, heightCm: 164, weightKg: 74, activityLevel: 'light', locale: 'fr', timezone: 'Europe/Paris' };
  const day = '2026-11-04';
  const at = (time: string) => `${day}T${time}:00+01:00`;
  let token = '';
  const request = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };

  beforeAll(async () => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sugars@local.test', password: 'password123' }) });
    token = ((await res.json()) as AuthResponse).token;
    expect((await request('PUT', '/api/me/profile', profile)).status).toBe(200);
  });

  it('drafts a blood-sugar plan with a carbs « repère », a per-meal guide and the doctor’s note', async () => {
    const draft = await request<GoalsResponse>('POST', '/api/goals/draft', { intentions: 'Je suis prédiabétique, ma glycémie à jeun est un peu haute' });
    expect(draft.status).toBe(200);
    expect(planInputs.at(-1)?.intentions).toContain('prédiabétique');
    const { plan, targets, energy } = draft.body;
    expect(plan?.carbsPerMeal).toBe(45);
    expect(plan?.focus[0]).toBe('carbs');
    expect(plan?.summary).toContain('ne remplace pas l’avis de ton médecin');
    // At most 45 % of energy from carbs, as a « repère »; total sugars at the label's reference intake.
    expect(targets?.carbs).toEqual({ value: Math.round((energy!.goalKcal * 0.45) / 4), kind: 'max' });
    expect(targets?.sugar).toEqual({ value: Math.round(energy!.goalKcal * 0.045), kind: 'max' });
    expect(targets?.fiber).toEqual({ value: 30, kind: 'min' });
    expect((await request('PUT', '/api/goals', { plan })).status).toBe(200);
  });

  it('judges each meal’s carbs against the guide, and notes juice kindly', async () => {
    const breakfast = await request<Meal>('POST', '/api/meals', { eatenAt: at('08:00'), localDate: day, mealType: 'breakfast', text: 'deux tartines et un jus d’orange' });
    expect(breakfast.status).toBe(201);
    expect(breakfast.body.insight?.headline).toMatch(/glucides/);
    expect(breakfast.body.insight?.fruitSugar).toEqual({ grams: 21, sources: ['Jus d’orange'] });
    // Whole fruit never flags.
    const snack = await request<Meal>('POST', '/api/meals', { eatenAt: at('16:00'), localDate: day, mealType: 'snack', text: 'une pomme' });
    expect(snack.body.insight?.fruitSugar).toBeNull();
    // The day leads with carbs, total sugars right behind.
    const summary = await request<DaySummary>('GET', `/api/days/${day}`);
    expect(summary.body.progress.slice(0, 4).map((p) => p.nutrient)).toEqual(['kcal', 'carbs', 'fiber', 'sugar']);
  });

  it('gives the coach the juice signal and today’s carbs per meal, and the coach mentions it', async () => {
    await request<Meal>('POST', '/api/meals', { eatenAt: at('10:30'), localDate: day, mealType: 'snack', text: 'un smoothie' });
    const reply = await request<{ reply: CoachMessage }>('POST', '/api/coach/messages', { text: 'Et mon sucre aujourd’hui ?', localDate: day });
    expect(reply.status).toBe(200);
    const sugars = coachInputs.at(-1)!.sugars!;
    expect(sugars.fruitSugarToday).toEqual({ grams: 49, sources: ['Jus d’orange', 'Smoothie mangue-banane'] });
    expect(sugars.fruitSugarDays7).toBe(1);
    expect(sugars.carbsByMeal?.map((m) => [m.time, m.guide, m.level])).toEqual([
      ['08:00', 45, 'above'],
      ['10:30', 20, 'high'],
      ['16:00', 20, 'within'],
    ]);
    expect(reply.body.reply.content).toMatch(/fruit entier/);
    // The coach's context carries it, with the plan's guide.
    const text = coachText(coachInputs.at(-1)!);
    expect(text).toContain('"carbsPerMeal": 45');
    expect(text).toContain('"fruitSugarToday"');
  }, 15_000);

  it('says nothing about sugars to the coach when there is nothing to say', async () => {
    await request('PUT', '/api/goals', { plan: { ...(await request<GoalsResponse>('GET', '/api/goals')).body.plan!, carbsPerMeal: null, tags: ['reduce_sugar'] } });
    await request('POST', '/api/coach/messages', { text: 'Et la semaine prochaine ?', localDate: '2026-11-20' });
    expect(coachInputs.at(-1)!.sugars).toBeNull();
    expect(coachText(coachInputs.at(-1)!)).not.toContain('"sugars"');
  }, 15_000);
});
