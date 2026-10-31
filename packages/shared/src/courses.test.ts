import { describe, expect, it } from 'vitest';

import { courseAsMeal, courseItems, courseTarget, courseTimeFor, followsMeal, mealCourses, mealSpan, moveCourses, refersToPast, withoutCourse, type MealSpan } from './courses';
import type { FoodItem, Meal, MealType } from './schemas';

const day = '2026-10-31';
const at = (time: string) => `${day}T${time}:00+01:00`;
const span = (mealType: MealType, start: string, end = start, courses = 1): MealSpan => ({ localDate: day, mealType, start: at(start), end: at(end), courses });
const follows = (s: MealSpan, time: string, mealType?: MealType) => followsMeal(s, { eatenAt: at(time), localDate: day, mealType });

const item = (name: string, kcal: number, courseId?: string): FoodItem => ({
  id: name,
  name,
  emoji: '',
  portion: '',
  grams: 100,
  per100g: { kcal, protein: 0, carbs: 0, sugar: 0, addedSugar: 0, fat: 0, satFat: 0, fiber: 0, sodium: 0 },
  source: 'ai',
  confidence: null,
  brand: null,
  barcode: null,
  ...(courseId ? { courseId } : {}),
});

const lunch: Meal = {
  id: 'm1',
  eatenAt: at('12:00'),
  localDate: day,
  mealType: 'lunch',
  title: 'Déjeuner',
  items: [item('Salade', 100), item('Poulet', 300, 'c2'), item('Tarte', 250, 'c3')],
  photoId: 'p1',
  note: null,
  insight: null,
  favorite: false,
  totals: { kcal: 650, protein: 0, carbs: 0, sugar: 0, addedSugar: 0, fat: 0, satFat: 0, fiber: 0, sodium: 0 },
  courses: [
    { id: 'c0', label: 'Entrée', eatenAt: at('12:00'), photoId: 'p1', basedOn: null },
    { id: 'c2', label: 'Plat', eatenAt: at('12:20'), photoId: null, basedOn: null },
    { id: 'c3', label: 'Dessert', eatenAt: at('12:45'), photoId: 'p3', basedOn: null },
  ],
  createdAt: '',
  updatedAt: '',
};

describe('the course window', () => {
  it('joins the courses of a meal eaten at a normal pace', () => {
    expect(follows(span('lunch', '12:00'), '12:20')).toBe(true);
    expect(follows(span('lunch', '12:00', '12:20', 2), '12:45')).toBe(true);
    // A long Sunday lunch: 45 min between courses.
    expect(follows(span('lunch', '12:30', '14:00', 3), '14:45')).toBe(true);
    // A coffee an hour after dessert still belongs to dinner.
    expect(follows(span('dinner', '19:30', '20:30', 3), '21:30')).toBe(true);
  });

  it('starts a new meal past the window', () => {
    expect(follows(span('lunch', '12:00', '12:45', 3), '14:01')).toBe(false);
    expect(follows(span('lunch', '12:30'), '14:30')).toBe(false); // the 2 h snack
    expect(follows(span('snack', '16:00'), '16:40')).toBe(true);
    expect(follows(span('snack', '16:00'), '16:50')).toBe(false);
  });

  it('keeps a snack and the next main meal apart, unless they are this close', () => {
    expect(follows(span('snack', '11:00'), '12:00')).toBe(false);
    expect(follows(span('snack', '17:30'), '18:45')).toBe(false);
    // An apéritif 20 min before lunch, a brunch across 11:00: one meal.
    expect(follows(span('snack', '11:30'), '11:50')).toBe(true);
    expect(follows(span('breakfast', '10:40'), '11:05')).toBe(true);
    // Breakfast at 10:30, then the clock says lunch an hour later: a new meal.
    expect(follows(span('breakfast', '10:30'), '11:40')).toBe(false);
    // Dessert after a late lunch, when the clock already says snack: still lunch.
    expect(follows(span('lunch', '14:00'), '15:10')).toBe(true);
  });

  it('respects the day, the type the capture says, and a cap on courses', () => {
    expect(followsMeal(span('dinner', '23:30'), { eatenAt: '2026-11-01T00:10:00+01:00', localDate: '2026-11-01' })).toBe(false);
    expect(follows(span('lunch', '12:00'), '12:20', 'lunch')).toBe(true);
    expect(follows(span('lunch', '12:00'), '12:20', 'snack')).toBe(false);
    expect(follows(span('lunch', '12:00', '12:30', 8), '12:40')).toBe(false);
  });

  it('takes a forgotten starter a little before the first course, never long before', () => {
    expect(follows(span('lunch', '12:30'), '12:05')).toBe(true);
    expect(follows(span('lunch', '12:30'), '11:50')).toBe(false);
    expect(follows(span('lunch', '12:00', '12:45', 3), '12:20')).toBe(true);
  });

  it('picks the latest meal the capture follows', () => {
    const meals = [
      { id: 'breakfast', s: span('breakfast', '08:00') },
      { id: 'snack', s: span('snack', '11:20') },
      { id: 'lunch', s: span('lunch', '12:10') },
    ];
    expect(courseTarget(meals, (m) => m.s, { eatenAt: at('12:30'), localDate: day })?.id).toBe('lunch');
    expect(courseTarget(meals, (m) => m.s, { eatenAt: at('08:20'), localDate: day })?.id).toBe('breakfast');
    expect(courseTarget(meals, (m) => m.s, { eatenAt: at('16:00'), localDate: day })).toBeNull();
    expect(courseTarget([], (m: { s: MealSpan }) => m.s, { eatenAt: at('12:30'), localDate: day })).toBeNull();
  });
});

describe('a meal in courses', () => {
  it('reads a meal from an older server as one course', () => {
    const old = { ...lunch, courses: undefined, items: [item('Salade', 100)] };
    expect(mealCourses(old)).toEqual([{ id: 'c0', label: '', eatenAt: old.eatenAt, photoId: 'p1', basedOn: null }]);
    expect(courseItems(old, 'c0')).toHaveLength(1);
    expect(mealSpan(old)).toEqual({ localDate: day, mealType: 'lunch', start: at('12:00'), end: at('12:00'), courses: 1 });
  });

  it('spans from the first course to the last, and gives each course its items', () => {
    expect(mealSpan(lunch)).toMatchObject({ start: at('12:00'), end: at('12:45'), courses: 3 });
    expect(courseItems(lunch, 'c0').map((i) => i.name)).toEqual(['Salade']);
    expect(courseItems(lunch, 'c3').map((i) => i.name)).toEqual(['Tarte']);
  });

  it('writes one course to the health store on its own, never the whole meal again', () => {
    const dessert = courseAsMeal(lunch, 'c3');
    expect(dessert.totals.kcal).toBe(250);
    expect(dessert.eatenAt).toBe(at('12:45'));
    expect(dessert.photoId).toBe('p3');
  });

  it('drops a course with its items and totals, keeping the first course’s untagged items', () => {
    const noStarter = withoutCourse(lunch, 'c0');
    expect(noStarter.items.map((i) => i.name)).toEqual(['Poulet', 'Tarte']);
    expect(noStarter.eatenAt).toBe(at('12:20'));
    expect(noStarter.photoId).toBe('p3');
    const noDessert = withoutCourse(lunch, 'c3');
    expect(noDessert.totals.kcal).toBe(400);
    expect(noDessert.items[0]!.courseId).toBe('c0');
    // The last course can't go: that is deleting the meal.
    expect(withoutCourse({ ...lunch, courses: [lunch.courses![0]!] }, 'c0').courses).toHaveLength(1);
  });

  it('dates a course added from the meal’s page now, or just after the meal when remembered later', () => {
    const s = mealSpan(lunch);
    expect(courseTimeFor(s, at('13:05'))).toBe(at('13:05'));
    expect(courseTimeFor(s, at('17:00'))).toBe(at('12:55'));
    expect(courseTimeFor(s, '2026-11-01T09:00:00+01:00')).toBe(at('12:55'));
    expect(courseTimeFor(span('dinner', '23:30', '23:55'), '2026-11-01T08:00:00+01:00')).toBe(at('23:55'));
  });
});

describe('moving a meal', () => {
  it('moves every course with the first one, keeping their gaps', () => {
    const moved = moveCourses(lunch.courses!, '2026-11-02T19:00:00+01:00');
    expect(moved.map((c) => c.eatenAt)).toEqual(['2026-11-02T19:00:00+01:00', '2026-11-02T19:20:00+01:00', '2026-11-02T19:45:00+01:00']);
    // Into another offset: the same moments, written there.
    expect(moveCourses([{ eatenAt: at('12:00') }, { eatenAt: at('12:30') }], '2026-11-02T12:00:00Z').map((c) => c.eatenAt)).toEqual(['2026-11-02T12:00:00Z', '2026-11-02T12:30:00Z']);
    expect(moveCourses([], at('12:00'))).toEqual([]);
  });
});

describe('references to the past', () => {
  it('spots leftovers and earlier meals, in French and English', () => {
    for (const text of [
      'le reste du gratin d’hier soir',
      'Les restes de dimanche',
      'comme mardi midi',
      'la même chose qu’hier',
      'pareil que ce midi',
      'comme d’habitude',
      'des pâtes réchauffées',
      "yesterday's leftovers",
      'same as Tuesday lunch',
      'the usual, as usual',
    ]) {
      expect(refersToPast(text), text).toBe(true);
    }
  });

  it('stays quiet otherwise', () => {
    for (const text of ['un croissant et un café', 'salade au restaurant', 'une demi-part de tarte', 'pas de sucre dans le café', '', null]) {
      expect(refersToPast(text), String(text)).toBe(false);
    }
  });
});
