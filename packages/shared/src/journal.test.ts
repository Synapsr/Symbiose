import { describe, expect, it } from 'vitest';

import { addDays } from './dates';
import {
  CONSISTENCY_BRISTOL,
  consistencyOf,
  journalDataFor,
  JournalEntryInputSchema,
  JournalEntryPatchSchema,
  JOURNAL_KINDS,
  transitSummary,
  type JournalData,
  type JournalKind,
} from './journal';

const to = '2026-10-30';
const entry = (daysAgo: number, kind: JournalKind = 'transit', data: JournalData = {}) => ({ kind, localDate: addDays(to, -daysAgo), data });

describe('health journal entries', () => {
  it('maps the plain words to Bristol types and back', () => {
    for (const [word, bristol] of Object.entries(CONSISTENCY_BRISTOL)) expect(consistencyOf(bristol)).toBe(word);
    expect([1, 2, 3, 4, 5, 6, 7].map(consistencyOf)).toEqual(['hard', 'hard', 'normal', 'normal', 'soft', 'soft', 'liquid']);
  });

  it('offers every kind but the older « Ressenti », transit never first', () => {
    expect(JOURNAL_KINDS).toEqual(['symptom', 'medication', 'transit', 'other']);
  });

  it('keeps only the fields that belong to the kind', () => {
    const data = { bristol: 4, ease: 'easy', feeling: 2 } as const;
    expect(journalDataFor('transit', data)).toEqual({ bristol: 4, ease: 'easy' });
    expect(journalDataFor('feeling', data)).toEqual({ feeling: 2 });
    expect(journalDataFor('symptom', data)).toEqual({});
  });

  it('lets a transit stand alone but asks other notes for words or a face', () => {
    const base = { at: '2026-10-30T08:10:00+01:00', localDate: to };
    expect(JournalEntryInputSchema.safeParse({ ...base, kind: 'transit' }).success).toBe(true);
    expect(JournalEntryInputSchema.safeParse({ ...base, kind: 'feeling', data: { feeling: 4 } }).success).toBe(true);
    expect(JournalEntryInputSchema.safeParse({ ...base, kind: 'feeling' }).success).toBe(false);
    expect(JournalEntryInputSchema.safeParse({ ...base, text: '   ' }).success).toBe(false);
    // A face on a symptom doesn't count: it isn't kept.
    expect(JournalEntryInputSchema.safeParse({ ...base, kind: 'symptom', data: { feeling: 2 } }).success).toBe(false);
    const parsed = JournalEntryInputSchema.parse({ ...base, text: '  Mal de tête  ' });
    expect(parsed).toMatchObject({ kind: 'other', text: 'Mal de tête', data: {} });
  });

  it('moves the time and its day together', () => {
    expect(JournalEntryPatchSchema.safeParse({ text: 'ok' }).success).toBe(true);
    expect(JournalEntryPatchSchema.safeParse({ at: '2026-10-30T08:10:00+01:00' }).success).toBe(false);
    expect(JournalEntryPatchSchema.safeParse({ at: '2026-10-30T08:10:00+01:00', localDate: to }).success).toBe(true);
  });
});

describe('transit frequency', () => {
  it('is null until a transit is noted', () => {
    expect(transitSummary([entry(0, 'feeling')], to)).toBeNull();
  });

  it('counts per day over the window, with gaps and how it went', () => {
    const entries = [
      entry(13, 'transit', { bristol: 4, ease: 'easy' }),
      entry(12, 'transit', { bristol: 2, ease: 'difficult' }),
      entry(12),
      entry(8, 'transit', { bristol: 1, ease: 'painful' }),
      entry(3, 'transit', { bristol: 6 }),
      entry(1),
      entry(1, 'feeling', { feeling: 4 }),
    ];
    const summary = transitSummary(entries, to)!;
    expect(summary).toMatchObject({
      days: 14,
      total: 6,
      perDay: 0.4,
      daysSinceLast: 1,
      // Days 7 to 4 ago.
      longestGap: 4,
      consistency: { hard: 2, normal: 1, soft: 1, liquid: 0 },
      difficult: 2,
      painful: 1,
    });
    expect(summary.counts).toHaveLength(14);
    expect(summary.counts[0]).toEqual({ date: addDays(to, -13), count: 1 });
    expect(summary.counts[1]!.count).toBe(2);
    expect(summary.counts.at(-1)).toEqual({ date: to, count: 0 });
  });

  it('starts counting when tracking started, not 14 days ago', () => {
    const summary = transitSummary([entry(2), entry(1), entry(0), entry(0)], to)!;
    expect(summary).toMatchObject({ days: 3, total: 4, perDay: 1.3, daysSinceLast: 0, longestGap: 0 });
    expect(summary.counts.filter((c) => c.count === null)).toHaveLength(11);
  });

  it('remembers older tracking: a quiet start of the window is a gap', () => {
    const summary = transitSummary([entry(20), entry(2)], to)!;
    expect(summary).toMatchObject({ days: 14, total: 1, longestGap: 11, daysSinceLast: 2 });
    expect(transitSummary([entry(2)], to, 14, addDays(to, -30))).toMatchObject({ days: 14, longestGap: 11 });
  });

  it('ignores what comes after the window', () => {
    expect(transitSummary([entry(-1)], to)).toBeNull();
  });
});
