import { addDays, RECOVERY_BASELINE_DAYS, recoverySignal, type RecoverySignal, type SleepNight, type VitalDay, type VitalsInputSchema } from '@symbiose/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { z } from 'zod';

import type { RecoveryBrief } from '../ai/types';
import type { Db } from '../db';
import { vitals, type VitalRow } from '../db/schema';

export function toVital(row: VitalRow): VitalDay {
  return { localDate: row.localDate, metric: row.metric, value: row.value, samples: row.samples, source: row.source, updatedAt: row.updatedAt };
}

/** One value per day and metric: importing a day again replaces it (the watch may have synced more since). */
export function upsertVitals(db: Db, userId: string, input: z.output<typeof VitalsInputSchema>): number {
  const updatedAt = new Date().toISOString();
  db.transaction((tx) => {
    for (const day of input.days) {
      const values = { value: Math.round(day.value * 10) / 10, samples: day.samples, source: input.source, updatedAt };
      tx.insert(vitals)
        .values({ userId, localDate: day.localDate, metric: day.metric, ...values })
        .onConflictDoUpdate({ target: [vitals.userId, vitals.localDate, vitals.metric], set: values })
        .run();
    }
  });
  return input.days.length;
}

export function vitalsBetween(db: Db, userId: string, from: string, to: string): VitalDay[] {
  return db
    .select()
    .from(vitals)
    .where(and(eq(vitals.userId, userId), gte(vitals.localDate, from), lte(vitals.localDate, to)))
    .orderBy(asc(vitals.localDate))
    .all()
    .map(toVital);
}

/** Last night's vitals against the 30 days before. */
export function recoveryFor(db: Db, userId: string, date: string, night: Pick<SleepNight, 'asleepMin'> | null): RecoverySignal {
  return recoverySignal(vitalsBetween(db, userId, addDays(date, -RECOVERY_BASELINE_DAYS), date), date, night);
}

/** What the AI may hear: a classification only, and only when it's trusted beyond a first hint. */
export function recoveryBrief(signal: RecoverySignal): RecoveryBrief | null {
  if (!signal.status || !signal.confidence || signal.confidence === 'low') return null;
  return { status: signal.status, confidence: signal.confidence, reasons: signal.reasons };
}
