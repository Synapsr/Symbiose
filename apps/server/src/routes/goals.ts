import { computeTargets, GoalDraftInputSchema, GoalPlanSchema, LocalDateSchema, toLocalDate, type GoalsResponse } from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { users } from '../db/schema';
import { HttpError } from '../errors';
import { validate, type Deps } from '../http';
import { heuristicPlan, planFromDraft } from '../services/goals';
import { resolveUser } from '../services/users';
import { bloodPressureBrief } from '../services/blood-pressure';
import { weightTrend } from '../services/weights';

export function goalRoutes({ db, ai, config }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

  app.get('/', validate('query', z.object({ date: LocalDateSchema.optional() })), (c) => {
    const { date } = c.req.valid('query');
    const resolved = resolveUser(db, c.get('userId'), date ?? toLocalDate());
    return c.json<GoalsResponse>({ plan: resolved.row.plan ?? null, targets: resolved.targets, energy: resolved.energy });
  });

  /** Turns free-text intentions into a plan preview. Nothing is saved. */
  app.post('/draft', validate('json', GoalDraftInputSchema), async (c) => {
    const { intentions } = c.req.valid('json');
    const resolved = resolveUser(db, c.get('userId'));
    const profile = resolved.row.profile;
    if (!profile) throw new HttpError(409, 'profile_required', 'Complete your profile first');

    const plan = ai.enabled
      ? planFromDraft(
          await ai.draftPlan({
            locale: profile.locale,
            profile,
            intentions,
            previousPlan: resolved.row.plan ?? null,
            weight: weightTrend(db, c.get('userId'), toLocalDate(), 90),
            bloodPressure: bloodPressureBrief(db, c.get('userId'), profile, toLocalDate()),
          }),
          intentions,
        )
      : heuristicPlan(intentions, profile.locale);
    const { targets, energy } = computeTargets(profile, plan);
    return c.json<GoalsResponse & { aiGenerated: boolean }>({ plan, targets, energy, aiGenerated: ai.enabled });
  });

  app.put('/', validate('json', z.object({ plan: GoalPlanSchema })), (c) => {
    const { plan } = c.req.valid('json');
    const userId = c.get('userId');
    db.update(users).set({ plan }).where(eq(users.id, userId)).run();
    const resolved = resolveUser(db, userId, toLocalDate());
    return c.json<GoalsResponse>({ plan, targets: resolved.targets, energy: resolved.energy });
  });

  return app;
}
