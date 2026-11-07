import {
  carbsGuideFor,
  carbsPerMeal,
  consistencyOf,
  focusNutrients,
  foodKey,
  goalNutrient,
  SHORT_NIGHT_MIN,
  startOfWeek,
  type MealType,
  type NutrientKey,
  type ReportData,
  type ReportDay,
  type Target,
} from '@symbiose/shared';

import type { TranslationKey } from '@/i18n';

import { weightView } from '../weight-chart';
import { columns, dayBars, dayPoints, INK, MACRO_COLORS, PAIR_COLORS, ranges, strip, stripHeight, SUGAR_RAMP, swatch, weightSvg } from './charts';
import { columnsTable, CONTENT_WIDTH, lineCount, paragraph, sideBySide, sized, table, type Block, type Column, type Row } from './layout';
import { chartBlock, kpis, legend, sectionHead, subHead, type Copy, type Formatters, type Kpi } from './pieces';
import type { ReportSection } from './sections';

/** What every part reads: the data, the words, and the choices made on the export screen. */
export interface PartContext {
  data: ReportData;
  copy: Copy;
  f: Formatters;
  calories: boolean;
  sections: ReadonlySet<ReportSection>;
  /** Every day of the period. */
  dates: string[];
  /** The days with at least one meal. */
  logged: ReportDay[];
}

const HALF = (CONTENT_WIDTH - 24) / 2;
const THIRD = (CONTENT_WIDTH - 2 * 20) / 3;
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const mean = (values: readonly number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);
export const median = (values: readonly number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** The same rule as Tendances: under a limit, over a minimum, within 10 % of a target. */
export function withinTarget(total: number, target: Target): boolean {
  if (target.kind === 'max') return total <= target.value;
  if (target.kind === 'min') return total >= target.value;
  return Math.abs(total - target.value) <= target.value * 0.1;
}

/** The target over the days it applied to: the same on most days; energy may move with activity. */
export function meanTarget(days: readonly ReportDay[], key: NutrientKey): Target {
  const values = days.map((d) => d.targets[key].value);
  return { kind: days[0]?.targets[key].kind ?? 'target', value: mean(values) ?? 0 };
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** A clock time as hours, where the small hours belong to the evening before (00:30 → 24.5). */
const eveningHours = (time: string) => {
  const m = minutesOf(time);
  return (m < 4 * 60 ? m + 1440 : m) / 60;
};
const clockOf = (hours: number) => {
  const m = Math.round(hours * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- Nutrition

/** « Où vient l'énergie »: protein, carbs and fat as shares of the energy they bring (4, 4 and 9 kcal per g). */
function macroSplit(c: PartContext): Block | null {
  const avg = (key: NutrientKey) => mean(c.logged.map((d) => d.totals[key])) ?? 0;
  const kcal = { protein: avg('protein') * 4, carbs: avg('carbs') * 4, fat: avg('fat') * 9 };
  const total = kcal.protein + kcal.carbs + kcal.fat;
  if (total <= 0) return null;
  const keys = ['protein', 'carbs', 'fat'] as const;
  const shares = keys.map((key) => Math.round((kcal[key] / total) * 100));
  const blocks = keys
    .map((key, i) => `<div style="flex:${Math.max(shares[i]!, 1)};background:${MACRO_COLORS[key]};color:${key === 'carbs' ? INK.text : '#fff'}">${shares[i]}&nbsp;%</div>`)
    .join('');
  const names = legend(keys.map((key) => ({ mark: swatch(MACRO_COLORS[key]), label: c.f.text(c.f.nutrient(key)) })));
  return { height: 14 + 26 + 6 + 8 + 14, html: `<div class="over">${c.f.t('report.pdf.split')}</div><div class="seg">${blocks}</div><div class="legend" style="margin-top:8px">${names}</div>` };
}

function nutrientChart(c: PartContext, key: NutrientKey, width: number, height: number): Block {
  const { f, data } = c;
  const target = meanTarget(c.logged.length ? c.logged : data.days, key);
  const avg = mean(c.logged.map((d) => d.totals[key]));
  const summary = avg === null ? '' : f.t('report.pdf.avgTarget', { avg: f.amount(key, avg), target: f.target(key, target) });
  const svg = dayBars({
    width,
    height,
    dates: c.dates,
    series: [{ values: data.days.map((d) => (d.logged ? d.totals[key] : null)), color: INK.accent }],
    references: [{ values: data.days.map((d) => d.targets[key].value), label: f.target(key, data.days.at(-1)!.targets[key]) }],
    tick: (v) => f.num(v),
    locale: c.copy.locale,
  });
  return chartBlock(f.text(f.nutrient(key)), summary, svg, height, width);
}

export function nutritionPart(c: PartContext): Block[] {
  const { f } = c;
  const blocks: Block[] = [sectionHead('nutrition', f.t('report.section.nutrition'), f.t('report.pdf.nutrition.sub', { days: c.copy.plural('report.pdf.loggedDays', c.logged.length) }))];
  if (c.calories) {
    const split = macroSplit(c);
    if (split) blocks.push(split);
    blocks.push(nutrientChart(c, 'kcal', CONTENT_WIDTH, 150));
  }
  const pairs: [NutrientKey, NutrientKey][] = [
    ['protein', 'carbs'],
    ['fat', 'fiber'],
    ['satFat', 'sodium'],
  ];
  for (const [a, b] of pairs) blocks.push(sideBySide([sized(nutrientChart(c, a, HALF, 118), HALF), sized(nutrientChart(c, b, HALF, 118), HALF)]));
  return blocks;
}

// ---------------------------------------------------------------- Carbs and sugars

interface Source {
  name: string;
  amount: number;
  count: number;
}

/** Which foods bring a nutrient over the period, largest first, with their share of it. */
export function topSources(data: ReportData, key: NutrientKey, limit: number): { sources: Source[]; total: number } {
  const groups = new Map<string, Source>();
  let total = 0;
  for (const meal of data.meals) {
    for (const item of meal.items) {
      const amount = item.nutrients[key];
      total += amount;
      if (amount <= 0) continue;
      const k = foodKey(item.name);
      const entry = groups.get(k) ?? { name: item.name, amount: 0, count: 0 };
      entry.amount += amount;
      entry.count++;
      groups.set(k, entry);
    }
  }
  return { sources: [...groups.values()].sort((a, b) => b.amount - a.amount).slice(0, limit), total };
}

function sourcesTable(c: PartContext, key: NutrientKey, width: number, limit = 6): Block | null {
  const { f } = c;
  const { sources, total } = topSources(c.data, key, limit);
  if (!sources.length || total <= 0) return null;
  // Narrow (three side by side): the share alone.
  const withCount = width > 260;
  const cols: Column[] = [
    { width: width - 50 - (withCount ? 42 : 0), label: f.nutrient(key) },
    ...(withCount ? [{ width: 42, label: c.copy.t('report.pdf.col.times'), align: 'right' as const }] : []),
    { width: 50, label: c.copy.t('report.pdf.col.share'), align: 'right' },
  ];
  const rows: Row[] = sources.map((s) => ({ cells: [f.text(s.name), ...(withCount ? [f.num(s.count)] : []), `${f.num(Math.round((s.amount / total) * 100))}&nbsp;%`] }));
  return sized(table(cols, rows), width);
}

export function carbsPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const plan = data.plan;
  const guide = carbsPerMeal(plan);
  const blocks: Block[] = [sectionHead('carbs', f.t('report.section.carbs'), f.t('report.pdf.carbs.sub'))];

  const refs = [];
  const carbsTarget = data.days.at(-1)!.targets.carbs;
  if (carbsTarget.kind === 'max') refs.push({ values: data.days.map((d) => d.targets.carbs.value), label: `${f.nutrient('carbs')} ${f.target('carbs', carbsTarget)}` });
  refs.push({ values: data.days.map((d) => d.targets.addedSugar.value), label: `${f.nutrient('addedSugar')} ${f.target('addedSugar', data.days.at(-1)!.targets.addedSugar)}` });
  const nested = (['carbs', 'sugar', 'addedSugar'] as const).map((key) => ({ values: data.days.map((d) => (d.logged ? d.totals[key] : null)), color: SUGAR_RAMP[key] }));
  const names = legend([
    { mark: swatch(SUGAR_RAMP.carbs), label: f.text(f.nutrient('carbs')) },
    { mark: swatch(SUGAR_RAMP.sugar), label: f.t('report.pdf.n.sugar') },
    { mark: swatch(SUGAR_RAMP.addedSugar), label: f.t('report.pdf.n.addedSugar') },
  ]);
  const avg = (key: NutrientKey) => f.amount(key, mean(c.logged.map((d) => d.totals[key])) ?? 0);
  blocks.push(
    chartBlock(
      f.t('report.pdf.carbs.daily'),
      f.t('report.pdf.carbs.dailySub', { carbs: avg('carbs'), sugar: avg('sugar'), added: avg('addedSugar') }),
      dayBars({ width: CONTENT_WIDTH, height: 170, dates: c.dates, series: nested, references: refs, tick: (v) => f.num(v), locale: copy.locale }),
      170,
      CONTENT_WIDTH,
      names,
    ),
  );

  // Per meal: every meal a dot, against the carbs-per-meal guide in blood-sugar mode.
  const mains = data.meals.filter((m) => m.mealType !== 'snack');
  const snacks = data.meals.filter((m) => m.mealType === 'snack');
  const within = guide === null ? null : data.meals.filter((m) => m.totals.carbs <= carbsGuideFor(m.mealType, guide) + 5).length;
  const perMeal = dayPoints({
    width: HALF,
    height: 140,
    from: data.from,
    to: data.to,
    series: [
      { points: mains.map((m) => ({ date: m.localDate, value: m.totals.carbs })), color: SUGAR_RAMP.sugar },
      { points: snacks.map((m) => ({ date: m.localDate, value: m.totals.carbs })), color: SUGAR_RAMP.carbs },
    ],
    references: guide === null ? [] : [{ value: guide, label: f.t('report.pdf.carbs.guide', { value: f.amount('carbs', guide) }) }],
    tick: (v) => f.num(v),
    locale: copy.locale,
    minStep: 10,
  });
  const perMealSummary =
    within === null ? f.t('report.pdf.medianValue', { value: f.amount('carbs', median(data.meals.map((m) => m.totals.carbs)) ?? 0) }) : f.t('report.pdf.carbs.within', { count: within, total: data.meals.length });
  const mealLegend = legend([
    { mark: swatch(SUGAR_RAMP.sugar, 'dot'), label: f.t('report.pdf.carbs.meals') },
    { mark: swatch(SUGAR_RAMP.carbs, 'dot'), label: f.t('report.pdf.carbs.snacks') },
  ]);

  // Over the day: the average amount per hour of a day noted.
  const days = Math.max(1, c.logged.length);
  const hourly = (key: NutrientKey) => {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const meal of data.meals) hours[Math.floor(minutesOf(meal.time) / 60)]! += meal.totals[key] / days;
    return hours;
  };
  const byHour = columns({
    width: HALF,
    height: 140,
    labels: Array.from({ length: 24 }, (_, h) => f.clock(`${String(h).padStart(2, '0')}:00`)),
    series: (['carbs', 'sugar', 'addedSugar'] as const).map((key) => ({ values: hourly(key), color: SUGAR_RAMP[key] })),
    tick: (v) => f.num(v),
    labelEvery: 4,
  });
  blocks.push(
    sideBySide([
      sized(chartBlock(f.t('report.pdf.carbs.perMeal'), perMealSummary, perMeal, 140, HALF, mealLegend), HALF),
      sized(chartBlock(f.t('report.pdf.carbs.byHour'), f.t('report.pdf.carbs.byHourSub'), byHour, 140, HALF, names), HALF),
    ]),
  );

  // By kind of meal.
  const typeCols: Column[] = [
    { width: 150, label: copy.t('report.pdf.col.meal') },
    { width: 60, label: copy.t('report.pdf.col.count'), align: 'right' },
    { width: 130, label: f.nutrient('carbs'), align: 'right' },
    { width: 130, label: copy.t('report.pdf.n.sugar'), align: 'right' },
    { width: 130, label: copy.t('report.pdf.n.addedSugar'), align: 'right' },
    { width: CONTENT_WIDTH - 150 - 60 - 390, label: guide === null ? '' : copy.t('report.pdf.col.guide'), align: 'right' },
  ];
  const typeRows: Row[] = MEAL_TYPES.flatMap((type) => {
    const list = data.meals.filter((m) => m.mealType === type);
    if (!list.length) return [];
    const avgOf = (key: NutrientKey) => f.amount(key, mean(list.map((m) => m.totals[key])) ?? 0);
    const ok = guide === null ? '' : `${f.num(list.filter((m) => m.totals.carbs <= carbsGuideFor(type, guide) + 5).length)} / ${f.num(list.length)}`;
    return [{ cells: [f.t(`meal.${type}` as TranslationKey), f.num(list.length), avgOf('carbs'), avgOf('sugar'), avgOf('addedSugar'), ok] }];
  });
  if (typeRows.length) blocks.push(subHead(f.t('report.pdf.carbs.byType')), table(typeCols, typeRows));

  const sources = [sourcesTable(c, 'carbs', HALF), sourcesTable(c, 'addedSugar', HALF)].filter((b): b is Block => b !== null);
  if (sources.length) blocks.push(subHead(f.t('report.pdf.sources')), sideBySide(sources));
  return blocks;
}

// ---------------------------------------------------------------- Meals and foods

export function foodsPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const meals = data.meals;
  const days = Math.max(1, c.logged.length);
  const blocks: Block[] = [sectionHead('foods', f.t('report.section.foods'), f.t('report.pdf.foods.sub', { meals: copy.plural('report.pdf.mealCount', meals.length), days: copy.plural('report.pdf.loggedDays', c.logged.length) }))];

  const breakfastDays = new Set(meals.filter((m) => m.mealType === 'breakfast').map((m) => m.localDate)).size;
  const lastMeals = c.logged.map((d) => Math.max(...meals.filter((m) => m.localDate === d.date).map((m) => eveningHours(m.time))));
  const lastMeal = median(lastMeals);
  blocks.push(
    kpis([
      { label: f.t('report.pdf.kpi.mealsPerDay'), value: f.num(meals.length / days, 1) },
      { label: f.t('report.pdf.kpi.breakfast'), value: `${f.num(breakfastDays)} / ${f.num(c.logged.length)}` },
      { label: f.t('report.pdf.kpi.snacks'), value: f.num(meals.filter((m) => m.mealType === 'snack').length / days, 1) },
      ...(lastMeal === null ? [] : [{ label: f.t('report.pdf.kpi.lastMeal'), value: f.clock(clockOf(lastMeal)) }]),
    ]),
  );

  const rows = MEAL_TYPES.flatMap((type) => {
    const hours = meals.filter((m) => m.mealType === type).map((m) => eveningHours(m.time));
    if (!hours.length) return [];
    const mid = median(hours)!;
    return [{ label: copy.t(`meal.${type}` as TranslationKey), values: hours, marker: mid, note: `${copy.t('report.pdf.medianAt', { time: f.clock(clockOf(mid)) })} · ${copy.plural('report.pdf.mealCount', hours.length)}` }];
  });
  if (rows.length) {
    const all = rows.flatMap((r) => r.values);
    const min = Math.min(6, Math.floor(Math.min(...all)));
    const max = Math.max(23, Math.ceil(Math.max(...all)));
    const ticks = Array.from({ length: Math.floor((max - min) / 3) + 1 }, (_, i) => min + i * 3).map((h) => ({ value: h, label: f.clock(clockOf(h)) }));
    const height = stripHeight(rows.length, 26);
    blocks.push(chartBlock(f.t('report.pdf.foods.times'), f.t('report.pdf.foods.timesSub'), strip({ width: CONTENT_WIDTH, rows, min, max, ticks, color: INK.accent, rowHeight: 26 }), height));
  }

  // The foods that come back most, with their usual portion.
  const groups = new Map<string, { name: string; count: number; grams: number[] }>();
  for (const meal of meals) {
    for (const item of meal.items) {
      const k = foodKey(item.name);
      const entry = groups.get(k) ?? { name: item.name, count: 0, grams: [] };
      entry.count++;
      if (item.grams > 0) entry.grams.push(item.grams);
      groups.set(k, entry);
    }
  }
  const frequent = [...groups.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 20);
  if (frequent.length) {
    const cols: Column[] = [
      { width: HALF - 160, label: copy.t('report.pdf.col.food') },
      { width: 50, label: copy.t('report.pdf.col.times'), align: 'right' },
      { width: 110, label: copy.t('report.pdf.col.portion'), align: 'right' },
    ];
    blocks.push(
      subHead(f.t('report.pdf.foods.frequent')),
      columnsTable(
        cols,
        frequent.map((g) => [f.text(g.name), f.num(g.count), g.grams.length ? `${f.num(median(g.grams)!)}&nbsp;g` : '']),
        2,
        24,
      ),
    );
  }

  // Where the plan's nutrients come from; carbs and sugars have their own part.
  const plan = data.plan;
  const hero = goalNutrient(plan, !c.calories);
  const sugarsElsewhere = c.sections.has('carbs');
  const wanted = [hero, ...focusNutrients(plan), ...(plan?.rules.map((r) => r.nutrient) ?? []), 'protein', 'fiber', 'fat', 'sodium'] as NutrientKey[];
  const keys = [...new Set(wanted)].filter((key) => (key !== 'kcal' || c.calories) && !(sugarsElsewhere && (key === 'carbs' || key === 'sugar' || key === 'addedSugar'))).slice(0, 3);
  const tables = keys.map((key) => sourcesTable(c, key, THIRD, 6)).filter((b): b is Block => b !== null);
  if (tables.length) blocks.push(subHead(f.t('report.pdf.sources')), sideBySide(tables, 20));
  return blocks;
}

// ---------------------------------------------------------------- Weight

export function weightPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  // The weight screen's numbers: the trend warms up on the weigh-ins before the period.
  const view = weightView(data.weights, { range: c.dates.length, today: data.to, smoothed: true });
  if (!view.readings.length || !view.current) return [];
  const readings = view.readings;

  const blocks: Block[] = [sectionHead('weight', f.t('report.section.weight'), f.t('report.pdf.weight.sub'))];
  const tiles: Kpi[] = [{ label: f.t('report.pdf.kpi.trendNow'), value: f.kg(view.current.value), sub: f.t('report.pdf.kpi.on', { date: f.short(view.current.date) }) }];
  if (view.change !== null && view.since) tiles.push({ label: f.t('report.pdf.kpi.trendChange'), value: f.signedKg(view.change), sub: f.t('report.pdf.kpi.since', { date: f.short(view.since) }) });
  if (view.perWeek !== null) tiles.push({ label: f.t('report.pdf.kpi.rate'), value: f.signedKg(view.perWeek), unit: f.t('report.pdf.perWeek'), sub: f.t('report.pdf.kpi.rateSub') });
  tiles.push({ label: f.t('report.pdf.kpi.weighIns'), value: f.num(readings.length), sub: f.t('report.pdf.kpi.range', { min: f.kg(Math.min(...readings.map((p) => p.kg))), max: f.kg(Math.max(...readings.map((p) => p.kg))) }) });
  blocks.push(kpis(tiles));

  const names = legend([
    { mark: swatch(INK.raw, 'dot'), label: f.t('report.pdf.weight.raw') },
    { mark: swatch(INK.accent, 'line'), label: f.t('report.pdf.weight.trend') },
  ]);
  blocks.push(chartBlock(f.t('report.pdf.weight.chart'), '', weightSvg(view, CONTENT_WIDTH, 230, copy.locale), 230, CONTENT_WIDTH, names));

  const third = (CONTENT_WIDTH - 2 * 24) / 3;
  const cols: Column[] = [
    { width: third - 140, label: copy.t('report.pdf.col.date') },
    { width: 70, label: copy.t('report.pdf.col.weighIn'), align: 'right' },
    { width: 70, label: copy.t('report.pdf.col.trend'), align: 'right' },
  ];
  blocks.push(subHead(f.t('report.pdf.readings')), columnsTable(cols, readings.map((p) => [f.short(p.date), f.kg(p.kg), `<span class="soft">${f.kg(p.trend)}</span>`]), 3, 24));
  return blocks;
}

// ---------------------------------------------------------------- Blood pressure

export function bloodPressurePart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const readings = data.bloodPressure ?? [];
  if (!readings.length) return [];
  const sys = readings.map((r) => r.systolic);
  const dia = readings.map((r) => r.diastolic);
  const pulses = readings.flatMap((r) => (r.pulse === null ? [] : [r.pulse]));
  const blocks: Block[] = [sectionHead('bloodPressure', f.t('report.section.bloodPressure'), f.t('report.pdf.bp.sub'))];
  blocks.push(
    kpis([
      { label: f.t('report.pdf.kpi.bpAverage'), value: `${f.num(mean(sys)!)} / ${f.num(mean(dia)!)}`, unit: 'mmHg' },
      { label: f.t('report.pdf.kpi.readings'), value: f.num(readings.length) },
      { label: f.t('report.pdf.kpi.bpRange'), value: `${f.num(Math.min(...sys))} – ${f.num(Math.max(...sys))}`, unit: 'mmHg' },
      ...(pulses.length ? [{ label: f.t('report.pdf.kpi.pulse'), value: f.num(mean(pulses)!), unit: 'bpm' }] : []),
    ]),
  );
  const daily = (key: 'systolic' | 'diastolic') => {
    const byDay = new Map<string, number[]>();
    for (const r of readings) byDay.set(r.localDate, [...(byDay.get(r.localDate) ?? []), r[key]]);
    return [...byDay.entries()].map(([date, values]) => ({ date, value: mean(values)! }));
  };
  const svg = dayPoints({
    width: CONTENT_WIDTH,
    height: 200,
    from: data.from,
    to: data.to,
    series: [
      { points: readings.map((r) => ({ date: r.localDate, value: r.systolic })), color: PAIR_COLORS[0], line: daily('systolic') },
      { points: readings.map((r) => ({ date: r.localDate, value: r.diastolic })), color: PAIR_COLORS[1], line: daily('diastolic') },
    ],
    references: [
      { value: 140, label: '140' },
      { value: 90, label: '90' },
    ],
    tick: (v) => f.num(v),
    locale: copy.locale,
    minStep: 10,
  });
  const names = legend([
    { mark: swatch(PAIR_COLORS[0], 'dot'), label: f.t('bp.systolic') },
    { mark: swatch(PAIR_COLORS[1], 'dot'), label: f.t('bp.diastolic') },
  ]);
  blocks.push(chartBlock(f.t('report.pdf.bp.chart'), 'mmHg', svg, 200, CONTENT_WIDTH, names));
  const cols: Column[] = [
    { width: HALF - 220, label: copy.t('report.pdf.col.date') },
    { width: 60, label: copy.t('report.pdf.col.time'), align: 'right' },
    { width: 90, label: copy.t('report.pdf.col.bp'), align: 'right' },
    { width: 70, label: copy.t('report.pdf.col.pulse'), align: 'right' },
  ];
  const rows = readings.map((r) => [f.short(r.localDate), f.clock(r.measuredAt.slice(11, 16)), `${f.num(r.systolic)} / ${f.num(r.diastolic)}`, r.pulse === null ? '' : f.num(r.pulse)]);
  blocks.push(subHead(f.t('report.pdf.readings')), columnsTable(cols, rows, 2, 24));
  return blocks;
}

// ---------------------------------------------------------------- Activity

export function activityPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const { goals, days } = data.activity;
  const total = days.reduce((sum, d) => sum + d.activeMinutes, 0);
  const withSteps = days.flatMap((d) => (d.steps === null ? [] : [d.steps]));
  const strength = data.workouts.filter((w) => w.type === 'strength').length;
  const weeks = days.length / 7;
  const blocks: Block[] = [sectionHead('activity', f.t('report.section.activity'), f.t('report.pdf.activity.sub'))];
  const tiles: Kpi[] = [
    { label: f.t('report.pdf.kpi.activePerWeek'), value: f.num(total / weeks), unit: 'min', sub: f.t('report.pdf.kpi.goal', { goal: `${f.num(goals.weeklyActiveMinutes)} min` }) },
    { label: f.t('report.pdf.kpi.sessions'), value: f.num(data.workouts.length) },
  ];
  if (withSteps.length) tiles.push({ label: f.t('report.pdf.kpi.steps'), value: f.num(mean(withSteps)!), sub: goals.dailySteps ? f.t('report.pdf.kpi.goal', { goal: f.num(goals.dailySteps) }) : undefined });
  if (strength || goals.weeklyStrengthSessions) tiles.push({ label: f.t('report.pdf.kpi.strength'), value: f.num(strength / weeks, 1), sub: goals.weeklyStrengthSessions ? f.t('report.pdf.kpi.goal', { goal: f.num(goals.weeklyStrengthSessions) }) : undefined });
  blocks.push(kpis(tiles));

  const charts: Block[] = [];
  const width = withSteps.length ? HALF : CONTENT_WIDTH;
  if (days.length <= 14) {
    const svg = dayBars({ width, height: 140, dates: c.dates, series: [{ values: days.map((d) => d.activeMinutes), color: INK.accent }], tick: (v) => f.num(v), locale: copy.locale, emptyDots: false });
    charts.push(sized(chartBlock(f.t('report.pdf.activity.daily'), '', svg, 140, width), width));
  } else {
    // Monday to Sunday; the weeks the period only partly covers are drawn lighter.
    const byWeek = new Map<string, { minutes: number; days: number }>();
    for (const d of days) {
      const week = startOfWeek(d.date);
      const entry = byWeek.get(week) ?? { minutes: 0, days: 0 };
      entry.minutes += d.activeMinutes;
      entry.days++;
      byWeek.set(week, entry);
    }
    const list = [...byWeek.entries()];
    const svg = columns({
      width,
      height: 140,
      labels: list.map(([week]) => f.short(week)),
      series: [{ values: list.map(([, w]) => w.minutes), color: INK.accent }],
      reference: { value: goals.weeklyActiveMinutes, label: `${f.num(goals.weeklyActiveMinutes)} min` },
      faint: list.map(([, w]) => w.days < 7),
      tick: (v) => f.num(v),
      labelEvery: Math.max(1, Math.ceil(list.length / Math.floor(width / 56))),
    });
    charts.push(sized(chartBlock(f.t('report.pdf.activity.weekly'), list.some(([, w]) => w.days < 7) ? f.t('report.pdf.activity.partial') : '', svg, 140, width), width));
  }
  if (withSteps.length) {
    const svg = dayBars({
      width: HALF,
      height: 140,
      dates: c.dates,
      series: [{ values: days.map((d) => d.steps), color: INK.accent }],
      references: goals.dailySteps ? [{ values: days.map(() => goals.dailySteps), label: f.num(goals.dailySteps) }] : [],
      tick: (v) => (v >= 1000 ? `${f.num(v / 1000, 1)}k` : f.num(v)),
      locale: copy.locale,
      emptyDots: false,
    });
    charts.push(sized(chartBlock(f.t('report.pdf.activity.steps'), '', svg, 140, HALF), HALF));
  }
  blocks.push(charts.length > 1 ? sideBySide(charts) : charts[0]!);

  if (data.workouts.length) {
    const energy = c.calories;
    const cols: Column[] = [
      { width: 92, label: copy.t('report.pdf.col.date') },
      { width: CONTENT_WIDTH - 92 - 70 - 90 - 80 - (energy ? 70 : 0) - 70, label: copy.t('report.pdf.col.activity') },
      { width: 70, label: copy.t('report.pdf.col.duration'), align: 'right' },
      { width: 90, label: copy.t('report.pdf.col.intensity'), align: 'right' },
      { width: 80, label: copy.t('report.pdf.col.distance'), align: 'right' },
      ...(energy ? [{ width: 70, label: copy.t('report.pdf.col.energy'), align: 'right' as const }] : []),
      { width: 70, label: copy.t('report.pdf.col.heartRate'), align: 'right' },
    ];
    const rows: Row[] = data.workouts.map((w) => ({
      cells: [
        f.short(w.localDate),
        f.t(`workout.type.${w.type}` as TranslationKey),
        `${f.num(Math.round(w.durationMin))}&nbsp;min`,
        w.intensity ? f.t(`workout.${w.intensity}` as TranslationKey) : '',
        w.distanceKm ? `${f.num(w.distanceKm, 1)}&nbsp;km` : '',
        ...(energy ? [w.activeKcal ? `${f.num(w.activeKcal)}&nbsp;kcal` : ''] : []),
        w.avgHeartRate ? `${f.num(w.avgHeartRate)}&nbsp;bpm` : '',
      ],
    }));
    blocks.push(subHead(f.t('report.pdf.sessions')), table(cols, rows));
  }
  return blocks;
}

// ---------------------------------------------------------------- Sleep, water, mood

export function sleepPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const sleep = data.sleep;
  if (!sleep?.nights.length) return [];
  const nights = sleep.nights;
  const short = nights.filter((n) => n.asleepMin < SHORT_NIGHT_MIN).length;
  const blocks: Block[] = [sectionHead('sleep', f.t('report.section.sleep'), f.t('report.pdf.sleep.sub'))];
  blocks.push(
    kpis([
      { label: f.t('report.pdf.kpi.sleepAverage'), value: f.sleep(sleep.averageMin ?? 0) },
      ...(sleep.bedtime ? [{ label: f.t('report.pdf.kpi.bedtime'), value: f.clock(sleep.bedtime) }] : []),
      ...(sleep.wakeTime ? [{ label: f.t('report.pdf.kpi.wake'), value: f.clock(sleep.wakeTime) }] : []),
      { label: f.t('report.pdf.kpi.shortNights'), value: `${f.num(short)} / ${f.num(nights.length)}` },
    ]),
  );
  const byDate = new Map(nights.map((n) => [n.localDate, n]));
  const hours = c.dates.map((date) => {
    const night = byDate.get(date);
    return night ? night.asleepMin / 60 : null;
  });
  const duration = dayBars({
    width: HALF,
    height: 140,
    dates: c.dates,
    series: [{ values: hours, color: INK.accent }],
    references: [{ values: c.dates.map(() => 7), label: f.sleep(SHORT_NIGHT_MIN) }],
    tick: (v) => `${f.num(v)}${copy.locale === 'fr' ? '\u00A0h' : 'h'}`,
    locale: copy.locale,
    emptyDots: false,
  });
  // The clock from the evening before: 18:00 is 0.
  const offset = (iso: string) => (minutesOf(iso.slice(11, 16)) - 18 * 60 + 1440) % 1440;
  const spans = nights.map((n) => {
    const start = offset(n.bedtime);
    const end = offset(n.wakeTime);
    return { date: n.localDate, start, end: end > start ? end : start + n.asleepMin };
  });
  const lo = Math.floor(Math.min(...spans.map((s) => s.start)) / 120) * 120;
  const hi = Math.ceil(Math.max(...spans.map((s) => s.end)) / 120) * 120;
  const ticks = Array.from({ length: (hi - lo) / 120 + 1 }, (_, i) => lo + i * 120).map((value) => ({ value, label: f.clock(clockOf(((value + 18 * 60) % 1440) / 60)) }));
  const schedule = ranges({ width: HALF, height: 140, from: data.from, to: data.to, ranges: spans, min: lo, max: hi, ticks, color: INK.accent, locale: copy.locale });
  blocks.push(
    sideBySide([
      sized(chartBlock(f.t('report.pdf.sleep.duration'), '', duration, 140, HALF), HALF),
      sized(chartBlock(f.t('report.pdf.sleep.schedule'), sleep.regularityMin === null ? '' : f.t('report.pdf.sleep.regularity', { min: f.num(sleep.regularityMin) }), schedule, 140, HALF), HALF),
    ]),
  );
  return blocks;
}

export function hydrationPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const water = data.hydration;
  if (!water?.daysLogged) return [];
  const liters = (ml: number) => `${f.num(ml / 1000, 1)}\u00A0L`;
  const goal = median(water.days.map((d) => d.goalMl)) ?? 0;
  const blocks: Block[] = [sectionHead('hydration', f.t('report.section.hydration'), f.t('report.pdf.water.sub'))];
  blocks.push(
    kpis([
      { label: f.t('report.pdf.kpi.waterAverage'), value: liters(water.averageMl ?? 0) },
      { label: f.t('report.pdf.kpi.waterGoal'), value: liters(goal) },
      { label: f.t('report.pdf.kpi.waterDays'), value: `${f.num(water.daysReached)} / ${f.num(water.days.length)}` },
    ]),
  );
  const svg = dayBars({
    width: CONTENT_WIDTH,
    height: 130,
    dates: c.dates,
    series: [{ values: water.days.map((d) => (d.ml > 0 ? d.ml / 1000 : null)), color: INK.accent }],
    // The everyday goal, flat: on active days it grows a little (the day's own goal counts in « Jours à l'objectif »).
    references: [{ values: water.days.map(() => goal / 1000), label: liters(goal) }],
    tick: (v) => f.num(v, 1),
    locale: copy.locale,
    emptyDots: false,
  });
  blocks.push(chartBlock(f.t('report.pdf.water.chart'), 'L', svg, 130));
  return blocks;
}

export function moodPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const mood = data.mood;
  if (!mood?.days.length) return [];
  const blocks: Block[] = [sectionHead('mood', f.t('report.section.mood'), f.t('report.pdf.mood.sub'))];
  blocks.push(
    kpis([
      { label: f.t('report.pdf.kpi.moodAverage'), value: f.num(mood.average ?? 0, 1), unit: '/ 5' },
      { label: f.t('report.pdf.kpi.checkIns'), value: f.num(mood.days.length) },
    ]),
  );
  const points = mood.days.map((d) => ({ date: d.date, value: d.mood }));
  const svg = dayPoints({
    width: CONTENT_WIDTH,
    height: 130,
    from: data.from,
    to: data.to,
    series: [{ points, color: INK.accent, line: points }],
    scale: { min: 1, max: 5, ticks: [1, 2, 3, 4, 5] },
    tick: (v) => f.num(v),
    locale: copy.locale,
  });
  blocks.push(chartBlock(f.t('report.pdf.mood.chart'), f.t('report.pdf.mood.scale'), svg, 130));
  if (mood.link) {
    const text = copy.t(`report.pdf.mood.link.${mood.link.factor}` as TranslationKey, { with: f.num(mood.link.withAvg, 1), without: f.num(mood.link.withoutAvg, 1) });
    blocks.push(paragraph(text, { size: 11, html: f.text(text) }));
  }
  return blocks;
}

// ---------------------------------------------------------------- Cravings

export function cravingsPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const list = data.cravings;
  if (!list.length) return [];
  const count = (outcome: string) => list.filter((x) => x.outcome === outcome).length;
  const blocks: Block[] = [sectionHead('cravings', f.t('report.section.cravings'), f.t('report.pdf.cravings.sub'))];
  blocks.push(
    kpis([
      { label: f.t('report.pdf.kpi.cravings'), value: f.num(list.length), sub: f.t('report.pdf.kpi.cravingsPerDay', { value: f.num(list.length / c.dates.length, 1) }) },
      { label: f.t('report.pdf.kpi.resisted'), value: f.num(count('resisted')) },
      { label: f.t('report.pdf.kpi.gaveIn'), value: f.num(count('gave_in')) },
      { label: f.t('report.pdf.kpi.pending'), value: f.num(count('pending')) },
    ]),
  );
  const hours = Array.from({ length: 24 }, () => 0);
  for (const craving of list) hours[Math.floor(minutesOf(craving.time) / 60)]!++;
  const byHour = columns({
    width: HALF,
    height: 130,
    labels: Array.from({ length: 24 }, (_, h) => f.clock(`${String(h).padStart(2, '0')}:00`)),
    series: [{ values: hours, color: INK.accent }],
    tick: (v) => f.num(v),
    labelEvery: 4,
  });
  const what = new Map<string, { label: string; count: number }>();
  for (const craving of list) {
    if (!craving.what) continue;
    const k = foodKey(craving.what);
    const entry = what.get(k) ?? { label: craving.what, count: 0 };
    entry.count++;
    what.set(k, entry);
  }
  const top = [...what.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  const parts: Block[] = [sized(chartBlock(f.t('report.pdf.cravings.hours'), '', byHour, 130, HALF), HALF)];
  if (top.length) {
    const cols: Column[] = [
      { width: HALF - 60, label: copy.t('report.pdf.col.craving') },
      { width: 60, label: copy.t('report.pdf.col.times'), align: 'right' },
    ];
    parts.push(sized(table(cols, top.map((w) => ({ cells: [f.text(w.label), f.num(w.count)] }))), HALF));
  }
  blocks.push(sideBySide(parts));

  const intensity = (n: number | null) => (n === 1 ? f.t('craving.low') : n === 2 ? f.t('craving.mid') : n === 3 ? f.t('craving.high') : '');
  const cols: Column[] = [
    { width: 100, label: copy.t('report.pdf.col.date') },
    { width: 70, label: copy.t('report.pdf.col.time') },
    { width: CONTENT_WIDTH - 100 - 70 - 120 - 120, label: copy.t('report.pdf.col.craving') },
    { width: 120, label: copy.t('report.pdf.col.intensity') },
    { width: 120, label: copy.t('report.pdf.col.outcome'), align: 'right' },
  ];
  const rows: Row[] = list.map((x) => ({
    cells: [f.short(x.localDate), f.clock(x.time), x.what ? f.text(x.what) : `<span class="muted">${f.t('report.pdf.unsaid')}</span>`, intensity(x.intensity), f.t(`report.pdf.outcome.${x.outcome}` as TranslationKey)],
  }));
  blocks.push(subHead(f.t('report.pdf.cravings.list')), table(cols, rows));
  return blocks;
}

// ---------------------------------------------------------------- Notes

export function notesPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  const transit = data.transit;
  const moodWords = (data.mood?.days ?? []).filter((d) => d.note);
  if (!data.journal.length && !moodWords.length) return [];
  const blocks: Block[] = [sectionHead('notes', f.t('report.section.notes'), f.t('report.pdf.notes.sub'))];
  if (transit && transit.total > 0) {
    const consistency = (['hard', 'normal', 'soft', 'liquid'] as const).filter((k) => transit.consistency[k] > 0).map((k) => `${copy.t(`journal.consistency.${k}` as TranslationKey)} ${transit.consistency[k]}`);
    blocks.push(
      kpis([
        { label: f.t('report.pdf.kpi.transitPerDay'), value: f.num(transit.perDay, 1), sub: f.t('report.pdf.kpi.transitTotal', { count: transit.total, days: transit.days }) },
        ...(consistency.length ? [{ label: f.t('report.pdf.kpi.consistency'), value: `<span style="font-size:13px">${f.text(consistency.join(' · '))}</span>` }] : []),
        { label: f.t('report.pdf.kpi.difficult'), value: f.num(transit.difficult) },
      ]),
    );
  }
  const textWidth = CONTENT_WIDTH - 92 - 60 - 110 - 12;
  type Note = { date: string; time: string; kind: string; text: string };
  const notes: Note[] = [
    ...data.journal.filter((entry) => entry.kind !== 'transit' || entry.text.trim()).map((entry) => {
      const details = [
        entry.data.bristol !== undefined ? copy.t('report.pdf.bristol', { consistency: copy.t(`journal.consistency.${consistencyOf(entry.data.bristol)}` as TranslationKey).toLowerCase(), type: entry.data.bristol }) : '',
        entry.data.ease ? copy.t(`journal.ease.${entry.data.ease}` as TranslationKey) : '',
        entry.text,
      ].filter(Boolean);
      const kind = copy.t(entry.kind === 'other' ? 'journal.kind.otherShort' : (`journal.kind.${entry.kind}` as TranslationKey));
      return { date: entry.localDate, time: entry.at.slice(11, 16), kind, text: details.join(' · ') };
    }),
    ...moodWords.map((d) => ({ date: d.date, time: '', kind: `${copy.t('journal.kind.feeling')} ${d.mood}/5`, text: d.note ?? '' })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const cols: Column[] = [
    { width: 92, label: copy.t('report.pdf.col.date') },
    { width: 60, label: copy.t('report.pdf.col.time') },
    { width: 110, label: copy.t('report.pdf.col.kind') },
    { width: CONTENT_WIDTH - 92 - 60 - 110, label: copy.t('report.pdf.col.note') },
  ];
  const rows: Row[] = notes.map((n) => {
    const lines = Math.min(6, lineCount(n.text || '—', textWidth, 11));
    return {
      height: Math.max(20, lines * 15 + 6),
      className: 'meal',
      cells: [f.short(n.date), n.time ? f.clock(n.time) : '', f.text(n.kind), `<div class="wrap" style="-webkit-line-clamp:${lines};max-height:${lines * 15}px">${f.text(n.text || '—')}</div>`],
    };
  });
  if (rows.length) blocks.push(table(cols, rows));
  return blocks;
}

// ---------------------------------------------------------------- Meal journal

export function mealsPart(c: PartContext): Block[] {
  const { f, data, copy } = c;
  if (!data.meals.length) return [];
  const keys: NutrientKey[] = [...(c.calories ? (['kcal'] as const) : []), 'protein', 'carbs', 'sugar', 'fat', 'fiber'];
  const numberWidth = 52;
  const timeWidth = 62;
  const titleWidth = CONTENT_WIDTH - timeWidth - keys.length * numberWidth;
  const cols: Column[] = [
    { width: timeWidth, label: copy.t('report.pdf.col.time') },
    { width: titleWidth, label: copy.t('report.pdf.col.mealFoods') },
    ...keys.map((key) => ({ width: numberWidth, label: key === 'kcal' ? 'kcal' : copy.t(`report.pdf.short.${key}` as TranslationKey), align: 'right' as const })),
  ];
  const value = (key: NutrientKey, n: number) => f.num(n, key === 'kcal' || n >= 10 ? 0 : 1);
  const rows: Row[] = [];
  for (const day of data.days) {
    if (!day.logged) continue;
    const meals = data.meals.filter((m) => m.localDate === day.date);
    rows.push({
      height: 32,
      className: 'day',
      keepWithNext: true,
      span: 2,
      cells: [`${f.text(f.weekday(day.date))} <span class="soft" style="font-weight:500">· ${f.plural('report.pdf.mealCount', meals.length)}</span>`, ...keys.map((key) => value(key, day.totals[key]))],
    });
    for (const meal of meals) {
      const foods = meal.items.map((i) => `${i.name}${i.grams ? ` ${f.num(i.grams)} g` : ''}`).join(' · ');
      const lines = Math.min(3, lineCount(foods, titleWidth - 12, 10));
      rows.push({
        height: 8 + 15 + lines * 13 + 4,
        className: 'meal',
        cells: [
          `<div class="cell2"><div class="a">${f.clock(meal.time)}</div><div class="b2">${f.t(`report.pdf.type.${meal.mealType}` as TranslationKey)}</div></div>`,
          `<div class="cell2"><div class="a">${f.text(meal.title)}</div><div class="b2" style="-webkit-line-clamp:${lines};max-height:${lines * 13}px">${f.text(foods)}</div></div>`,
          ...keys.map((key) => value(key, meal.totals[key])),
        ],
      });
    }
  }
  return [
    {
      ...sectionHead('meals', f.t('report.section.meals'), f.t('report.pdf.meals.sub')),
      pageBreak: true,
    },
    table(cols, rows, { minRows: 3 }),
  ];
}
