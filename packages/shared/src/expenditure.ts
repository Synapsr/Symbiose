import { addDays, dateRange, daysBetween, startOfWeek } from './dates';
import type { ExpenditureConfidence, ExpenditureEstimate, ExpenditureReason, WeightPoint } from './schemas';

/**
 * Adaptive energy expenditure: what the person really burns, measured from
 * what they log and how their weight trend moves, rather than from a formula.
 *
 *   expenditure ≈ average logged intake − KCAL_PER_KG × trend slope (kg/day)
 *
 * Under-logging is the main failure mode: only complete-looking days count
 * toward the intake, and nothing is estimated until the data is good enough.
 */

/** Energy in a kilogram of body-weight change (the classic 3 500 kcal per pound). */
export const KCAL_PER_KG = 7700;
/** The window looks back this far, ending the day before (that day isn't over)… */
export const EXPENDITURE_WINDOW_DAYS = 28;
/** …and needs at least this much history. */
export const EXPENDITURE_MIN_DAYS = 14;
export const EXPENDITURE_MIN_WEIGH_INS = 6;
/** Share of the window's days that must look completely logged. */
export const EXPENDITURE_MIN_COMPLETE_SHARE = 0.6;
/** The estimate never strays further than this from the formula. */
export const EXPENDITURE_MAX_DEVIATION = 0.25;
/** Physical activity level (expenditure / BMR) range seen in doubly labelled water studies. */
export const PAL_MIN = 1.1;
export const PAL_MAX = 2.5;

/** A day looks completely logged from this share of the formula's maintenance… */
const COMPLETE_SHARE_OF_FORMULA = 0.5;
/** …and of the person's own typical logged day. */
const COMPLETE_SHARE_OF_TYPICAL = 0.6;
/** Scales swing with water, salt and glycogen: never trust a trend tighter than this. */
const MIN_WEIGHT_NOISE_KG = 0.3;
/** Standard error (kcal/day) up to which the estimate is trusted. */
const SE_HIGH = 120;
const SE_MEDIUM = 250;

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const mean = (values: number[]) => sum(values) / values.length;
// `+ 0` turns −0 into 0.
const round1 = (n: number) => Math.round(n * 10) / 10 + 0;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const latest = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface WeightTrendFit {
  /** kg per day. */
  slope: number;
  /** Trend weight at t = 0. */
  intercept: number;
  /** Robust scatter of the readings around the line (kg), never below the scale's daily noise. */
  noiseKg: number;
  /** Standard error of the slope, kg per day. */
  slopeSe: number;
}

/**
 * Theil–Sen line through the weigh-ins (`t` in days): the median of all
 * pairwise slopes, so a 3 kg water spike barely moves it, with no lag.
 */
export function fitWeightTrend(points: { t: number; kg: number }[]): WeightTrendFit | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = points[j]!.t - points[i]!.t;
      if (dt !== 0) slopes.push((points[j]!.kg - points[i]!.kg) / dt);
    }
  }
  if (!slopes.length) return null;
  const slope = median(slopes);
  const intercept = median(points.map((p) => p.kg - slope * p.t));
  const noiseKg = Math.max(1.4826 * median(points.map((p) => Math.abs(p.kg - intercept - slope * p.t))), MIN_WEIGHT_NOISE_KG);
  const meanT = mean(points.map((p) => p.t));
  const sxx = sum(points.map((p) => (p.t - meanT) ** 2));
  return { slope, intercept, noiseKg, slopeSe: noiseKg / Math.sqrt(sxx) };
}

export interface ExpenditureInput {
  /** Last day of the window: the day before the one it's computed for. */
  end: string;
  /** Logged kcal per day; days without any meal are absent. */
  intake: ReadonlyMap<string, number>;
  /** Daily weigh-ins, any range: only the window's count. */
  weights: readonly WeightPoint[];
  /** The formula's maintenance on a given day (activity-adjusted when the plan says so). */
  formulaFor: (date: string) => number;
  bmr: number;
}

/**
 * Measured maintenance over the last 14–28 days, with how much to trust it.
 * Returns no estimate, with the reasons and what's missing, until there are
 * enough complete days and weigh-ins spread over the window.
 */
export function estimateExpenditure({ end, intake, weights, formulaFor, bmr }: ExpenditureInput): ExpenditureEstimate {
  const rangeStart = addDays(end, -(EXPENDITURE_WINDOW_DAYS - 1));
  const inRange = (date: string) => date >= rangeStart && date <= end;
  const loggedDates = [...intake.keys()].filter(inRange).sort();
  const rangeWeights = weights.filter((w) => inRange(w.date)).sort((a, b) => a.date.localeCompare(b.date));

  // Intake and weight change must cover the same days: the window starts once both exist.
  const dataStart = loggedDates[0] && rangeWeights[0] ? latest([loggedDates[0], rangeWeights[0].date]) : null;
  const from = dataStart ? latest([rangeStart, dataStart]) : addDays(end, 1);
  const days = dateRange(from, end);
  const formula = Math.round(days.length ? mean(days.map(formulaFor)) : formulaFor(end));

  const logged = days.flatMap((d) => (intake.has(d) ? [intake.get(d)!] : []));
  // Partial days (only breakfast noted…) would make the intake look smaller than it was.
  const threshold = logged.length ? Math.max(COMPLETE_SHARE_OF_FORMULA * formula, COMPLETE_SHARE_OF_TYPICAL * median(logged)) : 0;
  const complete = logged.filter((kcal) => kcal >= threshold);
  const points = rangeWeights.filter((w) => w.date >= from);

  const neededComplete = Math.ceil(EXPENDITURE_MIN_COMPLETE_SHARE * Math.max(days.length, EXPENDITURE_MIN_DAYS));
  const mid = addDays(from, Math.floor(days.length / 2));
  const firstHalf = points.filter((p) => p.date < mid).length;
  const secondHalf = points.length - firstHalf;

  const reasons: ExpenditureReason[] = [];
  if (days.length < EXPENDITURE_MIN_DAYS) reasons.push('few_days');
  if (complete.length < neededComplete) reasons.push('few_complete_days');
  if (points.length < EXPENDITURE_MIN_WEIGH_INS) reasons.push('few_weigh_ins');
  else if (firstHalf < 2 || secondHalf < 2) reasons.push('weigh_ins_bunched');

  const missing = {
    days: Math.max(0, EXPENDITURE_MIN_DAYS - days.length),
    completeDays: Math.max(0, neededComplete - complete.length),
    weighIns: Math.max(0, EXPENDITURE_MIN_WEIGH_INS - points.length, 2 - secondHalf),
  };
  if (reasons.includes('weigh_ins_bunched') && firstHalf < 2 && dataStart) {
    missing.days = Math.max(missing.days, daysUntilSpread(points.map((p) => p.date), dataStart, end));
  }

  const fit = points.length >= 2 ? fitWeightTrend(points.map((p) => ({ t: daysBetween(from, p.date), kg: p.kg }))) : null;
  const avgIntake = complete.length ? Math.round(mean(complete)) : null;
  const data = {
    loggedDays: logged.length,
    completeDays: complete.length,
    weighIns: points.length,
    avgIntake,
    trendChangeKg: fit ? round1(fit.slope * (days.length - 1)) : null,
    trendKgPerWeek: fit ? round1(fit.slope * 7) : null,
  };
  const window = { from, to: end, days: days.length };

  if (reasons.length || !fit || avgIntake === null) {
    return { estimate: null, formula, difference: null, confidence: null, clamped: false, window, data, reasons, missing };
  }

  const intakeMean = mean(complete);
  const raw = intakeMean - KCAL_PER_KG * fit.slope;
  const high = Math.min(PAL_MAX * bmr, (1 + EXPENDITURE_MAX_DEVIATION) * formula);
  const low = Math.min(Math.max(PAL_MIN * bmr, (1 - EXPENDITURE_MAX_DEVIATION) * formula), high);
  const bounded = clamp(raw, low, high);
  const clamped = Math.abs(bounded - raw) >= 1;
  const estimate = Math.round(bounded / 10) * 10;

  // Both the scale's noise and the day-to-day spread of meals blur the measure.
  const intakeSd = complete.length > 1 ? Math.sqrt(sum(complete.map((k) => (k - intakeMean) ** 2)) / (complete.length - 1)) : 0;
  const se = Math.hypot(KCAL_PER_KG * fit.slopeSe, intakeSd / Math.sqrt(complete.length));
  let confidence: ExpenditureConfidence = se <= SE_HIGH && complete.length >= 0.8 * days.length && days.length >= 21 ? 'high' : se <= SE_MEDIUM ? 'medium' : 'low';
  // Pulled back from an unlikely value: the data probably misses something.
  if (clamped && confidence === 'high') confidence = 'medium';

  return { estimate, formula, difference: estimate - formula, confidence, clamped, window, data, reasons, missing };
}

/** Days until the window's first half holds 2 weigh-ins, if the person weighs in daily from tomorrow. */
function daysUntilSpread(dates: string[], dataStart: string, end: string): number {
  for (let k = 1; k <= EXPENDITURE_WINDOW_DAYS; k++) {
    const newEnd = addDays(end, k);
    const from = latest([dataStart, addDays(newEnd, -(EXPENDITURE_WINDOW_DAYS - 1))]);
    const mid = addDays(from, Math.floor((daysBetween(from, newEnd) + 1) / 2));
    const all = [...dates, ...dateRange(addDays(end, 1), newEnd)];
    if (all.filter((d) => d >= from && d < mid).length >= 2) return k;
  }
  return EXPENDITURE_WINDOW_DAYS;
}

/** Only these are good enough to move the budget. */
export function isTrusted(estimate: Pick<ExpenditureEstimate, 'estimate' | 'confidence'>): boolean {
  return estimate.estimate !== null && (estimate.confidence === 'medium' || estimate.confidence === 'high');
}

/** The applied shift moves by at most this much a week. */
export const ADAPTIVE_STEP_KCAL = 100;
/** Weeks of history replayed to find the current shift. */
export const ADAPTIVE_LOOKBACK_WEEKS = 8;

/**
 * The weekly check-ins that decide the shift on `date`: Mondays from the
 * opt-in week (or the lookback) to `date`'s week. The budget stays steady
 * within a week, and logging today never moves today's budget.
 */
export function adaptiveCheckpoints(date: string, since: string): string[] {
  if (date < since) return [];
  const last = startOfWeek(date);
  const lookback = addDays(last, -7 * ADAPTIVE_LOOKBACK_WEEKS);
  const first = latest([startOfWeek(since), lookback]);
  const out: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 7)) out.push(day);
  return out;
}

/**
 * The shift added to the formula's maintenance. Each week it walks toward
 * that week's target (trusted measure − formula) by at most `step`, and back
 * toward the formula when a week has no trusted measure.
 */
export function adaptiveShift(weeklyTargets: (number | null)[], step = ADAPTIVE_STEP_KCAL): number {
  let shift = 0;
  for (const target of weeklyTargets) shift += clamp((target ?? 0) - shift, -step, step);
  return Math.round(shift);
}
