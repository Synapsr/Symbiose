import { z } from 'zod';

import { addDays } from './dates';
import type { JournalEntry } from './journal';
import { LocalDateSchema, LocalDateTimeSchema, type Profile, type Sex } from './schemas';

/**
 * Opt-in life modules: sleep (read from the health store), hydration and
 * mood. Each is off by default and only reaches insights and the AI once
 * the person turns it on.
 */

// ---------------------------------------------------------------- Sleep

export const SleepSourceSchema = z.enum(['healthkit', 'health_connect']);
export type SleepSource = z.infer<typeof SleepSourceSchema>;

/** One night, merged from the health store's stages and attributed to the day the person woke up. */
export const SleepNightInputSchema = z.object({
  /** The wake-up day. */
  localDate: LocalDateSchema,
  /** First moment in bed or asleep, device-local with offset. */
  bedtime: LocalDateTimeSchema,
  wakeTime: LocalDateTimeSchema,
  asleepMin: z.number().min(0).max(1440),
  /** Null when the store only knows the time asleep. */
  inBedMin: z.number().min(0).max(1440).nullable().default(null),
});
export type SleepNightInput = z.input<typeof SleepNightInputSchema>;

export const SleepInputSchema = z.object({
  nights: z.array(SleepNightInputSchema).min(1).max(1000),
  source: SleepSourceSchema,
});
export type SleepInput = z.input<typeof SleepInputSchema>;

export interface SleepNight extends z.output<typeof SleepNightInputSchema> {
  source: SleepSource;
  updatedAt: string;
}

/** Below this, a night counts as short: adults need 7 hours or more (AASM / Sleep Research Society). */
export const SHORT_NIGHT_MIN = 7 * 60;

export interface SleepTrend {
  /** Nights with data in the window, oldest first. */
  nights: SleepNight[];
  /** Average time asleep, in minutes. */
  averageMin: number | null;
  /** Typical bedtime and wake time, local "HH:MM". */
  bedtime: string | null;
  wakeTime: string | null;
  /** Spread (standard deviation) of the middle of the night, in minutes: the lower, the more regular. */
  regularityMin: number | null;
  /** Cravings per day after short nights vs the other nights, over 30 days at least; null without enough data. */
  cravingsAfterShortNights: { short: number; normal: number } | null;
  windowDays: number;
}

export type SleepSegmentKind = 'inBed' | 'asleep' | 'awake' | 'outOfBed';

/** A piece of a night as health stores give it: a stage, from any source. */
export interface SleepSegment {
  start: Date;
  end: Date;
  kind: SleepSegmentKind;
}

export interface MergedNight {
  start: Date;
  end: Date;
  asleepMin: number;
  inBedMin: number | null;
}

type Span = [number, number];

/** Sorted, non-overlapping union of intervals. */
function union(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const length = (spans: Span[]) => spans.reduce((sum, [a, b]) => sum + (b - a), 0);

/** Total length of `spans` once `holes` are cut out (both already unions). */
function lengthWithout(spans: Span[], holes: Span[]): number {
  let total = length(spans);
  for (const [a, b] of spans) for (const [c, d] of holes) total -= Math.max(0, Math.min(b, d) - Math.max(a, c));
  return total;
}

/** Two pieces further apart than this belong to different sleeps. */
const SESSION_GAP_MS = 2 * 3_600_000;
/** Shorter sleeps are naps, not nights. */
const MIN_NIGHT_MIN = 60;

/**
 * Turns raw stages (several sources may overlap: watch, phone, apps) into
 * nights. Time asleep is the union of the asleep stages minus the moments
 * a tracker saw the person awake or out of bed; time in bed is the union of
 * everything except out of bed. When a store only knows time in bed (a
 * phone's bedtime schedule), that is the best estimate of time asleep.
 * Naps (under an hour) are left out.
 */
export function mergeSleepSegments(segments: SleepSegment[]): MergedNight[] {
  const spans = segments
    .map((s) => ({ a: s.start.getTime(), b: s.end.getTime(), kind: s.kind }))
    .filter((s) => Number.isFinite(s.a) && Number.isFinite(s.b) && s.b > s.a)
    .sort((x, y) => x.a - y.a);

  const sessions: (typeof spans)[] = [];
  let end = -Infinity;
  for (const span of spans) {
    if (span.a > end + SESSION_GAP_MS) sessions.push([]);
    sessions.at(-1)!.push(span);
    end = Math.max(end, span.b);
  }

  const nights: MergedNight[] = [];
  for (const session of sessions) {
    const of = (...kinds: SleepSegmentKind[]) => union(session.filter((s) => kinds.includes(s.kind)).map((s): Span => [s.a, s.b]));
    const awake = of('awake', 'outOfBed');
    const asleep = of('asleep');
    const inBed = of('inBed', 'asleep', 'awake');
    const inBedMs = lengthWithout(inBed, of('outOfBed'));
    const asleepMs = asleep.length ? lengthWithout(asleep, awake) : lengthWithout(of('inBed'), awake);
    const asleepMin = Math.round(asleepMs / 60_000);
    if (asleepMin < MIN_NIGHT_MIN) continue;
    const hasBed = session.some((s) => s.kind === 'inBed' || s.kind === 'awake');
    nights.push({
      start: new Date(Math.min(...session.map((s) => s.a))),
      end: new Date(Math.max(...session.map((s) => s.b))),
      asleepMin,
      inBedMin: hasBed ? Math.max(asleepMin, Math.round(inBedMs / 60_000)) : null,
    });
  }
  return nights;
}

/** One night per wake-up day (the longest, so a nap never replaces the night), oldest first. */
export function nightsByWakeDate<T extends { asleepMin: number }>(nights: T[], wakeDate: (night: T) => string): T[] {
  const byDate = new Map<string, T>();
  for (const night of nights) {
    const date = wakeDate(night);
    const kept = byDate.get(date);
    if (!kept || night.asleepMin > kept.asleepMin) byDate.set(date, night);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, night]) => night);
}

// ---------------------------------------------------------------- Hydration

export const WATER_SIZES = [150, 250, 330, 500] as const;
/** One glass. */
export const DEFAULT_GLASS_ML = 250;

export const WaterSourceSchema = z.enum(['healthkit', 'health_connect', 'manual']);
export type WaterSource = z.infer<typeof WaterSourceSchema>;

export const WaterInputSchema = z.object({
  /** Health store identifier, used to deduplicate imports. */
  externalId: z.string().min(1).max(120).nullable().default(null),
  at: LocalDateTimeSchema,
  localDate: LocalDateSchema,
  ml: z.number().min(1).max(3000),
});
export type WaterInput = z.input<typeof WaterInputSchema>;

export const WaterImportSchema = z.object({
  entries: z.array(WaterInputSchema).min(1).max(5000),
  source: z.enum(['healthkit', 'health_connect']),
});
export type WaterImport = z.input<typeof WaterImportSchema>;

export interface WaterEntry extends z.output<typeof WaterInputSchema> {
  id: string;
  source: WaterSource;
  createdAt: string;
}

export interface DayHydration {
  totalMl: number;
  goalMl: number;
  entries: WaterEntry[];
}

export interface HydrationTrend {
  /** Every day of the window, oldest first. */
  days: { date: string; ml: number; goalMl: number }[];
  /** Average over the days with at least one drink. */
  averageMl: number | null;
  daysLogged: number;
  daysReached: number;
  windowDays: number;
}

const DRINKS_SHARE = 0.8;
const MAX_ACTIVITY_ML = 750;

/**
 * Daily drinks goal, in ml.
 *
 * EFSA (2010) sets adequate intakes of total water at 2.0 L/day for adult
 * women and 2.5 L/day for adult men. Food usually brings about 20 % of it,
 * so drinks cover the other ~80 %: 1.6 L and 2.0 L ("other" takes the
 * midpoint, 1.8 L). Exercise adds sweat losses roughly in proportion to the
 * energy spent, so logged workouts add ≈1 ml per kcal (the classic
 * water-to-energy ratio), capped at +750 ml: the goal moves, lightly.
 * A goal chosen by hand (`Profile.waterGoalMl`) replaces the everyday base;
 * workouts still add to it. Rounded to 50 ml.
 */
export function hydrationGoalMl(sex: Sex, workoutKcal: number | null = 0, chosenMl: number | null = null): number {
  const totalWater = sex === 'female' ? 2000 : sex === 'male' ? 2500 : 2250;
  const base = chosenMl ?? totalWater * DRINKS_SHARE;
  const extra = Math.min(MAX_ACTIVITY_ML, Math.max(0, workoutKcal ?? 0));
  return Math.round((base + extra) / 50) * 50;
}

/** The everyday drinks goal of a profile, before workouts. */
export function everydayWaterGoalMl(profile: Pick<Profile, 'sex' | 'waterGoalMl'>): number {
  return hydrationGoalMl(profile.sex, 0, profile.waterGoalMl ?? null);
}

// ---------------------------------------------------------------- Mood

/**
 * « Humeur » is one concept: the day's mood check-in, a face and an optional
 * word. It is logged from « + » (and from Today's pill when the module is on)
 * and read by Today, the history, Progrès and the coach. The older journal
 * kind « Ressenti » used the same faces: those notes are kept, and read as the
 * day's mood when the day has no check-in (`dayMoods`).
 */
export const MoodLevelSchema = z.number().int().min(1).max(5);

/** The optional word of a check-in. */
export const MOOD_NOTE_MAX = 280;

/** One check-in per day: the latest one wins. */
export const MoodInputSchema = z.object({
  at: LocalDateTimeSchema,
  localDate: LocalDateSchema,
  /** 1 (very low) to 5 (very good). */
  mood: MoodLevelSchema,
  note: z.string().trim().max(MOOD_NOTE_MAX).nullable().default(null),
});
export type MoodInput = z.input<typeof MoodInputSchema>;

export interface MoodCheckIn extends z.output<typeof MoodInputSchema> {
  updatedAt: string;
}

/** The day's mood as everything reads it; `noteId` when it comes from an older « Ressenti » note. */
export interface DayMood extends MoodCheckIn {
  noteId?: string;
}

type FeelingNote = Pick<JournalEntry, 'id' | 'kind' | 'at' | 'localDate' | 'text' | 'data' | 'updatedAt'>;

const clip = (text: string) => (text.length > MOOD_NOTE_MAX ? `${text.slice(0, MOOD_NOTE_MAX - 1).trimEnd()}…` : text);

/**
 * One mood per day, oldest first: the check-in, or on a day without one, the
 * latest face among the older « Ressenti » notes, with its words. Notes
 * without a face carry no mood and stay plain notes.
 */
export function dayMoods(checkIns: MoodCheckIn[], notes: FeelingNote[]): DayMood[] {
  const byDate = new Map<string, DayMood>(checkIns.map((c) => [c.localDate, c]));
  const latest = new Map<string, FeelingNote>();
  for (const note of notes) {
    if (note.kind !== 'feeling' || note.data.feeling === undefined || byDate.has(note.localDate)) continue;
    const kept = latest.get(note.localDate);
    if (!kept || Date.parse(note.at) > Date.parse(kept.at)) latest.set(note.localDate, note);
  }
  for (const [date, note] of latest) {
    const text = note.text.trim();
    byDate.set(date, { localDate: date, at: note.at, mood: note.data.feeling!, note: text ? clip(text) : null, updatedAt: note.updatedAt, noteId: note.id });
  }
  return [...byDate.values()].sort((a, b) => a.localDate.localeCompare(b.localDate));
}

export type MoodFactor = 'shortSleep' | 'craving' | 'sugarOver';

/** « Les jours où… »: average mood on days with vs without a factor. An observation, never a cause. */
export interface MoodLink {
  factor: MoodFactor;
  withAvg: number;
  withoutAvg: number;
  withDays: number;
  withoutDays: number;
}

export interface MoodTrend {
  /** Days of the window with a mood, oldest first, with their word when there is one. */
  days: { date: string; mood: number; note?: string }[];
  average: number | null;
  latest: MoodCheckIn | null;
  link: MoodLink | null;
  /** Very low moods that last (see `moodPersistentlyLow`). */
  persistentLow: boolean;
  windowDays: number;
}

/** A day of check-in with what may relate to it; null when unknown (no night recorded, no meal logged). */
export type MoodDay = { mood: number } & Partial<Record<MoodFactor, boolean | null>>;

const MIN_GROUP_DAYS = 3;
const MIN_MOOD_GAP = 0.5;

const mean = (values: number[]) => Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10;

/**
 * The factor whose days differ most in mood, when both groups have at least
 * 3 days and the gap is at least half a point. Small samples, so the app
 * and the AI only ever say « Les jours où… ».
 */
export function moodLink(days: MoodDay[]): MoodLink | null {
  let best: MoodLink | null = null;
  for (const factor of ['shortSleep', 'craving', 'sugarOver'] as const) {
    const withDays = days.filter((d) => d[factor] === true).map((d) => d.mood);
    const withoutDays = days.filter((d) => d[factor] === false).map((d) => d.mood);
    if (withDays.length < MIN_GROUP_DAYS || withoutDays.length < MIN_GROUP_DAYS) continue;
    const link = { factor, withAvg: mean(withDays), withoutAvg: mean(withoutDays), withDays: withDays.length, withoutDays: withoutDays.length };
    const gap = Math.abs(link.withAvg - link.withoutAvg);
    if (gap >= MIN_MOOD_GAP && (!best || gap > Math.abs(best.withAvg - best.withoutAvg))) best = link;
  }
  return best;
}

/**
 * Very low moods that last: at least 4 check-ins at 1/5 over the last 14
 * days, and the latest one still low (2/5 or less). Only then do the app and
 * the coach gently mention talking to someone.
 */
export function moodPersistentlyLow(days: { date: string; mood: number }[], today: string): boolean {
  const recent = days.filter((d) => d.date >= addDays(today, -13) && d.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const latest = recent.at(-1);
  return Boolean(latest && latest.mood <= 2 && recent.filter((d) => d.mood === 1).length >= 4);
}
