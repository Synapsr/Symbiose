import {
  mergeSleepSegments,
  nightsByWakeDate,
  toLocalDate,
  toLocalDateTime,
  type BloodPressureReadingInput,
  type Locale,
  type Meal,
  type Profile,
  type Sex,
  type SleepNightInput,
  type SleepSegment,
  type WaterInput,
  type WorkoutInput,
  type WorkoutIntensity,
  type WorkoutType,
} from '@symbiose/shared';

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

/** Same idea for the opt-in blood pressure types, asked only to people who track it. */
export const BP_SCOPES = 1;
/** And for the opt-in sleep and water types. */
export const SLEEP_SCOPES = 1;
export const WATER_SCOPES = 1;

/** Marks the readings Symbiose writes to the store, so they're not imported back as duplicates. */
export const OWN_READING_KEY = 'SymbioseReadingId';
export const OWN_RECORD_PREFIX = 'symbiose-bp-';
export const OWN_WATER_PREFIX = 'symbiose-water-';

/** A manual reading saved on the server, to copy into the health store. */
export interface BloodPressureWrite {
  id: string;
  measuredAt: Date;
  systolic: number;
  diastolic: number;
}

/** A glass logged in the app, to copy into the health store. */
export interface WaterWrite {
  id: string;
  at: Date;
  ml: number;
}

/** The opt-in data types to ask the store for, from the profile's switches. */
export interface HealthModules {
  bloodPressure?: boolean;
  sleep?: boolean;
  hydration?: boolean;
}

export function healthModules(profile: Profile | null | undefined): HealthModules {
  return { bloodPressure: profile?.trackBloodPressure === true, sleep: profile?.trackSleep === true, hydration: profile?.trackHydration === true };
}

/** The settings to save once the store was asked for these modules. */
export function grantedScopes(modules: HealthModules): { bpScopes?: number; sleepScopes?: number; waterScopes?: number } {
  return {
    ...(modules.bloodPressure ? { bpScopes: BP_SCOPES } : null),
    ...(modules.sleep ? { sleepScopes: SLEEP_SCOPES } : null),
    ...(modules.hydration ? { waterScopes: WATER_SCOPES } : null),
  };
}

/**
 * Bridge to the phone's health store, which aggregates the watch's data:
 * Apple Health on iOS (Apple Watch), Health Connect on Android (Wear OS,
 * Garmin, Fitbit, Samsung…).
 */
export interface HealthBridge {
  source: 'healthkit' | 'health_connect' | null;
  /** Display name of the store, per app language. */
  storeName: Record<Locale, string>;
  isAvailable(): Promise<boolean>;
  /**
   * Asks for read (activity, workouts, body) and write (nutrition) permissions,
   * plus blood pressure, sleep and water for the modules the person turned on.
   */
  connect(options?: HealthModules): Promise<boolean>;
  readDay(day: Date): Promise<DayHealth>;
  /** Every body-weight reading between two dates (from a connected scale or typed into Health). */
  readWeights(from: Date, to: Date): Promise<WeightReading[]>;
  /** Sex, birth year, height and weight, to pre-fill the profile. Missing values are left out. */
  readProfile(): Promise<HealthProfile>;
  /** Workout sessions that started between two dates, ready for `PUT /api/workouts`. */
  readWorkouts(from: Date, to: Date): Promise<WorkoutInput[]>;
  /** Blood pressure readings between two dates, without the ones Symbiose wrote itself. */
  readBloodPressure(from: Date, to: Date): Promise<BloodPressureReadingInput[]>;
  writeBloodPressure(reading: BloodPressureWrite): Promise<void>;
  writeMeal(meal: Meal): Promise<void>;
  /** Nights that ended between two dates, merged from the stages and keyed by wake-up day. */
  readSleep(from: Date, to: Date): Promise<SleepNightInput[]>;
  /** Drinks between two dates, without the glasses Symbiose wrote itself. */
  readWater(from: Date, to: Date): Promise<WaterInput[]>;
  writeWater(entry: WaterWrite): Promise<void>;
  /** Removes a glass Symbiose wrote (an undo in the app). */
  deleteWater(id: string): Promise<void>;
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

/** One reading from the store, in our shape. Returns null for implausible or swapped values. */
export function toBloodPressureInput(reading: { externalId: string; measuredAt: Date; systolic: number; diastolic: number; pulse: number | null }): BloodPressureReadingInput | null {
  const systolic = Math.round(reading.systolic);
  const diastolic = Math.round(reading.diastolic);
  if (!(systolic >= 60 && systolic <= 260 && diastolic >= 30 && diastolic <= 160 && diastolic < systolic)) return null;
  const pulse = reading.pulse !== null && reading.pulse >= 30 && reading.pulse <= 220 ? Math.round(reading.pulse) : null;
  return {
    externalId: reading.externalId.slice(0, 120),
    measuredAt: toLocalDateTime(reading.measuredAt),
    localDate: toLocalDate(reading.measuredAt),
    systolic,
    diastolic,
    pulse,
  };
}

/** Raw stages from any number of sources → one night per wake-up day, in the server's shape. */
export function toSleepNights(segments: SleepSegment[]): SleepNightInput[] {
  return nightsByWakeDate(mergeSleepSegments(segments), (night) => toLocalDate(night.end)).map((night) => ({
    localDate: toLocalDate(night.end),
    bedtime: toLocalDateTime(night.start),
    wakeTime: toLocalDateTime(night.end),
    asleepMin: Math.min(1440, night.asleepMin),
    inBedMin: night.inBedMin === null ? null : Math.min(1440, night.inBedMin),
  }));
}

/** One drink from the store, in our shape. Returns null for implausible amounts. */
export function toWaterInput(drink: { externalId: string; at: Date; ml: number }): WaterInput | null {
  const ml = Math.round(drink.ml);
  if (!(ml >= 1 && ml <= 3000)) return null;
  return { externalId: drink.externalId.slice(0, 120), at: toLocalDateTime(drink.at), localDate: toLocalDate(drink.at), ml };
}

/**
 * Watches don't say how hard a walk was. Infer it so that an easy stroll
 * doesn't count as active: from the pace when there's a distance, otherwise
 * from the energy per kilo and hour (METs, as in `estimateWorkoutKcal`).
 */
export function inferWalkIntensity(workout: WorkoutInput, weightKg: number | null): WorkoutInput {
  if (workout.type !== 'walking' || workout.intensity) return workout;
  const hours = workout.durationMin / 60;
  let intensity: WorkoutIntensity | null = null;
  if (workout.distanceKm && hours > 0) {
    const kmh = workout.distanceKm / hours;
    intensity = kmh < 4 ? 'light' : kmh >= 6.5 ? 'vigorous' : 'moderate';
  } else if (workout.activeKcal && weightKg && hours > 0) {
    // Walking METs are 2.8 (light), 3.5 (moderate) and 5 (vigorous): split halfway.
    const met = workout.activeKcal / (weightKg * hours) + 1;
    intensity = met < 3.15 ? 'light' : met >= 4.25 ? 'vigorous' : 'moderate';
  }
  return intensity ? { ...workout, intensity } : workout;
}
