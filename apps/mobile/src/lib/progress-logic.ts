/**
 * « Ta progression » on the phone, kept free of React Native so it can be unit
 * tested on its own: the progress bars, the flame's moment and the evening reminder.
 */
import { addDays, clockMinutes, type FamilyProgress, type ProgressSummary, type StreakSummary } from '@symbiose/shared';

/** How full a family's bar is on the way to its next step, as its « 14 / 30 » reads (full once every step is reached). */
export function familyRatio(family: FamilyProgress): number {
  if (family.next === null) return 1;
  return family.next > 0 ? Math.min(1, Math.max(0, family.count / family.next)) : 0;
}

/** The flame grew today and this phone hasn't celebrated it yet: once a day, from the day's first meal. */
export function flameDue(summary: Pick<ProgressSummary, 'today' | 'streak'>, seenOn: string): boolean {
  return summary.streak.todayLogged && summary.streak.current >= 1 && seenOn !== summary.today;
}

/** The line under the flame's number, as an i18n key and its values. */
export type FlameLine =
  | { key: 'flame.first' }
  | { key: 'flame.again'; best: number }
  | { key: 'flame.step' }
  | { key: 'flame.toRecord'; count: number }
  | { key: 'flame.record' }
  | { key: 'flame.recordNext'; count: number; next: number };

/**
 * What the flame says once it has grown: a beginning, a new start that
 * remembers the record, a step reached (its card follows), the days left to
 * beat the record, or the next step past it. Always something ahead.
 */
export function flameLine(summary: Pick<ProgressSummary, 'streak' | 'families'>, stepReached: boolean): FlameLine {
  const { current, best } = summary.streak;
  if (stepReached) return { key: 'flame.step' };
  if (current <= 1) return best > 1 ? { key: 'flame.again', best } : { key: 'flame.first' };
  if (current < best) return { key: 'flame.toRecord', count: best - current + 1 };
  const next = summary.families.find((f) => f.family === 'streak')?.next ?? null;
  return next === null ? { key: 'flame.record' } : { key: 'flame.recordNext', count: next - current, next };
}

/** The evening reminder: late enough for dinner to be logged, early enough to still do it. */
export const STREAK_REMINDER_AT = '20:30';
/** Every identifier starts with this, so the reminders are replaced without touching the coach's notifications. */
export const STREAK_PREFIX = 'streak.';

export interface StreakReminder {
  id: string;
  date: string;
  time: string;
  title: string;
  body: string;
  data: { kind: 'streak'; date: string };
}

export interface ReminderCopy {
  /** « Ta série de 12 jours t'attend ». */
  title: (count: number) => string;
  /** Tomorrow's, when the count isn't known yet. */
  later: string;
  body: string;
}

/**
 * The reminders to schedule, re-planned whenever the streak changes: today's
 * while the run (two days at least) still waits for its meal, and tomorrow's,
 * in case the app isn't opened then, for a run that will still be alive.
 * Nothing once today counts: the reminder is never a nag.
 */
export function streakReminders(streak: Pick<StreakSummary, 'current' | 'todayLogged' | 'restDays'>, today: string, nowMinutes: number, copy: ReminderCopy): StreakReminder[] {
  const time = STREAK_REMINDER_AT;
  const reminder = (date: string, title: string): StreakReminder => ({ id: `${STREAK_PREFIX}${date}`, date, time, title, body: copy.body, data: { kind: 'streak', date } });
  const out: StreakReminder[] = [];
  if (!streak.todayLogged && streak.current >= 2 && clockMinutes(time) > nowMinutes) out.push(reminder(today, copy.title(streak.current)));
  // Tomorrow the run is alive if today counts, or if a rest day will cover it.
  const aliveTomorrow = streak.todayLogged ? streak.current >= 1 : streak.current >= 2 && streak.restDays > 0;
  if (aliveTomorrow) out.push(reminder(addDays(today, 1), copy.later));
  return out;
}
