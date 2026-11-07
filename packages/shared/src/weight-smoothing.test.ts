import { describe, expect, it } from 'vitest';

import { smoothWeights, trendOn, weeklyRate } from './weight-smoothing';

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

describe('smoothWeights', () => {
  it('starts on the first reading and keeps the order of the days', () => {
    const smoothed = smoothWeights([
      { date: day(2), kg: 80 },
      { date: day(0), kg: 81 },
    ]);
    expect(smoothed.map((p) => p.date)).toEqual([day(0), day(2)]);
    expect(smoothed[0]!.trend).toBe(81);
  });

  it('barely follows a one-day spike', () => {
    const smoothed = smoothWeights([80, 80, 80, 82, 80, 80].map((kg, i) => ({ date: day(i), kg })));
    expect(Math.max(...smoothed.map((p) => p.trend))).toBeLessThan(80.25);
  });

  it('closes half the gap after a week, and almost all of it after a long pause', () => {
    const week = smoothWeights([
      { date: day(0), kg: 80 },
      { date: day(7), kg: 78 },
    ]);
    expect(week[1]!.trend).toBeCloseTo(79, 5);
    const pause = smoothWeights([
      { date: day(0), kg: 80 },
      { date: day(70), kg: 74 },
    ]);
    expect(pause[1]!.trend).toBeCloseTo(74, 1);
  });
});

describe('weeklyRate', () => {
  it('reads a steady loss of half a kilo a week once the trend has caught up', () => {
    const points = Array.from({ length: 120 }, (_, i) => ({ date: day(i), kg: 90 - (0.5 / 7) * i }));
    expect(weeklyRate(smoothWeights(points))).toBeCloseTo(-0.5, 2);
  });

  it('waits for a week of readings', () => {
    expect(weeklyRate(smoothWeights([{ date: day(0), kg: 80 }, { date: day(3), kg: 79 }]))).toBeNull();
  });
});

describe('trendOn', () => {
  it('reads between readings and nothing outside them', () => {
    const smoothed = smoothWeights([
      { date: day(0), kg: 80 },
      { date: day(10), kg: 80 },
    ]);
    expect(trendOn(smoothed, day(5))).toBe(80);
    expect(trendOn(smoothed, day(11))).toBeNull();
    expect(trendOn(smoothed, day(-1))).toBeNull();
  });
});
