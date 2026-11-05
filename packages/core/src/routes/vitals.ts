import { addDays, LocalDateSchema, toLocalDate, VitalsInputSchema, type RecoverySignal, type VitalDay } from '@symbiose/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import { validate, type Deps } from '../http';
import { nightOf } from '../services/sleep';
import { recoveryFor, upsertVitals, vitalsBetween } from '../services/vitals';

/** Nightly vitals from the health store (HRV, resting heart rate), imported once the morning check-in is on. */
export function vitalsRoutes({ db, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  /** One value per day and metric; importing a day again replaces it. */
  app.put('/', validate('json', VitalsInputSchema), (c) => {
    return c.json({ written: upsertVitals(db, c.get('userId'), c.req.valid('json')) });
  });

  /** The days of a window, and how the last one compares with the 30 before. */
  app.get('/', validate('query', z.object({ days: z.coerce.number().int().min(1).max(365).default(30), to: LocalDateSchema.optional() })), (c) => {
    const { days, to = toLocalDate() } = c.req.valid('query');
    const userId = c.get('userId');
    return c.json<{ days: VitalDay[]; recovery: RecoverySignal }>({
      days: vitalsBetween(db, userId, addDays(to, -(days - 1)), to),
      recovery: recoveryFor(db, userId, to, nightOf(db, userId, to)),
    });
  });

  return app;
}
