import { lt } from 'drizzle-orm';

import type { AiUsage, AiUsageListener } from '../ai/types';
import type { Db } from '../db';
import { aiUsage } from '../db/schema';
import { nowIso } from '../http';

/** Rows older than this are dropped at startup: a year to compare with, and a bit more. */
export const AI_USAGE_MONTHS = 13;

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const label = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : 'unknown');
/** Error codes only (`ai_rate_limited`): anything that looks like a message is dropped. */
const errorCode = (value: unknown) => (typeof value === 'string' && /^[\w.:-]{1,64}$/.test(value) ? value : 'ai_error');

/** What one AI call leaves in the database: its numbers, never who asked or what was said. */
export function usageRow(usage: AiUsage, at: string): typeof aiUsage.$inferInsert {
  return {
    at,
    feature: label(usage.feature, 32),
    provider: label(usage.provider, 40),
    model: label(usage.model, 100),
    inputTokens: count(usage.inputTokens),
    outputTokens: count(usage.outputTokens),
    cacheReadTokens: count(usage.cacheReadTokens),
    cacheWriteTokens: count(usage.cacheWriteTokens),
    durationMs: count(usage.durationMs),
    ok: usage.ok === true,
    error: usage.ok === true ? null : errorCode(usage.error),
  };
}

/** Writes each AI call as one row; a failed write is logged, never thrown into the answer. */
export function createUsageRecorder(db: Db): AiUsageListener {
  return (usage) => {
    try {
      db.insert(aiUsage).values(usageRow(usage, nowIso())).run();
    } catch (error) {
      console.warn(`AI usage not recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

/** Drops the rows older than `AI_USAGE_MONTHS`; returns how many went. */
export function pruneAiUsage(db: Db, now = new Date()): number {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - AI_USAGE_MONTHS);
  return db.delete(aiUsage).where(lt(aiUsage.at, cutoff.toISOString())).run().changes;
}
