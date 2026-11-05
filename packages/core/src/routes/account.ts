import { ProfileSchema, type Profile } from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AuthEnv } from '../auth';
import { activity, bloodPressure, coachMessages, cravings, journalEntries, meals, moods, photos as photosTable, sleepNights, users, vitals, waterLogs, weights, workouts } from '../db/schema';
import { nowIso, validate, type Deps } from '../http';
import { toReading } from '../services/blood-pressure';
import { toActivity, toCraving } from '../services/day';
import { toWaterEntry } from '../services/hydration';
import { toJournalEntry } from '../services/journal';
import { toMeal } from '../services/meals';
import { toMood } from '../services/mood';
import { toNight } from '../services/sleep';
import { getUserRow, toUser } from '../services/users';
import { toVital } from '../services/vitals';
import { toWorkout } from '../services/workouts';

/** Opt-in switches: profile forms that predate one don't send it, and must not turn it off. */
const OPT_INS = ['trackBloodPressure', 'trackSleep', 'trackHydration', 'trackMood'] as const satisfies (keyof Profile)[];

export function meRoutes({ db, config, photos, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  app.get('/', (c) => c.json(toUser(getUserRow(db, c.get('userId')), config)));

  app.put('/profile', validate('json', ProfileSchema), (c) => {
    const profile = { ...c.req.valid('json') };
    const stored = getUserRow(db, c.get('userId')).profile;
    for (const key of OPT_INS) if (profile[key] === undefined && stored?.[key] !== undefined) profile[key] = stored[key];
    // Same for the drinks goal chosen by hand; null brings the default back.
    if (profile.waterGoalMl === undefined && stored?.waterGoalMl !== undefined) profile.waterGoalMl = stored.waterGoalMl;
    // Same for the proactive coach, set from its own screen.
    if (profile.proactive === undefined && stored?.proactive) profile.proactive = stored.proactive;
    const row = db
      .update(users)
      .set({ profile, name: profile.name })
      .where(eq(users.id, c.get('userId')))
      .returning()
      .get();
    return c.json(toUser(row, config));
  });

  /** Everything we store about the user, as JSON. */
  app.get('/export', (c) => {
    const userId = c.get('userId');
    const user = toUser(getUserRow(db, userId), config);
    const payload = {
      exportedAt: nowIso(),
      user,
      meals: db.select().from(meals).where(eq(meals.userId, userId)).all().map(toMeal),
      activity: db.select().from(activity).where(eq(activity.userId, userId)).all().map(toActivity),
      weights: db.select().from(weights).where(eq(weights.userId, userId)).all(),
      workouts: db.select().from(workouts).where(eq(workouts.userId, userId)).all().map(toWorkout),
      bloodPressure: db.select().from(bloodPressure).where(eq(bloodPressure.userId, userId)).all().map(toReading),
      sleep: db.select().from(sleepNights).where(eq(sleepNights.userId, userId)).all().map(toNight),
      hydration: db.select().from(waterLogs).where(eq(waterLogs.userId, userId)).all().map(toWaterEntry),
      mood: db.select().from(moods).where(eq(moods.userId, userId)).all().map(toMood),
      cravings: db.select().from(cravings).where(eq(cravings.userId, userId)).all().map(toCraving),
      journal: db.select().from(journalEntries).where(eq(journalEntries.userId, userId)).all().map(toJournalEntry),
      vitals: db.select().from(vitals).where(eq(vitals.userId, userId)).all().map(toVital),
      coach: db.select().from(coachMessages).where(eq(coachMessages.userId, userId)).all(),
    };
    c.header('Content-Disposition', `attachment; filename="symbiose-export-${payload.exportedAt.slice(0, 10)}.json"`);
    return c.json(payload);
  });

  app.delete('/', async (c) => {
    const userId = c.get('userId');
    // Every photo the account stored, the courses' included.
    for (const photo of db.select({ id: photosTable.id }).from(photosTable).where(eq(photosTable.userId, userId)).all()) await photos.remove(userId, photo.id);
    db.delete(users).where(eq(users.id, userId)).run();
    return c.body(null, 204);
  });

  return app;
}
