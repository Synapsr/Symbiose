import type { WeightPoint } from './schemas';

/**
 * The weight under the day-to-day noise: water, salt, a late dinner move the
 * scale by a kilo overnight, the trend barely. An exponential moving average
 * that knows about time: each reading pulls the trend toward it by how long
 * it has been since the previous one, so a fortnight without weighing counts
 * for more than a day, and the line never needs a reading every day. Shared by
 * the weight screen and the PDF report, so both show the same numbers.
 */

/** Days for the trend to close half the gap to a new reading: about a week (close to « The Hacker's Diet » 10 % a day). */
export const WEIGHT_HALF_LIFE_DAYS = 7;

export interface SmoothedWeight extends WeightPoint {
  /** The smoothed weight on that day, in kg (not rounded). */
  trend: number;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;

/** The readings (any order, one per day) with the trend through each one, oldest first. */
export function smoothWeights(points: readonly WeightPoint[], halfLifeDays = WEIGHT_HALF_LIFE_DAYS): SmoothedWeight[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: SmoothedWeight[] = [];
  for (const point of sorted) {
    const previous = out.at(-1);
    if (!previous) {
      out.push({ ...point, trend: point.kg });
      continue;
    }
    const gap = Math.max(0, daysBetween(previous.date, point.date));
    const pull = 1 - Math.pow(0.5, gap / halfLifeDays);
    out.push({ ...point, trend: previous.trend + pull * (point.kg - previous.trend) });
  }
  return out;
}

/**
 * How fast the trend moves, in kg per week, over the last `days` of the
 * readings (the trend at the end against the trend `days` earlier, read off
 * the line between readings). Null with less than a week of readings.
 */
export function weeklyRate(smoothed: readonly SmoothedWeight[], days = 28): number | null {
  const last = smoothed.at(-1);
  const first = smoothed[0];
  if (!last || !first) return null;
  const span = Math.min(days, daysBetween(first.date, last.date));
  if (span < 7) return null;
  const start = trendOn(smoothed, new Date(Date.parse(last.date) - span * DAY_MS).toISOString().slice(0, 10));
  return start === null ? null : ((last.trend - start) / span) * 7;
}

/** The trend on `date`, read off the line between the readings around it; null outside them. */
export function trendOn(smoothed: readonly SmoothedWeight[], date: string): number | null {
  const after = smoothed.findIndex((p) => p.date >= date);
  if (after < 0) return null;
  const next = smoothed[after]!;
  if (next.date === date || after === 0) return next.date === date ? next.trend : null;
  const previous = smoothed[after - 1]!;
  const share = daysBetween(previous.date, date) / Math.max(1, daysBetween(previous.date, next.date));
  return previous.trend + share * (next.trend - previous.trend);
}
