import { z } from 'zod';

import { addDays, dateRange, daysBetween } from './dates';
import { LocalDateSchema, LocalDateTimeSchema } from './schemas';

// ---------------------------------------------------------------- Health journal (the notes of « Historique »)

/**
 * What a note is about. "other" is the free note, the default.
 * "feeling" is the older « Ressenti »: mood now has one home, the day's mood
 * check-in (see `life.ts`). Notes of that kind are kept and still read, as the
 * day's mood when it has no check-in; older app versions may still write them.
 */
export const JournalKindSchema = z.enum(['feeling', 'symptom', 'medication', 'transit', 'other']);
export type JournalKind = z.infer<typeof JournalKindSchema>;
/** The kinds a new note can take, in the order the app shows them (transit never first). */
export const JOURNAL_KINDS = ['symptom', 'medication', 'transit', 'other'] as const satisfies readonly JournalKind[];
export type NoteKind = (typeof JOURNAL_KINDS)[number];

/** A simplified Bristol scale in plain words; the Bristol type (1–7) is what gets stored. */
export const StoolConsistencySchema = z.enum(['hard', 'normal', 'soft', 'liquid']);
export type StoolConsistency = z.infer<typeof StoolConsistencySchema>;
export const STOOL_CONSISTENCIES = StoolConsistencySchema.options;

/** Each word stands for the upper end of its Bristol range: 1–2, 3–4, 5–6, 7. */
export const CONSISTENCY_BRISTOL: Record<StoolConsistency, number> = { hard: 2, normal: 4, soft: 6, liquid: 7 };

export function consistencyOf(bristol: number): StoolConsistency {
  if (bristol <= 2) return 'hard';
  if (bristol <= 4) return 'normal';
  if (bristol <= 6) return 'soft';
  return 'liquid';
}

export const TransitEaseSchema = z.enum(['easy', 'difficult', 'painful']);
export type TransitEase = z.infer<typeof TransitEaseSchema>;
export const TRANSIT_EASES = TransitEaseSchema.options;

/** Kind-specific fields, all optional: a note is never more than a few taps. */
export const JournalDataSchema = z.object({
  /** transit: Bristol stool type, 1 (hard lumps) to 7 (liquid). */
  bristol: z.number().int().min(1).max(7).optional(),
  /** transit: how it went. */
  ease: TransitEaseSchema.optional(),
  /** feeling (older notes): 1 (very low) to 5 (very good). */
  feeling: z.number().int().min(1).max(5).optional(),
});
export type JournalData = z.infer<typeof JournalDataSchema>;

const KIND_FIELDS: Record<JournalKind, readonly (keyof JournalData)[]> = {
  transit: ['bristol', 'ease'],
  feeling: ['feeling'],
  symptom: [],
  medication: [],
  other: [],
};

/** Keeps the fields that belong to the kind: a note moved from transit to feeling drops its Bristol type. */
export function journalDataFor(kind: JournalKind, data: JournalData): JournalData {
  return Object.fromEntries(KIND_FIELDS[kind].flatMap((field) => (data[field] === undefined ? [] : [[field, data[field]]])));
}

/** A transit stands on its own (how often is the point); any other note needs words, or a face for a feeling. */
export function isMeaningfulEntry(entry: { kind: JournalKind; text: string; data: JournalData }): boolean {
  if (entry.kind === 'transit') return true;
  if (entry.text.trim()) return true;
  return entry.kind === 'feeling' && entry.data.feeling !== undefined;
}

export const JOURNAL_TEXT_MAX = 2000;

const journalFields = {
  /** Device-local time of what is noted (now by default, earlier when told). */
  at: LocalDateTimeSchema,
  localDate: LocalDateSchema,
  kind: JournalKindSchema,
  text: z.string().trim().max(JOURNAL_TEXT_MAX),
  data: JournalDataSchema,
};

export const JournalEntryInputSchema = z
  .object({ ...journalFields, kind: journalFields.kind.default('other'), text: journalFields.text.default(''), data: journalFields.data.default({}) })
  .refine((entry) => isMeaningfulEntry({ ...entry, data: journalDataFor(entry.kind, entry.data) }), { message: 'Write a few words', path: ['text'] });
export type JournalEntryInput = z.input<typeof JournalEntryInputSchema>;

/** Any subset of the fields; the time and its day move together. */
export const JournalEntryPatchSchema = z
  .object(journalFields)
  .partial()
  .refine((patch) => (patch.at === undefined) === (patch.localDate === undefined), { message: '`at` and `localDate` go together', path: ['localDate'] });
export type JournalEntryPatch = z.input<typeof JournalEntryPatchSchema>;

export interface JournalEntry {
  id: string;
  at: string;
  localDate: string;
  kind: JournalKind;
  text: string;
  data: JournalData;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- Transit frequency

/** The window the app and the coach look at. */
export const TRANSIT_WINDOW_DAYS = 14;

export interface TransitSummary {
  /** Last day of the window. */
  to: string;
  /** Days counted: the window, or fewer when tracking started inside it. */
  days: number;
  total: number;
  /** Per day over `days`, one decimal. */
  perDay: number;
  /** Per day of the whole window, oldest first; null before tracking started. */
  counts: { date: string; count: number | null }[];
  /** Days since the last one (0 = today); null when none in the window. */
  daysSinceLast: number | null;
  /** Longest run of days without one, since tracking started. */
  longestGap: number;
  consistency: Record<StoolConsistency, number>;
  /** How many went with difficulty or pain. */
  difficult: number;
  painful: number;
}

type TransitLike = Pick<JournalEntry, 'kind' | 'localDate' | 'data'>;

/**
 * Bowel movements over the `days` ending on `to`. Counting starts at the first
 * transit ever noted (from `entries`, or `trackedSince` when known), so someone
 * who started three days ago reads "per day over 3 days", not over 14.
 * Null when nothing is tracked yet.
 */
export function transitSummary(entries: TransitLike[], to: string, days = TRANSIT_WINDOW_DAYS, trackedSince: string | null = null): TransitSummary | null {
  const windowStart = addDays(to, -(days - 1));
  const transits = entries.filter((e) => e.kind === 'transit' && e.localDate <= to);
  const first = [...transits.map((e) => e.localDate), ...(trackedSince ? [trackedSince] : [])].sort()[0];
  if (!first || first > to) return null;
  const start = first > windowStart ? first : windowStart;
  const counted = transits.filter((e) => e.localDate >= start);

  const perDate = new Map<string, number>();
  for (const e of counted) perDate.set(e.localDate, (perDate.get(e.localDate) ?? 0) + 1);
  const counts = dateRange(windowStart, to).map((date) => ({ date, count: date < start ? null : (perDate.get(date) ?? 0) }));

  let longestGap = 0;
  let gap = 0;
  for (const { count } of counts) {
    if (count === null) continue;
    gap = count === 0 ? gap + 1 : 0;
    longestGap = Math.max(longestGap, gap);
  }
  const last = counted.map((e) => e.localDate).sort().at(-1);
  const consistency: Record<StoolConsistency, number> = { hard: 0, normal: 0, soft: 0, liquid: 0 };
  for (const e of counted) if (e.data.bristol !== undefined) consistency[consistencyOf(e.data.bristol)]++;
  const span = daysBetween(start, to) + 1;

  return {
    to,
    days: span,
    total: counted.length,
    perDay: Math.round((counted.length / span) * 10) / 10,
    counts,
    daysSinceLast: last ? daysBetween(last, to) : null,
    longestGap,
    consistency,
    difficult: counted.filter((e) => e.data.ease === 'difficult' || e.data.ease === 'painful').length,
    painful: counted.filter((e) => e.data.ease === 'painful').length,
  };
}
