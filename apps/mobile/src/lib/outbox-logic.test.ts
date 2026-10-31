import { describe, expect, it } from 'vitest';

import { backoffDelay, findSentMeal, isNetworkStatus, isRetryableStatus, mayStillBeProcessing, nextToSend, scopeId, SETTLE_DELAY, timeline, uniqueEatenAt } from './outbox-logic';

const meal = (eatenAt: string, extra: Partial<{ localDate: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'; photoId: string | null }> = {}) => ({
  eatenAt,
  localDate: eatenAt.slice(0, 10),
  mealType: 'lunch' as const,
  photoId: null,
  ...extra,
});

describe('failure classification', () => {
  it('queues network failures and the proxy errors only', () => {
    for (const status of [0, 502, 503, 504]) expect(isNetworkStatus(status)).toBe(true);
    for (const status of [400, 401, 404, 413, 422, 424, 500]) expect(isNetworkStatus(status)).toBe(false);
  });

  it('keeps waiting on a timeout or a rate limit once queued', () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(424)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });

  it('knows when the server may still be working on the first request', () => {
    expect(mayStillBeProcessing(504)).toBe(true);
    expect(mayStillBeProcessing(502)).toBe(true);
    expect(mayStillBeProcessing(0)).toBe(false);
    expect(mayStillBeProcessing(503)).toBe(false);
  });
});

describe('backoffDelay', () => {
  const mid = () => 0.5; // no jitter

  it('grows, then caps at 10 minutes', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => backoffDelay(n, mid));
    expect(delays).toEqual([5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 600_000, 600_000]);
  });

  it('jitters within ±20 %', () => {
    expect(backoffDelay(4, () => 0)).toBe(48_000);
    expect(backoffDelay(4, () => 1)).toBe(72_000);
  });

  it('respects a minimum, e.g. after a gateway timeout', () => {
    expect(backoffDelay(1, mid, SETTLE_DELAY)).toBe(SETTLE_DELAY);
    expect(backoffDelay(6, mid, SETTLE_DELAY)).toBe(300_000);
  });

  it('does not wait before the first attempt', () => {
    expect(backoffDelay(0, mid)).toBe(0);
  });
});

describe('nextToSend', () => {
  const entries = [
    { id: 'c', createdAt: 30, error: null },
    { id: 'a', createdAt: 10, error: 'Refused' },
    { id: 'b', createdAt: 20, error: null },
    { id: 'd', createdAt: 5, error: null },
  ];

  it('sends the oldest capture first', () => {
    expect(nextToSend(entries, new Set())?.id).toBe('d');
  });

  it('skips captures still in their first attempt and those refused for good', () => {
    expect(nextToSend(entries, new Set(['d']))?.id).toBe('b');
    expect(nextToSend(entries, new Set(['d', 'b', 'c']))).toBeNull();
  });

  it('returns null on an empty queue', () => {
    expect(nextToSend([], new Set())).toBeNull();
  });
});

describe('findSentMeal', () => {
  const at = '2026-10-30T12:30:05+01:00';
  const text = { kind: 'create' as const, photo: false, eatenAt: at, localDate: '2026-10-30' };

  it('finds the meal a lost response created, by its exact time', () => {
    const meals = [meal('2026-10-30T08:10:00+01:00'), meal(at)];
    expect(findSentMeal(text, meals)).toBe(meals[1]);
  });

  it('ignores a meal one second apart, or on another day', () => {
    expect(findSentMeal(text, [meal('2026-10-30T12:30:06+01:00')])).toBeNull();
    expect(findSentMeal(text, [meal(at, { localDate: '2026-10-29' })])).toBeNull();
  });

  it('checks the meal type only when the capture set one', () => {
    expect(findSentMeal(text, [meal(at, { mealType: 'snack' })])).not.toBeNull();
    expect(findSentMeal({ ...text, mealType: 'dinner' }, [meal(at, { mealType: 'snack' })])).toBeNull();
    expect(findSentMeal({ ...text, mealType: 'snack' }, [meal(at, { mealType: 'snack' })])).not.toBeNull();
  });

  it('matches the kind of meal: photo or not, or the same shared photo for a copy', () => {
    expect(findSentMeal({ ...text, photo: true }, [meal(at)])).toBeNull();
    expect(findSentMeal({ ...text, photo: true }, [meal(at, { photoId: 'p1' })])).not.toBeNull();
    expect(findSentMeal(text, [meal(at, { photoId: 'p1' })])).toBeNull();
    const copy = { kind: 'duplicate' as const, photoId: 'p1', eatenAt: at, localDate: '2026-10-30' };
    expect(findSentMeal(copy, [meal(at, { photoId: 'p2' })])).toBeNull();
    expect(findSentMeal(copy, [meal(at, { photoId: 'p1' })])).not.toBeNull();
    expect(findSentMeal({ kind: 'barcode', eatenAt: at, localDate: '2026-10-30' }, [meal(at)])).not.toBeNull();
  });

  it('finds a capture that joined a meal as one of its courses, at its own time', () => {
    const later = '2026-10-30T12:52:00+01:00';
    const lunch = {
      ...meal(at, { photoId: 'p1' }),
      courses: [
        { id: 'c0', label: 'Entrée', eatenAt: at, photoId: 'p1', basedOn: null },
        { id: 'c1', label: 'Dessert', eatenAt: later, photoId: null, basedOn: null },
      ],
    };
    expect(findSentMeal({ ...text, eatenAt: later }, [lunch])).toBe(lunch);
    // The dessert had no photo: a photo capture at that time isn't it.
    expect(findSentMeal({ ...text, eatenAt: later, photo: true }, [lunch])).toBeNull();
    expect(findSentMeal({ ...text, eatenAt: '2026-10-30T12:53:00+01:00' }, [lunch])).toBeNull();
  });
});

describe('uniqueEatenAt', () => {
  it('keeps a free timestamp untouched', () => {
    expect(uniqueEatenAt('2026-10-30T12:30:00+01:00', ['2026-10-30T12:31:00+01:00'])).toBe('2026-10-30T12:30:00+01:00');
  });

  it('nudges a taken one by a second, within the same minute', () => {
    const taken = ['2026-10-29T14:05:00+01:00'];
    expect(uniqueEatenAt('2026-10-29T14:05:00+01:00', taken)).toBe('2026-10-29T14:05:01+01:00');
    expect(uniqueEatenAt('2026-10-29T14:05:00+01:00', [...taken, '2026-10-29T14:05:01+01:00'])).toBe('2026-10-29T14:05:02+01:00');
    expect(uniqueEatenAt('2026-10-29T14:05:59+01:00', ['2026-10-29T14:05:59+01:00'])).toBe('2026-10-29T14:05:58+01:00');
  });

  it('handles timestamps without seconds and keeps the offset', () => {
    expect(uniqueEatenAt('2026-10-29T14:05-04:00', ['2026-10-29T14:05-04:00'])).toBe('2026-10-29T14:05:01-04:00');
  });

  it('never leaves the day', () => {
    const taken = Array.from({ length: 60 }, (_, s) => `2026-10-29T23:59:${String(s).padStart(2, '0')}+01:00`);
    const result = uniqueEatenAt('2026-10-29T23:59:59+01:00', taken);
    expect(result.startsWith('2026-10-29T23:58:')).toBe(true);
  });
});

describe('timeline', () => {
  it('interleaves waiting captures with meals, newest first', () => {
    const rows = timeline(
      [{ eatenAt: '2026-10-30T08:00:00+01:00', id: 'breakfast' }, { eatenAt: '2026-10-30T19:30:00+01:00', id: 'dinner' }],
      [{ eatenAt: '2026-10-30T12:30:00+01:00', id: 'lunch' }],
    );
    expect(rows.map((r) => (r.type === 'meal' ? r.meal.id : r.entry.id))).toEqual(['dinner', 'lunch', 'breakfast']);
    expect(rows[1]!.type).toBe('queued');
  });
});

describe('scopeId', () => {
  it('separates servers and accounts, with a storage-safe key', () => {
    const a = scopeId('https://a.example', 'u1');
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(scopeId('https://a.example', 'u1')).toBe(a);
    expect(scopeId('https://a.example', 'u2')).not.toBe(a);
    expect(scopeId('https://b.example', 'u1')).not.toBe(a);
  });
});
