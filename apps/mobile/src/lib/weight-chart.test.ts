import { addDays, type WeightPoint } from '@symbiose/shared';
import { describe, expect, it } from 'vitest';

import { changeTone, dateTicks, dotsPath, kgScale, monotonePath, nearestReading, rangeStart, weightChart, weightView } from './weight-chart';

const today = '2026-11-07';
/** A steady half kilo a week down, with a scale that wobbles ±0.6 kg, weighed most mornings. */
const losing: WeightPoint[] = Array.from({ length: 200 }, (_, i) => ({ date: addDays(today, -199 + i), kg: Math.round((84 - (0.5 / 7) * i + 0.6 * Math.sin(i * 2.1)) * 10) / 10 })).filter((_, i) => i % 5 !== 3);

describe('rangeStart', () => {
  it('goes back the range, but never before the first reading', () => {
    expect(rangeStart('1m', today, '2026-01-01')).toBe('2026-10-09');
    expect(rangeStart('1y', today, '2026-09-01')).toBe('2026-09-01');
    expect(rangeStart('all', today, '2025-03-02')).toBe('2025-03-02');
    expect(rangeStart('all', today, null)).toBe(today);
    expect(rangeStart(7, today, '2026-01-01')).toBe('2026-11-01');
  });
});

describe('weightView', () => {
  it('smoothed: the trend starts on the range’s first day, warmed up on the readings before it', () => {
    const view = weightView(losing, { range: '3m', today, smoothed: true });
    expect(view.from).toBe(addDays(today, -90));
    expect(view.line[0]!.date).toBe(view.from);
    expect(view.readings.every((p) => p.date >= view.from)).toBe(true);
    expect(view.since).toBe(view.from);
    // About 13 weeks at half a kilo: the trend says so, the noise doesn't.
    expect(view.change!).toBeGreaterThan(-7.4);
    expect(view.change!).toBeLessThan(-5.6);
    expect(view.perWeek!).toBeCloseTo(-0.5, 1);
    expect(view.current).toEqual({ date: today, value: view.readings.at(-1)!.trend });
  });

  it('raw: the readings themselves, from the first to the last of the range, and no pace', () => {
    const view = weightView(losing, { range: '1m', today, smoothed: false });
    const inRange = losing.filter((p) => p.date >= view.from);
    expect(view.line.map((p) => p.value)).toEqual(inRange.map((p) => p.kg));
    expect(view.change).toBe(Math.round((inRange.at(-1)!.kg - inRange[0]!.kg) * 10) / 10);
    expect(view.since).toBe(inRange[0]!.date);
    expect(view.perWeek).toBeNull();
  });

  it('a short history fills the chart, and one reading has no change', () => {
    const view = weightView([{ date: '2026-11-01', kg: 70 }, { date: '2026-11-05', kg: 69.6 }], { range: '6m', today, smoothed: true });
    expect(view.from).toBe('2026-11-01');
    expect(view.line.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-05']);
    expect(view.change).not.toBeNull();
    // Less than a week of readings: no pace yet.
    expect(view.perWeek).toBeNull();

    const one = weightView([{ date: '2026-11-05', kg: 70 }], { range: '1m', today, smoothed: true });
    expect(one.current).toEqual({ date: '2026-11-05', value: 70 });
    expect(one.change).toBeNull();
    expect(one.since).toBeNull();
  });

  it('nothing to show without readings, and nothing from the future', () => {
    expect(weightView([], { range: '1m', today, smoothed: true })).toMatchObject({ readings: [], line: [], current: null, change: null });
    expect(weightView([{ date: '2026-11-09', kg: 70 }], { range: '1m', today, smoothed: true }).readings).toEqual([]);
  });
});

describe('changeTone', () => {
  it('is good only the way the plan wants, never otherwise', () => {
    expect(changeTone(-1.2, 'deficit')).toBe('good');
    expect(changeTone(1.2, 'deficit')).toBe('neutral');
    expect(changeTone(0.8, 'surplus')).toBe('good');
    expect(changeTone(-1.2, 'maintain')).toBe('neutral');
    expect(changeTone(-0.1, 'deficit')).toBe('neutral');
    expect(changeTone(null, 'deficit')).toBe('neutral');
    expect(changeTone(-2, null)).toBe('neutral');
  });
});

describe('kgScale', () => {
  it('keeps at least 2 kg on the axis, gridlines on whole kilos inside it', () => {
    const flat = kgScale([74.1, 74.3]);
    expect(flat.high - flat.low).toBeGreaterThanOrEqual(2);
    expect(flat.low).toBeLessThan(74.1);
    expect(flat.high).toBeGreaterThan(74.3);
    expect(flat.ticks).toEqual([74, 75]);
  });

  it('steps up with the span: two to five gridlines, the data filling the height', () => {
    for (const values of [[70, 71], [70, 74], [60, 75], [55, 110], [74.7, 83.2]]) {
      const scale = kgScale(values);
      expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
      expect(scale.ticks.length).toBeLessThanOrEqual(5);
      expect(scale.ticks.every((v) => v >= scale.low && v <= scale.high && Number.isInteger(v / scale.step))).toBe(true);
      // Past the 2 kg floor, the readings fill the height but for a little air.
      if (Math.max(...values) - Math.min(...values) > 2) expect((Math.min(...values) - scale.low) / (scale.high - scale.low)).toBeLessThan(0.06);
    }
    expect(kgScale([74.7, 83.2]).ticks).toEqual([76, 78, 80, 82]);
  });
});

describe('dateTicks', () => {
  it('a month: the Mondays, in the person’s language', () => {
    const ticks = dateTicks('2026-10-09', today, 320, 'fr');
    expect(ticks.map((t) => t.date)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
    expect(ticks[0]!.label).toBe('12 oct.');
    expect(dateTicks('2026-10-09', today, 320, 'en')[0]!.label).toBe('Oct 12');
  });

  it('months, fewer when narrow, and January says its year', () => {
    const year = dateTicks('2025-11-08', today, 320, 'fr');
    expect(year.length).toBeLessThanOrEqual(7);
    expect(year.every((t) => t.date.endsWith('-01'))).toBe(true);
    expect(year.find((t) => t.date === '2026-01-01')?.label).toBe('2026');
    expect(dateTicks('2025-11-08', today, 160, 'fr').length).toBeLessThan(year.length);
  });
});

describe('weightChart', () => {
  const size = { width: 340, height: 220 };

  it('places the readings in the plot, latest at the right edge', () => {
    const view = weightView(losing, { range: '3m', today, smoothed: true });
    const chart = weightChart(view, size, 'fr');
    const last = chart.readings.at(-1)!;
    expect(last.x).toBeCloseTo(chart.plot.right, 5);
    for (const p of chart.readings) {
      expect(p.y).toBeGreaterThanOrEqual(chart.plot.top);
      expect(p.y).toBeLessThanOrEqual(chart.plot.bottom);
    }
    // The line passes through the trend; the dots are the scale's readings.
    expect(last.lineY).toBeCloseTo(chart.y(last.trend), 5);
    expect(last.y).toBeCloseTo(chart.y(last.kg), 5);
    expect(chart.line.startsWith(`M${chart.plot.left}`)).toBe(true);
    expect(chart.area.endsWith('Z')).toBe(true);
    expect(chart.yTicks.every((t) => t.y >= chart.plot.top && t.y <= chart.plot.bottom)).toBe(true);
    expect(chart.xTicks.length).toBeGreaterThanOrEqual(2);
  });

  it('labels the kg axis in whole kilos, and keeps date labels apart', () => {
    const wide = weightChart(weightView(losing, { range: 'all', today, smoothed: false }), size, 'en');
    expect(wide.yTicks.map((t) => t.label)).toContain('80');
    const few = weightChart(weightView([{ date: '2026-10-29', kg: 68.4 }, { date: '2026-11-05', kg: 68.1 }], { range: '1m', today, smoothed: true }), size, 'fr');
    const gaps = few.xTicks.slice(1).map((tick, i) => tick.x - few.xTicks[i]!.x);
    expect(Math.min(...gaps)).toBeGreaterThan(40);
  });

  it('joins the weigh-ins straight when not smoothed', () => {
    const raw = weightChart(weightView(losing, { range: '1m', today, smoothed: false }), size, 'fr');
    expect(raw.line).not.toContain('C');
    const smooth = weightChart(weightView(losing, { range: '1m', today, smoothed: true }), size, 'fr');
    expect(smooth.line).toContain('C');
  });

  it('a single reading sits in the middle', () => {
    const chart = weightChart(weightView([{ date: today, kg: 70 }], { range: '1m', today, smoothed: true }), size, 'fr');
    expect(chart.readings[0]!.x).toBeCloseTo((chart.plot.left + chart.plot.right) / 2, 5);
    expect(chart.area).toBe('');
  });
});

describe('nearestReading', () => {
  const readings = [{ x: 0 }, { x: 10 }, { x: 30 }, { x: 31 }];
  it('snaps to the closest reading on either side', () => {
    expect(nearestReading(readings, -5)).toBe(0);
    expect(nearestReading(readings, 4)).toBe(0);
    expect(nearestReading(readings, 6)).toBe(1);
    expect(nearestReading(readings, 25)).toBe(2);
    expect(nearestReading(readings, 99)).toBe(3);
    expect(nearestReading([], 3)).toBe(-1);
  });
});

describe('monotonePath', () => {
  it('never goes past a reading between two of them', () => {
    const points = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 10 }];
    const numbers = monotonePath(points).match(/-?\d+(\.\d+)?/g)!.map(Number);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
    expect(monotonePath([{ x: 1, y: 2 }])).toBe('M1,2');
    expect(monotonePath([])).toBe('');
  });

  it('draws dots as one path', () => {
    expect(dotsPath([{ x: 5, y: 5 }], 2)).toBe('M3,5a2,2 0 1,0 4,0a2,2 0 1,0 -4,0');
  });
});
