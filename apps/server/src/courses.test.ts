import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AuthResponse, CoachMealActionResult, CoachMessage, DaySummary, FoodItem, Glance, Meal, Nutrients, Profile, SeparateCourseResult } from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMockAi } from '@symbiose/core/ai/mock';
import type { Ai, AnalyzedItem, CoachInput, MealAnalysis, MealAnalysisInput } from '@symbiose/core/ai/types';
import { createApp } from './app';
import { openDb } from './db';
import { coachMessages, meals } from '@symbiose/core/db/schema';
import type { Config } from './env';
import { PhotoStore } from './services/photos';

/**
 * Meals in courses: the entrée noted, the main photographed 20 min later,
 * then dessert, make one meal with one verdict; a correction applies to the
 * whole meal; words about the past reuse what was logged then.
 */

const dir = mkdtempSync(join(tmpdir(), 'symbiose-courses-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Values whose energy matches their macros (20 % protein, 50 % carbs, 30 % fat), so the server keeps them as they are. */
const per100g = (kcal: number, addedSugar = 0): Nutrients => ({ kcal, protein: kcal / 20, carbs: kcal / 8, sugar: addedSugar, addedSugar, fat: kcal / 30, satFat: 0, fiber: 0, sodium: 100 });
const food = (name: string, grams: number, kcal: number, addedSugar = 0, course = 1): AnalyzedItem => ({ name, emoji: '', portion: '', grams, confidence: 0.8, per100g: per100g(kcal, addedSugar), course });

/** What the fake analyst answers, by what it was asked. */
const FOODS: Record<string, AnalyzedItem> = {
  salade: food('Salade composée', 200, 90),
  poulet: food('Poulet rôti', 150, 215),
  tarte: food('Tarte aux pommes', 120, 255, 11),
  café: food('Café sucré', 150, 22, 2),
  gratin: food('Gratin dauphinois', 300, 145),
};

const analysis = (items: AnalyzedItem[], extra: Partial<MealAnalysis> = {}): MealAnalysis => ({
  isFood: true,
  reusedMeal: null,
  title: items.map((i) => i.name).join(', '),
  mealType: 'lunch',
  courses: [],
  items,
  verdict: 'good',
  headline: 'Un repas',
  tips: [],
  clarification: null,
  ...extra,
});

const inputs: MealAnalysisInput[] = [];
/** Set by a test to answer differently. */
let answer: ((input: MealAnalysisInput) => MealAnalysis) | null = null;

function defaultAnswer(input: MealAnalysisInput): MealAnalysis {
  if (input.assessOnly) {
    const labels = input.meal!.courses.map((c, i) => c.label || `Plat ${i + 1}`);
    return analysis([], { title: 'Repas jugé', headline: `Repas entier : ${input.meal!.courses.length} plats`, courses: labels.length > 1 ? labels : [], verdict: 'ok' });
  }
  const words = `${input.text ?? ''}`.toLowerCase();
  const items = Object.entries(FOODS).filter(([key]) => words.includes(key)).map(([, item]) => item);
  const found = items.length ? items : [FOODS.poulet!];
  if (input.meal) {
    const names = ['Entrée', 'Plat', 'Dessert', 'Café'];
    return analysis(found, { title: 'Déjeuner complet', headline: 'Repas équilibré, le dessert apporte l’essentiel du sucre ajouté.', courses: [...input.meal.courses.map((_, i) => names[i]!), names[input.meal.courses.length] ?? ''] });
  }
  return analysis(found);
}

const mock = createMockAi();
const ai: Ai = {
  ...mock,
  async analyzeMeal(input) {
    inputs.push(input);
    return (answer ?? defaultAnswer)(input);
  },
};

function makeApp() {
  const config: Config = { port: 0, dataDir: dir, publicUrl: null, jwtSecret: 'test-secret', allowSignup: true, anthropicApiKey: null, anthropicWorkspaceId: null, aiModel: 'fake', aiMock: false, corsOrigins: ['*'] };
  const db = openDb(':memory:');
  return Object.assign(createApp({ db, ai, photos: new PhotoStore(db, dir), config, fetch: (async () => new Response('{}', { status: 404 })) as typeof fetch }), { db });
}

const profile: Profile = { name: 'Loan', sex: 'male', birthYear: 1995, heightCm: 178, weightKg: 75, activityLevel: 'light', locale: 'fr', timezone: 'Europe/Paris' };
const jpeg = (fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, fill)]).toString('base64');
const day = '2026-10-31';
const yesterday = '2026-10-30';
const at = (time: string, date = day) => `${date}T${time}:00+01:00`;

describe('meals in courses', () => {
  const app = makeApp();
  let token = '';
  const request = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const log = (body: Record<string, unknown>) => request<Meal>('POST', '/api/meals', { localDate: day, ...body });
  const mealsOn = async (date = day) => (await request<Meal[]>('GET', `/api/meals?date=${date}`)).body;
  const photo = (id: string | null) => app.request(`/api/photos/${id}`, { headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'courses@example.com', password: 'password123' }) });
    token = ((await res.json()) as AuthResponse).token;
    expect((await request('PUT', '/api/me/profile', profile)).status).toBe(200);
  });

  let lunch: Meal;

  it('makes one meal of a starter, a main 20 min later and dessert, judged whole', async () => {
    const breakfast = await log({ eatenAt: at('08:00'), text: 'une tarte' });
    lunch = (await log({ eatenAt: at('12:00'), text: 'une salade', course: 'auto' })).body;
    expect(lunch.id).not.toBe(breakfast.body.id);
    expect(lunch.courses).toHaveLength(1);

    const main = await log({ eatenAt: at('12:20'), photoBase64: jpeg(1), course: 'auto' });
    expect(main.status).toBe(201);
    expect(main.body.id).toBe(lunch.id);
    // The analyst saw the starter, and the day before the meal (breakfast) without the meal itself.
    const asked = inputs.at(-1)!;
    expect(asked.meal?.courses).toEqual([{ course: 1, label: '', time: '12:00', items: 'Salade composée 200 g', nutrients: expect.objectContaining({ kcal: 180 }) }]);
    expect(asked.dayTotalsBefore.kcal).toBe(306);
    expect(asked.photos).toHaveLength(1);

    lunch = (await log({ eatenAt: at('12:45'), text: 'une tarte', course: 'auto' })).body;
    expect(lunch.courses!.map((c) => [c.label, c.eatenAt])).toEqual([
      ['Entrée', at('12:00')],
      ['Plat', at('12:20')],
      ['Dessert', at('12:45')],
    ]);
    expect(lunch.eatenAt).toBe(at('12:00'));
    expect(lunch.photoId).toBe(main.body.courses![1]!.photoId);
    expect(lunch.title).toBe('Déjeuner complet');
    expect(lunch.insight?.headline).toBe('Repas équilibré, le dessert apporte l’essentiel du sucre ajouté.');
    expect(lunch.totals.kcal).toBe(180 + 323 + 306);
    // Each item knows its course; the starter's (logged as a meal of one course) are the first course's.
    expect(lunch.items.map((i) => i.courseId)).toEqual(lunch.courses!.map((c) => c.id));
    expect(lunch.courses![0]!.id).toBe('c0');
  });

  it('keeps the day, the totals, the glance and the coach on one meal', async () => {
    const summary = (await request<DaySummary>('GET', `/api/days/${day}`)).body;
    expect(summary.meals).toHaveLength(2);
    expect(summary.totals.kcal).toBe(306 + 180 + 323 + 306);
    const glance = (await request<Glance>('GET', `/api/glance?date=${day}&hideCalories=0`)).body;
    expect(glance.meals).toBe(2);
    // The watch says when the last course was eaten, not when lunch started.
    expect(glance.lastMealAt).toBe(at('12:45'));
  });

  it('leaves older apps’ captures alone, and starts a new meal past the window', async () => {
    const old = await log({ eatenAt: at('12:50'), text: 'un café' });
    expect(old.body.id).not.toBe(lunch.id);
    await request('DELETE', `/api/meals/${old.body.id}`);
    const snack = await log({ eatenAt: at('14:30'), text: 'un café', course: 'auto' });
    expect(snack.body.id).not.toBe(lunch.id);
    await request('DELETE', `/api/meals/${snack.body.id}`);
  });

  it('joins the meal chosen on the phone, or makes a new one when it is gone', async () => {
    const late = await log({ eatenAt: at('15:30'), text: 'un café', course: { mealId: lunch.id } });
    expect(late.body.id).toBe(lunch.id);
    expect(late.body.courses).toHaveLength(4);
    const courseId = late.body.courses![3]!.id;
    expect((await request<Meal>('DELETE', `/api/meals/${lunch.id}/courses/${courseId}`)).body.courses).toHaveLength(3);

    const orphan = await log({ eatenAt: at('16:00'), text: 'une tarte', course: { mealId: 'gone' } });
    expect(orphan.status).toBe(201);
    expect(orphan.body.id).not.toBe(lunch.id);
    await request('DELETE', `/api/meals/${orphan.body.id}`);
  });

  it('keeps a scanned dessert exactly, and judges the meal again around it', async () => {
    const yoghurt: FoodItem = { id: 'y1', name: 'Yaourt', emoji: '🥛', portion: '1 pot', grams: 125, per100g: per100g(80, 7), source: 'barcode', confidence: null, brand: 'Marque', barcode: '123', courseId: 'elsewhere' };
    const res = await log({ eatenAt: at('13:00'), items: [yoghurt], course: 'auto' });
    expect(res.body.id).toBe(lunch.id);
    expect(inputs.at(-1)).toMatchObject({ assessOnly: true, photos: [], text: null });
    const added = res.body.items.at(-1)!;
    expect(added).toMatchObject({ name: 'Yaourt', grams: 125, per100g: per100g(80, 7), barcode: '123', courseId: res.body.courses![3]!.id });
    expect(res.body.insight?.headline).toBe('Repas entier : 4 plats');
    await request('DELETE', `/api/meals/${lunch.id}/courses/${res.body.courses![3]!.id}`);
  });

  it('keeps both of two scans sent at the same moment', async () => {
    const scan = (name: string, time: string): FoodItem => ({ id: name, name, emoji: '', portion: '', grams: 100, per100g: per100g(50), source: 'barcode', confidence: null, brand: null, barcode: name });
    const [first, second] = await Promise.all([
      log({ eatenAt: at('13:01'), items: [scan('Compote', '13:01')], course: 'auto' }),
      log({ eatenAt: at('13:02'), items: [scan('Biscuit', '13:02')], course: 'auto' }),
    ]);
    expect([first.body.id, second.body.id]).toEqual([lunch.id, lunch.id]);
    const both = (await request<Meal>('GET', `/api/meals/${lunch.id}`)).body;
    expect(both.items.map((i) => i.name)).toEqual(expect.arrayContaining(['Compote', 'Biscuit']));
    expect(both.courses).toHaveLength(5);
    for (const course of both.courses!.slice(3)) await request('DELETE', `/api/meals/${lunch.id}/courses/${course.id}`);
    expect((await request<Meal>('GET', `/api/meals/${lunch.id}`)).body.courses).toHaveLength(3);
  });

  it('applies one correction to the whole meal: every course, every photo, sent once', async () => {
    answer = (input) => {
      const courses = input.previous!.courses!;
      return analysis(
        courses.flatMap((c) => c.items.map((i) => ({ ...food(i.name, i.grams, i.per100g.kcal, i.per100g.addedSugar, c.course), ...(c.label === 'Dessert' ? { grams: i.grams / 2 } : {}) }))),
        { courses: ['Entrée', 'Plat', 'Dessert'], title: 'Salade, poulet et demi-tarte', headline: 'Plus léger avec une demi-part.' },
      );
    };
    const res = await request<Meal>('POST', `/api/meals/${lunch.id}/refine`, { correction: 'le dessert c’était une demi-part' });
    answer = null;
    expect(res.status).toBe(200);
    const asked = inputs.at(-1)!;
    expect(asked.correction).toBe('le dessert c’était une demi-part');
    expect(asked.previous?.courses?.map((c) => [c.course, c.label, c.items.length])).toEqual([
      [1, 'Entrée', 1],
      [2, 'Plat', 1],
      [3, 'Dessert', 1],
    ]);
    // The main's photo, said to be the second course's.
    expect(asked.photos.map((p) => p.course)).toEqual([2]);
    expect(asked.history).toBeUndefined();
    expect(res.body.items.find((i) => i.name === 'Tarte aux pommes')).toMatchObject({ grams: 60, courseId: res.body.courses![2]!.id });
    expect(res.body.courses).toHaveLength(3);
    expect(res.body.insight?.headline).toBe('Plus léger avec une demi-part.');
    lunch = res.body;
  });

  it('drops a course the correction says wasn’t eaten, its photo with it', async () => {
    const withPhoto = await log({ eatenAt: at('13:05'), photoBase64: jpeg(2), text: 'un café', course: 'auto' });
    const coffee = withPhoto.body.courses!.at(-1)!;
    expect((await photo(coffee.photoId)).status).toBe(200);
    answer = (input) => analysis(input.previous!.courses!.filter((c) => c.course < 4).flatMap((c) => c.items.map((i) => food(i.name, i.grams, i.per100g.kcal, i.per100g.addedSugar, c.course))));
    const res = await request<Meal>('POST', `/api/meals/${lunch.id}/refine`, { correction: 'pas de café finalement' });
    answer = null;
    expect(res.body.courses!.map((c) => c.id)).toEqual(lunch.courses!.map((c) => c.id));
    expect((await photo(coffee.photoId)).status).toBe(404);
    // The main's photo, still shown, stays.
    expect((await photo(lunch.photoId)).status).toBe(200);
  });

  it('moves a course out and back, keeping its photo', async () => {
    const dessert = lunch.courses![2]!;
    const res = await request<SeparateCourseResult>('POST', `/api/meals/${lunch.id}/courses/${dessert.id}/separate`);
    expect(res.status).toBe(200);
    expect(res.body.meal.courses).toHaveLength(2);
    expect(res.body.meal.totals.kcal).toBe(180 + 323);
    expect(res.body.separated).toMatchObject({ eatenAt: dessert.eatenAt, title: 'Repas jugé', courses: [expect.objectContaining({ id: 'c0' })] });
    expect(res.body.separated.items.map((i) => [i.name, i.courseId])).toEqual([['Tarte aux pommes', undefined]]);
    // Both meals judged again: what is left, and the course on its own.
    expect(inputs.slice(-2).map((i) => [i.assessOnly, i.meal!.courses.length])).toEqual([
      [true, 2],
      [true, 1],
    ]);
    // Moved out of lunch at lunchtime, it is a snack.
    expect(inputs.at(-1)!.mealTypeHint).toBe('snack');
    expect((await mealsOn()).length).toBe(3);

    const merged = await request<Meal>('POST', `/api/meals/${lunch.id}/merge`, { mealId: res.body.separated.id });
    expect(merged.body.courses).toHaveLength(3);
    expect(merged.body.totals.kcal).toBe(lunch.totals.kcal);
    expect((await request('GET', `/api/meals/${res.body.separated.id}`)).status).toBe(404);
    expect((await photo(lunch.photoId)).status).toBe(200);
    expect((await request('POST', `/api/meals/${lunch.id}/courses/nope/separate`)).status).toBe(404);
    lunch = merged.body;
  });

  it('keeps courses when portions are edited, and drops one left empty', async () => {
    const dessert = lunch.courses![2]!;
    const items = lunch.items.filter((i) => i.courseId !== dessert.id).map((i) => ({ ...i, grams: i.grams + 10 }));
    const res = await request<Meal>('PATCH', `/api/meals/${lunch.id}`, { items });
    expect(res.body.courses!.map((c) => c.id)).toEqual(lunch.courses!.slice(0, 2).map((c) => c.id));
    expect(res.body.items.map((i) => i.courseId)).toEqual(lunch.courses!.slice(0, 2).map((c) => c.id));
    // Moving the meal moves its courses together.
    const moved = await request<Meal>('PATCH', `/api/meals/${lunch.id}`, { eatenAt: at('12:30') });
    expect(moved.body.courses!.map((c) => c.eatenAt)).toEqual([at('12:30'), at('12:50')]);
    lunch = moved.body;
  });

  it('copies a whole meal in courses, or as courses of the meal it follows', async () => {
    const copy = await request<Meal>('POST', `/api/meals/${lunch.id}/duplicate`, { eatenAt: at('19:30'), localDate: day });
    expect(copy.body.courses!.map((c) => c.eatenAt)).toEqual([at('19:30'), at('19:50')]);
    expect(copy.body.totals.kcal).toBe(lunch.totals.kcal);
    expect(copy.body.photoId).toBe(lunch.photoId);

    const dessert = await log({ eatenAt: at('18:00'), text: 'une tarte' });
    const joined = await request<Meal>('POST', `/api/meals/${dessert.body.id}/duplicate`, { eatenAt: at('20:00'), localDate: day, course: 'auto' });
    expect(joined.body.id).toBe(copy.body.id);
    expect(joined.body.courses).toHaveLength(3);
    expect(joined.body.courses![2]!.eatenAt).toBe(at('20:00'));

    // Deleting the copy keeps the photo the lunch still shows.
    await request('DELETE', `/api/meals/${copy.body.id}`);
    expect((await photo(lunch.photoId)).status).toBe(200);
  });

  it('counts each course at its own hour in Trends', async () => {
    const dinner = await log({ eatenAt: at('19:40', '2026-10-29'), localDate: '2026-10-29', text: 'un poulet' });
    const dessert = await log({ eatenAt: at('20:05', '2026-10-29'), localDate: '2026-10-29', text: 'une tarte', course: 'auto' });
    expect(dessert.body.id).toBe(dinner.body.id);
    const { byHour } = (await request<{ byHour: { nutrient: string; hours: number[] } }>('GET', '/api/insights?from=2026-10-29&to=2026-10-29')).body;
    expect(byHour.hours[19]).toBeGreaterThan(0);
    expect(byHour.hours[20]).toBeGreaterThan(0);
  });

  it('reads meals from before courses as one course, and joins them without rewriting them', async () => {
    const old = (await log({ eatenAt: at('10:00', yesterday), localDate: yesterday, text: 'une salade' })).body;
    app.db.update(meals).set({ courses: null }).where(eq(meals.id, old.id)).run();
    expect((await request<Meal>('GET', `/api/meals/${old.id}`)).body.courses).toEqual([{ id: 'c0', label: '', eatenAt: at('10:00', yesterday), photoId: null, basedOn: null }]);
    const joined = await log({ eatenAt: at('10:20', yesterday), localDate: yesterday, text: 'un café', course: 'auto' });
    expect(joined.body.id).toBe(old.id);
    expect(joined.body.items.map((i) => i.courseId)).toEqual(['c0', joined.body.courses![1]!.id]);
  });
});

describe('words about the past', () => {
  const app = makeApp();
  let token = '';
  const request = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  let dinner: Meal;

  beforeAll(async () => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'leftovers@example.com', password: 'password123' }) });
    token = ((await res.json()) as AuthResponse).token;
    expect((await request('PUT', '/api/me/profile', profile)).status).toBe(200);
    // Yesterday's dinner, with a scanned item whose exact values must come back.
    dinner = (
      await request<Meal>('POST', '/api/meals', {
        eatenAt: at('19:45', yesterday),
        localDate: yesterday,
        title: 'Gratin et salade',
        items: [
          { id: 'g', name: 'Gratin dauphinois', grams: 350, source: 'manual', per100g: per100g(152) },
          { id: 's', name: 'Salade verte', grams: 80, source: 'barcode', barcode: '42', per100g: per100g(17) },
        ],
      })
    ).body;
  });

  it('sends nothing more for a usual capture', async () => {
    await request('POST', '/api/meals', { eatenAt: at('08:00'), localDate: day, text: 'une tarte' });
    expect(inputs.at(-1)!.history).toBeUndefined();
  });

  it('reuses yesterday’s dinner for its leftovers, with the values it was logged with', async () => {
    answer = (input) => {
      const past = input.history!.meals.find((m) => m.title === 'Gratin et salade')!;
      return analysis([food('Gratin dauphinois', 175, 999)], { reusedMeal: past.ref, title: 'Reste de gratin' });
    };
    const res = await request<Meal>('POST', '/api/meals', { eatenAt: at('12:30'), localDate: day, text: 'le reste du gratin d’hier soir' });
    answer = null;
    const asked = inputs.at(-1)!;
    expect(asked.history?.today).toBe('Sat 2026-10-31');
    expect(asked.history?.meals.map((m) => [m.when, m.title, m.items])).toEqual([
      ['Sat 2026-10-31 08:00', 'Tarte aux pommes', 'Tarte aux pommes 120 g'],
      ['Fri 2026-10-30 19:45', 'Gratin et salade', 'Gratin dauphinois 350 g · Salade verte 80 g'],
    ]);
    // The grams the AI chose, the values per 100 g as logged.
    expect(res.body.items).toEqual([expect.objectContaining({ name: 'Gratin dauphinois', grams: 175, per100g: per100g(152) })]);
    expect(res.body.courses![0]!.basedOn).toEqual({ mealId: dinner.id, localDate: yesterday, mealType: dinner.mealType, title: 'Gratin et salade' });
  });

  it('keeps what a course was based on when it is moved out and joined back', async () => {
    const meals = (await request<Meal[]>('GET', `/api/meals?date=${day}`)).body;
    const lunch = meals.find((m) => m.title === 'Reste de gratin')!;
    const dessert = (await request<Meal>('POST', '/api/meals', { eatenAt: at('12:50'), localDate: day, text: 'une tarte', course: 'auto' })).body;
    expect(dessert.id).toBe(lunch.id);
    const out = (await request<SeparateCourseResult>('POST', `/api/meals/${lunch.id}/courses/${dessert.courses![1]!.id}/separate`)).body;
    const back = (await request<Meal>('POST', `/api/meals/${lunch.id}/merge`, { mealId: out.separated.id })).body;
    expect(back.courses!.map((c) => c.basedOn?.mealId ?? null)).toEqual([dinner.id, null]);
    // The leftovers moved out keep it too.
    const moved = (await request<SeparateCourseResult>('POST', `/api/meals/${lunch.id}/courses/${back.courses![0]!.id}/separate`)).body;
    expect(moved.separated.courses![0]!.basedOn?.mealId).toBe(dinner.id);
    await request('POST', `/api/meals/${moved.meal.id}/merge`, { mealId: moved.separated.id });
  });

  it('lets a correction refer to the past too, on the course it changes', async () => {
    // Far enough from the leftovers at 12:30 to be a meal of its own.
    const lunch = (await request<Meal>('POST', '/api/meals', { eatenAt: at('15:30'), localDate: day, text: 'une salade', course: 'auto' })).body;
    const meal = (await request<Meal>('POST', '/api/meals', { eatenAt: at('15:45'), localDate: day, text: 'un poulet', course: 'auto' })).body;
    expect(meal.id).toBe(lunch.id);
    answer = (input) => {
      const past = input.history!.meals.find((m) => m.title === 'Gratin et salade')!;
      return analysis([food('Salade verte', 80, 1, 0, 1), food('Poulet rôti', 150, 215, 0, 2)], { reusedMeal: past.ref });
    };
    const res = await request<Meal>('POST', `/api/meals/${meal.id}/refine`, { correction: 'la salade c’était la même qu’hier soir' });
    answer = null;
    expect(inputs.at(-1)!.history).toBeDefined();
    expect(res.body.items[0]).toMatchObject({ name: 'Salade verte', per100g: per100g(17), barcode: '42' });
    expect(res.body.courses!.map((c) => c.basedOn?.mealId ?? null)).toEqual([dinner.id, null]);
  });
});

describe('the coach and courses', () => {
  const coachInputs: CoachInput[] = [];
  const app = makeApp();
  // The real mock coach proposes the add; meals still go through the scripted analyst.
  Object.assign(ai, {
    async coach(input: CoachInput, onText?: (delta: string) => void) {
      coachInputs.push(input);
      return mock.coach(input, onText);
    },
  });
  let token = '';
  const request = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };

  beforeAll(async () => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'coach-courses@example.com', password: 'password123' }) });
    token = ((await res.json()) as AuthResponse).token;
    expect((await request('PUT', '/api/me/profile', profile)).status).toBe(200);
  });

  it('shows a meal’s courses, and adds a dessert at lunchtime to lunch', async () => {
    const lunch = (await request<Meal>('POST', '/api/meals', { eatenAt: at('12:00'), localDate: day, text: 'une salade', course: 'auto' })).body;
    await request('POST', '/api/meals', { eatenAt: at('12:20'), localDate: day, text: 'un poulet', course: 'auto' });
    const reply = (await request<{ reply: CoachMessage }>('POST', '/api/coach/messages', { text: 'Ajoute une tarte à 12h40', localDate: day })).body.reply;
    expect(coachInputs.at(-1)!.recentMeals).toEqual([expect.objectContaining({ id: lunch.id, courses: ['Entrée', 'Plat'] })]);
    const applied = await request<CoachMealActionResult>('POST', `/api/coach/messages/${reply.id}/meal-actions/0/apply`, { now: at('14:00') });
    expect(applied.body.meal).toMatchObject({ id: lunch.id, courses: expect.arrayContaining([expect.objectContaining({ eatenAt: at('12:40') })]) });
    expect(applied.body.meal!.courses).toHaveLength(3);
    app.db.delete(coachMessages).run();
  });
});
