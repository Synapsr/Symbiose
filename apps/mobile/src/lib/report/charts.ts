import { addDays, daysBetween, type Locale } from '@symbiose/shared';

import { dotsPath, weightChart as weightGeometry, type WeightView } from '../weight-chart';
import { esc, textWidth } from './layout';

/**
 * The report's charts, as inline SVG: thin marks on recessive hairlines, one
 * hue per series, references drawn as solid lines with their own label, and
 * no value on every point (the tables carry them). Pure strings, so the PDF
 * needs nothing but the HTML.
 */

export const INK = {
  text: '#141414',
  text2: '#55565B',
  muted: '#8A8A8F',
  grid: '#EBE9E3',
  axis: '#C9C7BF',
  surface: '#FFFFFF',
  /** Symbiose's emerald: every single-series chart. */
  accent: '#0F7663',
  accentSoft: '#E3F0EB',
  /** A day without a meal noted. */
  empty: '#D6D4CD',
  /** Raw weigh-ins, under the trend. */
  raw: '#AFADA5',
} as const;

/** Protein, carbs and fat: validated as a set (all pairs, colour-blind safe). */
export const MACRO_COLORS = { protein: '#E55B3C', carbs: '#D4A017', fat: '#2F6FD6' } as const;
/** Carbs ⊃ sugars ⊃ added sugars: one hue, light to dark, nested like the amounts. */
export const SUGAR_RAMP = { carbs: '#D9A93A', sugar: '#A87506', addedSugar: '#5E3E00' } as const;
/** Two series of one chart (systolic, diastolic). */
export const PAIR_COLORS = ['#2F6FD6', '#E55B3C'] as const;

const TICK = 9.5;
const AXIS_FONT = `font-size="${TICK}" fill="${INK.muted}"`;

const round = (n: number) => Math.round(n * 10) / 10;

/** Round, readable gridlines covering [min, max]. */
export function niceScale(min: number, max: number, count = 4, minStep = 0): { min: number; max: number; ticks: number[] } {
  if (!(max > min)) max = min + 1;
  const raw = Math.max((max - min) / count, minStep);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw - 1e-9) ?? 10 * power);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min: lo, max: hi, ticks };
}

const dateOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};
const tag = (locale: Locale) => (locale === 'fr' ? 'fr-FR' : 'en-US');

/** « 3 nov. » / « Nov 3 ». */
export function shortDate(date: string, locale: Locale): string {
  return dateOf(date).toLocaleDateString(tag(locale), { day: 'numeric', month: 'short' });
}

/**
 * Which days of a period get a date under the axis: every day, every other
 * day, the Mondays, every other Monday, or the first of each month, whichever
 * is the densest that still leaves room between labels.
 */
export function dateTicks(dates: readonly string[], plotWidth: number, locale: Locale): { index: number; label: string }[] {
  const n = dates.length;
  if (!n) return [];
  const room = Math.max(1, Math.floor(plotWidth / 62));
  const every = (step: number, offset = 0) => dates.flatMap((date, index) => ((index - offset) % step === 0 && index >= offset ? [{ index, label: shortDate(date, locale) }] : []));
  const mondays = dates.flatMap((date, index) => (dateOf(date).getDay() === 1 ? [index] : []));
  const months = dates.flatMap((date, index) => (date.endsWith('-01') ? [index] : []));
  const candidates = [
    () => every(1),
    () => every(2),
    () => mondays.map((index) => ({ index, label: shortDate(dates[index]!, locale) })),
    () => mondays.filter((_, i) => i % 2 === 0).map((index) => ({ index, label: shortDate(dates[index]!, locale) })),
    () => months.map((index) => ({ index, label: dateOf(dates[index]!).toLocaleDateString(tag(locale), { month: 'short' }) })),
    () => months.filter((_, i) => i % 2 === 0).map((index) => ({ index, label: dateOf(dates[index]!).toLocaleDateString(tag(locale), { month: 'short' }) })),
  ];
  for (const make of candidates) {
    const ticks = make();
    if (ticks.length && ticks.length <= room) return ticks;
  }
  return [{ index: 0, label: shortDate(dates[0]!, locale) }];
}

interface Plot {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const svgOpen = (width: number, height: number) =>
  `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="-apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif">`;

/** Horizontal gridlines with their values on the left. */
function yGrid(plot: Plot, ticks: number[], y: (v: number) => number, label: (v: number) => string): string {
  return ticks
    .map((v, i) => {
      const yy = round(y(v));
      const line = `<line x1="${plot.left}" x2="${plot.right}" y1="${yy}" y2="${yy}" stroke="${i === 0 ? INK.axis : INK.grid}" stroke-width="1"/>`;
      return `${line}<text x="${plot.left - 6}" y="${yy + 3.2}" text-anchor="end" ${AXIS_FONT}>${esc(label(v))}</text>`;
    })
    .join('');
}

function xLabels(plot: Plot, ticks: { x: number; label: string }[], height: number): string {
  return ticks
    .map(({ x, label }, i) => {
      // The first and the last labels stay inside the chart.
      const anchor = i === 0 && x - plot.left < 18 ? 'start' : i === ticks.length - 1 && plot.right - x < 18 ? 'end' : 'middle';
      return `<text x="${round(x)}" y="${height - 3}" text-anchor="${anchor}" ${AXIS_FONT}>${esc(label)}</text>`;
    })
    .join('');
}

/** A reference's label at the right end of its line, on a white chip so it reads over the marks. */
function refLabel(right: number, lineY: number, text: string): string {
  const w = textWidth(text, TICK) + 8;
  const top = lineY - 15;
  return (
    `<rect x="${round(right - w)}" y="${round(top)}" width="${round(w)}" height="13" rx="3" fill="${INK.surface}" fill-opacity="0.92"/>` +
    `<text x="${round(right - 4)}" y="${round(top + 9.8)}" text-anchor="end" font-size="${TICK}" font-weight="600" fill="${INK.text2}">${esc(text)}</text>`
  );
}

/** A bar growing from the baseline: rounded at its data end, square at the baseline. */
function bar(x: number, y: number, w: number, base: number, color: string, opacity = 1): string {
  const h = base - y;
  if (h <= 0.3) return '';
  const r = Math.min(3, w / 2, h);
  const d = `M${round(x)} ${round(base)}V${round(y + r)}Q${round(x)} ${round(y)} ${round(x + r)} ${round(y)}H${round(x + w - r)}Q${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + r)}V${round(base)}Z`;
  return `<path d="${d}" fill="${color}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}/>`;
}

function leftGutter(ticks: number[], label: (v: number) => string): number {
  return Math.ceil(Math.max(...ticks.map((t) => textWidth(label(t), TICK)))) + 8;
}

export interface DaySeries {
  values: readonly (number | null)[];
  color: string;
}

export interface DayBarsOptions {
  width: number;
  height: number;
  dates: readonly string[];
  /** Drawn from the baseline, the first one behind; null: nothing noted that day. */
  series: readonly DaySeries[];
  /** Per day; each drawn as a step line when it changes. */
  references?: readonly { values: readonly (number | null)[]; label: string }[];
  tick: (v: number) => string;
  locale: Locale;
  /** A small grey dot on the baseline for the days without data (meals: « nothing noted », never a zero). */
  emptyDots?: boolean;
}

/** Bars per day; several series overlap from the same baseline (nested amounts: carbs, sugars, added sugars). */
export function dayBars(o: DayBarsOptions): string {
  const n = o.dates.length;
  const references = o.references ?? [];
  const all = [...o.series.flatMap((s) => s.values), ...references.flatMap((r) => r.values)].filter((v): v is number => v !== null);
  const scale = niceScale(0, Math.max(1, ...all) * 1.04, o.height < 130 ? 3 : 4);
  const left = leftGutter(scale.ticks, o.tick);
  const plot: Plot = { left, right: o.width - 2, top: references.length ? 18 : 6, bottom: o.height - 17 };
  const y = (v: number) => plot.bottom - ((v - scale.min) / (scale.max - scale.min)) * (plot.bottom - plot.top);
  const band = (plot.right - plot.left) / n;
  const barWidth = (layer: number) => {
    const full = Math.min(22, Math.max(1, band * (band < 5 ? 0.82 : 0.64)));
    // Nested series: each one a little narrower, so the one behind still shows.
    return o.series.length > 1 ? full * (1 - layer * 0.18) : full;
  };

  let marks = '';
  o.series.forEach((series, layer) => {
    const w = barWidth(layer);
    series.values.forEach((v, i) => {
      if (v === null) return;
      marks += bar(plot.left + i * band + (band - w) / 2, y(v), w, plot.bottom, series.color);
    });
  });
  // Days without data: a small grey dot on the baseline, never a zero bar.
  const empty =
    o.emptyDots === false
      ? ''
      : o.series[0]!.values
          .map((v, i) => (v === null ? `<circle cx="${round(plot.left + (i + 0.5) * band)}" cy="${plot.bottom}" r="${round(Math.min(1.8, band / 3))}" fill="${INK.empty}"/>` : ''))
          .join('');

  const lines = references
    .map((reference) => {
      let d = '';
      let last: number | null = null;
      reference.values.forEach((v, i) => {
        if (v === null) {
          last = null;
          return;
        }
        const yy = round(y(v));
        const x0 = round(plot.left + i * band);
        const x1 = round(plot.left + (i + 1) * band);
        d += last === null ? `M${x0} ${yy}H${x1}` : `V${yy}H${x1}`;
        last = v;
      });
      const end = [...reference.values].reverse().find((v): v is number => v !== null);
      return `<path d="${d}" fill="none" stroke="${INK.text2}" stroke-width="1.25" stroke-linejoin="round"/>${end === undefined ? '' : refLabel(plot.right, y(end), reference.label)}`;
    })
    .join('');

  const ticks = dateTicks(o.dates, plot.right - plot.left, o.locale).map((t) => ({ x: plot.left + (t.index + 0.5) * band, label: t.label }));
  return `${svgOpen(o.width, o.height)}${yGrid(plot, scale.ticks, y, o.tick)}${marks}${empty}${lines}${xLabels(plot, ticks, o.height)}</svg>`;
}

/**
 * The weight chart, drawn from the weight screen's own geometry (`weight-chart.ts`), so the PDF
 * shows the same scale, trend and dates: the smoothed trend as the main line over a faint wash,
 * weigh-ins as faint dots, whole kilos on the right, dates below, at least 2 kg of span, never red.
 */
export function weightSvg(view: WeightView, width: number, height: number, locale: Locale): string {
  const g = weightGeometry(view, { width, height }, locale);
  const grid = g.yTicks
    .map((t) => `<line x1="${g.plot.left}" x2="${g.plot.right}" y1="${round(t.y)}" y2="${round(t.y)}" stroke="${INK.grid}"/><text x="${g.plot.right + 8}" y="${round(t.y + 3.4)}" ${AXIS_FONT}>${esc(t.label)}</text>`)
    .join('');
  const dates = g.xTicks.map((t) => `<text x="${round(t.x)}" y="${height - 6}" text-anchor="${t.anchor}" ${AXIS_FONT}>${esc(t.label)}</text>`).join('');
  const base = `<line x1="${g.plot.left}" x2="${g.plot.right}" y1="${g.plot.bottom}" y2="${g.plot.bottom}" stroke="${INK.axis}"/>`;
  const wash = g.area ? `<path d="${g.area}" fill="${INK.accent}" fill-opacity="0.08"/>` : '';
  const dots = `<path d="${dotsPath(g.readings, 2.6)}" fill="${INK.raw}" fill-opacity="0.75"/>`;
  const line = `<path d="${g.line}" fill="none" stroke="${INK.accent}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const current = view.current ? `<circle cx="${round(g.x(view.current.date))}" cy="${round(g.y(view.current.value))}" r="4" fill="${INK.accent}" stroke="${INK.surface}" stroke-width="2"/>` : '';
  return `${svgOpen(width, height)}${grid}${base}${wash}${dots}${line}${current}${dates}</svg>`;
}

export interface PointSeries {
  points: readonly { date: string; value: number }[];
  color: string;
  /** Joins the points with a line (daily averages). */
  line?: readonly { date: string; value: number }[];
}

export interface DayPointsOptions {
  width: number;
  height: number;
  from: string;
  to: string;
  series: readonly PointSeries[];
  /** Horizontal references, labelled at their right end. */
  references?: readonly { value: number; label: string }[];
  /** A fixed scale (mood: 1 to 5) and its labels. */
  scale?: { min: number; max: number; ticks: number[] };
  tick: (v: number) => string;
  locale: Locale;
  minStep?: number;
}

/** Readings over days: dots, and a thin line through each day's average when asked. */
export function dayPoints(o: DayPointsOptions): string {
  const n = daysBetween(o.from, o.to) + 1;
  const values = [...o.series.flatMap((s) => s.points.map((p) => p.value)), ...(o.references ?? []).map((r) => r.value)];
  const scale = o.scale ?? niceScale(Math.min(...values), Math.max(...values), 4, o.minStep ?? 0);
  const left = leftGutter(scale.ticks, o.tick);
  const plot: Plot = { left, right: o.width - 4, top: o.references?.length ? 16 : 10, bottom: o.height - 17 };
  const x = (date: string) => plot.left + ((daysBetween(o.from, date) + 0.5) / n) * (plot.right - plot.left);
  const y = (v: number) => plot.bottom - ((v - scale.min) / (scale.max - scale.min)) * (plot.bottom - plot.top);

  const refs = (o.references ?? [])
    .map((r) => `<line x1="${plot.left}" x2="${plot.right}" y1="${round(y(r.value))}" y2="${round(y(r.value))}" stroke="${INK.text2}" stroke-width="1.25"/>${refLabel(plot.right, y(r.value), r.label)}`)
    .join('');
  const count = o.series.reduce((sum, s) => sum + s.points.length, 0);
  // Many readings: smaller dots, so the cloud stays readable.
  const r = count > 120 ? 2.3 : 3.2;
  const marks = o.series
    .map((s) => {
      // A line only joins readings a couple of days apart: a gap stays a gap.
      const path = (s.line ?? []).map((p, i, all) => `${i && daysBetween(all[i - 1]!.date, p.date) <= 3 ? 'L' : 'M'}${round(x(p.date))} ${round(y(p.value))}`).join('');
      const line = path ? `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-opacity="0.55" stroke-linejoin="round" stroke-linecap="round"/>` : '';
      const dots = s.points.map((p) => `<circle cx="${round(x(p.date))}" cy="${round(y(p.value))}" r="${r}" fill="${s.color}" stroke="${INK.surface}" stroke-width="${count > 120 ? 0.8 : 1.5}"/>`).join('');
      return line + dots;
    })
    .join('');
  const dates = Array.from({ length: n }, (_, i) => addDays(o.from, i));
  const ticks = dateTicks(dates, plot.right - plot.left, o.locale).map((t) => ({ x: x(dates[t.index]!), label: t.label }));
  return `${svgOpen(o.width, o.height)}${yGrid(plot, scale.ticks, y, o.tick)}${marks}${refs}${xLabels(plot, ticks, o.height)}</svg>`;
}

export interface ColumnsOptions {
  width: number;
  height: number;
  /** One label per column; only some are printed (`labelEvery`). */
  labels: readonly string[];
  /** Overlapping layers, the first behind. */
  series: readonly { values: readonly number[]; color: string }[];
  reference?: { value: number; label: string };
  /** Columns drawn lighter (a week the period only partly covers). */
  faint?: readonly boolean[];
  tick: (v: number) => string;
  labelEvery?: number;
}

/** Columns over categories (hours of the day, weeks), several layers from one baseline. */
export function columns(o: ColumnsOptions): string {
  const n = o.labels.length;
  const all = [...o.series.flatMap((s) => s.values), o.reference?.value ?? 0];
  const scale = niceScale(0, Math.max(1, ...all) * 1.04, o.height < 130 ? 3 : 4);
  const left = leftGutter(scale.ticks, o.tick);
  const plot: Plot = { left, right: o.width - 2, top: o.reference ? 18 : 6, bottom: o.height - 17 };
  const y = (v: number) => plot.bottom - ((v - scale.min) / (scale.max - scale.min)) * (plot.bottom - plot.top);
  const band = (plot.right - plot.left) / n;
  let marks = '';
  o.series.forEach((series, layer) => {
    const w = Math.min(24, band * 0.64) * (o.series.length > 1 ? 1 - layer * 0.18 : 1);
    series.values.forEach((v, i) => {
      marks += bar(plot.left + i * band + (band - w) / 2, y(v), w, plot.bottom, series.color, o.faint?.[i] ? 0.4 : 1);
    });
  });
  const reference = o.reference
    ? `<line x1="${plot.left}" x2="${plot.right}" y1="${round(y(o.reference.value))}" y2="${round(y(o.reference.value))}" stroke="${INK.text2}" stroke-width="1.25"/>${refLabel(plot.right, y(o.reference.value), o.reference.label)}`
    : '';
  const every = o.labelEvery ?? 1;
  const ticks = o.labels.flatMap((label, i) => (i % every === 0 ? [{ x: plot.left + (i + 0.5) * band, label }] : []));
  return `${svgOpen(o.width, o.height)}${yGrid(plot, scale.ticks, y, o.tick)}${marks}${reference}${xLabels(plot, ticks, o.height)}</svg>`;
}

export interface StripOptions {
  width: number;
  /** One row per category, top to bottom. */
  rows: readonly { label: string; values: readonly number[]; marker?: number | null; note?: string }[];
  /** The axis: its range and the ticks printed under it. */
  min: number;
  max: number;
  ticks: readonly { value: number; label: string }[];
  color: string;
  rowHeight?: number;
}

/** Every value as a translucent dot on its row, the median as a short dark tick: where things cluster, and how much they spread. */
export function strip(o: StripOptions): string {
  const rowHeight = o.rowHeight ?? 24;
  const labelWidth = Math.ceil(Math.max(...o.rows.map((r) => textWidth(r.label, 10.5)))) + 12;
  const noteWidth = Math.ceil(Math.max(0, ...o.rows.map((r) => textWidth(r.note ?? '', 9.5)))) + 10;
  const plot: Plot = { left: labelWidth, right: o.width - noteWidth, top: 4, bottom: 4 + o.rows.length * rowHeight };
  const height = plot.bottom + 17;
  const x = (v: number) => plot.left + ((v - o.min) / (o.max - o.min)) * (plot.right - plot.left);
  const grid = o.ticks
    .map((t) => `<line x1="${round(x(t.value))}" x2="${round(x(t.value))}" y1="${plot.top}" y2="${plot.bottom}" stroke="${INK.grid}"/><text x="${round(x(t.value))}" y="${height - 3}" text-anchor="middle" ${AXIS_FONT}>${esc(t.label)}</text>`)
    .join('');
  const rows = o.rows
    .map((row, i) => {
      const cy = plot.top + (i + 0.5) * rowHeight;
      const label = `<text x="0" y="${round(cy + 3.6)}" font-size="10.5" fill="${INK.text}">${esc(row.label)}</text>`;
      const base = `<line x1="${plot.left}" x2="${plot.right}" y1="${round(cy)}" y2="${round(cy)}" stroke="${INK.grid}"/>`;
      const dots = row.values.map((v) => `<circle cx="${round(x(v))}" cy="${round(cy)}" r="3.4" fill="${o.color}" fill-opacity="0.3"/>`).join('');
      const marker = row.marker != null ? `<line x1="${round(x(row.marker))}" x2="${round(x(row.marker))}" y1="${round(cy - 7)}" y2="${round(cy + 7)}" stroke="${INK.text}" stroke-width="2" stroke-linecap="round"/>` : '';
      const note = row.note ? `<text x="${o.width}" y="${round(cy + 3.4)}" text-anchor="end" font-size="9.5" fill="${INK.text2}">${esc(row.note)}</text>` : '';
      return label + base + dots + marker + note;
    })
    .join('');
  return `${svgOpen(o.width, height)}${grid}${rows}</svg>`;
}

/** Height of a strip chart with `rows` rows. */
export const stripHeight = (rows: number, rowHeight = 24) => 4 + rows * rowHeight + 17;

export interface RangesOptions {
  width: number;
  height: number;
  from: string;
  to: string;
  /** One range per day, in minutes from the evening before (bedtime → wake time). */
  ranges: readonly { date: string; start: number; end: number }[];
  /** Minutes on the axis; from the evening before, top to bottom. */
  min: number;
  max: number;
  ticks: readonly { value: number; label: string }[];
  color: string;
  locale: Locale;
}

/** Floating bars down a clock (bedtime to wake time, night by night): the schedule's regularity at a glance. */
export function ranges(o: RangesOptions): string {
  const n = daysBetween(o.from, o.to) + 1;
  const left = Math.ceil(Math.max(...o.ticks.map((t) => textWidth(t.label, TICK)))) + 8;
  const plot: Plot = { left, right: o.width - 2, top: 6, bottom: o.height - 17 };
  const band = (plot.right - plot.left) / n;
  const y = (m: number) => plot.top + ((m - o.min) / (o.max - o.min)) * (plot.bottom - plot.top);
  const grid = o.ticks
    .map((t) => `<line x1="${plot.left}" x2="${plot.right}" y1="${round(y(t.value))}" y2="${round(y(t.value))}" stroke="${INK.grid}"/><text x="${plot.left - 6}" y="${round(y(t.value) + 3.2)}" text-anchor="end" ${AXIS_FONT}>${esc(t.label)}</text>`)
    .join('');
  const w = Math.min(14, Math.max(1.5, band * 0.6));
  const marks = o.ranges
    .map((r) => {
      const i = daysBetween(o.from, r.date);
      const x0 = plot.left + i * band + (band - w) / 2;
      const top = y(Math.max(o.min, r.start));
      const bottom = y(Math.min(o.max, r.end));
      return `<rect x="${round(x0)}" y="${round(top)}" width="${round(w)}" height="${round(Math.max(1, bottom - top))}" rx="${round(Math.min(3, w / 2))}" fill="${o.color}"/>`;
    })
    .join('');
  const dates = Array.from({ length: n }, (_, i) => addDays(o.from, i));
  const ticks = dateTicks(dates, plot.right - plot.left, o.locale).map((t) => ({ x: plot.left + (t.index + 0.5) * band, label: t.label }));
  return `${svgOpen(o.width, o.height)}${grid}${marks}${xLabels(plot, ticks, o.height)}</svg>`;
}

/** A small square of colour, before a legend entry. */
export function swatch(color: string, shape: 'square' | 'dot' | 'line' = 'square'): string {
  if (shape === 'line') return `<svg width="14" height="8" viewBox="0 0 14 8"><line x1="1" x2="13" y1="4" y2="4" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`;
  if (shape === 'dot') return `<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="${color}"/></svg>`;
  return `<svg width="9" height="9" viewBox="0 0 9 9"><rect width="9" height="9" rx="2" fill="${color}"/></svg>`;
}
