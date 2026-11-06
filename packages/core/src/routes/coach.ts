import {
  addDays,
  ApplyCoachMealActionInputSchema,
  CoachInputSchema,
  focusNutrients,
  localTime,
  mealTotals,
  TRANSIT_WINDOW_DAYS,
  toLocalDateTime,
  type CoachMealAction,
  type CoachMealActionResult,
  type CoachMessage,
  type NutrientKey,
  type Workout,
} from '@symbiose/shared';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { AuthEnv } from '../auth';
import type { CoachInput, CoachMealBrief, CoachOutput } from '../ai/types';
import type { Db } from '../db';
import { coachMessages, meals, type CoachMessageRow } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { nowIso, validate, type Deps } from '../http';
import { newId } from '../ids';
import { computeInsights, daySummary } from '../services/day';
import { bloodPressureBrief } from '../services/blood-pressure';
import { energyExpenditureBrief } from '../services/expenditure';
import { journalBrief } from '../services/journal';
import { lifeBrief } from '../services/life';
import { moodNoteIds } from '../services/mood';
import { proactiveTurn, toCoachMessage } from '../services/coach-messages';
import { acceptMealActions, runMealAction } from '../services/meal-actions';
import { toMeal } from '../services/meals';
import { nightOf } from '../services/sleep';
import { sugarsBrief } from '../services/sugars';
import { resolveUser } from '../services/users';
import { recoveryBrief, recoveryFor } from '../services/vitals';
import { workoutsBetween } from '../services/workouts';

const HISTORY_TURNS = 20;

const toMessage = toCoachMessage;

/** The meals the coach may edit or delete: the conversation's day and the 2 days before. */
function recentMeals(db: Db, userId: string, localDate: string, focus: NutrientKey[]): CoachMealBrief[] {
  return db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.localDate, addDays(localDate, -2)), lte(meals.localDate, localDate)))
    .orderBy(asc(meals.localDate), asc(meals.eatenAt))
    .all()
    .map((row) => {
      const totals = mealTotals(row.items);
      // A meal in courses says so: its courses' names (« Plat 2 » when unnamed).
      const courses = row.courses && row.courses.length > 1 ? row.courses.map((c, i) => c.label || `#${i + 1}`) : null;
      return {
        id: row.id,
        date: row.localDate,
        time: localTime(row.eatenAt),
        type: row.mealType,
        title: row.title,
        kcal: Math.round(totals.kcal),
        ...(courses ? { courses } : {}),
        ...Object.fromEntries(focus.map((key) => [key, Math.round(totals[key])])),
      };
    });
}

/** Everything the coach knows: profile, plan, today, the last 7 days, the journal's last 14 and the conversation. */
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
  // A proactive message follows a turn that says what it is, so turns still alternate and a reply to it reads as one.
  const turns = history.flatMap((m) => {
    const cue = proactiveTurn(m);
    return [...(cue ? [{ role: 'user' as const, content: cue }] : []), { role: m.role, content: m.content }];
  });
  // The conversation must start with a user turn.
  while (turns[0]?.role === 'assistant') turns.shift();

  const day = daySummary(db, userId, localDate);
  const week = computeInsights(db, userId, addDays(localDate, -6), localDate);
  const brief = (w: Workout) => ({
    type: w.type,
    minutes: Math.round(w.durationMin),
    kcal: w.activeKcal === null ? null : Math.round(w.activeKcal),
    ...(w.steps === null ? {} : { steps: w.steps }),
  });
  return {
    ...resolved.context,
    history: turns,
    message: text,
    bloodPressure: bloodPressureBrief(db, userId, resolved.row.profile ?? null, localDate),
    energyExpenditure: energyExpenditureBrief(week.adaptiveEnergy),
    life: lifeBrief(db, userId, resolved.row.profile ?? null, resolved.row.plan ?? null, localDate),
    // The last week's moods are in `life.mood`, with their words: the older « Ressenti » notes they come from aren't repeated.
    journal: journalBrief(db, userId, addDays(localDate, -(TRANSIT_WINDOW_DAYS - 1)), localDate, moodNoteIds(db, userId, addDays(localDate, -6), localDate)),
    recovery: recoveryBrief(recoveryFor(db, userId, localDate, resolved.row.profile?.trackSleep ? nightOf(db, userId, localDate) : null)),
    sugars: sugarsBrief(db, userId, resolved.context.plan, localDate),
    today: {
      date: day.date,
      totals: day.totals,
      progress: day.progress,
      activity: day.activity,
      workouts: day.workouts.map((w) => ({ time: localTime(w.startedAt), ...brief(w) })),
    },
    recentMeals: recentMeals(db, userId, localDate, focusNutrients(resolved.context.plan)),
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

function saveExchange(db: Db, userId: string, input: CoachInput, output: CoachOutput): { user: CoachMessage; reply: CoachMessage } {
  const text = input.message;
  const userAt = nowIso();
  const user = db
    .insert(coachMessages)
    .values({ id: newId(), userId, role: 'user', content: text, suggestion: null, createdAt: userAt })
    .returning()
    .get();
  const reply = db
    .insert(coachMessages)
    .values({
      id: newId(),
      userId,
      role: 'assistant',
      content: output.reply,
      suggestion: output.planChange,
      mealActions: acceptMealActions(output.mealActions, new Set(input.recentMeals.map((m) => m.id)), input.today.date),
      // Strictly after the user message so ordering is stable.
      createdAt: new Date(Date.parse(userAt) + 1).toISOString(),
    })
    .returning()
    .get();
  return { user: toMessage(user), reply: toMessage(reply) };
}

export function coachRoutes({ db, ai, photos, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

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
    const input = buildCoachInput(db, userId, text, localDate);
    return c.json<{ user: CoachMessage; reply: CoachMessage }>(saveExchange(db, userId, input, await ai.coach(input)));
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
        await stream.writeSSE({ event: 'done', data: JSON.stringify(saveExchange(db, userId, input, output)) });
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

  // Meal actions proposed by the coach only run once confirmed, with the regular meal logic.
  const applying = new Set<string>();

  function findAction(userId: string, messageId: string, indexParam: string) {
    const row = db
      .select()
      .from(coachMessages)
      .where(and(eq(coachMessages.id, messageId), eq(coachMessages.userId, userId)))
      .get();
    if (!row) throw notFound('Message');
    const index = Number(indexParam);
    const action = Number.isInteger(index) ? row.mealActions?.[index] : undefined;
    if (!action) throw notFound('Meal action');
    return { row, index, action, key: `${row.id}:${index}` };
  }

  function saveAction(row: CoachMessageRow, index: number, changes: Partial<CoachMealAction>): CoachMessage {
    // Read again: other actions of the message may have changed while the AI worked.
    const fresh = db.select().from(coachMessages).where(eq(coachMessages.id, row.id)).get() ?? row;
    const mealActions = (fresh.mealActions ?? []).map((action, i) => (i === index ? { ...action, ...changes } : action));
    db.update(coachMessages).set({ mealActions }).where(eq(coachMessages.id, row.id)).run();
    return toMessage({ ...fresh, mealActions });
  }

  app.post('/messages/:id/meal-actions/:index/apply', validate('json', ApplyCoachMealActionInputSchema), async (c) => {
    const userId = c.get('userId');
    const { row, index, action, key } = findAction(userId, c.req.param('id'), c.req.param('index'));
    if (action.status === 'applied') {
      // Idempotent: a retry gets the first result instead of a second meal.
      const meal = action.resultMealId ? db.select().from(meals).where(and(eq(meals.id, action.resultMealId), eq(meals.userId, userId))).get() : undefined;
      return c.json<CoachMealActionResult>({ message: toMessage(row), meal: meal ? toMeal(meal) : null });
    }
    if (action.status === 'dismissed') throw new HttpError(409, 'action_dismissed', 'This proposal was dismissed');
    if (applying.has(key)) throw new HttpError(409, 'action_in_progress', 'This proposal is already being applied');
    applying.add(key);
    try {
      const meal = await runMealAction({ db, ai, photos }, userId, action, c.req.valid('json').now ?? toLocalDateTime());
      const message = saveAction(row, index, { status: 'applied', resultMealId: meal?.id ?? null });
      return c.json<CoachMealActionResult>({ message, meal });
    } finally {
      applying.delete(key);
    }
  });

  app.post('/messages/:id/meal-actions/:index/dismiss', (c) => {
    const { row, index, action, key } = findAction(c.get('userId'), c.req.param('id'), c.req.param('index'));
    if (action.status === 'applied') throw new HttpError(409, 'action_applied', 'This proposal was already applied');
    if (applying.has(key)) throw new HttpError(409, 'action_in_progress', 'This proposal is already being applied');
    return c.json<CoachMessage>(action.status === 'dismissed' ? toMessage(row) : saveAction(row, index, { status: 'dismissed' }));
  });

  app.delete('/messages', (c) => {
    db.delete(coachMessages).where(eq(coachMessages.userId, c.get('userId'))).run();
    return c.body(null, 204);
  });

  return app;
}
