import type { SignupMode } from './schemas';

/**
 * The admin's glance at the whole server: what the AI costs, how much the
 * instance is used, and its health. Counts and totals only: never an email,
 * a name, a meal, a note, or anything about one person.
 */

export const ADMIN_PERIODS = [7, 30, 90] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];

/** How a meal was logged, as far as the server can tell. */
export const MEAL_SOURCES = ['photo', 'text', 'barcode', 'library', 'manual', 'relog'] as const;
export type MealSource = (typeof MEAL_SOURCES)[number];

/** Tokens and cost of a set of AI calls; `costUsd` is null when no call of the set has a known price. */
export interface AiTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

/**
 * Someone waiting to get in (sign-up on request): only what an admin needs to
 * decide, the one place an admin sees anything about a person.
 */
export interface AdminRequest {
  id: string;
  email: string;
  /** The first name they gave, empty when none. */
  name: string;
  requestedAt: string;
}

export interface AdminOverview {
  generatedAt: string;
  days: AdminPeriod;
  /** The period's first and last days, in UTC (`YYYY-MM-DD`). */
  from: string;
  to: string;
  ai: AiTotals & {
    errors: number;
    /** 0..1 */
    errorRate: number;
    /** Share of the prompt read from the cache (0..1); null without any call. */
    cacheHitShare: number | null;
    /** Answered calls only. */
    latencyMs: { p50: number | null; p95: number | null };
    /** Calls whose model has no known price (left out of the cost). */
    unpricedCalls: number;
    /** Every day of the period, oldest first. */
    daily: (AiTotals & { date: string })[];
    /** Most calls first. */
    byFeature: (AiTotals & { feature: string })[];
    byModel: (AiTotals & { provider: string; model: string })[];
    /** The five most frequent, with how many times each. */
    topErrors: { code: string; count: number }[];
  };
  people: {
    accounts: number;
    /** Accounts waiting for an admin (sign-up on request), included in `accounts`. */
    pending: number;
    /** Distinct accounts that recorded anything over the last 24 hours, 7 days and 30 days. */
    active: { day: number; week: number; month: number };
    /** Accounts created over the last 7 and 30 days. */
    new: { week: number; month: number };
  };
  usage: {
    meals: number;
    mealSources: Record<MealSource, number>;
    cravings: number;
    notes: number;
    /** Messages written to the coach (its replies are AI calls). */
    coachMessages: number;
    /** Every day of the period, oldest first. */
    daily: { date: string; meals: number; cravings: number; notes: number; coachMessages: number }[];
  };
  system: {
    version: string;
    uptimeSeconds: number;
    dbBytes: number;
    photos: number;
    photosBytes: number;
    backups: { count: number; lastAt: string | null };
    ai: { enabled: boolean; provider: string | null; model: string | null };
    signup: SignupMode;
  };
}
