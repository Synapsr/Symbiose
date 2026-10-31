import { localHour, mealTypeForHour } from './dates';
import { mealTotals } from './meals';
import type { FoodItem, Meal, MealCourse, MealType } from './schemas';

/**
 * Meals in several courses: the entrée noted, the main photographed 20 min
 * later, then dessert, make one meal. These rules decide where a capture
 * goes, the same on the phone (the capture screen's chip) and on the server.
 */

/** The one course of a meal logged before courses existed, or by an older app: a stable id. */
export const FIRST_COURSE_ID = 'c0';

export const COURSE_WINDOW = {
  /** A course follows the meal's last one within this many minutes, after a breakfast, lunch or dinner… */
  mealMin: 75,
  /** …and after a snack. */
  snackMin: 45,
  /** This close, a course follows whatever the clock says (a brunch, an apéritif before lunch); also how early it may come before the first one. */
  closeMin: 30,
  maxCourses: 8,
} as const;

type CourseSource = Pick<Meal, 'eatenAt' | 'photoId' | 'courses'>;

/** A meal's courses, in order; a meal from an older server is its one course. */
export function mealCourses(meal: CourseSource): MealCourse[] {
  return meal.courses?.length ? meal.courses : [{ id: FIRST_COURSE_ID, label: '', eatenAt: meal.eatenAt, photoId: meal.photoId, basedOn: null }];
}

/** The items of one course: those tagged with it, and the untagged ones for the first course. */
export function courseItems(meal: CourseSource & Pick<Meal, 'items'>, courseId: string): FoodItem[] {
  const first = mealCourses(meal)[0]!.id;
  return meal.items.filter((item) => (item.courseId ?? first) === courseId);
}

/** The meal's photos, in course order. */
export function mealPhotos(meal: CourseSource): string[] {
  return mealCourses(meal).flatMap((course) => (course.photoId ? [course.photoId] : []));
}

/**
 * One course as a meal of its own, totals included: what the health store
 * gets when a course joins a meal (the meal's earlier courses were written
 * when they were logged, so nothing is counted twice).
 */
export function courseAsMeal<M extends Meal>(meal: M, courseId: string): M {
  const course = mealCourses(meal).find((c) => c.id === courseId);
  if (!course) return meal;
  const items = courseItems(meal, courseId);
  return { ...meal, eatenAt: course.eatenAt, photoId: course.photoId, items, totals: mealTotals(items), courses: [course] };
}

/** The meal without one course (its items and totals with it): what the screen shows before the server agrees. */
export function withoutCourse<M extends Meal>(meal: M, courseId: string): M {
  const courses = mealCourses(meal);
  const kept = courses.filter((c) => c.id !== courseId);
  if (!kept.length || kept.length === courses.length) return meal;
  const first = courses[0]!.id;
  const items = meal.items.filter((item) => (item.courseId ?? first) !== courseId).map((item) => (item.courseId ? item : { ...item, courseId: first }));
  return { ...meal, eatenAt: kept[0]!.eatenAt, photoId: kept.find((c) => c.photoId)?.photoId ?? null, items, totals: mealTotals(items), courses: kept };
}

// ---------------------------------------------------------------- Where a capture goes

/** What the rule needs of a meal (or of a capture still on its way to the server). */
export interface MealSpan {
  localDate: string;
  mealType: MealType;
  /** Its first course. */
  start: string;
  /** Its last course. */
  end: string;
  courses: number;
}

export function mealSpan(meal: CourseSource & Pick<Meal, 'localDate' | 'mealType'>): MealSpan {
  const courses = mealCourses(meal);
  const times = courses.map((c) => c.eatenAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { localDate: meal.localDate, mealType: meal.mealType, start: times[0]!, end: times.at(-1)!, courses: courses.length };
}

const minutesBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 60_000;

export interface CaptureMoment {
  eatenAt: string;
  localDate: string;
  /** When the capture says it (the coach often does): a course never joins a meal of another type. */
  mealType?: MealType;
}

/**
 * Whether a capture at `at` is the next course of `span`. Same day, never
 * more than 30 min before its first course, and after its last one:
 * - within 30 min, always;
 * - within 75 min (45 after a snack), unless the clock points to another
 *   main meal: a snack at 11:00 and lunch at 12:00 stay two meals.
 * A snack 2 h after lunch is a new meal.
 */
export function followsMeal(span: MealSpan, at: CaptureMoment): boolean {
  if (span.localDate !== at.localDate || span.courses >= COURSE_WINDOW.maxCourses) return false;
  if (at.mealType && at.mealType !== span.mealType) return false;
  if (minutesBetween(at.eatenAt, span.start) > COURSE_WINDOW.closeMin) return false;
  const afterLast = minutesBetween(span.end, at.eatenAt);
  if (afterLast <= COURSE_WINDOW.closeMin) return true;
  if (afterLast > (span.mealType === 'snack' ? COURSE_WINDOW.snackMin : COURSE_WINDOW.mealMin)) return false;
  const clock = mealTypeForHour(localHour(at.eatenAt));
  return clock === 'snack' || clock === span.mealType;
}

/** The meal a capture joins as its next course: the latest one it follows, or null for a new meal. */
export function courseTarget<T>(candidates: readonly T[], spanOf: (candidate: T) => MealSpan, at: CaptureMoment): T | null {
  let best: T | null = null;
  let bestEnd = -Infinity;
  for (const candidate of candidates) {
    const span = spanOf(candidate);
    const end = Date.parse(span.end);
    if (end > bestEnd && followsMeal(span, at)) {
      best = candidate;
      bestEnd = end;
    }
  }
  return best;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** A local timestamp moved by whole minutes, keeping its offset (wall-clock arithmetic). */
function shiftMinutes(eatenAt: string, minutes: number): string {
  const m = STAMP.exec(eatenAt);
  if (!m) return eatenAt;
  const [, y, mo, d, h, mi, s = '00', offset] = m;
  const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) + minutes * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}${offset}`;
}

const offsetOf = (eatenAt: string) => /(Z|[+-]\d{2}:\d{2})$/.exec(eatenAt)?.[1] ?? 'Z';

/** A moment as a local timestamp at `offset` ("+01:00", "Z"). */
function atOffset(ms: number, offset: string): string {
  const [hours = 0, minutes = 0] = offset === 'Z' ? [] : offset.slice(1).split(':').map(Number);
  const t = new Date(ms + (offset.startsWith('-') ? -1 : 1) * (hours * 60 + minutes) * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}${offset}`;
}

/** The courses moved together so the first one starts at `start`: a meal moved to another time or day, or copied. */
export function moveCourses<C extends { eatenAt: string }>(courses: readonly C[], start: string): C[] {
  if (!courses.length) return [];
  const delta = Date.parse(start) - Math.min(...courses.map((c) => Date.parse(c.eatenAt)));
  const first = courses.reduce((a, b) => (Date.parse(b.eatenAt) < Date.parse(a.eatenAt) ? b : a));
  return courses.map((c) => ({ ...c, eatenAt: c === first ? start : atOffset(Date.parse(c.eatenAt) + delta, offsetOf(start)) }));
}

/**
 * When a course added from a meal's page was eaten: now, while it still
 * follows the meal; otherwise (a dessert remembered later) just after the
 * meal's last course, on its day.
 */
export function courseTimeFor(span: MealSpan, now: string): string {
  if (now.slice(0, 10) === span.localDate && minutesBetween(span.end, now) >= 0 && followsMeal({ ...span, courses: 0 }, { eatenAt: now, localDate: span.localDate })) return now;
  const after = shiftMinutes(span.end, 10);
  return after.slice(0, 10) === span.localDate ? after : span.end;
}

// ---------------------------------------------------------------- References to the past

// « le reste du gratin d'hier soir », « comme mardi midi », « la même chose qu'hier », "yesterday's leftovers".
const PAST =
  /\b(hier|avant[- ]hier|veille|l'autre (jour|soir|midi)|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|semaine derniere|derniere fois|comme d'hab\w*|meme chose|meme que|pareil|restes?|rechauff\w*|ce (matin|midi)|tout a l'heure|yesterday|last (night|time|week)|leftovers?|the other (day|night)|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|same (as|thing|again)|as usual|earlier today|this (morning|noon))\b/;

/**
 * Whether words refer to an earlier meal: only then does the analyst get the
 * last days' meals (a few hundred tokens), so the usual capture costs nothing
 * more. A false alarm only costs those tokens.
 */
export function refersToPast(text: string | null | undefined): boolean {
  if (!text) return false;
  const plain = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'");
  return PAST.test(plain);
}
