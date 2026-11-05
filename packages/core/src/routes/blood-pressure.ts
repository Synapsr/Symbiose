import {
  BloodPressureInputSchema,
  BloodPressureReadingInputSchema,
  LocalDateSchema,
  toLocalDate,
  type BloodPressureReading,
  type BloodPressureTrend,
} from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import { bloodPressure } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { validate, type Deps } from '../http';
import { bloodPressureTrend, upsertReadings } from '../services/blood-pressure';

// Catches swapped fields in hand-typed readings.
const ManualReadingSchema = BloodPressureReadingInputSchema.refine((r) => r.diastolic < r.systolic, {
  message: 'Diastolic must be lower than systolic',
  path: ['diastolic'],
});

/** Writes are accepted whatever the opt-in; insights and the AI only use them when it is on. */
export function bloodPressureRoutes({ db, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  app.get('/', validate('query', z.object({ days: z.coerce.number().int().min(1).max(730).default(90), to: LocalDateSchema.optional() })), (c) => {
    const { days, to = toLocalDate() } = c.req.valid('query');
    return c.json<BloodPressureTrend>(bloodPressureTrend(db, c.get('userId'), to, days));
  });

  /** Readings from Apple Health / Health Connect; re-importing one updates it. */
  app.put('/', validate('json', BloodPressureInputSchema), (c) => {
    const { readings, source } = c.req.valid('json');
    return c.json({ written: upsertReadings(db, c.get('userId'), readings, source).length });
  });

  app.post('/', validate('json', ManualReadingSchema), (c) => {
    const [reading] = upsertReadings(db, c.get('userId'), [c.req.valid('json')], 'manual');
    return c.json<BloodPressureReading>(reading!, 201);
  });

  /** Imported readings live in the health store: deleting them here would not stick. */
  app.delete('/:id', (c) => {
    const where = and(eq(bloodPressure.id, c.req.param('id')), eq(bloodPressure.userId, c.get('userId')));
    const row = db.select({ source: bloodPressure.source }).from(bloodPressure).where(where).get();
    if (!row) throw notFound('Reading');
    if (row.source !== 'manual') throw new HttpError(409, 'imported_reading', 'Imported readings are managed in the health app');
    db.delete(bloodPressure).where(where).run();
    return c.body(null, 204);
  });

  return app;
}
