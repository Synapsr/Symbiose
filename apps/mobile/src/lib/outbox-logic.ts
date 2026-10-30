/**
 * The offline queue's rules, kept free of React Native so they can be unit
 * tested on their own (`pnpm --filter @symbiose/mobile test`).
 */
import type { CreateMealInput, Meal, MealType } from '@symbiose/shared';

/** A meal captured without network, waiting to be sent. Persisted as is; a photo lives in its own file. */
export type OutboxEntry = {
  id: string;
  /** Capture order: requests go out one at a time, oldest first. */
  createdAt: number;
  /** The original moment of the meal, never re-stamped on retry. */
  eatenAt: string;
  localDate: string;
  mealType?: MealType;
  /** What the waiting card shows. */
  label: string;
  emoji: string | null;
  /** Set when the server refused it for good: shown on the card until retried or deleted. */
  error: string | null;
} & (
  | { kind: 'create'; input: Pick<CreateMealInput, 'text' | 'items' | 'title'>; photo: boolean }
  /** "Same as yesterday": `photoId` is the source meal's photo, which the copy shares. */
  | { kind: 'duplicate'; sourceId: string; photoId: string | null }
  /** Scanned offline: the product is looked up, then logged at its standard portion. */
  | { kind: 'barcode'; code: string }
);

// ---------------------------------------------------------------- Failures

/** Offline, timeout, DNS (all status 0) and the proxy's 502/503/504: keep the capture and try again later. */
export function isNetworkStatus(status: number): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

/** Once queued, a capture also waits out a request timeout or a rate limit instead of giving up. */
export function isRetryableStatus(status: number): boolean {
  return isNetworkStatus(status) || status === 408 || status === 429;
}

/** The gateway gave up before the server did: the server may still be finishing the first request. */
export function mayStillBeProcessing(status: number): boolean {
  return status === 502 || status === 504;
}

// ---------------------------------------------------------------- Backoff

const STEPS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

/** Long enough for a slow analysis that outlived the gateway to land before we look for it. */
export const SETTLE_DELAY = 90_000;

/**
 * Wait before the next attempt after `failures` failed ones in a row: 5 s, 15 s,
 * 30 s, 1 min, 2 min, 5 min, then every 10 min, ±20 % so devices don't sync up.
 * Connectivity coming back or the app returning to the foreground skips the wait.
 */
export function backoffDelay(failures: number, random: () => number = Math.random, minimum = 0): number {
  if (failures <= 0) return minimum;
  const base = STEPS[Math.min(failures, STEPS.length) - 1]!;
  const jitter = base * 0.2 * (random() * 2 - 1);
  return Math.max(minimum, Math.round(base + jitter));
}

// ---------------------------------------------------------------- Order

/** The next capture to send: the oldest one that isn't on hold (still in its first attempt, or refused for good). */
export function nextToSend<T extends Pick<OutboxEntry, 'id' | 'createdAt' | 'error'>>(entries: readonly T[], onHold: ReadonlySet<string>): T | null {
  let next: T | null = null;
  for (const entry of entries) {
    if (entry.error || onHold.has(entry.id)) continue;
    if (!next || entry.createdAt < next.createdAt) next = entry;
  }
  return next;
}

// ---------------------------------------------------------------- Duplicates

type SentCandidate = Pick<Meal, 'eatenAt' | 'localDate' | 'mealType' | 'photoId'>;
type DedupeKey = Pick<OutboxEntry, 'eatenAt' | 'localDate' | 'mealType'> &
  ({ kind: 'create'; photo: boolean } | { kind: 'duplicate'; photoId: string | null } | { kind: 'barcode' });

/**
 * The meal an earlier attempt already created, if its answer got lost on the
 * way back: same day, same exact `eatenAt` (unique per capture, see
 * `uniqueEatenAt`), same type when the capture set one, and the same kind of
 * meal (a photo meal has a photo, a copy shares its source's photo).
 */
export function findSentMeal<M extends SentCandidate>(entry: DedupeKey, meals: readonly M[]): M | null {
  return (
    meals.find((meal) => {
      if (meal.localDate !== entry.localDate || meal.eatenAt !== entry.eatenAt) return false;
      if (entry.mealType && meal.mealType !== entry.mealType) return false;
      if (entry.kind === 'create') return Boolean(meal.photoId) === entry.photo;
      if (entry.kind === 'duplicate') return meal.photoId === entry.photoId;
      return meal.photoId === null;
    }) ?? null
  );
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** Moves a local timestamp by whole seconds, keeping its offset. */
function shiftSeconds(eatenAt: string, seconds: number): string | null {
  const m = STAMP.exec(eatenAt);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', offset] = m;
  // Wall-clock arithmetic: the offset is kept as is, so treat the local time as UTC.
  const t = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) + seconds * 1000);
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return `${date}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}${offset}`;
}

/**
 * Makes a capture's `eatenAt` unique among the meals and captures we know of,
 * by nudging it a few seconds (same minute when possible, never another day).
 * That's what lets the duplicate check match on time alone: two meals logged
 * on a past day within the same minute would otherwise share a timestamp.
 */
export function uniqueEatenAt(eatenAt: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(eatenAt)) return eatenAt;
  const day = eatenAt.slice(0, 10);
  const minute = eatenAt.slice(0, 16);
  let sameDay: string | null = null;
  for (let i = 1; i <= 120; i++) {
    for (const delta of [i, -i]) {
      const candidate = shiftSeconds(eatenAt, delta);
      if (!candidate || used.has(candidate) || candidate.slice(0, 10) !== day) continue;
      if (candidate.slice(0, 16) === minute) return candidate;
      sameDay ??= candidate;
    }
  }
  return sameDay ?? eatenAt;
}

// ---------------------------------------------------------------- Timeline

export type TimelineRow<M, Q> = { type: 'meal'; at: number; meal: M } | { type: 'queued'; at: number; entry: Q };

/** Meals and waiting captures, newest first, each at its own time. */
export function timeline<M extends { eatenAt: string }, Q extends { eatenAt: string }>(meals: readonly M[], queued: readonly Q[]): TimelineRow<M, Q>[] {
  const rows: TimelineRow<M, Q>[] = [
    ...meals.map((meal) => ({ type: 'meal' as const, at: Date.parse(meal.eatenAt), meal })),
    ...queued.map((entry) => ({ type: 'queued' as const, at: Date.parse(entry.eatenAt), entry })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

/** A short, storage-key-safe id for a server + account pair: each keeps its own queue. */
export function scopeId(serverUrl: string, userId: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${serverUrl}|${userId}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
