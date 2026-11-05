import {
  ActivityInputSchema,
  addDays,
  CravingInputSchema,
  CravingPatchSchema,
  CravingTipRequestSchema,
  LocalDateSchema,
  localTime,
  toLocalDate,
  type Craving,
  type DayActivity,
  type DaySummary,
  type FoodItem,
  type InsightsResponse,
  type LibraryResponse,
  type WeeklyReview,
  type WeeklyReviewState,
  type WeightTrend,
  WeightInputSchema,
} from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import type { CravingOutput } from '../ai/types';
import { activity, cravings } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { nowIso, validate, type Deps } from '../http';
import { newId } from '../ids';
import { computeInsights, daySummary, library, toActivity, toCraving } from '../services/day';
import { lookupBarcode } from '../services/openfoodfacts';
import { resolveUser } from '../services/users';
import { lifeBrief } from '../services/life';
import { generateReview, weeklyReviewState } from '../services/review';
import { upsertWeights, weightTrend } from '../services/weights';
import { activityToday } from '../services/workouts';

const FALLBACK_TIPS = {
  fr: [
    { tip: "Bois un grand verre d'eau et laisse passer 10 minutes : la plupart des envies retombent d'elles-mêmes.", alternative: 'Un fruit avec quelques amandes' },
    { tip: "Change d'activité deux minutes : marche, respire, sors de la pièce. L'envie est souvent liée au contexte.", alternative: 'Un yaourt nature avec de la cannelle' },
  ],
  en: [
    { tip: 'Drink a big glass of water and give it 10 minutes: most cravings fade on their own.', alternative: 'A piece of fruit with a few almonds' },
    { tip: 'Switch context for two minutes: walk, breathe, leave the room. Cravings are often tied to the setting.', alternative: 'Plain yoghurt with cinnamon' },
  ],
};

export function trackingRoutes({ db, ai, photos, fetch: fetchImpl, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  app.get('/days/:date', (c) => {
    const date = LocalDateSchema.parse(c.req.param('date'));
    return c.json<DaySummary>(daySummary(db, c.get('userId'), date));
  });

  app.get('/foods/library', validate('query', z.object({ today: LocalDateSchema.optional() })), (c) => {
    return c.json<LibraryResponse>(library(db, c.get('userId'), c.req.valid('query').today ?? toLocalDate()));
  });

  app.get('/foods/barcode/:code', async (c) => {
    const code = c.req.param('code');
    if (!/^\d{6,14}$/.test(code)) throw new HttpError(400, 'invalid_barcode', 'Barcodes are 6 to 14 digits');
    const locale = resolveUser(db, c.get('userId')).context.locale;
    let item: FoodItem | null;
    try {
      item = await lookupBarcode(code, locale, fetchImpl);
    } catch {
      throw new HttpError(502, 'food_db_unreachable', 'Open Food Facts is unreachable right now');
    }
    if (!item) throw notFound('Product');
    return c.json<FoodItem>(item);
  });

  /** Daily activity from the watch / phone health store. */
  app.put('/activity', validate('json', ActivityInputSchema), (c) => {
    const input = c.req.valid('json');
    const userId = c.get('userId');
    const values = {
      steps: input.steps,
      activeKcal: input.activeKcal,
      restingKcal: input.restingKcal,
      weightKg: input.weightKg,
      source: input.source,
      updatedAt: nowIso(),
    };
    const row = db
      .insert(activity)
      .values({ userId, localDate: input.localDate, ...values })
      .onConflictDoUpdate({ target: [activity.userId, activity.localDate], set: values })
      .returning()
      .get();
    // A fresh weight reading from a scale keeps targets accurate.
    if (input.weightKg) {
      upsertWeights(db, userId, { source: input.source, samples: [{ localDate: input.localDate, kg: input.weightKg, measuredAt: new Date().toISOString() }] });
    }
    return c.json<DayActivity>(toActivity(row));
  });

  /** Body-weight readings, typically the history from Apple Health / Health Connect. */
  app.put('/weights', validate('json', WeightInputSchema), (c) => {
    const written = upsertWeights(db, c.get('userId'), c.req.valid('json'));
    return c.json({ written });
  });

  app.get('/weights', validate('query', z.object({ days: z.coerce.number().int().min(1).max(730).default(90), to: LocalDateSchema.optional() })), (c) => {
    const { days, to = toLocalDate() } = c.req.valid('query');
    return c.json<WeightTrend>(weightTrend(db, c.get('userId'), to, days));
  });

  /** Advice for a craving: the AI's, streamed through `onText` when asked, else a kind fallback. */
  async function cravingAdvice(
    userId: string,
    craving: { at: string; localDate: string; what: string; intensity: number | null },
    onText?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<CravingOutput> {
    const resolved = resolveUser(db, userId, craving.localDate);
    const fallback = FALLBACK_TIPS[resolved.context.locale][Math.floor(Math.random() * 2)]!;
    if (!ai.enabled) return fallback;
    try {
      return await ai.cravingTip(
        {
          ...resolved.context,
          what: craving.what,
          intensity: craving.intensity,
          localTime: localTime(craving.at),
          activityToday: activityToday(db, userId, craving.localDate),
          life: lifeBrief(db, userId, resolved.row.profile ?? null, resolved.row.plan ?? null, craving.localDate),
        },
        onText,
        signal,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn('craving tip failed, using fallback', error);
      return fallback;
    }
  }

  const findCraving = (userId: string, id: string) =>
    db
      .select()
      .from(cravings)
      .where(and(eq(cravings.id, id), eq(cravings.userId, userId)))
      .get();

  /**
   * Saved the moment « J'ai une envie » is tapped. With `tip: 'stream'` it
   * answers at once and the advice comes from /cravings/:id/tip/stream; older
   * apps (`tip: 'inline'`, the default) wait for it here.
   */
  app.post('/cravings', validate('json', CravingInputSchema), async (c) => {
    const { tip: mode, ...input } = c.req.valid('json');
    const userId = c.get('userId');
    const advice = mode === 'inline' ? await cravingAdvice(userId, input) : null;
    const row = db
      .insert(cravings)
      .values({
        id: newId(),
        userId,
        at: input.at,
        localDate: input.localDate,
        what: input.what,
        intensity: input.intensity,
        outcome: 'pending',
        tip: advice?.tip ?? null,
        createdAt: nowIso(),
      })
      .returning()
      .get();
    return c.json<{ craving: Craving; alternative: string | null }>({ craving: toCraving(row), alternative: advice?.alternative ?? null }, 201);
  });

  /** What the sheet learns after saving: the chip, the intensity, then the outcome. */
  app.patch('/cravings/:id', validate('json', CravingPatchSchema), (c) => {
    const patch = Object.fromEntries(Object.entries(c.req.valid('json')).filter(([, value]) => value !== undefined));
    const row = db
      .update(cravings)
      .set(patch)
      .where(and(eq(cravings.id, c.req.param('id')), eq(cravings.userId, c.get('userId'))))
      .returning()
      .get();
    if (!row) throw notFound('Craving');
    return c.json<Craving>(toCraving(row));
  });

  /**
   * The advice for a saved craving, as Server-Sent Events: `delta` while it is
   * written (the tip, a line break, the alternative), then `done` with the
   * craving (its tip saved) and the alternative. `what` and `intensity` may
   * name a chip just tapped. A request the app drops (another chip, the sheet
   * closed) stops the AI and saves nothing.
   */
  app.post('/cravings/:id/tip/stream', validate('json', CravingTipRequestSchema), (c) => {
    const userId = c.get('userId');
    const row = findCraving(userId, c.req.param('id'));
    if (!row) throw notFound('Craving');
    const { what, intensity } = c.req.valid('json');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const dropped = new AbortController();
      stream.onAbort(() => dropped.abort());
      try {
        const advice = await cravingAdvice(
          userId,
          { at: row.at, localDate: row.localDate, what: what ?? row.what, intensity: intensity === undefined ? row.intensity : intensity },
          (delta) => void stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) }),
          dropped.signal,
        );
        if (stream.aborted) return;
        const saved = db.update(cravings).set({ tip: advice.tip }).where(eq(cravings.id, row.id)).returning().get();
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ craving: toCraving(saved), alternative: advice.alternative }) });
      } catch (error) {
        if (stream.aborted) return;
        const known = error instanceof HttpError ? error : null;
        if (!known) console.error(error);
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: known?.code ?? 'internal', message: known?.message ?? 'Something went wrong' }) });
      }
    });
  });

  const rangeQuery = z.object({
    days: z.coerce.number().int().min(1).max(90).default(7),
    to: LocalDateSchema.optional(),
  });
  /** Calories hidden on the device: the goal's headline nutrient is never kcal then. */
  const hideCaloriesQuery = z.object({ hideCalories: z.enum(['0', '1']).optional() });

  app.get('/insights', validate('query', rangeQuery.extend(hideCaloriesQuery.shape)), (c) => {
    const { days, to = toLocalDate(), hideCalories } = c.req.valid('query');
    return c.json<InsightsResponse>(computeInsights(db, c.get('userId'), addDays(to, -(days - 1)), to, { hideCalories: hideCalories === '1' }));
  });

  /** The saved « Bilan de la semaine », and whether it should be (re)written now. */
  app.get('/insights/review', validate('query', z.object({ to: LocalDateSchema.optional() }).extend(hideCaloriesQuery.shape)), (c) => {
    const { to = toLocalDate(), hideCalories } = c.req.valid('query');
    return c.json<WeeklyReviewState>(weeklyReviewState(db, ai, c.get('userId'), to, { hideCalories: hideCalories === '1' }));
  });

  /** AI-written review of a period, cached until the underlying data changes; the 7-day one is saved as the weekly review. */
  app.post('/insights/review', validate('json', rangeQuery), async (c) => {
    const { days, to = toLocalDate() } = c.req.valid('json');
    return c.json<WeeklyReview>(await generateReview(db, ai, c.get('userId'), to, days));
  });

  app.get('/photos/:id', async (c) => {
    const photo = await photos.readBytes(c.get('userId'), c.req.param('id'));
    if (!photo) throw notFound('Photo');
    c.header('Content-Type', photo.mime);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(new Uint8Array(photo.bytes));
  });

  return app;
}
