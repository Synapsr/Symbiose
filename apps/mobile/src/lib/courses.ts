import { courseTarget, courseTimeFor, localHour, localTime, mealSpan, mealTypeForHour, toLocalDate, toLocalDateTime, type CourseTarget, type Meal, type MealSpan, type MealType } from '@symbiose/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useOutbox } from './outbox';
import { useApi } from './session';
import { usePending } from './stores';
import { useHiddenIds } from './undo';

export { basedOnLabel, courseName, joinedCourse, withMeal, yourMeal } from './course-logic';

/** Where a capture would go, as the capture screen's chip says it. */
export interface CourseChoice {
  target: CourseTarget;
  mealType: MealType;
  /** When the meal started: « 12:40 ». */
  time: string;
  /** Adding to a chosen meal (« Ajouter un plat »): when the new course was eaten. */
  at: { eatenAt: string; localDate: string } | null;
}

/**
 * The meal a capture made now would join (see `courseTarget`): one of the
 * day's meals, or a capture still on its way, which the server places once
 * it lands. With `intoId`, the meal chosen from its page. Null: a new meal.
 * Only today: a past day's captures take the current time of day, which says
 * nothing about the meals then.
 */
export function useCourseTarget(date: string, intoId?: string): CourseChoice | null {
  const api = useApi();
  const queryClient = useQueryClient();
  const today = toLocalDate();
  const day = useQuery({ queryKey: ['day', date], queryFn: () => api.day(date), enabled: date === today || Boolean(intoId) });
  const pending = usePending((s) => s.items);
  const outbox = useOutbox((s) => s.items);
  const hidden = useHiddenIds();
  const [now] = useState(() => toLocalDateTime());
  const meals = (day.data?.meals ?? []).filter((m) => !hidden[m.id]);

  if (intoId) {
    const meal = meals.find((m) => m.id === intoId) ?? queryClient.getQueryData<Meal>(['meal', intoId]);
    if (!meal) return null;
    return { target: { mealId: meal.id }, mealType: meal.mealType, time: localTime(meal.eatenAt), at: { eatenAt: courseTimeFor(mealSpan(meal), now), localDate: meal.localDate } };
  }
  if (date !== today) return null;

  // A capture on its way to a known meal lengthens it; the others stand on their own.
  const spans = new Map(meals.map((m) => [m.id, mealSpan(m)]));
  const loose: { span: MealSpan; target: CourseTarget }[] = [];
  for (const capture of [...pending.map((p) => p.input), ...outbox]) {
    if (capture.localDate !== date) continue;
    const into = typeof capture.course === 'object' ? spans.get(capture.course.mealId) : undefined;
    if (into) {
      if (Date.parse(capture.eatenAt) > Date.parse(into.end)) into.end = capture.eatenAt;
      into.courses += 1;
    } else {
      const mealType = capture.mealType ?? mealTypeForHour(localHour(capture.eatenAt));
      loose.push({ span: { localDate: date, mealType, start: capture.eatenAt, end: capture.eatenAt, courses: 1 }, target: 'auto' });
    }
  }
  const candidates = [...meals.map((m) => ({ span: spans.get(m.id)!, target: { mealId: m.id } as CourseTarget })), ...loose];
  const found = courseTarget(candidates, (c) => c.span, { eatenAt: now, localDate: date });
  return found ? { target: found.target, mealType: found.span.mealType, time: localTime(found.span.start), at: null } : null;
}
