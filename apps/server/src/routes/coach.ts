import { randomUUID } from 'node:crypto';

import { addDays, CoachInputSchema, localTime, type CoachMessage } from '@symbiose/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { requireAuth, type AuthEnv } from '../auth';
import { coachMessages, type CoachMessageRow } from '../db/schema';
import { nowIso, validate, type Deps } from '../http';
import { computeInsights, daySummary } from '../services/day';
import { resolveUser } from '../services/users';

const HISTORY_TURNS = 20;

const toMessage = (row: CoachMessageRow): CoachMessage => ({
  id: row.id,
  role: row.role,
  content: row.content,
  suggestion: row.suggestion ?? null,
  createdAt: row.createdAt,
});

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
    const output = await ai.coach({
      ...resolved.context,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      message: text,
      today: {
        date: day.date,
        totals: day.totals,
        progress: day.progress,
        activity: day.activity,
        meals: day.meals.map((m) => ({ time: localTime(m.eatenAt), title: m.title, kcal: m.totals.kcal })),
      },
      week: {
        averages: week.averages,
        loggedDays: week.loggedDays,
        adherence: week.adherence,
        topSources: week.topSources,
        byHour: week.byHour,
        cravings: week.cravings,
      },
    });

    const userAt = nowIso();
    const userRow = db
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
    return c.json<{ user: CoachMessage; reply: CoachMessage }>({ user: toMessage(userRow), reply: toMessage(reply) });
  });

  app.delete('/messages', (c) => {
    db.delete(coachMessages).where(eq(coachMessages.userId, c.get('userId'))).run();
    return c.body(null, 204);
  });

  return app;
}
