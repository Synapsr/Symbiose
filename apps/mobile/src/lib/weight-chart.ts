import { addDays, smoothWeights, trendOn, weeklyRate, type GoalPlan, type Locale, type SmoothedWeight, type WeightPoint } from '@symbiose/shared';

/**
 * The weight screen's numbers and chart, without React: which readings a
 * range shows, the line (smoothed or not), the change and the pace in plain
 * numbers, then scales, ticks and SVG paths for a given size. Pure, so the
 * same chart can be drawn anywhere SVG is (a PDF report too).
 */

export type WeightRange = '1m' | '3m' | '6m' | '1y' | 'all';
export const WEIGHT_RANGES: readonly WeightRange[] = ['1m', '3m', '6m', '1y', 'all'];
const RANGE_DAYS: Record<Exclude<WeightRange, 'all'>, number> = { '1m': 30, '3m': 91, '6m': 182, '1y': 365 };

/** What the screen asks the server for: everything, up to the two years the API keeps. */
export const WEIGHT_HISTORY_DAYS = 730;

/** Below this, a change reads as « stable »: a scale's own noise. */
export const STABLE_KG = 0.2;

/** At least this span on the axis, so a few hundred grams never look like a cliff. */
const MIN_SPAN_KG = 2;

const DAY_MS = 86_400_000;
const time = (date: string) => Date.parse(date);
const daysBetween = (from: string, to: string) => Math.round((time(to) - time(from)) / DAY_MS);

export interface LinePoint {
  date: string;
  value: number;
}

export interface WeightView {
  from: string;
  to: string;
  smoothed: boolean;
  /** The readings inside the range, oldest first, each with the trend through it. */
  readings: SmoothedWeight[];
  /** The main line: the trend (from the range's first day when there are readings before it), or the readings themselves. */
  line: LinePoint[];
  /** Where the line ends: the trend at the latest reading, or that reading. */
  current: LinePoint | null;
  /** From the line's start to its end, in kg (null with a single day). */
  change: number | null;
  /** The day the change counts from. */
  since: string | null;
  /** The trend's pace over the range, in kg a week: smoothed only, and after a week of readings. */
  perWeek: number | null;
}

/**
 * The first day a range (or a number of days, as Tendances' period) shows: never before the first
 * reading, so a short history fills the chart.
 */
export function rangeStart(range: WeightRange | number, today: string, firstReading: string | null): string {
  const days = typeof range === 'number' ? range : range === 'all' ? null : RANGE_DAYS[range];
  const start = days === null ? (firstReading ?? today) : addDays(today, -(days - 1));
  return firstReading && firstReading > start ? firstReading : start;
}

/** The numbers of a range, smoothed or not, from every reading (the trend warms up on the ones before the range). */
export function weightView(points: readonly WeightPoint[], options: { range: WeightRange | number; today: string; smoothed: boolean }): WeightView {
  const { range, today, smoothed } = options;
  const all = smoothWeights(points.filter((p) => p.date <= today));
  const from = rangeStart(range, today, all[0]?.date ?? null);
  const readings = all.filter((p) => p.date >= from);
  const last = readings.at(-1);
  const empty = { from, to: today, smoothed, readings, line: [], current: null, change: null, since: null, perWeek: null };
  if (!last) return empty;

  if (!smoothed) {
    const line = readings.map((p) => ({ date: p.date, value: p.kg }));
    const first = line[0]!;
    const change = last.date > first.date ? round(last.kg - first.value, 1) : null;
    return { ...empty, line, current: { date: last.date, value: last.kg }, change, since: change === null ? null : first.date };
  }

  // The trend is a line through time: when there are readings before the range, it starts at its first day.
  const before = all.length > readings.length;
  const start = before ? trendOn(all, from) : null;
  const line = [...(start !== null && from < readings[0]!.date ? [{ date: from, value: start }] : []), ...readings.map((p) => ({ date: p.date, value: p.trend }))];
  const first = line[0]!;
  const span = daysBetween(first.date, last.date);
  const change = span > 0 ? round(last.trend - first.value, 1) : null;
  const perWeek = span > 0 ? weeklyRate(all, span) : null;
  return { ...empty, line, current: { date: last.date, value: last.trend }, change, since: change === null ? null : first.date, perWeek: perWeek === null ? null : round(perWeek, 2) };
}

/** A change is worth a colour only when it goes the way the plan wants; anything else stays neutral (never red). */
export function changeTone(change: number | null, calorieMode: GoalPlan['calorieMode'] | null | undefined): 'good' | 'neutral' {
  if (change === null || Math.abs(change) < STABLE_KG) return 'neutral';
  const wanted = calorieMode === 'deficit' ? -1 : calorieMode === 'surplus' ? 1 : 0;
  return wanted !== 0 && Math.sign(change) === wanted ? 'good' : 'neutral';
}

// ---------------------------------------------------------------- Geometry

export interface ChartSize {
  width: number;
  height: number;
}

/** Room around the plot: the kg labels on the right, the dates underneath. */
export const CHART_INSETS = { top: 10, right: 40, bottom: 26, left: 2 } as const;

export interface Tick {
  value: number;
  y: number;
  label: string;
}

export interface DateTick {
  date: string;
  x: number;
  label: string;
  /** Labels at the edges grow inwards, so they never leave the chart. */
  anchor: 'start' | 'middle' | 'end';
}

export interface PlottedReading {
  date: string;
  kg: number;
  trend: number;
  x: number;
  /** Where the reading sits. */
  y: number;
  /** Where the main line passes that day (the trend, or the reading itself). */
  lineY: number;
}

export interface WeightChartGeometry {
  /** The plot's box inside the chart. */
  plot: { left: number; right: number; top: number; bottom: number };
  x: (date: string) => number;
  y: (kg: number) => number;
  /** The main line, a monotone curve (it never invents a dip between two readings). */
  line: string;
  /** The same line closed down to the plot's floor, for a soft wash. */
  area: string;
  readings: PlottedReading[];
  yTicks: Tick[];
  xTicks: DateTick[];
}

/**
 * The kg axis: the readings with a little air, at least a 2 kg span, and gridlines on whole kilos
 * (every 1, 2, 5 or 10 kg), two to five of them inside. The data, not the ticks, sets the edges.
 */
export function kgScale(values: readonly number[]): { low: number; high: number; step: number; ticks: number[] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, MIN_SPAN_KG) * 1.12;
  const mid = (max + min) / 2;
  const low = mid - span / 2;
  const high = mid + span / 2;
  const count = (step: number) => Math.floor(high / step) - Math.ceil(low / step) + 1;
  const step = [1, 2, 5, 10, 20, 50].find((s) => count(s) <= 5) ?? 100;
  const ticks: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) ticks.push(v);
  return { low, high, step, ticks };
}

/** The dates under the chart: days, Mondays, months or seasons, as many as fit without crowding. */
export function dateTicks(from: string, to: string, width: number, locale: Locale): { date: string; label: string }[] {
  const days = daysBetween(from, to);
  const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { ...options, timeZone: 'UTC' });
  const dayLabel = fmt({ day: 'numeric', month: 'short' });
  const monthLabel = fmt({ month: 'short' });
  const out: { date: string; label: string }[] = [];

  if (days <= 62) {
    // Days, every few: Mondays past two weeks, so the eye finds the weeks.
    const fit = Math.max(2, Math.floor(width / (days <= 14 ? 72 : 56)));
    const every = days <= 14 ? Math.max(1, Math.ceil(days / fit)) : 7 * Math.max(1, Math.ceil(days / 7 / fit));
    let date = days <= 14 ? from : nextMonday(from);
    for (; date <= to; date = addDays(date, every)) out.push({ date, label: dayLabel.format(new Date(time(date))) });
    return out;
  }
  // Months: every one, or every second, third or sixth; January says its year.
  const fit = Math.max(2, Math.floor(width / 44));
  const months = days / 30.4;
  const every = [1, 2, 3, 6, 12].find((n) => months / n <= fit) ?? 12;
  let [y, m] = from.split('-').map(Number) as [number, number];
  if (from.slice(8) !== '01') m += 1;
  for (;;) {
    if (m > 12) {
      y += 1;
      m -= 12;
    }
    const date = `${y}-${String(m).padStart(2, '0')}-01`;
    if (date > to) break;
    if ((m - 1) % every === 0) out.push({ date, label: m === 1 ? String(y) : monthLabel.format(new Date(time(date))) });
    m += 1;
  }
  return out;
}

function nextMonday(date: string): string {
  const weekday = new Date(time(date)).getUTCDay();
  return addDays(date, (8 - weekday) % 7);
}

/** Scales, ticks and paths for a view drawn at `size`. */
export function weightChart(view: WeightView, size: ChartSize, locale: Locale): WeightChartGeometry {
  const plot = { left: CHART_INSETS.left, right: size.width - CHART_INSETS.right, top: CHART_INSETS.top, bottom: size.height - CHART_INSETS.bottom };
  // One day alone sits in the middle; otherwise the range runs edge to edge.
  const start = time(view.from);
  const span = Math.max(DAY_MS, time(view.to) - start);
  const single = view.from === view.to;
  const x = (date: string) => (single ? (plot.left + plot.right) / 2 : plot.left + ((time(date) - start) / span) * (plot.right - plot.left));
  const values = [...view.line.map((p) => p.value), ...view.readings.map((p) => p.kg)];
  const scale = kgScale(values.length ? values : [0]);
  const y = (kg: number) => plot.top + ((scale.high - kg) / (scale.high - scale.low)) * (plot.bottom - plot.top);

  const linePoints = view.line.map((p) => ({ x: x(p.date), y: y(p.value) }));
  // The trend is a curve; the weigh-ins themselves are joined straight, nothing implied between them.
  const line = view.smoothed ? monotonePath(linePoints) : linearPath(linePoints);
  const area = linePoints.length > 1 ? `${line}L${f(linePoints.at(-1)!.x)},${f(plot.bottom)}L${f(linePoints[0]!.x)},${f(plot.bottom)}Z` : '';
  const lineValue = new Map(view.line.map((p) => [p.date, p.value]));
  const readings = view.readings.map((p) => ({ date: p.date, kg: p.kg, trend: p.trend, x: x(p.date), y: y(p.kg), lineY: y(lineValue.get(p.date) ?? p.kg) }));

  const number = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });
  const yTicks = scale.ticks.map((value) => ({ value, y: y(value), label: number.format(value) }));
  const candidates = single ? [{ date: view.from, label: dateTicks(view.from, view.from, size.width, locale)[0]?.label ?? '' }] : dateTicks(view.from, view.to, plot.right - plot.left, locale);
  // Labels at the edges grow inwards; one that would touch the previous one is left out.
  const xTicks: DateTick[] = [];
  let taken = -Infinity;
  for (const tick of candidates) {
    const at = x(tick.date);
    const anchor: DateTick['anchor'] = at - plot.left < 24 ? 'start' : plot.right - at < 24 ? 'end' : 'middle';
    const width = labelWidth(tick.label);
    const left = anchor === 'start' ? at : anchor === 'end' ? at - width : at - width / 2;
    if (left < taken + 10) continue;
    taken = left + width;
    xTicks.push({ ...tick, x: at, anchor });
  }
  return { plot, x, y, line, area, readings, yTicks, xTicks };
}

/** The reading closest to `x` (readings sorted by x): what a finger on the chart points at. */
export function nearestReading(readings: readonly { x: number }[], x: number): number {
  if (!readings.length) return -1;
  let low = 0;
  let high = readings.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (readings[mid]!.x < x) low = mid;
    else high = mid;
  }
  return Math.abs(readings[low]!.x - x) <= Math.abs(readings[high]!.x - x) ? low : high;
}

/** About how wide a date label is at 11 px: enough to keep two apart. */
const labelWidth = (label: string) => label.length * 6.2;

/** Straight segments from point to point. */
export function linearPath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)},${f(p.y)}`).join('');
}

/** Every reading as a small circle, in one path: hundreds of dots stay one shape to draw. */
export function dotsPath(points: readonly { x: number; y: number }[], r: number): string {
  return points.map((p) => `M${f(p.x - r)},${f(p.y)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`).join('');
}

/**
 * A smooth line through the points that never overshoots them (monotone
 * cubic, as d3's curveMonotoneX): between two readings it goes straight from
 * one to the other, without a bump that was never weighed.
 */
export function monotonePath(points: readonly { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${f(points[0]!.x)},${f(points[0]!.y)}`;
  if (n === 2) return `M${f(points[0]!.x)},${f(points[0]!.y)}L${f(points[1]!.x)},${f(points[1]!.y)}`;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1]!.x - points[i]!.x;
    slopes.push(dx === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / dx);
  }
  // Interior tangents bounded by both neighbours' slopes (d3's curveMonotoneX): flat at a turn, never past a reading.
  const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0]!;
    if (i === n - 1) return slopes[n - 2]!;
    const s0 = slopes[i - 1]!;
    const s1 = slopes[i]!;
    const h0 = points[i]!.x - points[i - 1]!.x;
    const h1 = points[i + 1]!.x - points[i]!.x;
    const p = h0 + h1 === 0 ? 0 : (s0 * h1 + s1 * h0) / (h0 + h1);
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
  });
  let d = `M${f(points[0]!.x)},${f(points[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    const third = (q.x - p.x) / 3;
    d += `C${f(p.x + third)},${f(p.y + tangents[i]! * third)},${f(q.x - third)},${f(q.y - tangents[i + 1]! * third)},${f(q.x)},${f(q.y)}`;
  }
  return d;
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const round = (n: number, decimals: number) => {
  const k = 10 ** decimals;
  const r = Math.round(n * k) / k;
  return r === 0 ? 0 : r;
};
