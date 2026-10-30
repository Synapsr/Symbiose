import { randomUUID } from 'node:crypto';

import { CredentialsSchema, ProfileSchema, type AuthResponse, type Profile } from '@symbiose/shared';
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { hashPassword, issueToken, rateLimit, requireAuth, verifyPassword, type AuthEnv } from '../auth';
import { activity, bloodPressure, coachMessages, cravings, journalEntries, meals, moods, sleepNights, users, waterLogs, weights, workouts } from '../db/schema';
import { HttpError } from '../errors';
import { nowIso, validate, type Deps } from '../http';
import { toReading } from '../services/blood-pressure';
import { toActivity, toCraving } from '../services/day';
import { toWaterEntry } from '../services/hydration';
import { toJournalEntry } from '../services/journal';
import { toMeal } from '../services/meals';
import { toMood } from '../services/mood';
import { toNight } from '../services/sleep';
import { getUserRow, toUser } from '../services/users';
import { toWorkout } from '../services/workouts';

/** Opt-in switches: profile forms that predate one don't send it, and must not turn it off. */
const OPT_INS = ['trackBloodPressure', 'trackSleep', 'trackHydration', 'trackMood'] as const satisfies (keyof Profile)[];

export function authRoutes({ db, config }: Deps) {
  const app = new Hono();
  const limiter = rateLimit(10, 60_000);

  app.post('/register', limiter, validate('json', CredentialsSchema), async (c) => {
    const { email, password, name } = c.req.valid('json');
    const existingUsers = db.select({ n: count() }).from(users).get()?.n ?? 0;
    if (existingUsers > 0 && !config.allowSignup) {
      throw new HttpError(403, 'signup_closed', 'Sign-ups are closed on this server');
    }
    if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
      throw new HttpError(409, 'email_taken', 'An account already exists with this email');
    }
    const row = db
      .insert(users)
      .values({
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
        name: name ?? '',
        isAdmin: existingUsers === 0,
        createdAt: nowIso(),
      })
      .returning()
      .get();
    return c.json<AuthResponse>({ token: await issueToken(row.id, config.jwtSecret), user: toUser(row) }, 201);
  });

  app.post('/login', limiter, validate('json', CredentialsSchema.pick({ email: true, password: true })), async (c) => {
    const { email, password } = c.req.valid('json');
    const row = db.select().from(users).where(eq(users.email, email)).get();
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      throw new HttpError(401, 'invalid_credentials', 'Wrong email or password');
    }
    return c.json<AuthResponse>({ token: await issueToken(row.id, config.jwtSecret), user: toUser(row) });
  });

  return app;
}

export function meRoutes({ db, config, photos }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

  app.get('/', (c) => c.json(toUser(getUserRow(db, c.get('userId')))));

  app.put('/profile', validate('json', ProfileSchema), (c) => {
    const profile = { ...c.req.valid('json') };
    const stored = getUserRow(db, c.get('userId')).profile;
    for (const key of OPT_INS) if (profile[key] === undefined && stored?.[key] !== undefined) profile[key] = stored[key];
    // Same for the drinks goal chosen by hand; null brings the default back.
    if (profile.waterGoalMl === undefined && stored?.waterGoalMl !== undefined) profile.waterGoalMl = stored.waterGoalMl;
    const row = db
      .update(users)
      .set({ profile, name: profile.name })
      .where(eq(users.id, c.get('userId')))
      .returning()
      .get();
    return c.json(toUser(row));
  });

  /** Everything we store about the user, as JSON. */
  app.get('/export', (c) => {
    const userId = c.get('userId');
    const user = toUser(getUserRow(db, userId));
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
      coach: db.select().from(coachMessages).where(eq(coachMessages.userId, userId)).all(),
    };
    c.header('Content-Disposition', `attachment; filename="symbiose-export-${payload.exportedAt.slice(0, 10)}.json"`);
    return c.json(payload);
  });

  app.delete('/', async (c) => {
    const userId = c.get('userId');
    const photoIds = db.select({ id: meals.photoId }).from(meals).where(eq(meals.userId, userId)).all();
    for (const { id } of photoIds) if (id) await photos.remove(userId, id);
    db.delete(users).where(eq(users.id, userId)).run();
    return c.body(null, 204);
  });

  return app;
}
