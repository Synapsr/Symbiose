import { randomUUID } from 'node:crypto';

import {
  addDays,
  clockMinutes,
  CRAVING_WINDOW_DAYS,
  cravingWindow,
  formatClock,
  localTime,
  mealTotals,
  MIN_WAKE_NIGHTS,
  morningTimes,
  nextMonday,
  NUTRIENT_META,
  resolveProactive,
  SHORT_NIGHT_MIN,
  usualWakeTimes,
  type CoachMessage,
  type CravingWindow,
  type Locale,
  type ProactiveSchedule,
  type ResolvedProactive,
} from '@symbiose/shared';
import { and, count, eq, gte, lte } from 'drizzle-orm';

import type { MorningInput, NudgesInput } from '../ai/types';
import type { Db } from '../db';
import { coachMessages, cravings, meals, type UserRow } from '../db/schema';
import { toCoachMessage } from './coach-messages';
import { daySummary } from './day';
import { nightOf, nightsBetween, sleepTrend } from './sleep';
import { getUserRow, resolveUser } from './users';
import { recoveryBrief, recoveryFor } from './vitals';

/** The person's proactive settings, with the craving heads-up's default resolved from their goals and cravings. */
export function proactiveSettings(db: Db, row: UserRow): ResolvedProactive {
  const logged = db.select({ n: count() }).from(cravings).where(eq(cravings.userId, row.id)).get()?.n ?? 0;
  return resolveProactive(row.profile?.proactive, row.plan ?? null, logged);
}

/** Cravings, sugary snacks and logged days over the 28 days ending on `date`. */
function cravingData(db: Db, userId: string, date: string) {
  const from = addDays(date, -(CRAVING_WINDOW_DAYS - 1));
  const cravingRows = db
    .select({ at: cravings.at, localDate: cravings.localDate })
    .from(cravings)
    .where(and(eq(cravings.userId, userId), gte(cravings.localDate, from), lte(cravings.localDate, date)))
    .all();
  const mealRows = db
    .select({ at: meals.eatenAt, localDate: meals.localDate, mealType: meals.mealType, items: meals.items })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, from), lte(meals.localDate, date)))
    .all();
  return {
    cravings: cravingRows,
    snacks: mealRows.filter((m) => m.mealType === 'snack').map((m) => ({ at: m.at, localDate: m.localDate, addedSugar: mealTotals(m.items).addedSugar })),
    loggedDays: new Set(mealRows.map((m) => m.localDate)).size,
  };
}

export function usualCravingWindow(db: Db, userId: string, date: string): CravingWindow | null {
  return cravingWindow(cravingData(db, userId, date), date);
}

/** Days with a meal between two days. */
function loggedDaysBetween(db: Db, userId: string, from: string, to: string): number {
  if (to < from) return 0;
  return db
    .selectDistinct({ day: meals.localDate })
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, from), lte(meals.localDate, to)))
    .all().length;
}

/** The day's morning check-in, once written. */
export function morningMessage(db: Db, userId: string, date: string): CoachMessage | null {
  const row = db
    .select()
    .from(coachMessages)
    .where(and(eq(coachMessages.userId, userId), eq(coachMessages.kind, 'morning'), eq(coachMessages.localDate, date)))
    .get();
  return row ? toCoachMessage(row) : null;
}

/**
 * Everything the phone needs to schedule the proactive notifications for
 * the coming days: the times (from their sleep when tracked), the craving
 * window, whether next Monday's review has enough data, today's check-in.
 */
export function proactiveSchedule(db: Db, userId: string, date: string): ProactiveSchedule {
  const row = getUserRow(db, userId);
  const settings = proactiveSettings(db, row);
  const nights = row.profile?.trackSleep ? nightsBetween(db, userId, addDays(date, -27), date) : [];
  const usualWake = usualWakeTimes(nights, date);
  const monday = nextMonday(date);
  const today = morningMessage(db, userId, date);
  return {
    date,
    settings,
    morning: { ...morningTimes(settings, usualWake), usualWake },
    sleepNights: nights.filter((n) => n.localDate > addDays(date, -14)).length,
    cravings: usualCravingWindow(db, userId, date),
    // The week a Monday review covers ends the day before; up to today, what is logged so far.
    review: { monday, loggedDays: loggedDaysBetween(db, userId, addDays(monday, -7), date < monday ? date : addDays(monday, -1)) },
    today: today ? { messageId: today.id, content: today.content } : null,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** What the morning check-in is written from: last night, recovery when reliable, yesterday, today's likely trigger. */
export function buildMorningInput(db: Db, userId: string, date: string, hideCalories = false): MorningInput {
  const resolved = resolveUser(db, userId, date);
  const profile = resolved.row.profile ?? null;
  const plan = resolved.row.plan ?? null;
  const trackSleep = profile?.trackSleep === true;
  const lastNight = trackSleep ? nightOf(db, userId, date) : null;
  const before = trackSleep ? nightsBetween(db, userId, addDays(date, -14), addDays(date, -1)) : [];
  const window = usualCravingWindow(db, userId, date);

  const yesterday = addDays(date, -1);
  const day = daySummary(db, userId, yesterday);
  // The goal's first focus, as Today shows it; calories only when they're not hidden.
  const hero = (plan?.focus ?? []).find((key) => !(hideCalories && key === 'kcal')) ?? 'protein';
  const progress = day.progress.find((p) => p.nutrient === hero);
  return {
    ...resolved.context,
    date,
    weekday: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    sleepTracked: trackSleep,
    night: lastNight
      ? {
          asleepMin: lastNight.asleepMin,
          bedtime: localTime(lastNight.bedtime),
          wakeTime: localTime(lastNight.wakeTime),
          usualAsleepMin: before.length >= MIN_WAKE_NIGHTS ? Math.round(median(before.map((n) => n.asleepMin))) : null,
        }
      : null,
    recovery: recoveryBrief(recoveryFor(db, userId, date, lastNight)),
    cravingsAfterShortNights: trackSleep ? sleepTrend(db, userId, addDays(date, -29), date).cravingsAfterShortNights : null,
    yesterday: {
      date: yesterday,
      meals: day.meals.length,
      hero: day.meals.length && progress ? { nutrient: hero, consumed: Math.round(progress.consumed), target: Math.round(progress.target.value), kind: progress.target.kind } : null,
      cravings: { total: day.cravings.total, resisted: day.cravings.resisted, what: [...new Set(day.cravings.items.map((c) => c.what))].slice(0, 3) },
    },
    cravingWindow: window ? { start: window.start, end: window.end } : null,
  };
}

/** Saves the day's check-in once: when two requests race, the first one written wins and both get it. */
export function saveMorning(db: Db, userId: string, date: string, content: string): CoachMessage {
  db.insert(coachMessages)
    .values({ id: randomUUID(), userId, role: 'assistant', content, suggestion: null, mealActions: null, kind: 'morning', localDate: date, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run();
  return morningMessage(db, userId, date)!;
}

export function nudgesInput(db: Db, userId: string, date: string, window: CravingWindow): NudgesInput {
  const resolved = resolveUser(db, userId, date);
  const rows = db
    .select({ what: cravings.what })
    .from(cravings)
    .where(and(eq(cravings.userId, userId), gte(cravings.localDate, addDays(date, -(CRAVING_WINDOW_DAYS - 1)))))
    .all();
  const counts = new Map<string, number>();
  for (const { what } of rows) counts.set(what.toLowerCase(), (counts.get(what.toLowerCase()) ?? 0) + 1);
  return {
    ...resolved.context,
    cravingWindow: { start: window.start, end: window.end, source: window.source },
    topCravings: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([what]) => what),
  };
}

// ---------------------------------------------------------------- Without the AI

const duration = (minutes: number, locale: Locale) => {
  const h = Math.floor(minutes / 60);
  const m = String(Math.round(minutes % 60)).padStart(2, '0');
  return locale === 'fr' ? (m === '00' ? `${h} h` : `${h} h ${m}`) : m === '00' ? `${h}h` : `${h}h${m}`;
};
const clock = (time: string, locale: Locale) => (locale === 'fr' ? time.replace(':', ' h ') : time);

/**
 * The check-in written from the data alone: the mock AI's answer, and the
 * fallback when the AI is off or fails. Same shape as the AI's: the night,
 * recovery when it shows, yesterday, one tip.
 */
export function templateMorning(input: MorningInput): string {
  const fr = input.locale === 'fr';
  const lines: string[] = [];
  const { night, yesterday, cravingWindow: window } = input;

  if (night) {
    const diff = night.usualAsleepMin === null ? null : night.asleepMin - night.usualAsleepMin;
    const vs =
      diff === null ? '' : Math.abs(diff) < 20 ? (fr ? ', comme d’habitude' : ', about your usual') : diff < 0 ? (fr ? `, ${duration(-diff, 'fr')} de moins que d’habitude` : `, ${duration(-diff, 'en')} less than usual`) : fr ? `, ${duration(diff, 'fr')} de plus que d’habitude` : `, ${duration(diff, 'en')} more than usual`;
    lines.push(fr ? `Nuit de ${duration(night.asleepMin, 'fr')}${vs}.` : `${duration(night.asleepMin, 'en')} of sleep${vs}.`);
  }
  if (input.recovery && input.recovery.status !== 'usual') {
    lines.push(fr ? 'Ta récupération semble un peu plus basse que d’habitude : vas-y en douceur.' : 'Your recovery seems a little lower than usual: go easy on yourself.');
  }

  if (!yesterday.meals) {
    lines.push(fr ? 'Hier, rien de noté : on repart tranquillement aujourd’hui.' : 'Nothing logged yesterday: a fresh, easy start today.');
  } else if (yesterday.hero) {
    const { nutrient, consumed, target, kind } = yesterday.hero;
    const unit = NUTRIENT_META[nutrient].unit;
    const label = NUTRIENT_META[nutrient].label[input.locale].toLowerCase();
    const amount = nutrient === 'kcal' ? `${consumed} kcal` : fr ? `${consumed} ${unit} de ${label}` : `${consumed} ${unit} of ${label}`;
    const goal = fr ? (kind === 'max' ? `pour une limite de ${target} ${unit}` : `pour un objectif de ${target} ${unit}`) : kind === 'max' ? `against a ${target} ${unit} limit` : `against a ${target} ${unit} goal`;
    const { total, resisted } = yesterday.cravings;
    const urges = !total
      ? ''
      : fr
        ? `, ${total} envie${total > 1 ? 's' : ''}${resisted ? ` dont ${resisted} surfée${resisted > 1 ? 's' : ''}` : ''}`
        : `, ${total} craving${total > 1 ? 's' : ''}${resisted ? `, ${resisted} ridden out` : ''}`;
    lines.push(fr ? `Hier : ${amount} ${goal}${urges}.` : `Yesterday: ${amount} ${goal}${urges}.`);
  }

  const short = Boolean(night && night.asleepMin < SHORT_NIGHT_MIN);
  if (window) {
    const snack = clock(formatClock(Math.round((clockMinutes(window.start) - 30) / 15) * 15), input.locale);
    lines.push(
      short
        ? fr
          ? `Après une nuit courte, l’envie de sucre arrive souvent plus tôt : prévois un en-cas protéiné vers ${snack}.`
          : `After a short night, sugar cravings often come earlier: plan a protein snack around ${snack}.`
        : fr
          ? `Aujourd’hui, garde un en-cas protéiné à portée de main vers ${snack}, avant ton créneau sucré.`
          : `Today, keep a protein snack within reach around ${snack}, before your usual sugar slot.`,
    );
  } else {
    lines.push(
      short
        ? fr
          ? 'Après une nuit courte, un petit-déjeuner avec des protéines aide à tenir jusqu’à midi.'
          : 'After a short night, a breakfast with some protein helps you get to lunch.'
        : fr
          ? 'Aujourd’hui, des protéines et des légumes à chaque repas : simple et rassasiant.'
          : 'Today, some protein and vegetables at each meal: simple and filling.',
    );
  }
  return lines.join('\n');
}

/** The week's nudges when the AI is off or fails. */
export const FALLBACK_NUDGES: Record<Locale, string[]> = {
  fr: [
    'Ton créneau sucré approche : un yaourt nature ou quelques noix, prêts à portée de main ?',
    'Un grand verre d’eau maintenant : la soif se déguise souvent en envie de sucre.',
    'Cinq minutes de marche avant ton créneau habituel, et l’envie arrive souvent moins fort.',
    'Si l’envie vient, assieds-toi et savoure un carré de chocolat noir, sans culpabilité.',
    'Un fruit et une poignée d’amandes préparés maintenant, et l’après-midi passe tout seul.',
  ],
  en: [
    'Your sugar slot is coming up: plain yoghurt or a few nuts within reach?',
    'A big glass of water now: thirst often passes for a sugar craving.',
    'Five minutes of walking before your usual slot, and the craving often comes softer.',
    'If the craving comes, sit down and enjoy a square of dark chocolate, guilt-free.',
    'A piece of fruit and a handful of almonds ready now, and the afternoon flows.',
  ],
};
