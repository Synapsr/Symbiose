import type { CoachMealAction, CoachMessageKind, CoachSuggestion, FoodItem, GoalPlan, JournalData, JournalKind, MealCourse, MealInsight, Profile, VitalMetric, WorkoutIntensity, WorkoutType } from '@symbiose/shared';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  /** Legacy, set on the very first account and read nowhere: admins are the emails listed in ADMIN_EMAILS. */
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  /** Sign-up on request: waiting for an admin. Accounts from before (and the first one) are approved. */
  pending: integer('pending', { mode: 'boolean' }).notNull().default(false),
  profile: text('profile', { mode: 'json' }).$type<Profile>(),
  plan: text('plan', { mode: 'json' }).$type<GoalPlan>(),
  createdAt: text('created_at').notNull(),
});

/** A course as stored: what the app sees, and the words it was logged with (the AI reads them again on a correction). */
export interface MealCourseRow extends MealCourse {
  text: string | null;
}

export const meals = sqliteTable(
  'meals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eatenAt: text('eaten_at').notNull(),
    localDate: text('local_date').notNull(),
    mealType: text('meal_type', { enum: ['breakfast', 'lunch', 'dinner', 'snack'] }).notNull(),
    title: text('title').notNull(),
    items: text('items', { mode: 'json' }).$type<FoodItem[]>().notNull(),
    photoId: text('photo_id'),
    inputText: text('input_text'),
    note: text('note'),
    insight: text('insight', { mode: 'json' }).$type<MealInsight>(),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    /**
     * Its courses once it has more than one (or one based on a past meal);
     * null for a meal of one course, whose photo and words are the columns
     * above. `eaten_at`, `photo_id` and `input_text` follow the first course.
     */
    courses: text('courses', { mode: 'json' }).$type<MealCourseRow[]>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('meals_user_date').on(t.userId, t.localDate)],
);

export const photos = sqliteTable('photos', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
});

export const activity = sqliteTable(
  'activity',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    steps: integer('steps'),
    activeKcal: real('active_kcal'),
    restingKcal: real('resting_kcal'),
    weightKg: real('weight_kg'),
    source: text('source').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

/** One body-weight reading per day (the most recent one of that day). */
export const weights = sqliteTable(
  'weights',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    kg: real('kg').notNull(),
    measuredAt: text('measured_at').notNull(),
    source: text('source').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

/** Blood pressure readings, stored whatever the opt-in; only shown when tracking is on. */
export const bloodPressure = sqliteTable(
  'blood_pressure',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    measuredAt: text('measured_at').notNull(),
    localDate: text('local_date').notNull(),
    systolic: integer('systolic').notNull(),
    diastolic: integer('diastolic').notNull(),
    pulse: integer('pulse'),
    source: text('source', { enum: ['healthkit', 'health_connect', 'manual'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('blood_pressure_user_date').on(t.userId, t.localDate),
    // SQLite treats NULLs as distinct: readings without an external id never collide.
    uniqueIndex('blood_pressure_user_external').on(t.userId, t.externalId),
  ],
);

/** Workout sessions, imported from the health store or added by hand. */
export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    type: text('type').$type<WorkoutType>().notNull(),
    startedAt: text('started_at').notNull(),
    localDate: text('local_date').notNull(),
    durationMin: real('duration_min').notNull(),
    intensity: text('intensity').$type<WorkoutIntensity>(),
    activeKcal: real('active_kcal'),
    distanceKm: real('distance_km'),
    avgHeartRate: real('avg_heart_rate'),
    source: text('source', { enum: ['healthkit', 'health_connect', 'manual'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('workouts_user_date').on(t.userId, t.localDate),
    // SQLite treats NULLs as distinct: manual entries without an external id never collide.
    uniqueIndex('workouts_user_external').on(t.userId, t.externalId),
  ],
);

/** One night per wake-up day, read from the health store (opt-in, stored whatever the switch). */
export const sleepNights = sqliteTable(
  'sleep_nights',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    bedtime: text('bedtime').notNull(),
    wakeTime: text('wake_time').notNull(),
    asleepMin: integer('asleep_min').notNull(),
    inBedMin: integer('in_bed_min'),
    source: text('source', { enum: ['healthkit', 'health_connect'] }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

/** Drinks, logged here or imported from the health store. */
export const waterLogs = sqliteTable(
  'water_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    at: text('at').notNull(),
    localDate: text('local_date').notNull(),
    ml: integer('ml').notNull(),
    source: text('source', { enum: ['healthkit', 'health_connect', 'manual'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('water_logs_user_date').on(t.userId, t.localDate),
    // SQLite treats NULLs as distinct: glasses logged here never collide.
    uniqueIndex('water_logs_user_external').on(t.userId, t.externalId),
  ],
);

/** One mood check-in per day; checking in again replaces it. */
export const moods = sqliteTable(
  'moods',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    at: text('at').notNull(),
    mood: integer('mood').notNull(),
    note: text('note'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

export const cravings = sqliteTable(
  'cravings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: text('at').notNull(),
    localDate: text('local_date').notNull(),
    /** Empty when not said. */
    what: text('what').notNull(),
    /** 1–3, null when not said. */
    intensity: integer('intensity'),
    outcome: text('outcome', { enum: ['pending', 'resisted', 'gave_in'] }).notNull().default('pending'),
    tip: text('tip'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('cravings_user_date').on(t.userId, t.localDate)],
);

/**
 * The health journal (the notes of « Historique »): short notes the person and their coach read.
 * Kind-specific fields (Bristol type, ease, feeling) share one JSON column: they
 * are sparse, never filtered on in SQL, validated by zod, and new ones need no migration.
 */
export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: text('at').notNull(),
    localDate: text('local_date').notNull(),
    kind: text('kind').$type<JournalKind>().notNull(),
    text: text('text').notNull().default(''),
    data: text('data', { mode: 'json' }).$type<JournalData>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('journal_entries_user_date').on(t.userId, t.localDate)],
);

export const coachMessages = sqliteTable(
  'coach_messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    suggestion: text('suggestion', { mode: 'json' }).$type<CoachSuggestion>(),
    /** Null on user messages and on replies saved before meal actions existed. */
    mealActions: text('meal_actions', { mode: 'json' }).$type<CoachMealAction[]>(),
    /** Messages the coach writes on its own (the morning check-in); null on the conversation's turns. */
    kind: text('kind').$type<CoachMessageKind>(),
    /** The day a proactive message is about. */
    localDate: text('local_date'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('coach_user_created').on(t.userId, t.createdAt),
    // One proactive message of a kind per day; NULLs never collide, so the conversation's turns are free.
    uniqueIndex('coach_user_kind_date').on(t.userId, t.kind, t.localDate),
  ],
);

/**
 * Nightly vitals from the watch (opt-in, with the morning check-in): one value
 * per day and metric. HRV is stored as the store measures it (SDNN or RMSSD),
 * each its own metric, never mixed.
 */
export const vitals = sqliteTable(
  'vitals',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localDate: text('local_date').notNull(),
    metric: text('metric').$type<VitalMetric>().notNull(),
    value: real('value').notNull(),
    samples: integer('samples').notNull().default(1),
    source: text('source', { enum: ['healthkit', 'health_connect'] }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate, t.metric] })],
);

/** Cached AI outputs (weekly reviews) keyed by a hash of their inputs. */
export const aiCache = sqliteTable('ai_cache', {
  key: text('key').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  value: text('value', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * One row per call to the AI provider, for the admin's global view: what it
 * cost and how it went. Never who asked or what was said. Kept 13 months.
 */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: integer('id').primaryKey(),
    at: text('at').notNull(),
    feature: text('feature').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    /** The failure's code (`ai_rate_limited`…), never its message. */
    error: text('error'),
  },
  (t) => [index('ai_usage_at').on(t.at)],
);

export type UserRow = typeof users.$inferSelect;
export type MealRow = typeof meals.$inferSelect;
export type CravingRow = typeof cravings.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
export type WeightRow = typeof weights.$inferSelect;
export type WorkoutRow = typeof workouts.$inferSelect;
export type BloodPressureRow = typeof bloodPressure.$inferSelect;
export type CoachMessageRow = typeof coachMessages.$inferSelect;
export type SleepNightRow = typeof sleepNights.$inferSelect;
export type WaterLogRow = typeof waterLogs.$inferSelect;
export type MoodRow = typeof moods.$inferSelect;
export type JournalEntryRow = typeof journalEntries.$inferSelect;
export type VitalRow = typeof vitals.$inferSelect;
