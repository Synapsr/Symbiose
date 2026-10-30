import { z } from 'zod';

import { addDays, startOfWeek } from './dates';
import { SHORT_NIGHT_MIN } from './life';
import { ClockTimeSchema, LocalDateSchema, type GoalPlan, type ProactiveSettings, type ProactiveSettingsInput } from './schemas';

/**
 * The proactive coach: a morning check-in, a heads-up before the usual
 * sugar craving, the Monday review. Rare by design: at most two
 * notifications a day, nothing during quiet hours, and nothing without
 * enough reliable data. Everything here is pure, so the server computes
 * the schedule and the phone only renders and schedules it.
 */

/** Never more proactive notifications than this in a day. */
export const MAX_PROACTIVE_PER_DAY = 2;

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" → minutes since midnight. */
export function clockMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Minutes since midnight → "HH:MM", wrapping around the day. */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Local minutes of a timestamp with offset (2026-10-30T07:05:00+01:00 → 425). */
const minutesOf = (localDateTime: string) => clockMinutes(localDateTime.slice(11, 16));

const round5 = (minutes: number) => Math.round(minutes / 5) * 5;

/** Inside [start, end), over midnight when the end comes first (22:00 → 07:00). */
export function inQuietHours(time: string, start: string, end: string): boolean {
  const t = clockMinutes(time);
  const s = clockMinutes(start);
  const e = clockMinutes(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** A time that falls in quiet hours moves to their end. */
export function afterQuietHours(time: string, start: string, end: string): string {
  return inQuietHours(time, start, end) ? end : time;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Linear-interpolated quantile of sorted values. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (pos - low);
}

/** Saturday or Sunday, from a YYYY-MM-DD. */
export function isWeekend(localDate: string): boolean {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/** The Monday on or after a day: when its review would be sent. */
export function nextMonday(localDate: string): string {
  const monday = startOfWeek(localDate);
  return monday === localDate ? monday : addDays(monday, 7);
}

/** What a notification shows of a message: its first line. */
export function firstLine(content: string): string {
  return content.trim().split('\n')[0]!.trim();
}

// ---------------------------------------------------------------- Settings

export interface ResolvedProactive extends ProactiveSettings {
  /** Resolved: the stored choice, else the default from the goals. */
  cravings: boolean;
}

/** The plan is about sugar: a sugar goal tag or a sugar limit. */
export function targetsSugar(plan: GoalPlan | null): boolean {
  if (!plan) return false;
  return plan.tags.includes('reduce_sugar') || plan.rules.some((r) => r.kind === 'max' && (r.nutrient === 'addedSugar' || r.nutrient === 'sugar'));
}

/** The craving heads-up is on by default when the goals target sugar or cravings were logged. */
export function cravingHeadsUpByDefault(plan: GoalPlan | null, cravingsLogged: number): boolean {
  return targetsSugar(plan) || cravingsLogged > 0;
}

const DEFAULTS: ProactiveSettings = { enabled: false, morning: true, weekly: true, morningTime: null, quietStart: '22:00', quietEnd: '07:00', maxPerDay: 1 };

export function resolveProactive(settings: ProactiveSettingsInput | undefined, plan: GoalPlan | null, cravingsLogged: number): ResolvedProactive {
  const merged = { ...DEFAULTS, ...settings };
  return { ...merged, cravings: settings?.cravings ?? cravingHeadsUpByDefault(plan, cravingsLogged) };
}

// ---------------------------------------------------------------- Morning time

export const WAKE_WINDOW_DAYS = 14;
export const MIN_WAKE_NIGHTS = 5;
/** Weekends are read over four weeks, from three mornings. */
const WEEKEND_WINDOW_DAYS = 28;
const MIN_WEEKEND_NIGHTS = 3;
/** Below this gap, weekends just follow weekdays. */
const WEEKEND_GAP_MIN = 45;

export interface UsualWake {
  /** Median wake time, "HH:MM" to 5 minutes: weekdays when there are enough, else every night. */
  weekday: string;
  /** Weekends, when they differ by 45 minutes or more; otherwise the same as weekdays. */
  weekend: string;
  /** Nights over the last 14 days. */
  nights: number;
}

/** Wake times counted from 18:00, so that a wake-up around midnight doesn't wrap. */
const fromEvening = (localDateTime: string) => (minutesOf(localDateTime) - 1080 + 1440) % 1440;
const wakeMedian = (nights: { wakeTime: string }[]) => round5(median(nights.map((n) => fromEvening(n.wakeTime))));

/**
 * The person's usual wake time: the median over the last 14 nights (5 at
 * least), with a separate weekend time when their weekends really differ.
 * Nights are keyed by their wake-up day.
 */
export function usualWakeTimes(nights: { localDate: string; wakeTime: string }[], today: string): UsualWake | null {
  const recent = nights.filter((n) => n.localDate > addDays(today, -WAKE_WINDOW_DAYS) && n.localDate <= today);
  if (recent.length < MIN_WAKE_NIGHTS) return null;
  const weekdays = recent.filter((n) => !isWeekend(n.localDate));
  const weekday = weekdays.length >= MIN_WAKE_NIGHTS ? wakeMedian(weekdays) : wakeMedian(recent);
  const weekends = nights.filter((n) => isWeekend(n.localDate) && n.localDate > addDays(today, -WEEKEND_WINDOW_DAYS) && n.localDate <= today);
  const weekend = weekends.length >= MIN_WEEKEND_NIGHTS ? wakeMedian(weekends) : weekday;
  const clock = (m: number) => formatClock(m + 1080);
  return { weekday: clock(weekday), weekend: clock(Math.abs(weekend - weekday) >= WEEKEND_GAP_MIN ? weekend : weekday), nights: recent.length };
}

export const DEFAULT_MORNING_TIME = '07:30';
/** The check-in waits a little after waking: time to land. */
export const AFTER_WAKE_MIN = 15;

export interface MorningTimes {
  /** When the morning check-in is sent, quiet hours already applied. */
  weekday: string;
  weekend: string;
  source: 'manual' | 'wake' | 'default';
}

/** The person's own time first, then their usual wake time + 15 min, else 07:30; never inside quiet hours. */
export function morningTimes(settings: Pick<ProactiveSettings, 'morningTime' | 'quietStart' | 'quietEnd'>, wake: UsualWake | null): MorningTimes {
  const quiet = (time: string) => afterQuietHours(time, settings.quietStart, settings.quietEnd);
  if (settings.morningTime) return { weekday: quiet(settings.morningTime), weekend: quiet(settings.morningTime), source: 'manual' };
  if (!wake) return { weekday: quiet(DEFAULT_MORNING_TIME), weekend: quiet(DEFAULT_MORNING_TIME), source: 'default' };
  const after = (time: string) => quiet(formatClock(round5(clockMinutes(time) + AFTER_WAKE_MIN)));
  return { weekday: after(wake.weekday), weekend: after(wake.weekend), source: 'wake' };
}

// ---------------------------------------------------------------- Craving window

export const CRAVING_WINDOW_DAYS = 28;
/** Days with a logged craving in the same slot before cravings alone set the window. */
export const MIN_CRAVING_DAYS = 3;
/** From this many craving days, the window can be more than a first hint. */
const SURE_CRAVING_DAYS = 5;
/** Logged days needed before sugary snacks alone set it. */
export const MIN_SUGAR_LOGGED_DAYS = 7;
/** Snacks with less added sugar than this don't count as a sugar reflex. */
const SUGARY_SNACK_G = 3;
const WINDOW_MIN = 120;
const WINDOW_STEP = 30;
const FIRST_WINDOW = 6 * 60;
const LAST_WINDOW_END = 23 * 60;
/** The heads-up comes this long before the window opens. */
export const HEADS_UP_MIN = 15;

export type ProactiveConfidence = 'low' | 'medium' | 'high';

export interface CravingWindow {
  /** Usual start and end of the window, "HH:MM" (the middle half of what happens in it). */
  start: string;
  end: string;
  /** When the heads-up is sent: 15 min before the start. */
  notifyAt: string;
  source: 'cravings' | 'sugar';
  confidence: ProactiveConfidence;
  /** Days with something in the window, over the last 28 days. */
  windowDays: number;
  /** Their share of the craving days, or of the sugary-snack grams. */
  share: number;
}

interface TimedEvent {
  day: string;
  minute: number;
  weight: number;
}

/** The two-hour slot (in half-hour steps) touched on the most days, then by weight, earliest first. */
function busiestWindow(events: TimedEvent[]) {
  let best: { inside: TimedEvent[]; days: number; weight: number } | null = null;
  for (let from = FIRST_WINDOW; from + WINDOW_MIN <= LAST_WINDOW_END; from += WINDOW_STEP) {
    const inside = events.filter((e) => e.minute >= from && e.minute < from + WINDOW_MIN);
    const days = new Set(inside.map((e) => e.day)).size;
    const weight = inside.reduce((sum, e) => sum + e.weight, 0);
    if (days && (!best || days > best.days || (days === best.days && weight > best.weight))) best = { inside, days, weight };
  }
  return best;
}

function windowFrom(inside: TimedEvent[]): Pick<CravingWindow, 'start' | 'end' | 'notifyAt'> {
  const minutes = inside.map((e) => e.minute).sort((a, b) => a - b);
  const start = Math.floor(quantile(minutes, 0.25) / 5) * 5;
  const end = Math.max(start + 30, Math.ceil(quantile(minutes, 0.75) / 5) * 5);
  return { start: formatClock(start), end: formatClock(end), notifyAt: formatClock(Math.floor((start - HEADS_UP_MIN) / 5) * 5) };
}

const share = (part: number, total: number) => Math.round((part / total) * 100) / 100;

/**
 * When the sugar reflex usually strikes, from the last 28 days: the two-hour
 * slot that holds the logged cravings on at least 3 days and 40 % of the
 * craving days (a low confidence below 5 craving days), else the slot that
 * holds 40 % of the added sugar from snacks (7 logged days at least, sugary
 * snacks on 4 days of the slot). Null without such a clear pattern: no
 * heads-up on a hunch.
 */
export function cravingWindow(
  input: {
    cravings: { at: string; localDate: string }[];
    /** Snack meals with their added sugar, in grams. */
    snacks: { at: string; localDate: string; addedSugar: number }[];
    /** Days with at least one meal over the same 28 days. */
    loggedDays: number;
  },
  today: string,
): CravingWindow | null {
  const from = addDays(today, -(CRAVING_WINDOW_DAYS - 1));
  const recent = <T extends { localDate: string }>(list: T[]) => list.filter((e) => e.localDate >= from && e.localDate <= today);

  const cravings = recent(input.cravings).map((c) => ({ day: c.localDate, minute: minutesOf(c.at), weight: 1 }));
  const cravingDays = new Set(cravings.map((c) => c.day)).size;
  if (cravingDays >= MIN_CRAVING_DAYS) {
    const best = busiestWindow(cravings);
    const part = best ? share(best.days, cravingDays) : 0;
    if (best && best.days >= MIN_CRAVING_DAYS && part >= 0.4) {
      const confidence: ProactiveConfidence =
        cravingDays < SURE_CRAVING_DAYS ? 'low' : part >= 0.6 && best.days >= 8 ? 'high' : part >= 0.5 && best.days >= 5 ? 'medium' : 'low';
      return { ...windowFrom(best.inside), source: 'cravings', confidence, windowDays: best.days, share: part };
    }
  }

  if (input.loggedDays < MIN_SUGAR_LOGGED_DAYS) return null;
  const snacks = recent(input.snacks)
    .filter((s) => s.addedSugar >= SUGARY_SNACK_G)
    .map((s) => ({ day: s.localDate, minute: minutesOf(s.at), weight: s.addedSugar }));
  const total = snacks.reduce((sum, s) => sum + s.weight, 0);
  const best = busiestWindow(snacks);
  if (!best || best.days < 4) return null;
  const part = share(best.weight, total);
  if (part < 0.4) return null;
  return { ...windowFrom(best.inside), source: 'sugar', confidence: best.days >= 8 && part >= 0.5 ? 'medium' : 'low', windowDays: best.days, share: part };
}

// ---------------------------------------------------------------- Recovery (nightly vitals)

/**
 * Nightly vitals from the watch, one value per day and metric. HRV comes as
 * SDNN from Apple Health and as RMSSD from Health Connect: two different
 * measures, never compared with each other.
 */
export const VitalMetricSchema = z.enum(['hrv_sdnn', 'hrv_rmssd', 'resting_hr']);
export type VitalMetric = z.infer<typeof VitalMetricSchema>;

export const VitalSourceSchema = z.enum(['healthkit', 'health_connect']);
export type VitalSource = z.infer<typeof VitalSourceSchema>;

export const VitalDayInputSchema = z
  .object({
    /** HRV: the night that ended that day; resting heart rate: that day's. */
    localDate: LocalDateSchema,
    metric: VitalMetricSchema,
    /** Milliseconds for HRV, beats per minute for resting heart rate. */
    value: z.number(),
    /** How many samples the value sums up. */
    samples: z.number().int().min(1).max(10_000).default(1),
  })
  .refine((v) => (v.metric === 'resting_hr' ? v.value >= 25 && v.value <= 220 : v.value >= 1 && v.value <= 300), { message: 'Implausible value', path: ['value'] });
export type VitalDayInput = z.input<typeof VitalDayInputSchema>;

export const VitalsInputSchema = z.object({
  days: z.array(VitalDayInputSchema).min(1).max(2000),
  source: VitalSourceSchema,
});
export type VitalsInput = z.input<typeof VitalsInputSchema>;

export interface VitalDay extends z.output<typeof VitalDayInputSchema> {
  source: VitalSource;
  updatedAt: string;
}

export const RECOVERY_BASELINE_DAYS = 30;
/** No reading of recovery before two weeks of data. */
export const MIN_RECOVERY_DAYS = 14;

export type RecoveryStatus = 'usual' | 'lower' | 'low';
export type RecoveryReason = 'hrv_below' | 'rhr_above' | 'short_night' | 'few_days' | 'no_reading';

export interface RecoveryMetric {
  metric: VitalMetric;
  value: number;
  /** Over the 30 days before. */
  median: number;
  mad: number;
  /** In robust standard deviations, positive when worse than usual (HRV lower, resting heart rate higher). */
  deviation: number;
  days: number;
}

export interface RecoverySignal {
  /** Null without two weeks of data or without last night's reading. */
  status: RecoveryStatus | null;
  confidence: ProactiveConfidence | null;
  reasons: RecoveryReason[];
  hrv: RecoveryMetric | null;
  restingHr: RecoveryMetric | null;
}

/** HRV swings a lot from night to night: a deviation is never read below 5 % of the usual value, nor 1 bpm. */
const FLOOR = { hrv: 0.05, restingHrBpm: 1 };

function againstBaseline(points: { localDate: string; metric: VitalMetric; value: number }[], metric: VitalMetric, today: string) {
  const byDay = new Map<string, number>();
  for (const p of points) if (p.metric === metric) byDay.set(p.localDate, p.value);
  const value = byDay.get(today);
  const from = addDays(today, -RECOVERY_BASELINE_DAYS);
  const past = [...byDay.entries()].filter(([day]) => day >= from && day < today).map(([, v]) => v);
  if (past.length < MIN_RECOVERY_DAYS) return { usable: null, reason: 'few_days' as const };
  if (value === undefined) return { usable: null, reason: 'no_reading' as const };
  const med = median(past);
  const mad = median(past.map((v) => Math.abs(v - med)));
  const resting = metric === 'resting_hr';
  const scale = Math.max(1.4826 * mad, resting ? FLOOR.restingHrBpm : med * FLOOR.hrv);
  const deviation = Math.round(((resting ? value - med : med - value) / scale) * 10) / 10;
  const usable: RecoveryMetric = { metric, value, median: Math.round(med * 10) / 10, mad: Math.round(mad * 10) / 10, deviation, days: past.length };
  return { usable, reason: null };
}

const points = (deviation: number) => (deviation >= 2 ? 2 : deviation >= 1 ? 1 : 0);
const LEVELS: ProactiveConfidence[] = ['low', 'medium', 'high'];

/**
 * How last night's vitals compare with the person's own 30-day baseline
 * (median and MAD, per metric): HRV below it and resting heart rate above
 * it each count 1 point past one robust deviation, 2 past two; a short
 * night adds one when something already shows. 0 is usual, 1–2 lower, 3 or
 * more low. Only from 14 days of data: before that, nothing is said.
 */
export function recoverySignal(
  vitals: { localDate: string; metric: VitalMetric; value: number }[],
  today: string,
  night?: { asleepMin: number } | null,
): RecoverySignal {
  const hrvs = (['hrv_sdnn', 'hrv_rmssd'] as const).map((metric) => againstBaseline(vitals, metric, today));
  const hrv = hrvs.flatMap((h) => (h.usable ? [h.usable] : [])).sort((a, b) => b.days - a.days)[0] ?? null;
  const rhr = againstBaseline(vitals, 'resting_hr', today);
  const restingHr = rhr.usable;
  if (!hrv && !restingHr) {
    const missing = [...hrvs, rhr].some((m) => m.reason === 'no_reading');
    return { status: null, confidence: null, reasons: [missing ? 'no_reading' : 'few_days'], hrv: null, restingHr: null };
  }

  const reasons: RecoveryReason[] = [];
  let score = 0;
  if (hrv && hrv.deviation >= 1) reasons.push('hrv_below');
  if (restingHr && restingHr.deviation >= 1) reasons.push('rhr_above');
  score += (hrv ? points(hrv.deviation) : 0) + (restingHr ? points(restingHr.deviation) : 0);
  if (score > 0 && night && night.asleepMin < SHORT_NIGHT_MIN) {
    score += 1;
    reasons.push('short_night');
  }
  const status: RecoveryStatus = score === 0 ? 'usual' : score >= 3 ? 'low' : 'lower';

  // More history, more trust; one metric alone, or two that disagree, less.
  const days = Math.min(...[hrv, restingHr].flatMap((m) => (m ? [m.days] : [])));
  let level = days >= 28 ? 2 : days >= 21 ? 1 : 0;
  if (!hrv || !restingHr) level = Math.min(level, 1);
  else if ((hrv.deviation >= 1 && restingHr.deviation <= -1) || (restingHr.deviation >= 1 && hrv.deviation <= -1)) level = Math.max(0, level - 1);
  return { status, confidence: LEVELS[level]!, reasons, hrv, restingHr };
}

// ---------------------------------------------------------------- API

export interface ProactiveSchedule {
  date: string;
  settings: ResolvedProactive;
  morning: MorningTimes & { usualWake: UsualWake | null };
  /** Nights recorded over the last 14 days, when sleep is tracked (0 otherwise). */
  sleepNights: number;
  /** Null without a clear pattern yet. */
  cravings: CravingWindow | null;
  /** The coming Monday review: the days logged so far in the week it covers. */
  review: { monday: string; loggedDays: number };
  /** Today's morning check-in, once written. */
  today: { messageId: string; content: string } | null;
}

/** A review is worth a notification from 3 logged days. */
export const MIN_REVIEW_DAYS = 3;
/** The morning check-in is offered after 3 nights of sleep data. */
export const MIN_OFFER_NIGHTS = 3;

export type ProactiveOffer = 'morning' | 'cravings';

/**
 * What the coach line may offer, asked once each, only when it would help:
 * the craving heads-up once a craving slot shows (3 cravings in the same
 * band), the morning check-in after 3 nights of sleep data. Never what is
 * already on, never what was answered.
 */
export function proactiveOffer(schedule: Pick<ProactiveSchedule, 'settings' | 'cravings' | 'sleepNights'>): ProactiveOffer | null {
  const { settings } = schedule;
  const offers = settings.offers ?? {};
  if (offers.cravings === undefined && schedule.cravings && !(settings.enabled && settings.cravings)) return 'cravings';
  if (offers.morning === undefined && schedule.sleepNights >= MIN_OFFER_NIGHTS && !(settings.enabled && settings.morning)) return 'morning';
  return null;
}

/**
 * The settings to save when the person answers an offer. « Oui » turns that
 * one feature on, and only that one when the coach was off; « Non » is
 * remembered so it is never asked again.
 */
export function answerOffer(settings: ResolvedProactive, offer: ProactiveOffer, yes: boolean): ProactiveSettingsPatch {
  const offers = { ...settings.offers, [offer]: yes };
  if (!yes) return { offers };
  if (settings.enabled) return { offers, [offer]: true };
  return offer === 'morning' ? { offers, enabled: true, morning: true, weekly: true, cravings: false } : { offers, enabled: true, cravings: true, morning: false, weekly: false };
}

export const ProactiveSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  morning: z.boolean().optional(),
  cravings: z.boolean().optional(),
  weekly: z.boolean().optional(),
  morningTime: ClockTimeSchema.nullable().optional(),
  quietStart: ClockTimeSchema.optional(),
  quietEnd: ClockTimeSchema.optional(),
  maxPerDay: z.number().int().min(1).max(2).optional(),
  /** Merged with the stored answers. */
  offers: z.object({ morning: z.boolean().optional(), cravings: z.boolean().optional() }).optional(),
});
export type ProactiveSettingsPatch = z.input<typeof ProactiveSettingsPatchSchema>;

export const MorningRequestSchema = z.object({
  localDate: LocalDateSchema,
  /** The person hides calories on their phone: the check-in doesn't mention them either. */
  hideCalories: z.boolean().optional(),
});

/** One-line nudges for the craving heads-up, written once a week. */
export interface CravingNudges {
  /** Monday of the week they were written for. */
  week: string;
  lines: string[];
}
