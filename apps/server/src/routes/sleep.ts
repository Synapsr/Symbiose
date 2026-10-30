import { addDays, LocalDateSchema, SleepInputSchema, toLocalDate, type SleepTrend } from '@symbiose/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { validate, type Deps } from '../http';
import { sleepTrend, upsertNights } from '../services/sleep';

/** Read from the health store only. Imports are accepted whatever the opt-in; insights and the AI only use them when it is on. */
export function sleepRoutes({ db, config }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

  app.get('/', validate('query', z.object({ days: z.coerce.number().int().min(1).max(365).default(30), to: LocalDateSchema.optional() })), (c) => {
    const { days, to = toLocalDate() } = c.req.valid('query');
    return c.json<SleepTrend>(sleepTrend(db, c.get('userId'), addDays(to, -(days - 1)), to));
  });

  /** Nights merged on the phone, one per wake-up day; importing a night again replaces it. */
  app.put('/', validate('json', SleepInputSchema), (c) => {
    const { nights, source } = c.req.valid('json');
    return c.json({ written: upsertNights(db, c.get('userId'), nights, source) });
  });

  return app;
}
