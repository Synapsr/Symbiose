import { addDays, localTime, SHORT_NIGHT_MIN, type SleepNight, type SleepSource, type SleepTrend } from '@symbiose/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { cravings, sleepNights, type SleepNightRow } from '../db/schema';

export type NightFields = Omit<SleepNight, 'source' | 'updatedAt'>;

export function toNight(row: SleepNightRow): SleepNight {
  return {
    localDate: row.localDate,
    bedtime: row.bedtime,
    wakeTime: row.wakeTime,
    asleepMin: row.asleepMin,
    inBedMin: row.inBedMin,
    source: row.source,
    updatedAt: row.updatedAt,
  };
}

/** One night per wake-up day: importing a night again replaces it (the watch may have synced more since). */
export function upsertNights(db: Db, userId: string, nights: NightFields[], source: SleepSource): number {
  const updatedAt = new Date().toISOString();
  db.transaction((tx) => {
    for (const night of nights) {
      const values = {
        bedtime: night.bedtime,
        wakeTime: night.wakeTime,
        asleepMin: Math.round(night.asleepMin),
        inBedMin: night.inBedMin === null ? null : Math.round(night.inBedMin),
        source,
        updatedAt,
      };
      tx.insert(sleepNights)
        .values({ userId, localDate: night.localDate, ...values })
        .onConflictDoUpdate({ target: [sleepNights.userId, sleepNights.localDate], set: values })
        .run();
    }
  });
  return nights.length;
}

/** Nights whose wake-up day falls between two days, oldest first. */
export function nightsBetween(db: Db, userId: string, from: string, to: string): SleepNight[] {
  return db
    .select()
    .from(sleepNights)
    .where(and(eq(sleepNights.userId, userId), gte(sleepNights.localDate, from), lte(sleepNights.localDate, to)))
    .orderBy(asc(sleepNights.localDate))
    .all()
    .map(toNight);
}

export function nightOf(db: Db, userId: string, date: string): SleepNight | null {
  return nightsBetween(db, userId, date, date)[0] ?? null;
}

const minutesOfDay = (localDateTime: string) => {
  const [h, m] = localTime(localDateTime).split(':').map(Number) as [number, number];
  return h * 60 + m;
};
/** Clock minutes counted from noon, so that bedtimes around midnight don't wrap. */
const fromNoon = (localDateTime: string) => (minutesOfDay(localDateTime) + 720) % 1440;
const clock = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const perDay = (total: number, days: number) => Math.round((total / days) * 10) / 10;

/** Standard deviation of the middle of the night: a simple, readable measure of how regular the schedule is. */
function regularity(nights: SleepNight[]): number | null {
  if (nights.length < 3) return null;
  const mids = nights.map((n) => fromNoon(n.bedtime) + (Date.parse(n.wakeTime) - Date.parse(n.bedtime)) / 120_000);
  const avg = mean(mids);
  return Math.round(Math.sqrt(mean(mids.map((m) => (m - avg) ** 2))));
}

/** Cravings logged on the day after a short night vs after the other nights, with at least 3 of each. */
function cravingsAfterShortNights(db: Db, userId: string, nights: SleepNight[]): SleepTrend['cravingsAfterShortNights'] {
  const short = nights.filter((n) => n.asleepMin < SHORT_NIGHT_MIN);
  const normal = nights.filter((n) => n.asleepMin >= SHORT_NIGHT_MIN);
  if (short.length < 3 || normal.length < 3) return null;
  const rows = db
    .select({ localDate: cravings.localDate })
    .from(cravings)
    .where(and(eq(cravings.userId, userId), gte(cravings.localDate, nights[0]!.localDate), lte(cravings.localDate, nights.at(-1)!.localDate)))
    .all();
  if (rows.length < 2) return null;
  const count = (list: SleepNight[]) => {
    const days = new Set(list.map((n) => n.localDate));
    return rows.filter((r) => days.has(r.localDate)).length;
  };
  return { short: perDay(count(short), short.length), normal: perDay(count(normal), normal.length) };
}

/**
 * Nights of a window with their average, typical schedule and regularity.
 * Cravings after short nights are compared over 30 days at least: a week
 * rarely has enough nights of each kind.
 */
export function sleepTrend(db: Db, userId: string, from: string, to: string): SleepTrend {
  const windowDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const nights = nightsBetween(db, userId, from, to);
  const linkFrom = addDays(to, -(Math.max(windowDays, 30) - 1));
  return {
    nights,
    averageMin: nights.length ? Math.round(mean(nights.map((n) => n.asleepMin))) : null,
    bedtime: nights.length ? clock(mean(nights.map((n) => fromNoon(n.bedtime))) - 720) : null,
    wakeTime: nights.length ? clock(mean(nights.map((n) => minutesOfDay(n.wakeTime)))) : null,
    regularityMin: regularity(nights),
    cravingsAfterShortNights: cravingsAfterShortNights(db, userId, linkFrom < from ? nightsBetween(db, userId, linkFrom, to) : nights),
    windowDays,
  };
}
