import { estimateWorkoutKcal, LocalDateSchema, WorkoutInputSchema, WorkoutsImportSchema, type Workout } from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import { workouts } from '../db/schema';
import { notFound } from '../errors';
import { validate, type Deps } from '../http';
import { getUserRow } from '../services/users';
import { upsertWorkouts, workoutsBetween } from '../services/workouts';

const rangeQuery = z
  .object({ from: LocalDateSchema, to: LocalDateSchema })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });

export function workoutRoutes({ db, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  app.get('/', validate('query', rangeQuery), (c) => {
    const { from, to } = c.req.valid('query');
    return c.json<Workout[]>(workoutsBetween(db, c.get('userId'), from, to));
  });

  /** Sessions from Apple Health / Health Connect; re-importing one updates it. */
  app.put('/', validate('json', WorkoutsImportSchema), (c) => {
    const written = upsertWorkouts(db, c.get('userId'), c.req.valid('json').workouts).length;
    return c.json({ written });
  });

  /** A session added by hand; without a measured value, its energy is estimated from METs. */
  app.post('/', validate('json', WorkoutInputSchema), (c) => {
    const input = c.req.valid('json');
    const userId = c.get('userId');
    const weightKg = getUserRow(db, userId).profile?.weightKg;
    const activeKcal = input.activeKcal ?? (weightKg ? estimateWorkoutKcal(input.type, input.intensity ?? 'moderate', input.durationMin, weightKg) : null);
    const [workout] = upsertWorkouts(db, userId, [{ ...input, activeKcal }]);
    return c.json<Workout>(workout!, 201);
  });

  app.delete('/:id', (c) => {
    const row = db
      .delete(workouts)
      .where(and(eq(workouts.id, c.req.param('id')), eq(workouts.userId, c.get('userId'))))
      .returning({ id: workouts.id })
      .get();
    if (!row) throw notFound('Workout');
    return c.body(null, 204);
  });

  return app;
}
