import {
  LocalDateSchema,
  MorningRequestSchema,
  ProactiveSettingsPatchSchema,
  ProactiveSettingsSchema,
  startOfWeek,
  toLocalDate,
  type CoachMessage,
  type CravingNudges,
  type ProactiveSchedule,
} from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import { aiCache, users } from '../db/schema';
import { HttpError } from '../errors';
import { nowIso, validate, type Deps } from '../http';
import {
  buildMorningInput,
  FALLBACK_NUDGES,
  morningMessage,
  nudgesInput,
  proactiveSchedule,
  proactiveSettings,
  saveMorning,
  templateMorning,
  usualCravingWindow,
} from '../services/proactive';
import { getUserRow } from '../services/users';

/** A check-in is a few short lines: anything longer is cut. */
const MAX_MORNING_CHARS = 800;
const MAX_NUDGE_CHARS = 140;

const cleanText = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_MORNING_CHARS);

/**
 * The proactive coach: its schedule for the phone, its settings, the
 * morning check-in (written once a day, then kept) and the week's craving
 * nudges. Nothing runs unless the person switched it on.
 */
export function proactiveRoutes({ db, ai, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  app.get('/', validate('query', z.object({ date: LocalDateSchema.optional() })), (c) => {
    return c.json<ProactiveSchedule>(proactiveSchedule(db, c.get('userId'), c.req.valid('query').date ?? toLocalDate()));
  });

  /** Changes some settings, keeps the others; answers with the new schedule. */
  app.put('/settings', validate('json', ProactiveSettingsPatchSchema.extend({ localDate: LocalDateSchema.optional() })), (c) => {
    const userId = c.get('userId');
    const { localDate, ...patch } = c.req.valid('json');
    const row = getUserRow(db, userId);
    if (!row.profile) throw new HttpError(409, 'profile_required', 'Complete your profile first');
    const stored = row.profile.proactive;
    const proactive = ProactiveSettingsSchema.parse({ ...stored, ...patch, offers: patch.offers ? { ...stored?.offers, ...patch.offers } : stored?.offers });
    db.update(users)
      .set({ profile: { ...row.profile, proactive } })
      .where(eq(users.id, userId))
      .run();
    return c.json<ProactiveSchedule>(proactiveSchedule(db, userId, localDate ?? toLocalDate()));
  });

  function requireOn(userId: string, feature: 'morning' | 'cravings') {
    const settings = proactiveSettings(db, getUserRow(db, userId));
    if (!settings.enabled || !settings[feature]) throw new HttpError(409, 'proactive_off', 'Turn the proactive coach on first');
  }

  // One check-in per person and day: concurrent requests share the one being written.
  const writing = new Map<string, Promise<CoachMessage>>();

  function ensureMorning(userId: string, date: string, hideCalories: boolean, onText?: (delta: string) => void): Promise<CoachMessage> {
    const existing = morningMessage(db, userId, date);
    if (existing) return Promise.resolve(existing);
    const key = `${userId}:${date}`;
    const running = writing.get(key);
    if (running) return running;
    const promise = (async () => {
      const input = buildMorningInput(db, userId, date, hideCalories);
      let text = '';
      if (ai.enabled) {
        try {
          text = cleanText((await ai.morning(input, onText)).text);
        } catch (error) {
          console.warn('morning check-in failed, writing it from the data', error);
        }
      }
      // Without the AI, the data still makes a fair check-in.
      return saveMorning(db, userId, date, text || templateMorning(input));
    })().finally(() => writing.delete(key));
    writing.set(key, promise);
    return promise;
  }

  /** Today's check-in: written on the first call of the day, then the same message. */
  app.post('/morning', validate('json', MorningRequestSchema), async (c) => {
    const { localDate, hideCalories } = c.req.valid('json');
    const userId = c.get('userId');
    requireOn(userId, 'morning');
    return c.json<CoachMessage>(await ensureMorning(userId, localDate, hideCalories ?? false));
  });

  /** Same, as Server-Sent Events: `delta` while it is written, then `done` with the saved message. */
  app.post('/morning/stream', validate('json', MorningRequestSchema), (c) => {
    const { localDate, hideCalories } = c.req.valid('json');
    const userId = c.get('userId');
    requireOn(userId, 'morning');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      try {
        const message = await ensureMorning(userId, localDate, hideCalories ?? false, (delta) => void stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) }));
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ message }) });
      } catch (error) {
        const known = error instanceof HttpError ? error : null;
        if (!known) console.error(error);
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: known?.code ?? 'internal', message: known?.message ?? 'Something went wrong' }) });
      }
    });
  });

  /** The week's one-line nudges for the craving heads-up: written once a week, then cached (the phone keeps them too). */
  app.post('/nudges', validate('json', z.object({ localDate: LocalDateSchema })), async (c) => {
    const { localDate } = c.req.valid('json');
    const userId = c.get('userId');
    requireOn(userId, 'cravings');
    const week = startOfWeek(localDate);
    const key = `nudges:${userId}:${week}`;
    const cached = db.select().from(aiCache).where(eq(aiCache.key, key)).get();
    if (cached) return c.json<CravingNudges>({ week, lines: cached.value as string[] });

    const window = usualCravingWindow(db, userId, localDate);
    if (!window) throw new HttpError(409, 'not_enough_data', 'No usual craving time yet');
    const input = nudgesInput(db, userId, localDate, window);
    if (ai.enabled) {
      try {
        const lines = [...new Set((await ai.cravingNudges(input)).lines.map((l) => l.trim()).filter((l) => l && l.length <= MAX_NUDGE_CHARS))].slice(0, 7);
        if (lines.length >= 3) {
          db.insert(aiCache).values({ key, userId, value: lines, createdAt: nowIso() }).onConflictDoNothing().run();
          return c.json<CravingNudges>({ week, lines });
        }
      } catch (error) {
        console.warn('craving nudges failed, using the stock lines', error);
      }
    }
    // Not cached: the AI gets another chance next time.
    return c.json<CravingNudges>({ week, lines: FALLBACK_NUDGES[input.locale] });
  });

  return app;
}
