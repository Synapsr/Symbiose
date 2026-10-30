import { describe, expect, it } from 'vitest';

import { addDays, dateRange } from './dates';
import { adaptiveCheckpoints, adaptiveShift, estimateExpenditure, fitWeightTrend, isTrusted, KCAL_PER_KG } from './expenditure';
import type { GoalPlan, Profile, WeightPoint } from './schemas';
import { computeEnergy } from './targets';

// The window ends yesterday: the estimate is computed on 2026-10-30.
const END = '2026-10-29';
const FORMULA = 2400;
const BMR = 1750;

/** Deterministic day-to-day noise (water, salt, portion sizes). */
const wobble = (i: number, amplitude: number) => amplitude * Math.sin(i * 2.3 + 0.7);

interface Scenario {
  days?: number;
  /** Logged kcal on day i (0 = oldest), or null when nothing was logged. */
  intake: (i: number) => number | null;
  /** Weigh-in on day i, or null. */
  weight: (i: number) => number | null;
}

function run({ days = 28, intake, weight }: Scenario) {
  const map = new Map<string, number>();
  const weights: WeightPoint[] = [];
  dateRange(addDays(END, -(days - 1)), END).forEach((date, i) => {
    const kcal = intake(i);
    if (kcal !== null) map.set(date, kcal);
    const kg = weight(i);
    if (kg !== null) weights.push({ date, kg });
  });
  return estimateExpenditure({ end: END, intake: map, weights, formulaFor: () => FORMULA, bmr: BMR });
}

describe('expenditure from the weight trend', () => {
  it('equals the intake when the weight is stable', () => {
    const result = run({ intake: (i) => 2300 + wobble(i, 300), weight: (i) => 80 + wobble(i, 0.3) });
    expect(result.reasons).toEqual([]);
    expect(result.estimate).toBeGreaterThan(2240);
    expect(result.estimate).toBeLessThan(2360);
    expect(result.formula).toBe(FORMULA);
    expect(result.difference).toBe(result.estimate! - FORMULA);
    expect(result.confidence).toBe('high');
    expect(result.window).toEqual({ from: addDays(END, -27), to: END, days: 28 });
    expect(result.data).toMatchObject({ loggedDays: 28, completeDays: 28, weighIns: 28 });
    expect(Math.abs(result.data.trendKgPerWeek!)).toBeLessThanOrEqual(0.1);
  });

  it('adds the energy of the weight lost', () => {
    // −0.5 kg a week ≈ 550 kcal a day on top of what was eaten.
    const result = run({ intake: (i) => 1900 + wobble(i, 250), weight: (i) => 85 - (0.5 / 7) * i + wobble(i, 0.4) });
    expect(result.estimate).toBeGreaterThan(2390);
    expect(result.estimate).toBeLessThan(2510);
    expect(result.data.trendKgPerWeek).toBeCloseTo(-0.5, 1);
    expect(result.data.trendChangeKg).toBeCloseTo(-1.9, 0);
    expect(isTrusted(result)).toBe(true);
  });

  it('subtracts the energy of the weight gained', () => {
    // +0.25 kg a week ≈ 275 kcal a day stored.
    const result = run({ intake: (i) => 2800 + wobble(i, 250), weight: (i) => 70 + (0.25 / 7) * i + wobble(i, 0.3) });
    expect(result.estimate).toBeGreaterThan(2465);
    expect(result.estimate).toBeLessThan(2585);
    expect(result.clamped).toBe(false);
  });

  it('shrugs off a 3 kg water spike', () => {
    const weight = (i: number) => (i === 25 ? 83 : i === 26 ? 81.5 : 80 + wobble(i, 0.2));
    const result = run({ intake: () => 2300, weight });
    expect(Math.abs(result.estimate! - 2300)).toBeLessThanOrEqual(40);

    // A least-squares line would read the spike as ~100+ kcal a day of storage.
    const points = dateRange(addDays(END, -27), END).map((_, t) => ({ t, kg: weight(t) }));
    const meanT = points.reduce((s, p) => s + p.t, 0) / points.length;
    const meanKg = points.reduce((s, p) => s + p.kg, 0) / points.length;
    const ols = points.reduce((s, p) => s + (p.t - meanT) * (p.kg - meanKg), 0) / points.reduce((s, p) => s + (p.t - meanT) ** 2, 0);
    expect(ols * KCAL_PER_KG).toBeGreaterThan(100);
    expect(Math.abs(fitWeightTrend(points)!.slope * KCAL_PER_KG)).toBeLessThan(40);
  });

  it('ignores partly logged days instead of reading them as eating less', () => {
    // Every third day only breakfast was noted; the scale says intake matched expenditure.
    const result = run({ intake: (i) => (i % 3 === 0 ? 450 : 2300), weight: () => 80 });
    expect(result.data.loggedDays).toBe(28);
    expect(result.data.completeDays).toBe(18);
    expect(result.estimate).toBe(2300);
  });

  it('skips unlogged days without counting them as zero', () => {
    const result = run({ intake: (i) => (i % 3 === 1 ? null : 2300), weight: () => 80 });
    expect(result.data.loggedDays).toBe(19);
    expect(result.estimate).toBe(2300);
  });

  it('waits when too many days are only partly logged', () => {
    const result = run({ intake: (i) => (i % 2 ? 600 : 2300), weight: () => 80 });
    expect(result.estimate).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.reasons).toEqual(['few_complete_days']);
    // 60 % of 28 days = 17 complete days; 14 so far.
    expect(result.missing).toEqual({ days: 0, completeDays: 3, weighIns: 0 });
  });

  it('says what is missing for someone who just started', () => {
    const result = run({ days: 5, intake: () => 2200, weight: (i) => (i % 2 ? null : 72) });
    expect(result.estimate).toBeNull();
    expect(result.reasons).toEqual(['few_days', 'few_complete_days', 'few_weigh_ins']);
    expect(result.window.days).toBe(5);
    // 14 days of history, 9 of them complete, and 6 weigh-ins.
    expect(result.missing).toEqual({ days: 9, completeDays: 4, weighIns: 3 });
  });

  it('starts the window when both meals and weigh-ins exist', () => {
    // Weighing for 4 weeks, logging for 16 days only.
    const result = run({ intake: (i) => (i < 12 ? null : 2300), weight: () => 80 });
    expect(result.window).toEqual({ from: addDays(END, -15), to: END, days: 16 });
    expect(result.data.weighIns).toBe(16);
    expect(result.estimate).toBe(2300);
    expect(result.confidence).not.toBe('high');
  });

  it('needs weigh-ins spread over the window', () => {
    const sparse = run({ intake: () => 2300, weight: (i) => (i % 9 === 0 ? 80 : null) });
    expect(sparse.reasons).toEqual(['few_weigh_ins']);
    expect(sparse.missing.weighIns).toBe(2);

    // Stopped weighing two weeks ago: a couple of fresh weigh-ins fix it.
    const stopped = run({ intake: () => 2300, weight: (i) => (i < 14 ? 80 : null) });
    expect(stopped.reasons).toEqual(['weigh_ins_bunched']);
    expect(stopped.missing).toEqual({ days: 0, completeDays: 0, weighIns: 2 });

    // One old weigh-in, then daily ones lately: a few more days of recul.
    const late = run({ intake: () => 2300, weight: (i) => (i === 0 || i >= 16 ? 80 : null) });
    expect(late.reasons).toEqual(['weigh_ins_bunched']);
    expect(late.missing).toEqual({ days: 4, completeDays: 0, weighIns: 0 });
  });

  it('stays humble on two noisy weeks', () => {
    const result = run({ days: 14, intake: (i) => 2300 + wobble(i, 400), weight: (i) => (i % 2 ? null : 80 + wobble(i * 3, 0.9)) });
    expect(result.estimate).not.toBeNull();
    expect(result.confidence).toBe('low');
    expect(isTrusted(result)).toBe(false);
  });

  it('keeps the estimate within physiological bounds and ±25 % of the formula', () => {
    // 1500 kcal logged with a stable weight is below 1.1 × BMR: pulled back, and not fully trusted.
    const low = run({ intake: () => 1500, weight: () => 80 });
    expect(low.estimate).toBe(1930);
    expect(low.clamped).toBe(true);
    expect(low.confidence).toBe('medium');

    const high = run({ intake: () => 3400, weight: () => 80 });
    expect(high.estimate).toBe(3000);
    expect(high.difference).toBe(600);
    expect(high.clamped).toBe(true);
  });
});

describe('adaptive budget', () => {
  it('moves by at most 100 kcal a week, and back toward the formula without a trusted measure', () => {
    expect(adaptiveShift([])).toBe(0);
    expect(adaptiveShift([-300])).toBe(-100);
    expect(adaptiveShift([-300, -300, -300, -300])).toBe(-300);
    expect(adaptiveShift([40])).toBe(40);
    expect(adaptiveShift([250, 250, null])).toBe(100);
    expect(adaptiveShift([250, null, null])).toBe(0);
  });

  it('checks in once a week from the opt-in week, within the lookback', () => {
    // 2026-10-28 is a Wednesday.
    expect(adaptiveCheckpoints('2026-10-27', '2026-10-28')).toEqual([]);
    expect(adaptiveCheckpoints('2026-10-30', '2026-10-28')).toEqual(['2026-10-26']);
    expect(adaptiveCheckpoints('2026-11-09', '2026-10-28')).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    const long = adaptiveCheckpoints('2027-03-03', '2026-01-01');
    expect(long).toHaveLength(9);
    expect(long.at(-1)).toBe('2027-03-01');
  });

  const profile: Profile = { name: '', sex: 'male', birthYear: 1996, heightCm: 180, weightKg: 80, activityLevel: 'sedentary', locale: 'fr', timezone: 'Europe/Paris' };
  const plan: GoalPlan = {
    intentions: '',
    title: '',
    summary: '',
    tags: ['lose_weight'],
    calorieMode: 'maintain',
    caloriePercent: 0,
    proteinPerKg: 1.6,
    fatPercent: 30,
    rules: [],
    focus: ['kcal'],
    habits: [],
    coachTone: 'gentle',
    adjustForActivity: false,
    overrides: {},
    activity: null,
  };
  const now = new Date('2026-10-30T12:00:00Z');

  it('shifts maintenance only for people who opted in', () => {
    // BMR 1780 × 1.2 = 2136.
    expect(computeEnergy(profile, plan, { now, adaptiveKcal: 200 })).toMatchObject({ tdee: 2136, adaptiveKcal: 0 });
    const on = { ...plan, adaptiveEnergy: { since: '2026-10-01' } };
    expect(computeEnergy(profile, on, { now, adaptiveKcal: 200 })).toMatchObject({ tdee: 2336, goalKcal: 2340, adaptiveKcal: 200 });
    expect(computeEnergy(profile, { ...on, calorieMode: 'deficit', caloriePercent: 15 }, { now, adaptiveKcal: 200 }).goalKcal).toBe(1990);
    // Daily activity still moves the recalibrated budget.
    expect(computeEnergy(profile, { ...on, adjustForActivity: true }, { now, activeKcal: 500, adaptiveKcal: -100 }).tdee).toBe(2436);
  });

  it('never goes below the safety floors', () => {
    const on = { ...plan, adaptiveEnergy: { since: '2026-10-01' } };
    const deficit = computeEnergy(profile, { ...on, calorieMode: 'deficit', caloriePercent: 25 }, { now, adaptiveKcal: -400 });
    // Maintenance can't fall under 1.1 × BMR, and the goal keeps the formula's floor (BMR).
    expect(deficit.tdee).toBe(1958);
    expect(deficit.goalKcal).toBe(1780);
    expect(computeEnergy(profile, on, { now, adaptiveKcal: -400 }).goalKcal).toBe(1960);
  });
});
