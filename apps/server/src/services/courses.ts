import { FIRST_COURSE_ID, localTime, mealSpan, mealTotals, type FoodItem, type MealCourse, type MealSpan } from '@symbiose/shared';
import { and, eq, or, sql } from 'drizzle-orm';

import type { CourseBrief, PreviousCourse } from '../ai/types';
import { meals, type MealCourseRow, type MealRow } from '../db/schema';
import type { Deps } from '../http';

/**
 * A meal's courses as stored. A meal of one course keeps its photo and words
 * in its own columns (`courses` is null): every meal logged before courses
 * existed reads as it always did, without any rewrite.
 */
export function storedCourses(row: Pick<MealRow, 'courses' | 'eatenAt' | 'photoId' | 'inputText'>): MealCourseRow[] {
  return row.courses?.length ? row.courses : [{ id: FIRST_COURSE_ID, label: '', eatenAt: row.eatenAt, photoId: row.photoId, text: row.inputText, basedOn: null }];
}

export function toCourse({ text: _text, ...course }: MealCourseRow): MealCourse {
  return course;
}

export function rowSpan(row: MealRow): MealSpan {
  return mealSpan({ ...row, courses: storedCourses(row) });
}

/** Every item tagged with its course: untagged ones are the first course's, whatever comes before it later. */
export function tagItems(items: FoodItem[], firstCourseId: string): FoodItem[] {
  return items.map((item) => (item.courseId ? item : { ...item, courseId: firstCourseId }));
}

export const ownItems = (items: FoodItem[], courses: Pick<MealCourse, 'id'>[], courseId: string) =>
  items.filter((item) => (item.courseId ?? courses[0]!.id) === courseId);

/** The columns that follow the courses, in time order: the first gives the meal its time and words, the first photo is its cover. */
export function courseColumns(courses: MealCourseRow[], items: FoodItem[]): Pick<MealRow, 'courses' | 'items' | 'eatenAt' | 'photoId' | 'inputText'> {
  const sorted = [...courses].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt));
  return { courses: sorted, items, eatenAt: sorted[0]!.eatenAt, photoId: sorted.find((c) => c.photoId)?.photoId ?? null, inputText: sorted[0]!.text };
}

/** Courses left without items go (a correction said there was no dessert); one always stays. */
export function pruneCourses(courses: MealCourseRow[], items: FoodItem[]): { courses: MealCourseRow[]; removed: MealCourseRow[] } {
  const used = new Set(items.map((item) => item.courseId ?? courses[0]!.id));
  const kept = courses.filter((c) => used.has(c.id));
  if (!kept.length) return { courses: courses.slice(0, 1), removed: courses.slice(1) };
  return { courses: kept, removed: courses.filter((c) => !used.has(c.id)) };
}

/** The AI's names for the courses, when it named all of them; an empty name keeps the one there was. */
export function withLabels(courses: MealCourseRow[], labels: string[] | undefined): MealCourseRow[] {
  if (!labels || labels.length !== courses.length) return courses;
  return courses.map((c, i) => ({ ...c, label: labels[i]!.trim().slice(0, 40) || c.label }));
}

/** "Gratin dauphinois 350 g · Salade verte 80 g". */
export const itemLine = (items: FoodItem[]) => items.map((item) => `${item.name} ${Math.round(item.grams)} g`).join(' · ');

/** The courses as the AI reads them when a course joins, or to judge the meal: items in a line, nutrients summed. */
export function courseBriefs(courses: MealCourseRow[], items: FoodItem[]): CourseBrief[] {
  return courses.map((c, i) => {
    const own = ownItems(items, courses, c.id);
    return { course: i + 1, label: c.label, time: localTime(c.eatenAt), items: itemLine(own), nutrients: mealTotals(own) };
  });
}

/** The courses of a meal being corrected: their words and items with their values, so what isn't corrected stays. */
export function previousCourses(courses: MealCourseRow[], items: FoodItem[]): PreviousCourse[] {
  return courses.map((c, i) => ({ course: i + 1, label: c.label, time: localTime(c.eatenAt), text: c.text, items: ownItems(items, courses, c.id) }));
}

/**
 * Deletes the photos no meal shows any more. Copies share their photos, and
 * a course moved out keeps its own: a photo goes with its last meal.
 */
export async function releasePhotos({ db, photos }: Pick<Deps, 'db' | 'photos'>, userId: string, ids: (string | null)[]): Promise<void> {
  for (const id of new Set(ids.filter((id): id is string => Boolean(id)))) {
    const used = db
      .select({ id: meals.id })
      .from(meals)
      .where(and(eq(meals.userId, userId), or(eq(meals.photoId, id), sql`${meals.courses} LIKE ${`%"${id}"%`}`)))
      .get();
    if (!used) await photos.remove(userId, id);
  }
}
