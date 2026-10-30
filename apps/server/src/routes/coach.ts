import { randomUUID } from 'node:crypto';

import { addDays, CoachInputSchema, localTime, type CoachMessage, type Workout } from '@symbiose/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { requireAuth, type AuthEnv } from '../auth';
import type { CoachInput, CoachOutput } from '../ai/types';
import type { Db } from '../db';
import { coachMessages, type CoachMessageRow } from '../db/schema';
import { HttpError } from '../errors';
import { nowIso, validate, type Deps } from '../http';
import { computeInsights, daySummary } from '../services/day';
import { resolveUser } from '../services/users';
import { workoutsBetween } from '../services/workouts';

const HISTORY_TURNS = 20;

const toMessage = (row: CoachMessageRow): CoachMessage => ({
  id: row.id,
  role: row.role,
  content: row.content,
  suggestion: row.suggestion ?? null,
  createdAt: row.createdAt,
});

/** Everything the coach knows: profile, plan, today, the last 7 days and the conversation. */
function buildCoachInput(db: Db, userId: string, text: string, localDate: string): CoachInput {
  const resolved = resolveUser(db, userId, localDate);
  const history = db
    .select()
    .from(coachMessages)
    .where(eq(coachMessages.userId, userId))
    .orderBy(desc(coachMessages.createdAt))
    .limit(HISTORY_TURNS)
    .all()
    .reverse();
  // The conversation must start with a user turn.
  while (history[0]?.role === 'assistant') history.shift();

  const day = daySummary(db, userId, localDate);
  const week = computeInsights(db, userId, addDays(localDate, -6), localDate);
  const brief = (w: Workout) => ({ type: w.type, minutes: Math.round(w.durationMin), kcal: w.activeKcal === null ? null : Math.round(w.activeKcal) });
  return {
    ...resolved.context,
    history: history.map((m) => ({ role: m.role, content: m.content })),
    message: text,
    today: {
      date: day.date,
      totals: day.totals,
      progress: day.progress,
      activity: day.activity,
      meals: day.meals.map((m) => ({ time: localTime(m.eatenAt), title: m.title, kcal: m.totals.kcal })),
      workouts: day.workouts.map((w) => ({ time: localTime(w.startedAt), ...brief(w) })),
    },
    week: {
      averages: week.averages,
      loggedDays: week.loggedDays,
      adherence: week.adherence,
      topSources: week.topSources,
      byHour: week.byHour,
      cravings: week.cravings,
      weight: week.weight,
      activity: day.activityWeek,
      workouts: workoutsBetween(db, userId, addDays(localDate, -6), localDate).map((w) => ({ date: w.localDate, ...brief(w) })),
    },
  };
}

function saveExchange(db: Db, userId: string, text: string, output: CoachOutput): { user: CoachMessage; reply: CoachMessage } {
  const userAt = nowIso();
  const user = db
    .insert(coachMessages)
    .values({ id: randomUUID(), userId, role: 'user', content: text, suggestion: null, createdAt: userAt })
    .returning()
    .get();
  const reply = db
    .insert(coachMessages)
    .values({
      id: randomUUID(),
      userId,
      role: 'assistant',
      content: output.reply,
      suggestion: output.planChange,
      // Strictly after the user message so ordering is stable.
      createdAt: new Date(Date.parse(userAt) + 1).toISOString(),
    })
    .returning()
    .get();
  return { user: toMessage(user), reply: toMessage(reply) };
}

export function coachRoutes({ db, ai, config }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

  app.get('/messages', (c) => {
    const rows = db
      .select()
      .from(coachMessages)
      .where(eq(coachMessages.userId, c.get('userId')))
      .orderBy(desc(coachMessages.createdAt))
      .limit(100)
      .all();
    return c.json<CoachMessage[]>(rows.reverse().map(toMessage));
  });

  app.post('/messages', validate('json', CoachInputSchema), async (c) => {
    const { text, localDate } = c.req.valid('json');
    const userId = c.get('userId');
    const output = await ai.coach(buildCoachInput(db, userId, text, localDate));
    return c.json<{ user: CoachMessage; reply: CoachMessage }>(saveExchange(db, userId, text, output));
  });

  /**
   * Same as POST /messages, as Server-Sent Events: `delta` events carry the
   * reply as it is written, then `done` carries the saved messages (or `error`).
   */
  app.post('/messages/stream', validate('json', CoachInputSchema), (c) => {
    const { text, localDate } = c.req.valid('json');
    const userId = c.get('userId');
    const input = buildCoachInput(db, userId, text, localDate);
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      try {
        const output = await ai.coach(input, (delta) => void stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) }));
        await stream.writeSSE({ event: 'done', data: JSON.stringify(saveExchange(db, userId, text, output)) });
      } catch (error) {
        const known = error instanceof HttpError ? error : null;
        if (!known) console.error(error);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ code: known?.code ?? 'internal', message: known?.message ?? 'Something went wrong' }),
        });
      }
    });
  });

  app.delete('/messages', (c) => {
    db.delete(coachMessages).where(eq(coachMessages.userId, c.get('userId'))).run();
    return c.body(null, 204);
  });

  return app;
}
