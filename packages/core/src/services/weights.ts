import { addDays, type WeightInput, type WeightPoint, type WeightTrend } from '@symbiose/shared';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { users, weightDismissals, weights } from '../db/schema';

const round1 = (n: number) => Math.round(n * 10) / 10;
const average = (points: WeightPoint[]) => points.reduce((sum, p) => sum + p.kg, 0) / points.length;

/** Readings arrive with an offset (typed in the app) or in UTC (the health store): compared as instants. */
const later = (a: string, b: string) => {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isNaN(ta) || Number.isNaN(tb) ? a > b : ta > tb;
};

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The profile weight follows the most recent reading, so targets stay accurate. */
function alignProfileWeight(tx: Tx, userId: string) {
  const latest = tx.select().from(weights).where(eq(weights.userId, userId)).orderBy(desc(weights.localDate)).limit(1).get();
  const user = tx.select({ profile: users.profile }).from(users).where(eq(users.id, userId)).get();
  if (latest && user?.profile && user.profile.weightKg !== latest.kg) {
    tx.update(users)
      .set({ profile: { ...user.profile, weightKg: latest.kg } })
      .where(eq(users.id, userId))
      .run();
  }
}

/**
 * Stores readings, keeping the latest one of each day, then aligns the
 * profile weight on the most recent reading so targets stay accurate. A
 * reading deleted in the app (and anything older that day) stays out.
 */
export function upsertWeights(db: Db, userId: string, input: Pick<WeightInput, 'samples' | 'source'>): number {
  const latestPerDay = new Map<string, WeightInput['samples'][number]>();
  for (const sample of input.samples) {
    const current = latestPerDay.get(sample.localDate);
    if (!current || later(sample.measuredAt, current.measuredAt)) latestPerDay.set(sample.localDate, sample);
  }
  const dates = [...latestPerDay.keys()];
  const existing = new Map(
    db
      .select()
      .from(weights)
      .where(and(eq(weights.userId, userId), inArray(weights.localDate, dates)))
      .all()
      .map((row) => [row.localDate, row]),
  );
  const dismissed = new Map(
    db
      .select()
      .from(weightDismissals)
      .where(and(eq(weightDismissals.userId, userId), inArray(weightDismissals.localDate, dates)))
      .all()
      .map((row) => [row.localDate, row.measuredAt]),
  );

  const now = new Date().toISOString();
  let written = 0;
  db.transaction((tx) => {
    for (const [localDate, sample] of latestPerDay) {
      const row = existing.get(localDate);
      if (row && later(row.measuredAt, sample.measuredAt)) continue;
      const gone = dismissed.get(localDate);
      if (gone && !later(sample.measuredAt, gone)) continue;
      const values = { kg: round1(sample.kg), measuredAt: sample.measuredAt, source: input.source, updatedAt: now };
      tx.insert(weights)
        .values({ userId, localDate, ...values })
        .onConflictDoUpdate({ target: [weights.userId, weights.localDate], set: values })
        .run();
      written++;
    }
    alignProfileWeight(tx, userId);
  });
  return written;
}

/**
 * Takes back the weigh-in of a day (a typo, someone else on the scale). The
 * health store will send that reading again: it is remembered, to stay out.
 * Nothing to delete is fine: it's gone either way.
 */
export function deleteWeight(db: Db, userId: string, localDate: string): void {
  db.transaction((tx) => {
    const row = tx
      .delete(weights)
      .where(and(eq(weights.userId, userId), eq(weights.localDate, localDate)))
      .returning({ measuredAt: weights.measuredAt })
      .get();
    if (!row) return;
    tx.insert(weightDismissals)
      .values({ userId, localDate, measuredAt: row.measuredAt })
      .onConflictDoUpdate({ target: [weightDismissals.userId, weightDismissals.localDate], set: { measuredAt: row.measuredAt } })
      .run();
    alignProfileWeight(tx, userId);
  });
}

/** Weight over a window ending on `to`, with the change between its first and last week. */
export function weightTrend(db: Db, userId: string, to: string, windowDays: number): WeightTrend {
  const from = addDays(to, -(windowDays - 1));
  const points: WeightPoint[] = db
    .select({ date: weights.localDate, kg: weights.kg })
    .from(weights)
    .where(and(eq(weights.userId, userId), gte(weights.localDate, from), lte(weights.localDate, to)))
    .orderBy(asc(weights.localDate))
    .all();
  const latestRow = db
    .select({ date: weights.localDate, kg: weights.kg })
    .from(weights)
    .where(and(eq(weights.userId, userId), lte(weights.localDate, to)))
    .orderBy(desc(weights.localDate))
    .limit(1)
    .get();

  let changeKg: number | null = null;
  const first = points[0];
  const last = points.at(-1);
  if (first && last && last.date > first.date) {
    // Weekly averages smooth out day-to-day water fluctuations.
    const head = points.filter((p) => p.date <= addDays(first.date, 6));
    const tail = points.filter((p) => p.date >= addDays(last.date, -6));
    changeKg = round1(average(tail) - average(head));
  }
  return { points, latest: latestRow ?? null, changeKg, windowDays };
}
