import {
  addDays,
  clockMinutes,
  daysBetween,
  firstLine,
  inQuietHours,
  isWeekend,
  MAX_PROACTIVE_PER_DAY,
  MIN_REVIEW_DAYS,
  proactiveOffer,
  type ProactiveOffer,
  type ProactiveSchedule,
} from '@symbiose/shared';

import { plainText } from './markdown';

/**
 * Which proactive notifications to schedule over the coming days, from the
 * server's schedule. Pure: the phone replaces its pending notifications
 * with this list every time something changes, so it is always the truth.
 */

export type ProactiveKind = 'morning' | 'cravings' | 'weekly';

/** iOS category of the craving heads-up, with its two buttons (no ":" or "-" allowed). */
export const CRAVING_CATEGORY = 'cravingHeadsUp';
export const ACTION_CRAVING = 'craving';
export const ACTION_FINE = 'fine';

/** Every identifier starts with this, so the app only ever touches its own. */
export const PROACTIVE_PREFIX = 'proactive.';

/**
 * Notifications are planned a week ahead and re-planned whenever the app
 * opens: someone who stops opening the app stops hearing from it after a week.
 */
export const HORIZON_DAYS = 7;

export interface ProactiveData {
  kind: ProactiveKind;
  date: string;
  /** Monday's check-in also says the week's review is ready. */
  review?: boolean;
  [key: string]: unknown;
}

export interface PlannedNotification {
  id: string;
  kind: ProactiveKind;
  /** Local day and "HH:MM". */
  date: string;
  time: string;
  title: string;
  body: string;
  data: ProactiveData;
  category?: typeof CRAVING_CATEGORY;
}

export interface PlanCopy {
  morningTitle: string;
  /** When the day's check-in is already written: its first line is the body. */
  morningReadyTitle: string;
  morningBody: string;
  morningReview: string;
  weeklyTitle: string;
  weeklyBody: string;
  cravingsTitle: string;
  /** Used until the week's nudges arrive. */
  cravingsFallback: string[];
}

export interface PlanInput {
  schedule: ProactiveSchedule;
  /** The phone's local day and time, in minutes since midnight. */
  today: string;
  nowMinutes: number;
  /** The day the check-in was read in the app: no notification needed for it. */
  morningSeen: string;
  /** Local "HH:MM" of today's logged cravings. */
  cravingTimes: string[];
  nudges: string[];
  copy: PlanCopy;
  horizonDays?: number;
}

/** The week's nudges take turns, one a day: the same one in the notification and on the coach line, without Markdown. */
export function nudgeFor(date: string, lines: string[]): string | null {
  if (!lines.length) return null;
  return plainText(lines[((daysBetween('2026-01-05', date) % lines.length) + lines.length) % lines.length]!);
}

/** A craving logged in the hour before the heads-up makes it pointless that day. */
const RECENT_CRAVING_MIN = 60;
const PRIORITY: Record<ProactiveKind, number> = { morning: 0, weekly: 1, cravings: 2 };

export function planNotifications(input: PlanInput): PlannedNotification[] {
  const { schedule, today, nowMinutes, copy } = input;
  const { settings, morning, cravings: window, review } = schedule;
  if (!settings.enabled) return [];
  const nudges = input.nudges.length ? input.nudges : copy.cravingsFallback;

  const planned: PlannedNotification[] = [];
  for (let i = 0; i < (input.horizonDays ?? HORIZON_DAYS); i++) {
    const date = addDays(today, i);
    const isToday = i === 0;
    const ahead = (time: string) => !isToday || clockMinutes(time) > nowMinutes;
    const day: PlannedNotification[] = [];

    const at = isWeekend(date) ? morning.weekend : morning.weekday;
    const reviewReady = settings.weekly && date === review.monday && review.loggedDays >= MIN_REVIEW_DAYS;
    const seen = isToday && input.morningSeen === today;
    if (settings.morning && ahead(at) && !seen) {
      const line = isToday && schedule.today ? firstLine(plainText(schedule.today.content)) : null;
      day.push({
        id: `${PROACTIVE_PREFIX}morning.${date}`,
        kind: 'morning',
        date,
        time: at,
        title: line ? copy.morningReadyTitle : copy.morningTitle,
        // On Mondays, one notification says both: never a third one that day.
        body: [line ?? copy.morningBody, reviewReady ? copy.morningReview : null].filter(Boolean).join(' '),
        data: { kind: 'morning', date, ...(reviewReady ? { review: true } : null) },
      });
    } else if (reviewReady && !settings.morning && ahead(at)) {
      day.push({ id: `${PROACTIVE_PREFIX}weekly.${date}`, kind: 'weekly', date, time: at, title: copy.weeklyTitle, body: copy.weeklyBody, data: { kind: 'weekly', date } });
    }

    if (settings.cravings && window && ahead(window.notifyAt) && !inQuietHours(window.notifyAt, settings.quietStart, settings.quietEnd)) {
      const recent = isToday && input.cravingTimes.some((time) => clockMinutes(time) >= clockMinutes(window.notifyAt) - RECENT_CRAVING_MIN);
      if (!recent) {
        const line = nudgeFor(date, nudges)!;
        day.push({
          id: `${PROACTIVE_PREFIX}cravings.${date}`,
          kind: 'cravings',
          date,
          time: window.notifyAt,
          title: copy.cravingsTitle,
          body: line,
          data: { kind: 'cravings', date },
          category: CRAVING_CATEGORY,
        });
      }
    }

    // Their own cap (one a day by default), never more than two: the morning check-in comes first.
    const cap = Math.min(settings.maxPerDay ?? 1, MAX_PROACTIVE_PER_DAY);
    planned.push(...day.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]).slice(0, cap));
  }
  return planned.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

// ---------------------------------------------------------------- The coach line

/** What can be swiped away from the line, for the day. */
export type LineKind = 'cravings' | 'morning' | 'weekly' | 'offer';

export type ProactiveLine =
  | { kind: 'cravings'; start: string }
  | { kind: 'morning'; messageId: string | null; text: string; writing: boolean }
  | { kind: 'weekly' }
  | { kind: 'offer'; offer: ProactiveOffer; start: string | null };

export interface LineInput {
  schedule: ProactiveSchedule | null;
  today: string;
  nowMinutes: number;
  /** Swiped away today. */
  dismissed: LineKind[];
  cravingTimes: string[];
  /** Today's check-in, written or being written. */
  morning: { messageId: string | null; content: string; writing: boolean } | null;
}

/** The heads-up shows from an hour before the usual slot until half an hour after it. */
const HEADS_UP_BEFORE_MIN = 60;
const HEADS_UP_AFTER_MIN = 30;
/** The check-in shows from waking until noon. */
const MORNING_UNTIL = 12 * 60;
const MORNING_BEFORE_MIN = 60;

const morningAt = (schedule: ProactiveSchedule, today: string) => clockMinutes(isWeekend(today) ? schedule.morning.weekend : schedule.morning.weekday);

/**
 * The one proactive sentence Today shows in place of its day line, by
 * priority: the craving heads-up around the usual slot, the morning
 * check-in until noon, the Monday review, an offer. Null: the usual line.
 */
export function proactiveLine(input: LineInput): ProactiveLine | null {
  const { schedule, nowMinutes, dismissed } = input;
  if (!schedule) return null;
  const { settings, cravings: window } = schedule;
  const open = (kind: LineKind) => !dismissed.includes(kind);

  if (settings.enabled && settings.cravings && window && open('cravings')) {
    const start = clockMinutes(window.start);
    const near = nowMinutes >= start - HEADS_UP_BEFORE_MIN && nowMinutes <= clockMinutes(window.end) + HEADS_UP_AFTER_MIN;
    // A craving already logged around the slot: the line has done its job.
    const handled = input.cravingTimes.some((time) => clockMinutes(time) >= start - HEADS_UP_BEFORE_MIN);
    if (near && !handled) return { kind: 'cravings', start: window.start };
  }

  const morning = input.morning ?? (schedule.today ? { messageId: schedule.today.messageId, content: schedule.today.content, writing: false } : null);
  const up = nowMinutes >= morningAt(schedule, input.today) - MORNING_BEFORE_MIN;
  if (settings.enabled && settings.morning && morning && open('morning') && nowMinutes < MORNING_UNTIL && (morning.content || up)) {
    return { kind: 'morning', messageId: morning.messageId, text: morning.content, writing: morning.writing };
  }

  if (settings.enabled && settings.weekly && input.today === schedule.review.monday && schedule.review.loggedDays >= MIN_REVIEW_DAYS && open('weekly')) return { kind: 'weekly' };

  const offer = proactiveOffer(schedule);
  if (offer && open('offer')) return { kind: 'offer', offer, start: window?.start ?? null };
  return null;
}

/** When the app writes today's check-in on its own: the feature is on, it isn't written yet, and the person is up. */
export function morningDue(schedule: ProactiveSchedule, today: string, nowMinutes: number): boolean {
  const { settings } = schedule;
  if (!settings.enabled || !settings.morning || schedule.today) return false;
  return nowMinutes >= morningAt(schedule, today) - MORNING_BEFORE_MIN && nowMinutes < MORNING_UNTIL;
}
