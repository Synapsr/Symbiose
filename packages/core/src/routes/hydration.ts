import { addDays, LocalDateSchema, toLocalDate, WaterImportSchema, WaterInputSchema, type HydrationTrend, type WaterEntry } from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import { waterLogs } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { validate, type Deps } from '../http';
import { addWater, hydrationTrend } from '../services/hydration';
import { requireProfile, resolveUser } from '../services/users';

/** Writes are accepted whatever the opt-in; insights and the AI only use them when it is on. */
export function hydrationRoutes({ db, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  app.get('/', validate('query', z.object({ days: z.coerce.number().int().min(1).max(365).default(30), to: LocalDateSchema.optional() })), (c) => {
    const { days, to = toLocalDate() } = c.req.valid('query');
    const resolved = resolveUser(db, c.get('userId'));
    requireProfile(resolved);
    return c.json<HydrationTrend>(hydrationTrend(db, c.get('userId'), resolved.row.profile!, addDays(to, -(days - 1)), to));
  });

  /** A glass logged in the app. */
  app.post('/', validate('json', WaterInputSchema), (c) => {
    const [entry] = addWater(db, c.get('userId'), [{ ...c.req.valid('json'), externalId: null }], 'manual');
    return c.json<WaterEntry>(entry!, 201);
  });

  /** Drinks from Apple Health / Health Connect; re-importing one updates it. */
  app.put('/', validate('json', WaterImportSchema), (c) => {
    const { entries, source } = c.req.valid('json');
    return c.json({ written: addWater(db, c.get('userId'), entries, source).length });
  });

  /** Imported drinks live in the health store: deleting them here would not stick. */
  app.delete('/:id', (c) => {
    const where = and(eq(waterLogs.id, c.req.param('id')), eq(waterLogs.userId, c.get('userId')));
    const row = db.select({ source: waterLogs.source }).from(waterLogs).where(where).get();
    if (!row) throw notFound('Drink');
    if (row.source !== 'manual') throw new HttpError(409, 'imported_drink', 'Imported drinks are managed in the health app');
    db.delete(waterLogs).where(where).run();
    return c.body(null, 204);
  });

  return app;
}
