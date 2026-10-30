import { createHash, randomUUID } from 'node:crypto';

import {
  ActivityInputSchema,
  addDays,
  CravingInputSchema,
  CravingOutcomeSchema,
  LocalDateSchema,
  localTime,
  toLocalDate,
  type Craving,
  type DayActivity,
  type DaySummary,
  type FoodItem,
  type InsightsResponse,
  type LibraryResponse,
  type Review,
  type WeightTrend,
  WeightInputSchema,
} from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { activity, aiCache, cravings } from '../db/schema';
import { HttpError, notFound } from '../errors';
import { nowIso, validate, type Deps } from '../http';
import { computeInsights, daySummary, library, toActivity, toCraving } from '../services/day';
import { lookupBarcode } from '../services/openfoodfacts';
import { resolveUser } from '../services/users';
import { bloodPressureBrief } from '../services/blood-pressure';
import { energyExpenditureBrief } from '../services/expenditure';
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

export function trackingRoutes({ db, ai, photos, config, fetch: fetchImpl }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));

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

  app.post('/cravings', validate('json', CravingInputSchema), async (c) => {
    const input = c.req.valid('json');
    const userId = c.get('userId');
    const resolved = resolveUser(db, userId, input.localDate);
    let advice = FALLBACK_TIPS[resolved.context.locale][Math.floor(Math.random() * 2)]!;
    if (ai.enabled) {
      try {
        advice = await ai.cravingTip({
          ...resolved.context,
          what: input.what,
          intensity: input.intensity,
          localTime: localTime(input.at),
          activityToday: activityToday(db, userId, input.localDate),
        });
      } catch (error) {
        console.warn('craving tip failed, using fallback', error);
      }
    }
    const row = db
      .insert(cravings)
      .values({
        id: randomUUID(),
        userId,
        at: input.at,
        localDate: input.localDate,
        what: input.what,
        intensity: input.intensity,
        outcome: 'pending',
        tip: advice.tip,
        createdAt: nowIso(),
      })
      .returning()
      .get();
    return c.json<{ craving: Craving; alternative: string }>({ craving: toCraving(row), alternative: advice.alternative }, 201);
  });

  app.patch('/cravings/:id', validate('json', z.object({ outcome: CravingOutcomeSchema })), (c) => {
    const row = db
      .update(cravings)
      .set({ outcome: c.req.valid('json').outcome })
      .where(and(eq(cravings.id, c.req.param('id')), eq(cravings.userId, c.get('userId'))))
      .returning()
      .get();
    if (!row) throw notFound('Craving');
    return c.json<Craving>(toCraving(row));
  });

  const rangeQuery = z.object({
    days: z.coerce.number().int().min(1).max(90).default(7),
    to: LocalDateSchema.optional(),
  });

  app.get('/insights', validate('query', rangeQuery), (c) => {
    const { days, to = toLocalDate() } = c.req.valid('query');
    return c.json<InsightsResponse>(computeInsights(db, c.get('userId'), addDays(to, -(days - 1)), to));
  });

  /** AI-written review of a period, cached until the underlying data changes. */
  app.post('/insights/review', validate('json', rangeQuery), async (c) => {
    const { days, to = toLocalDate() } = c.req.valid('json');
    const userId = c.get('userId');
    const insights = computeInsights(db, userId, addDays(to, -(days - 1)), to);
    if (insights.loggedDays === 0) throw new HttpError(409, 'not_enough_data', 'Log a few meals first');
    const resolved = resolveUser(db, userId, to);
    const bloodPressure = bloodPressureBrief(db, userId, resolved.row.profile ?? null, to);
    const key = createHash('sha256')
      .update(JSON.stringify({ userId, insights, bloodPressure, plan: resolved.row.plan, model: ai.model }))
      .digest('hex');
    const cached = db.select().from(aiCache).where(eq(aiCache.key, key)).get();
    if (cached) return c.json<Review>(cached.value as Review);
    const review = await ai.review({ ...resolved.context, insights, bloodPressure, energyExpenditure: energyExpenditureBrief(insights.adaptiveEnergy) });
    db.insert(aiCache).values({ key, userId, value: review, createdAt: nowIso() }).onConflictDoNothing().run();
    return c.json<Review>(review);
  });

  app.get('/photos/:id', async (c) => {
    const photo = await photos.read(c.get('userId'), c.req.param('id'));
    if (!photo) throw notFound('Photo');
    c.header('Content-Type', photo.mime);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(new Uint8Array(photo.buffer));
  });

  return app;
}
