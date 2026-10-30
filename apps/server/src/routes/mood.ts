import { LocalDateSchema, MoodInputSchema, toLocalDate, type MoodCheckIn, type MoodTrend } from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { moods } from '../db/schema';
import { notFound } from '../errors';
import { validate, type Deps } from '../http';
import { moodTrend, saveMood } from '../services/mood';
import { requireProfile, resolveUser } from '../services/users';

/** Writes are accepted whatever the opt-in; insights and the AI only use them when it is on. */
export function moodRoutes({ db, config }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

  app.get('/', validate('query', z.object({ days: z.coerce.number().int().min(1).max(365).default(30), to: LocalDateSchema.optional() })), (c) => {
    const { days, to = toLocalDate() } = c.req.valid('query');
    const resolved = resolveUser(db, c.get('userId'));
    requireProfile(resolved);
    return c.json<MoodTrend>(moodTrend(db, c.get('userId'), resolved.row.profile!, resolved.row.plan ?? null, to, days));
  });

  /** The day's check-in; checking in again the same day replaces it. */
  app.put('/', validate('json', MoodInputSchema), (c) => c.json<MoodCheckIn>(saveMood(db, c.get('userId'), c.req.valid('json'))));

  app.delete('/:date', validate('param', z.object({ date: LocalDateSchema })), (c) => {
    const row = db
      .delete(moods)
      .where(and(eq(moods.userId, c.get('userId')), eq(moods.localDate, c.req.valid('param').date)))
      .returning({ date: moods.localDate })
      .get();
    if (!row) throw notFound('Check-in');
    return c.body(null, 204);
  });

  return app;
}
