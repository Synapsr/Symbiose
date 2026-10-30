import type { Meal } from '@symbiose/shared';

export interface DayHealth {
  steps: number | null;
  activeKcal: number | null;
  restingKcal: number | null;
  /** Most recent body weight, if any. */
  weightKg: number | null;
}

export interface WeightReading {
  measuredAt: Date;
  kg: number;
}

/**
 * Bridge to the phone's health store, which aggregates the watch's data:
 * Apple Health on iOS (Apple Watch), Health Connect on Android (Wear OS,
 * Garmin, Fitbit, Samsung…).
 */
export interface HealthBridge {
  source: 'healthkit' | 'health_connect' | null;
  /** Display name of the store. */
  storeName: string;
  isAvailable(): Promise<boolean>;
  /** Asks for read (activity, weight) and write (nutrition) permissions. */
  connect(): Promise<boolean>;
  readDay(day: Date): Promise<DayHealth>;
  /** Every body-weight reading between two dates (from a connected scale or typed into Health). */
  readWeights(from: Date, to: Date): Promise<WeightReading[]>;
  writeMeal(meal: Meal): Promise<void>;
}

export function dayBounds(day: Date): { start: Date; end: Date } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { start, end: end > new Date() ? new Date() : end };
}

/** Meal timestamps carry their offset; Date parses them correctly. */
export function mealWindow(meal: Meal): { start: Date; end: Date } {
  const start = new Date(meal.eatenAt);
  return { start, end: new Date(start.getTime() + 60_000) };
}
