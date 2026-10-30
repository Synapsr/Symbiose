import { computeTargets, GoalDraftInputSchema, GoalPlanSchema, LocalDateSchema, toLocalDate, type GoalsResponse } from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { users } from '../db/schema';
import { HttpError } from '../errors';
import { validate, type Deps } from '../http';
import { bloodPressureBrief } from '../services/blood-pressure';
import { adaptiveEnergyHistory, adaptiveShiftOn } from '../services/expenditure';
import { heuristicPlan, planFromDraft } from '../services/goals';
import { getUserRow, resolveUser } from '../services/users';
import { weightTrend } from '../services/weights';

export function goalRoutes({ db, ai, config }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

  app.get('/', validate('query', z.object({ date: LocalDateSchema.optional() })), (c) => {
    const { date = toLocalDate() } = c.req.valid('query');
    const userId = c.get('userId');
    const resolved = resolveUser(db, userId, date);
    const { profile, plan = null } = resolved.row;
    const adaptiveEnergy = profile ? adaptiveEnergyHistory(db, userId, profile, plan, date, date).asOf(date) : null;
    return c.json<GoalsResponse>({ plan, targets: resolved.targets, energy: resolved.energy, adaptiveEnergy });
  });

  /** Turns free-text intentions into a plan preview. Nothing is saved. */
  app.post('/draft', validate('json', GoalDraftInputSchema), async (c) => {
    const { intentions } = c.req.valid('json');
    const resolved = resolveUser(db, c.get('userId'));
    const profile = resolved.row.profile;
    if (!profile) throw new HttpError(409, 'profile_required', 'Complete your profile first');

    const drafted = ai.enabled
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
    // A new plan keeps the person's choice to follow their measured expenditure.
    const kept = resolved.row.plan?.adaptiveEnergy;
    const plan = kept ? { ...drafted, adaptiveEnergy: kept } : drafted;
    const today = toLocalDate();
    const { targets, energy } = computeTargets(profile, plan, { adaptiveKcal: adaptiveShiftOn(db, c.get('userId'), profile, plan, today) });
    return c.json<GoalsResponse & { aiGenerated: boolean }>({ plan, targets, energy, aiGenerated: ai.enabled });
  });

  app.put('/', validate('json', z.object({ plan: GoalPlanSchema })), (c) => {
    const input = c.req.valid('json').plan;
    const userId = c.get('userId');
    // Clients that don't know the opt-in don't send it: keep the stored choice (null turns it off).
    const stored = getUserRow(db, userId).plan?.adaptiveEnergy;
    const plan = input.adaptiveEnergy === undefined && stored !== undefined ? { ...input, adaptiveEnergy: stored } : input;
    db.update(users).set({ plan }).where(eq(users.id, userId)).run();
    const resolved = resolveUser(db, userId, toLocalDate());
    return c.json<GoalsResponse>({ plan, targets: resolved.targets, energy: resolved.energy });
  });

  return app;
}
