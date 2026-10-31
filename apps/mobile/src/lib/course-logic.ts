/**
 * Meals in courses, as the app says them: kept free of React Native (and of
 * the stores) so the offline queue and the screens can share them.
 */
import { daysBetween, mealCourses, type DaySummary, type Locale, type Meal, type MealCourse, type MealReference, type MealType } from '@symbiose/shared';

import type { TranslationKey } from '@/i18n';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** « ton déjeuner », "your lunch". */
export const yourMeal = (t: T, mealType: MealType) => t(`courses.your.${mealType}`);

/** A course's name: the AI's (« Entrée », « Dessert »), else « Plat 2 ». */
export const courseName = (t: T, course: Pick<MealCourse, 'label'>, index: number) => course.label || t('courses.course', { n: index + 1 });

/** « D'après ton dîner d'hier », said from the day of the meal that reused it. */
export function basedOnLabel(t: T, locale: Locale, basedOn: MealReference, mealDate: string): string {
  const days = daysBetween(basedOn.localDate, mealDate);
  const [y, m, d] = basedOn.localDate.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  const tag = locale === 'fr' ? 'fr-FR' : 'en-US';
  const when =
    days <= 0
      ? ''
      : days === 1
        ? t('courses.when.yesterday')
        : days < 7
          ? t('courses.when.weekday', { day: date.toLocaleDateString(tag, { weekday: 'long' }) })
          : t('courses.when.date', { date: date.toLocaleDateString(tag, { day: 'numeric', month: 'short' }) });
  return t('courses.basedOn', { meal: yourMeal(t, basedOn.mealType), when });
}

/** The course a capture just became, when it joined a meal (its exact time is its own); null for a new meal. */
export function joinedCourse(meal: Meal, eatenAt: string): MealCourse | null {
  const courses = mealCourses(meal);
  return courses.length > 1 ? (courses.find((c) => c.eatenAt === eatenAt) ?? null) : null;
}

/** The day with one meal replaced (a course joined it), or added. */
export function withMeal(day: DaySummary, meal: Meal): DaySummary {
  const meals = day.meals.some((m) => m.id === meal.id) ? day.meals.map((m) => (m.id === meal.id ? meal : m)) : [...day.meals, meal];
  return { ...day, meals: meals.sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt)) };
}
