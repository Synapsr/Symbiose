import { addDays, type WeightInput, type WeightPoint, type WeightTrend } from '@symbiose/shared';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import type { Db } from '../db';
import { users, weights } from '../db/schema';

const round1 = (n: number) => Math.round(n * 10) / 10;
const average = (points: WeightPoint[]) => points.reduce((sum, p) => sum + p.kg, 0) / points.length;

/**
 * Stores readings, keeping the latest one of each day, then aligns the
 * profile weight on the most recent reading so targets stay accurate.
 */
export function upsertWeights(db: Db, userId: string, input: Pick<WeightInput, 'samples' | 'source'>): number {
  const latestPerDay = new Map<string, WeightInput['samples'][number]>();
  for (const sample of input.samples) {
    const current = latestPerDay.get(sample.localDate);
    if (!current || sample.measuredAt > current.measuredAt) latestPerDay.set(sample.localDate, sample);
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

  const now = new Date().toISOString();
  let written = 0;
  db.transaction((tx) => {
    for (const [localDate, sample] of latestPerDay) {
      const row = existing.get(localDate);
      if (row && row.measuredAt > sample.measuredAt) continue;
      const values = { kg: round1(sample.kg), measuredAt: sample.measuredAt, source: input.source, updatedAt: now };
      tx.insert(weights)
        .values({ userId, localDate, ...values })
        .onConflictDoUpdate({ target: [weights.userId, weights.localDate], set: values })
        .run();
      written++;
    }
    const latest = tx.select().from(weights).where(eq(weights.userId, userId)).orderBy(desc(weights.localDate)).limit(1).get();
    const user = tx.select({ profile: users.profile }).from(users).where(eq(users.id, userId)).get();
    if (latest && user?.profile && user.profile.weightKg !== latest.kg) {
      tx.update(users)
        .set({ profile: { ...user.profile, weightKg: latest.kg } })
        .where(eq(users.id, userId))
        .run();
    }
  });
  return written;
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
