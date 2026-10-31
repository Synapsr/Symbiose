import type { DaySummary, Meal } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { en as EN } from '../i18n/en';
import { fr as FR, type TranslationKey } from '../i18n/fr';
import { basedOnLabel, courseName, joinedCourse, withMeal, yourMeal } from './course-logic';

// The dictionaries as the app fills them (`translate` itself needs the device's locale).
const fill = (text: string, params: Record<string, string | number> = {}) => Object.entries(params).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text);
const fr = (key: TranslationKey, params?: Record<string, string | number>) => fill(FR[key], params);
const en = (key: TranslationKey, params?: Record<string, string | number>) => fill(EN[key], params);

const at = (time: string) => `2026-10-31T${time}:00+01:00`;
const lunch = {
  id: 'm1',
  eatenAt: at('12:00'),
  localDate: '2026-10-31',
  mealType: 'lunch',
  photoId: null,
  courses: [
    { id: 'c0', label: 'Entrée', eatenAt: at('12:00'), photoId: null, basedOn: null },
    { id: 'c1', label: '', eatenAt: at('12:25'), photoId: null, basedOn: null },
  ],
} as unknown as Meal;

describe('how courses are said', () => {
  it('names the meal and its courses', () => {
    expect(fr('courses.with', { meal: yourMeal(fr, 'lunch'), time: '12:40' })).toBe('Avec ton déjeuner · 12:40');
    expect(fr('courses.added', { meal: yourMeal(fr, 'dinner') })).toBe('Ajouté à ton dîner');
    expect(en('courses.added', { meal: yourMeal(en, 'breakfast') })).toBe('Added to your breakfast');
    expect(courseName(fr, lunch.courses![0]!, 0)).toBe('Entrée');
    expect(courseName(fr, lunch.courses![1]!, 1)).toBe('Plat 2');
  });

  it('says which past meal was reused, from the meal’s own day', () => {
    const dinner = { mealId: 'd', localDate: '2026-10-30', mealType: 'dinner', title: 'Gratin' } as const;
    expect(basedOnLabel(fr, 'fr', dinner, '2026-10-31')).toBe('D’après ton dîner d’hier');
    expect(basedOnLabel(en, 'en', dinner, '2026-10-31')).toBe('Based on your dinner yesterday');
    expect(basedOnLabel(fr, 'fr', { ...dinner, mealType: 'lunch' }, '2026-10-30')).toBe('D’après ton déjeuner');
    expect(basedOnLabel(fr, 'fr', { ...dinner, localDate: '2026-10-27' }, '2026-10-31')).toBe('D’après ton dîner de mardi');
  });
});

describe('a capture that joined a meal', () => {
  it('is the course at its own time; a meal of one course is a new meal', () => {
    expect(joinedCourse(lunch, at('12:25'))?.id).toBe('c1');
    expect(joinedCourse(lunch, at('12:30'))).toBeNull();
    expect(joinedCourse({ ...lunch, courses: [lunch.courses![0]!] }, at('12:00'))).toBeNull();
  });

  it('replaces its meal on the day, or adds it in time order', () => {
    const breakfast = { ...lunch, id: 'm0', eatenAt: at('08:00') } as Meal;
    const day = { meals: [breakfast, { ...lunch, title: 'old' }] } as unknown as DaySummary;
    expect(withMeal(day, lunch).meals).toEqual([breakfast, lunch]);
    const snack = { ...lunch, id: 'm2', eatenAt: at('10:00') } as Meal;
    expect(withMeal(day, snack).meals.map((m) => m.id)).toEqual(['m0', 'm2', 'm1']);
  });
});
