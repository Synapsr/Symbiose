/**
 * « Ta progression » on the phone, kept free of React Native so it can be unit
 * tested on its own: the progress bars and the evening reminder.
 */
import { addDays, clockMinutes, type FamilyProgress, type StreakSummary } from '@symbiose/shared';

/** How full a family's bar is on the way to its next step, as its « 14 / 30 » reads (full once every step is reached). */
export function familyRatio(family: FamilyProgress): number {
  if (family.next === null) return 1;
  return family.next > 0 ? Math.min(1, Math.max(0, family.count / family.next)) : 0;
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
