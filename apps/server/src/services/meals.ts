import { randomUUID } from 'node:crypto';

import {
  COURSE_WINDOW,
  courseTarget,
  CreateMealInputSchema,
  DuplicateMealInputSchema,
  FIRST_COURSE_ID,
  localHour,
  localTime,
  mealFlags,
  mealTotals,
  mealTypeForHour,
  moveCourses,
  roundNutrients,
  sanitizePer100g,
  shortId,
  sumNutrients,
  type FoodItem,
  type GoalPlan,
  type Meal,
  type MealInsight,
  type MealReference,
  type MealType,
  type Nutrients,
  type SeparateCourseResult,
  type Targets,
  UpdateMealInputSchema,
} from '@symbiose/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { z } from 'zod';

import type { MealAnalysis, MealAnalysisInput, MealPhoto } from '../ai/types';
import type { Db } from '../db';
import { meals, type MealCourseRow, type MealRow } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { nowIso, type Deps } from '../http';
import { bloodPressureBrief } from './blood-pressure';
import { courseBriefs, courseColumns, ownItems, previousCourses, pruneCourses, releasePhotos, rowSpan, storedCourses, tagItems, toCourse, withLabels } from './courses';
import { historyFor, reusePast } from './meal-history';
import { decodePhoto } from './photos';
import { resolveUser } from './users';
import { mealActivity } from './workouts';

/** What logging, refining and deleting a meal needs. */
type MealDeps = Pick<Deps, 'db' | 'ai' | 'photos'>;
type Resolved = ReturnType<typeof resolveUser>;

/** A correction sends every course's photo, up to this many. */
const MAX_PHOTOS = 4;

export function toMeal(row: MealRow): Meal {
  return {
    id: row.id,
    eatenAt: row.eatenAt,
    localDate: row.localDate,
    mealType: row.mealType,
    title: row.title,
    items: row.items,
    photoId: row.photoId,
    note: row.note,
    insight: row.insight ?? null,
    favorite: row.favorite,
    totals: mealTotals(row.items),
    courses: storedCourses(row).map(toCourse),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

/**
 * Turns raw AI output into validated, physically plausible food items.
 * `courseFor` places each item in its course (a correction of a meal in courses).
 */
export function itemsFromAnalysis(analysis: MealAnalysis, courseFor?: (course: number | undefined) => string): FoodItem[] {
  return analysis.items
    .filter((item) => item.name.trim().length > 0)
    .slice(0, 40)
    .map((item) => ({
      id: shortId(),
      name: item.name.trim().slice(0, 120),
      emoji: [...(item.emoji ?? '')].slice(0, 2).join(''),
      portion: (item.portion ?? '').slice(0, 60),
      grams: Math.round(clamp(item.grams, 0, 5000)),
      per100g: sanitizePer100g(item.per100g),
      source: 'ai' as const,
      confidence: Math.round(clamp(item.confidence, 0, 1) * 100) / 100,
      brand: null,
      barcode: null,
      ...(courseFor ? { courseId: courseFor(item.course) } : {}),
    }));
}

/** Combines the AI's qualitative assessment with deterministic, goal-aware flags. */
export function buildInsight(
  totals: Nutrients,
  targets: Targets | null,
  plan: GoalPlan | null,
  ai?: Pick<MealAnalysis, 'verdict' | 'headline' | 'tips' | 'clarification'>,
): MealInsight | null {
  const flags = targets ? mealFlags(totals, targets, plan) : [];
  if (!ai) {
    if (!flags.length) return null;
    const worst = flags.find((f) => f.kind === 'max' && f.share >= 0.5);
    return { verdict: worst ? 'watch' : 'ok', headline: '', tips: [], flags, clarification: null };
  }
  return {
    verdict: ai.verdict,
    headline: ai.headline.slice(0, 240),
    tips: ai.tips.filter(Boolean).slice(0, 2).map((tip) => tip.slice(0, 240)),
    flags,
    clarification:
      ai.clarification && ai.clarification.options.length >= 2
        ? {
            question: ai.clarification.question.slice(0, 160),
            options: ai.clarification.options.slice(0, 4).map((o) => o.slice(0, 40)),
          }
        : null,
  };
}

/** Keeps the AI's words but recomputes the numbers; the question is moot once edited. */
function refreshedInsight(previous: MealInsight | null, items: FoodItem[], resolved: Resolved): MealInsight | null {
  const fresh = buildInsight(mealTotals(items), resolved.targets, resolved.context.plan);
  return previous ? { ...previous, flags: fresh?.flags ?? [], clarification: null } : fresh;
}

/** Removes the per-request item ids (and courses) so foods can be grouped across meals. */
export function stripItem(item: FoodItem): Omit<FoodItem, 'id'> {
  const { id: _id, courseId: _course, ...rest } = item;
  return rest;
}

/** An item as a new meal or course gets it: its own id, and no course from another meal. */
const freshItem = ({ courseId: _course, ...item }: FoodItem): FoodItem => ({ ...item, id: item.id || shortId() });

export function getMealRow(db: Db, userId: string, id: string): MealRow {
  const row = db.select().from(meals).where(and(eq(meals.id, id), eq(meals.userId, userId))).get();
  if (!row) throw notFound('Meal');
  return row;
}

/**
 * What was eaten that day before `eatenAt`, excluding one meal (the one being
 * analysed). By time, not by arrival: a lunch logged offline and sent after
 * dinner doesn't count the dinner.
 */
function totalsBefore(db: Db, userId: string, localDate: string, eatenAt: string, excludeId?: string) {
  const conditions = [eq(meals.userId, userId), eq(meals.localDate, localDate)];
  if (excludeId) conditions.push(ne(meals.id, excludeId));
  const rows = db.select({ items: meals.items, eatenAt: meals.eatenAt }).from(meals).where(and(...conditions)).all();
  const before = Date.parse(eatenAt);
  return roundNutrients(sumNutrients(rows.filter((r) => Date.parse(r.eatenAt) < before).map((r) => mealTotals(r.items))));
}

/** What every analysis of a meal knows about the moment: the day so far (before the meal starts), movement, blood pressure. */
function momentContext(db: Db, userId: string, resolved: Resolved, at: { localDate: string; eatenAt: string; start: string; mealType: MealType; excludeId?: string }) {
  return {
    ...resolved.context,
    localTime: localTime(at.eatenAt),
    mealTypeHint: at.mealType,
    dayTotalsBefore: totalsBefore(db, userId, at.localDate, at.start, at.excludeId),
    ...mealActivity(db, userId, at.localDate, at.eatenAt),
    bloodPressureCategory: bloodPressureBrief(db, userId, resolved.row.profile ?? null, at.localDate)?.category ?? null,
  } satisfies Omit<MealAnalysisInput, 'photos' | 'text'>;
}

function ensureFood(analysis: MealAnalysis): void {
  if (!analysis.isFood || analysis.items.length === 0) {
    throw new HttpError(422, 'not_food', 'No food or drink was recognised');
  }
}

const photoInput = (photo: { buffer: Buffer; mime: MealPhoto['mime'] }): MealPhoto => ({ base64: photo.buffer.toString('base64'), mime: photo.mime });

/** A meal whose items are final, as the AI judges it. */
interface Judged {
  id?: string;
  localDate: string;
  mealType: MealType;
  title: string;
  courses: MealCourseRow[];
  items: FoodItem[];
}

/**
 * Judges a whole meal whose items are final (a scanned dessert joining it, a
 * course moved out or deleted): one short call, without photos. Undefined
 * when the AI is off or fails: the meal then keeps its words, numbers redone.
 */
async function judge({ db, ai }: MealDeps, userId: string, resolved: Resolved, meal: Judged): Promise<MealAnalysis | undefined> {
  if (!ai.enabled || !meal.items.length) return undefined;
  const sorted = courseColumns(meal.courses, meal.items).courses!;
  try {
    return await ai.analyzeMeal({
      ...momentContext(db, userId, resolved, { localDate: meal.localDate, eatenAt: sorted.at(-1)!.eatenAt, start: sorted[0]!.eatenAt, mealType: meal.mealType, excludeId: meal.id }),
      photos: [],
      text: null,
      meal: { title: meal.title, courses: courseBriefs(meal.courses, meal.items) },
      assessOnly: true,
    });
  } catch {
    return undefined;
  }
}

/** The insight and names a judged meal gets, or what it keeps when the AI didn't answer. */
function judgedFields(analysis: MealAnalysis | undefined, previous: Pick<MealRow, 'insight' | 'title'>, items: FoodItem[], resolved: Resolved) {
  return {
    insight: analysis ? buildInsight(mealTotals(items), resolved.targets, resolved.context.plan, { ...analysis, clarification: null }) : refreshedInsight(previous.insight, items, resolved),
    title: analysis?.title.trim().slice(0, 120) || previous.title,
  };
}

// ---------------------------------------------------------------- Logging

type CreateInput = z.infer<typeof CreateMealInputSchema>;

/** The meal a capture joins as its next course (see `courseTarget`), or null for a new meal. */
function joinTarget(db: Db, userId: string, input: Pick<CreateInput, 'course' | 'eatenAt' | 'localDate' | 'mealType'>): MealRow | null {
  const { course } = input;
  if (!course) return null;
  if (course === 'auto') {
    const rows = db.select().from(meals).where(and(eq(meals.userId, userId), eq(meals.localDate, input.localDate))).all();
    return courseTarget(rows, rowSpan, input);
  }
  // The meal chosen on the phone; a new meal if it has gone (deleted while the capture waited offline) or is full.
  const row = db.select().from(meals).where(and(eq(meals.id, course.mealId), eq(meals.userId, userId))).get();
  return row && row.localDate === input.localDate && storedCourses(row).length < COURSE_WINDOW.maxCourses ? row : null;
}

/**
 * Logs a meal: known items are stored as is, a photo or a description goes
 * through the AI. With `course`, a capture that follows a meal becomes its
 * next course instead.
 */
export async function createMeal(deps: MealDeps, userId: string, input: CreateInput): Promise<Meal> {
  const target = joinTarget(deps.db, userId, input);
  if (target) return addCourse(deps, userId, target, input);

  const { db, ai, photos } = deps;
  const resolved = resolveUser(db, userId, input.localDate);
  const { plan } = resolved.context;
  const photo = input.photoBase64 ? decodePhoto(input.photoBase64) : null;
  const known = (input.items ?? []).map(freshItem);

  let items: FoodItem[];
  let title: string;
  let mealType = input.mealType ?? mealTypeForHour(localHour(input.eatenAt));
  let analysis: MealAnalysis | undefined;
  let basedOn: MealReference | null = null;

  if (known.length && !photo && !input.text) {
    items = known;
    title = input.title || items.map((i) => i.name).join(', ').slice(0, 120);
  } else {
    const history = historyFor(db, userId, [input.text], input.localDate, input.eatenAt);
    analysis = await ai.analyzeMeal({
      ...momentContext(db, userId, resolved, { localDate: input.localDate, eatenAt: input.eatenAt, start: input.eatenAt, mealType }),
      photos: photo ? [photoInput(photo)] : [],
      text: input.text ?? null,
      history: history?.input,
    });
    ensureFood(analysis);
    const reused = reusePast(itemsFromAnalysis(analysis), analysis.reusedMeal, history);
    items = [...reused.items, ...known];
    basedOn = reused.basedOn;
    title = input.title || analysis.title.slice(0, 120);
    mealType = input.mealType ?? analysis.mealType;
  }

  const photoId = photo ? await photos.save(userId, photo.buffer, photo.mime) : null;
  const now = nowIso();
  const row = db
    .insert(meals)
    .values({
      id: randomUUID(),
      userId,
      eatenAt: input.eatenAt,
      localDate: input.localDate,
      mealType,
      title,
      items,
      photoId,
      inputText: input.text ?? null,
      note: null,
      insight: buildInsight(mealTotals(items), resolved.targets, plan, analysis),
      favorite: false,
      // One course: its photo and words stay in the columns; only a reused past meal needs saying.
      courses: basedOn ? [{ id: FIRST_COURSE_ID, label: '', eatenAt: input.eatenAt, photoId, text: input.text ?? null, basedOn }] : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toMeal(row);
}

/**
 * A capture joining a meal as its next course. The AI analyses the new
 * course knowing the ones before it, and judges the whole meal: one verdict,
 * one headline. Known items (a scanned dessert) are kept as they are and the
 * meal is judged again around them.
 */
async function addCourse(deps: MealDeps, userId: string, row: MealRow, input: CreateInput): Promise<Meal> {
  const { db, ai, photos } = deps;
  const resolved = resolveUser(db, userId, row.localDate);
  const courses = storedCourses(row);
  const earlier = tagItems(row.items, courses[0]!.id);
  const photo = input.photoBase64 ? decodePhoto(input.photoBase64) : null;
  const courseId = shortId();
  const known = (input.items ?? []).map((item) => ({ ...freshItem(item), id: shortId() }));
  const course: MealCourseRow = { id: courseId, label: '', eatenAt: input.eatenAt, photoId: null, text: input.text ?? null, basedOn: null };

  let analysis: MealAnalysis | undefined;
  let added: FoodItem[];
  if (photo || input.text) {
    const start = Date.parse(input.eatenAt) < Date.parse(row.eatenAt) ? input.eatenAt : row.eatenAt;
    const history = historyFor(db, userId, [input.text], row.localDate, start, row.id);
    analysis = await ai.analyzeMeal({
      ...momentContext(db, userId, resolved, { localDate: row.localDate, eatenAt: input.eatenAt, start, mealType: row.mealType, excludeId: row.id }),
      photos: photo ? [photoInput(photo)] : [],
      text: input.text ?? null,
      meal: { title: row.title, courses: courseBriefs(courses, earlier) },
      history: history?.input,
    });
    ensureFood(analysis);
    const reused = reusePast(itemsFromAnalysis(analysis), analysis.reusedMeal, history);
    added = [...reused.items, ...known];
    course.basedOn = reused.basedOn;
  } else {
    added = known;
    analysis = await judge(deps, userId, resolved, { id: row.id, localDate: row.localDate, mealType: row.mealType, title: row.title, courses: [...courses, course], items: [...earlier, ...known.map((i) => ({ ...i, courseId }))] });
  }

  course.photoId = photo ? await photos.save(userId, photo.buffer, photo.mime) : null;
  const items = [...earlier, ...added.map((item) => ({ ...item, courseId }))];
  const next = withLabels([...courses, course], analysis?.courses);
  const updated = db
    .update(meals)
    .set({
      ...courseColumns(next, items),
      title: analysis?.title.trim().slice(0, 120) || row.title,
      // The AI may ask about the new course: its question stays.
      insight: analysis ? buildInsight(mealTotals(items), resolved.targets, resolved.context.plan, analysis) : refreshedInsight(row.insight, items, resolved),
      mealType: input.mealType ?? analysis?.mealType ?? row.mealType,
      updatedAt: nowIso(),
    })
    .where(eq(meals.id, row.id))
    .returning()
    .get();
  return toMeal(updated);
}

// ---------------------------------------------------------------- Editing

export async function updateMeal({ db, photos }: Pick<MealDeps, 'db' | 'photos'>, userId: string, id: string, input: z.infer<typeof UpdateMealInputSchema>): Promise<Meal> {
  const existing = getMealRow(db, userId, id);
  const changes: Partial<MealRow> = { updatedAt: nowIso() };
  let removed: MealCourseRow[] = [];
  if (input.title !== undefined) changes.title = input.title;
  if (input.mealType !== undefined) changes.mealType = input.mealType;
  if (input.localDate !== undefined) changes.localDate = input.localDate;
  if (input.favorite !== undefined) changes.favorite = input.favorite;
  if (input.note !== undefined) changes.note = input.note;
  // Moving a meal moves all its courses, keeping their gaps.
  let courses = existing.courses;
  if (input.eatenAt !== undefined) {
    changes.eatenAt = input.eatenAt;
    if (courses) courses = moveCourses(courses, input.eatenAt);
  }
  if (input.items !== undefined) {
    if (courses) {
      const known = new Set(courses.map((c) => c.id));
      const items = input.items.map((item) => (item.courseId && known.has(item.courseId) ? item : { ...item, courseId: courses![0]!.id }));
      ({ courses, removed } = pruneCourses(courses, items));
      Object.assign(changes, courseColumns(courses, items));
    } else {
      changes.items = input.items.map(({ courseId: _course, ...item }) => item);
    }
    // Keep the AI's words but recompute the numbers; the question is moot once edited.
    changes.insight = refreshedInsight(existing.insight, changes.items!, resolveUser(db, userId, input.localDate ?? existing.localDate));
  } else if (courses !== existing.courses) {
    Object.assign(changes, courseColumns(courses!, existing.items));
  }
  const row = toMeal(db.update(meals).set(changes).where(eq(meals.id, existing.id)).returning().get());
  await releasePhotos({ db, photos }, userId, removed.map((c) => c.photoId));
  return row;
}

/**
 * Re-runs the analysis with a correction ("no sugar in the coffee", or an
 * answer to the AI's question). It applies to the whole meal: the AI sees
 * every course (photos, words, items) and returns them all, so one sentence
 * can fix the coffee and halve the dessert. Words that refer to the past
 * (« en fait c'était le reste d'hier ») bring the last days' meals along.
 */
export async function refineMeal({ db, ai, photos }: MealDeps, userId: string, id: string, correction: string): Promise<Meal> {
  const existing = getMealRow(db, userId, id);
  const resolved = resolveUser(db, userId, existing.localDate);
  const courses = storedCourses(existing);
  const multi = courses.length > 1;
  const tagged = multi ? tagItems(existing.items, courses[0]!.id) : existing.items;
  const shown = await Promise.all(
    courses
      .map((course, i) => ({ course: i + 1, photoId: course.photoId }))
      .filter((c) => c.photoId)
      .slice(0, MAX_PHOTOS)
      .map(async ({ course, photoId }) => ({ course, stored: await photos.read(userId, photoId!) })),
  );
  const history = historyFor(db, userId, [correction], existing.localDate, existing.eatenAt, existing.id);
  const analysis = await ai.analyzeMeal({
    ...momentContext(db, userId, resolved, { localDate: existing.localDate, eatenAt: existing.eatenAt, start: existing.eatenAt, mealType: existing.mealType, excludeId: existing.id }),
    photos: shown.flatMap(({ course, stored }) => (stored ? [{ base64: stored.buffer.toString('base64'), mime: stored.mime as MealPhoto['mime'], ...(multi ? { course } : {}) }] : [])),
    text: multi ? null : courses[0]!.text,
    previous: { title: existing.title, items: existing.items, ...(multi ? { courses: previousCourses(courses, tagged) } : {}) },
    correction,
    history: history?.input,
  });
  ensureFood(analysis);

  // Each item back in its course: a number the meal doesn't have goes to the first.
  const courseFor = multi ? (n: number | undefined) => (n && n >= 1 && n <= courses.length ? courses[n - 1]!.id : courses[0]!.id) : undefined;
  const reused = reusePast(itemsFromAnalysis(analysis, courseFor), analysis.reusedMeal, history);
  const items = reused.items;
  let next = withLabels(courses, analysis.courses);
  let removed: MealCourseRow[] = [];
  if (multi) ({ courses: next, removed } = pruneCourses(next, items));
  if (reused.basedOn) {
    // The courses whose items came from the past meal say so (a meal of one course, in any case).
    const from = new Set(items.filter((i) => reused.reused.has(i.id)).map((i) => i.courseId ?? next[0]!.id));
    next = next.map((c) => (from.has(c.id) || !multi ? { ...c, basedOn: reused.basedOn } : c));
  }
  const keepColumns = !existing.courses && next.length === 1 && !next[0]!.basedOn;
  const row = db
    .update(meals)
    .set({
      ...(keepColumns ? { items } : courseColumns(next, items)),
      title: analysis.title.slice(0, 120) || existing.title,
      insight: buildInsight(mealTotals(items), resolved.targets, resolved.context.plan, { ...analysis, clarification: null }),
      updatedAt: nowIso(),
    })
    .where(eq(meals.id, existing.id))
    .returning()
    .get();
  await releasePhotos({ db, photos }, userId, removed.map((c) => c.photoId));
  return toMeal(row);
}

export async function deleteMeal({ db, photos }: Pick<MealDeps, 'db' | 'photos'>, userId: string, id: string): Promise<void> {
  const existing = getMealRow(db, userId, id);
  db.delete(meals).where(eq(meals.id, existing.id)).run();
  // Duplicated meals share their photos: each only goes once unused.
  await releasePhotos({ db, photos }, userId, storedCourses(existing).map((c) => c.photoId));
}

// ---------------------------------------------------------------- Courses

/** A meal with at least two courses, and one of them. */
function courseOf(db: Db, userId: string, mealId: string, courseId: string) {
  const row = getMealRow(db, userId, mealId);
  const courses = storedCourses(row);
  const course = courses.find((c) => c.id === courseId);
  if (!course) throw notFound('Course');
  if (courses.length < 2) throw new HttpError(409, 'single_course', 'This meal has only this course');
  const items = tagItems(row.items, courses[0]!.id);
  return { row, courses, course, rest: courses.filter((c) => c !== course), items, kept: items.filter((i) => i.courseId !== courseId) };
}

/** « Séparer »: a course becomes a meal of its own (both judged again). */
export async function separateCourse(deps: MealDeps, userId: string, mealId: string, courseId: string): Promise<SeparateCourseResult> {
  const { db } = deps;
  const { row, course, rest, items, kept } = courseOf(db, userId, mealId, courseId);
  const resolved = resolveUser(db, userId, row.localDate);
  const moved = ownItems(items, [course], courseId).map(({ courseId: _course, ...item }) => item);
  const alone: MealCourseRow = { ...course, id: FIRST_COURSE_ID, label: '' };
  const mealType = mealTypeForHour(localHour(course.eatenAt));
  const fallbackTitle = moved.map((i) => i.name).join(', ').slice(0, 120) || row.title;
  const [left, separated] = await Promise.all([
    judge(deps, userId, resolved, { id: row.id, localDate: row.localDate, mealType: row.mealType, title: row.title, courses: rest, items: kept }),
    judge(deps, userId, resolved, { localDate: row.localDate, mealType, title: fallbackTitle, courses: [alone], items: moved }),
  ]);
  const now = nowIso();
  const updated = db
    .update(meals)
    .set({ ...courseColumns(withLabels(rest, left?.courses), kept), ...judgedFields(left, row, kept, resolved), updatedAt: now })
    .where(eq(meals.id, row.id))
    .returning()
    .get();
  const inserted = db
    .insert(meals)
    .values({
      id: randomUUID(),
      userId,
      eatenAt: course.eatenAt,
      localDate: row.localDate,
      mealType: separated?.mealType ?? mealType,
      items: moved,
      photoId: course.photoId,
      inputText: course.text,
      note: null,
      ...judgedFields(separated, { insight: null, title: fallbackTitle }, moved, resolved),
      favorite: false,
      courses: course.basedOn ? [alone] : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return { meal: toMeal(updated), separated: toMeal(inserted) };
}

/** A course deleted from its meal (the meal judged again); deleting the last one is deleting the meal. */
export async function deleteCourse(deps: MealDeps, userId: string, mealId: string, courseId: string): Promise<Meal> {
  const { db } = deps;
  const { row, course, rest, kept } = courseOf(db, userId, mealId, courseId);
  const resolved = resolveUser(db, userId, row.localDate);
  const analysis = await judge(deps, userId, resolved, { id: row.id, localDate: row.localDate, mealType: row.mealType, title: row.title, courses: rest, items: kept });
  const updated = db
    .update(meals)
    .set({ ...courseColumns(withLabels(rest, analysis?.courses), kept), ...judgedFields(analysis, row, kept, resolved), updatedAt: nowIso() })
    .where(eq(meals.id, row.id))
    .returning()
    .get();
  await releasePhotos(deps, userId, [course.photoId]);
  return toMeal(updated);
}

/** Copies a meal's courses (fresh ids, moved to `start`) with their items: what joins another meal. */
function copiedCourses(source: MealRow, start: string) {
  const courses = storedCourses(source);
  const ids = new Map(courses.map((c) => [c.id, shortId()]));
  return {
    courses: moveCourses(courses, start).map((c) => ({ ...c, id: ids.get(c.id)!, basedOn: null })),
    items: tagItems(source.items, courses[0]!.id).map((item) => ({ ...item, id: shortId(), courseId: ids.get(item.courseId!)! })),
  };
}

/** Joins every course of `fromId` to the meal (« Séparer », undone), then judges it whole. */
export async function mergeMeal(deps: MealDeps, userId: string, intoId: string, fromId: string): Promise<Meal> {
  const { db } = deps;
  const into = getMealRow(db, userId, intoId);
  const from = getMealRow(db, userId, fromId);
  if (into.id === from.id || into.localDate !== from.localDate) throw new HttpError(409, 'cannot_merge', 'Only two meals of the same day can be joined');
  const courses = storedCourses(into);
  const joined = copiedCourses(from, storedCourses(from)[0]!.eatenAt);
  if (courses.length + joined.courses.length > COURSE_WINDOW.maxCourses) throw new HttpError(409, 'too_many_courses', 'This meal already has many courses');
  const nextCourses = [...courses, ...joined.courses];
  const items = [...tagItems(into.items, courses[0]!.id), ...joined.items];
  const resolved = resolveUser(db, userId, into.localDate);
  const analysis = await judge(deps, userId, resolved, { id: into.id, localDate: into.localDate, mealType: into.mealType, title: into.title, courses: nextCourses, items });
  // The photos move with their courses: nothing to delete.
  const updated = db.transaction((tx) => {
    tx.delete(meals).where(eq(meals.id, from.id)).run();
    return tx
      .update(meals)
      .set({ ...courseColumns(withLabels(nextCourses, analysis?.courses), items), ...judgedFields(analysis, into, items, resolved), updatedAt: nowIso() })
      .where(eq(meals.id, into.id))
      .returning()
      .get();
  });
  return toMeal(updated);
}

/**
 * "Same as yesterday": copies a meal to a new time, every course with it.
 * With `course`, the copy joins the meal it follows instead (a favourite
 * dessert after lunch), judged whole.
 */
export async function duplicateMeal(deps: MealDeps, userId: string, sourceId: string, input: z.infer<typeof DuplicateMealInputSchema>): Promise<Meal> {
  const { db } = deps;
  const source = getMealRow(db, userId, sourceId);
  const resolved = resolveUser(db, userId, input.localDate);
  const target = joinTarget(db, userId, input);
  if (target && target.id !== source.id && storedCourses(target).length + storedCourses(source).length <= COURSE_WINDOW.maxCourses) {
    const courses = storedCourses(target);
    const joined = copiedCourses(source, input.eatenAt);
    const nextCourses = [...courses, ...joined.courses];
    const items = [...tagItems(target.items, courses[0]!.id), ...joined.items];
    const analysis = await judge(deps, userId, resolved, { id: target.id, localDate: target.localDate, mealType: target.mealType, title: target.title, courses: nextCourses, items });
    const updated = db
      .update(meals)
      .set({ ...courseColumns(withLabels(nextCourses, analysis?.courses), items), ...judgedFields(analysis, target, items, resolved), updatedAt: nowIso() })
      .where(eq(meals.id, target.id))
      .returning()
      .get();
    return toMeal(updated);
  }

  const copy = source.courses ? copiedCourses(source, input.eatenAt) : null;
  const items = copy?.items ?? source.items.map((item) => ({ ...item, id: shortId() }));
  const now = nowIso();
  const row = db
    .insert(meals)
    .values({
      ...source,
      id: randomUUID(),
      ...(copy ? courseColumns(copy.courses, items) : { items }),
      eatenAt: input.eatenAt,
      localDate: input.localDate,
      mealType: input.mealType ?? source.mealType,
      favorite: false,
      insight: source.insight ? refreshedInsight(source.insight, items, resolved) : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toMeal(row);
}
