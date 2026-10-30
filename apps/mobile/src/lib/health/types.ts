import { toLocalDate, toLocalDateTime, type Meal, type Sex, type WorkoutInput, type WorkoutType } from '@symbiose/shared';

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

/** What the health store knows about the person; every field is optional. */
export interface HealthProfile {
  sex?: Sex;
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
}

/**
 * Bump when `connect()` asks for new data types, so people who connected
 * with an older version are asked once for the new ones.
 */
export const HEALTH_SCOPES = 2;

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
  /** Asks for read (activity, workouts, body) and write (nutrition) permissions. */
  connect(): Promise<boolean>;
  readDay(day: Date): Promise<DayHealth>;
  /** Every body-weight reading between two dates (from a connected scale or typed into Health). */
  readWeights(from: Date, to: Date): Promise<WeightReading[]>;
  /** Sex, birth year, height and weight, to pre-fill the profile. Missing values are left out. */
  readProfile(): Promise<HealthProfile>;
  /** Workout sessions that started between two dates, ready for `PUT /api/workouts`. */
  readWorkouts(from: Date, to: Date): Promise<WorkoutInput[]>;
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

/** Keeps only plausible values, in the ranges the server accepts. */
export function cleanProfile(raw: { sex?: Sex; birthDate?: Date; heightCm?: number; weightKg?: number }): HealthProfile {
  const out: HealthProfile = {};
  if (raw.sex) out.sex = raw.sex;
  if (raw.birthDate && !Number.isNaN(raw.birthDate.getTime())) {
    // Noon of that day, so a midnight stored in another time zone can't fall on the previous year.
    const year = new Date(raw.birthDate.getTime() + 12 * 3_600_000).getFullYear();
    if (year > 1900 && year <= new Date().getFullYear() - 12) out.birthYear = year;
  }
  if (raw.heightCm && raw.heightCm >= 80 && raw.heightCm <= 260) out.heightCm = Math.round(raw.heightCm);
  if (raw.weightKg && raw.weightKg >= 25 && raw.weightKg <= 400) out.weightKg = Math.round(raw.weightKg * 10) / 10;
  return out;
}

/** One session from the watch, in our shape. Returns null for sessions shorter than a minute. */
export function toWorkoutInput(session: {
  externalId: string;
  type: WorkoutType;
  start: Date;
  durationSec: number;
  activeKcal: number | null;
  distanceM: number | null;
  source: 'healthkit' | 'health_connect';
}): WorkoutInput | null {
  const durationMin = Math.min(1440, Math.round(session.durationSec / 60));
  if (!(durationMin >= 1)) return null;
  const kcal = session.activeKcal !== null && session.activeKcal > 0 ? Math.min(10_000, Math.round(session.activeKcal)) : null;
  const km = session.distanceM !== null && session.distanceM > 0 ? Math.min(1000, Math.round(session.distanceM / 10) / 100) : null;
  return {
    externalId: session.externalId.slice(0, 120),
    type: session.type,
    startedAt: toLocalDateTime(session.start),
    localDate: toLocalDate(session.start),
    durationMin,
    intensity: null,
    activeKcal: kcal,
    distanceKm: km,
    avgHeartRate: null,
    source: session.source,
  };
}
