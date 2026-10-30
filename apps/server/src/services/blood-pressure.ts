import { randomUUID } from 'node:crypto';

import {
  addDays,
  classifyBloodPressure,
  type BloodPressureReading,
  type BloodPressureSource,
  type BloodPressureTrend,
  type Profile,
} from '@symbiose/shared';
import { and, eq, gte, lte } from 'drizzle-orm';

import type { BloodPressureBrief } from '../ai/types';
import type { Db } from '../db';
import { bloodPressure, type BloodPressureRow } from '../db/schema';

export type ReadingFields = Omit<BloodPressureReading, 'id' | 'source' | 'createdAt'>;

/** Window the AI looks at: enough readings to see a level, recent enough to matter. */
const BRIEF_DAYS = 30;

export function toReading(row: BloodPressureRow): BloodPressureReading {
  return {
    id: row.id,
    externalId: row.externalId,
    measuredAt: row.measuredAt,
    localDate: row.localDate,
    systolic: row.systolic,
    diastolic: row.diastolic,
    pulse: row.pulse,
    source: row.source,
    createdAt: row.createdAt,
  };
}

/** Inserts readings; one already imported (same health-store id) is updated instead. */
export function upsertReadings(db: Db, userId: string, readings: ReadingFields[], source: BloodPressureSource): BloodPressureReading[] {
  const createdAt = new Date().toISOString();
  return db.transaction((tx) =>
    readings.map((reading) => {
      const fields = {
        ...reading,
        systolic: Math.round(reading.systolic),
        diastolic: Math.round(reading.diastolic),
        pulse: reading.pulse === null ? null : Math.round(reading.pulse),
        source,
      };
      const values = { id: randomUUID(), userId, ...fields, createdAt };
      const row = fields.externalId
        ? tx.insert(bloodPressure).values(values).onConflictDoUpdate({ target: [bloodPressure.userId, bloodPressure.externalId], set: fields }).returning().get()
        : tx.insert(bloodPressure).values(values).returning().get();
      return toReading(row);
    }),
  );
}

/** Readings between two days, oldest first. */
function readingsBetween(db: Db, userId: string, from: string, to: string): BloodPressureReading[] {
  return db
    .select()
    .from(bloodPressure)
    .where(and(eq(bloodPressure.userId, userId), gte(bloodPressure.localDate, from), lte(bloodPressure.localDate, to)))
    .all()
    .map(toReading)
    // Timestamps may mix offsets: compare instants, not strings.
    .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
}

function average(readings: BloodPressureReading[]): { systolic: number; diastolic: number } {
  const sum = (key: 'systolic' | 'diastolic') => readings.reduce((total, r) => total + r[key], 0);
  return { systolic: Math.round(sum('systolic') / readings.length), diastolic: Math.round(sum('diastolic') / readings.length) };
}

function summarize(readings: BloodPressureReading[], to: string, windowDays: number): BloodPressureTrend {
  const byDay = new Map<string, BloodPressureReading[]>();
  for (const r of readings) byDay.set(r.localDate, [...(byDay.get(r.localDate) ?? []), r]);
  const lastWeek = readings.filter((r) => r.localDate >= addDays(to, -6));
  const latest = readings.at(-1) ?? null;
  const average7 = lastWeek.length ? average(lastWeek) : null;
  // A single reading says little: classify the weekly average once there are enough of them.
  const basis = lastWeek.length >= 3 ? average7 : latest;
  return {
    points: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date, ...average(day) })),
    latest,
    average7,
    category: basis ? classifyBloodPressure(basis.systolic, basis.diastolic) : null,
    windowDays,
  };
}

export function bloodPressureTrend(db: Db, userId: string, to: string, windowDays: number): BloodPressureTrend {
  return summarize(readingsBetween(db, userId, addDays(to, -(windowDays - 1)), to), to, windowDays);
}

/** The trend for insights: null unless the person opted in and has readings in the window. */
export function visibleTrend(db: Db, userId: string, profile: Profile | null, to: string, windowDays: number): BloodPressureTrend | null {
  if (!profile?.trackBloodPressure) return null;
  const trend = bloodPressureTrend(db, userId, to, windowDays);
  return trend.latest ? trend : null;
}

/** What the AI is told about blood pressure: null unless the person opted in and has recent readings. */
export function bloodPressureBrief(db: Db, userId: string, profile: Profile | null, to: string): BloodPressureBrief | null {
  if (!profile?.trackBloodPressure) return null;
  const readings = readingsBetween(db, userId, addDays(to, -(BRIEF_DAYS - 1)), to);
  const { latest, average7, category } = summarize(readings, to, BRIEF_DAYS);
  if (!latest) return null;
  return {
    average7,
    category,
    latest: { date: latest.localDate, systolic: latest.systolic, diastolic: latest.diastolic, pulse: latest.pulse },
    readings: readings.length,
    severeLast7Days: readings.filter((r) => r.localDate >= addDays(to, -6) && classifyBloodPressure(r.systolic, r.diastolic) === 'grade3').length,
  };
}
