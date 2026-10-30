import type { CoachSuggestion, FoodItem, GoalPlan, MealInsight, Profile } from '@symbiose/shared';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  profile: text('profile', { mode: 'json' }).$type<Profile>(),
  plan: text('plan', { mode: 'json' }).$type<GoalPlan>(),
  createdAt: text('created_at').notNull(),
});

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

export const cravings = sqliteTable(
  'cravings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: text('at').notNull(),
    localDate: text('local_date').notNull(),
    what: text('what').notNull(),
    intensity: integer('intensity').notNull(),
    outcome: text('outcome', { enum: ['pending', 'resisted', 'gave_in'] }).notNull().default('pending'),
    tip: text('tip'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('cravings_user_date').on(t.userId, t.localDate)],
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
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('coach_user_created').on(t.userId, t.createdAt)],
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

export type UserRow = typeof users.$inferSelect;
export type MealRow = typeof meals.$inferSelect;
export type CravingRow = typeof cravings.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
export type CoachMessageRow = typeof coachMessages.$inferSelect;
