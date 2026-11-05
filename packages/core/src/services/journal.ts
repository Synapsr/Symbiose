import {
  consistencyOf,
  daysBetween,
  isMeaningfulEntry,
  journalDataFor,
  localTime,
  transitSummary,
  type JournalEntry,
  type JournalKind,
  type TransitSummary,
} from '@symbiose/shared';
import { and, asc, desc, eq, gte, lte, min } from 'drizzle-orm';

import type { JournalBrief, JournalNoteBrief } from '../ai/types';
import type { Db } from '../db';
import { journalEntries, type JournalEntryRow } from '../db/schema';
import { HttpError } from '../errors';
import { nowIso } from '../http';
import { newId } from '../ids';

type JournalFields = Pick<JournalEntry, 'at' | 'localDate' | 'kind' | 'text' | 'data'>;

/** Each note's words, at most; the AI needs the gist, not a diary. */
const NOTE_CHARS = 280;
/** All notes together, at most (≈1 500 tokens): past it, the oldest are left out. */
const BRIEF_CHARS = 6000;

export function toJournalEntry(row: JournalEntryRow): JournalEntry {
  return {
    id: row.id,
    at: row.at,
    localDate: row.localDate,
    kind: row.kind,
    text: row.text,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Newest first. Timestamps may mix offsets: within a day, compare instants, not strings. */
export function journalBetween(db: Db, userId: string, range: { from?: string; to?: string; kind?: JournalKind; limit?: number }): JournalEntry[] {
  return db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.userId, userId),
        range.from ? gte(journalEntries.localDate, range.from) : undefined,
        range.to ? lte(journalEntries.localDate, range.to) : undefined,
        range.kind ? eq(journalEntries.kind, range.kind) : undefined,
      ),
    )
    .orderBy(desc(journalEntries.localDate), desc(journalEntries.at))
    .limit(range.limit ?? 500)
    .all()
    .map(toJournalEntry)
    .sort((a, b) => b.localDate.localeCompare(a.localDate) || Date.parse(b.at) - Date.parse(a.at));
}

export function createJournalEntry(db: Db, userId: string, input: JournalFields): JournalEntry {
  const now = nowIso();
  const row = db
    .insert(journalEntries)
    .values({ id: newId(), userId, ...input, data: journalDataFor(input.kind, input.data), createdAt: now, updatedAt: now })
    .returning()
    .get();
  return toJournalEntry(row);
}

/** Merges the patch; the fields that don't fit the (new) kind are dropped. Null when it isn't theirs. */
export function updateJournalEntry(db: Db, userId: string, id: string, patch: Partial<JournalFields>): JournalEntry | null {
  const where = and(eq(journalEntries.id, id), eq(journalEntries.userId, userId));
  const row = db.select().from(journalEntries).where(where).get();
  if (!row) return null;
  const kind = patch.kind ?? row.kind;
  const next = { ...toJournalEntry(row), ...patch, kind, data: journalDataFor(kind, patch.data ?? row.data) };
  if (!isMeaningfulEntry(next)) throw new HttpError(400, 'invalid_input', 'text: Write a few words');
  const updated = db
    .update(journalEntries)
    .set({ at: next.at, localDate: next.localDate, kind, text: next.text, data: next.data, updatedAt: nowIso() })
    .where(where)
    .returning()
    .get();
  return toJournalEntry(updated);
}

/** The day transit tracking started, for frequencies that don't count the days before it. */
function firstTransitDate(db: Db, userId: string): string | null {
  return (
    db
      .select({ first: min(journalEntries.localDate) })
      .from(journalEntries)
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.kind, 'transit')))
      .get()?.first ?? null
  );
}

function noteBrief(entry: JournalEntry): JournalNoteBrief {
  const { bristol, ease, feeling } = entry.data;
  const text = entry.text.length > NOTE_CHARS ? `${entry.text.slice(0, NOTE_CHARS - 1).trimEnd()}…` : entry.text;
  return {
    date: entry.localDate,
    time: localTime(entry.at),
    kind: entry.kind,
    ...(bristol !== undefined ? { consistency: consistencyOf(bristol), bristol } : {}),
    ...(ease ? { ease } : {}),
    ...(feeling !== undefined ? { feeling } : {}),
    ...(text ? { text } : {}),
  };
}

/**
 * What the AI reads of the journal between two days: the notes, oldest first and
 * compact, and the transit frequency over the same days. Null when there's nothing.
 * `readAsMood` are the older « Ressenti » notes the AI already reads as a day's
 * mood (`moodNoteIds`): left out here so each mood is read once.
 */
export function journalBrief(db: Db, userId: string, from: string, to: string, readAsMood: ReadonlySet<string> = new Set()): JournalBrief | null {
  const entries = db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, userId), gte(journalEntries.localDate, from), lte(journalEntries.localDate, to)))
    .orderBy(asc(journalEntries.localDate), asc(journalEntries.at))
    .all()
    .map(toJournalEntry)
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || Date.parse(a.at) - Date.parse(b.at));
  const summary = transitSummary(entries, to, daysBetween(from, to) + 1, firstTransitDate(db, userId));
  const notesOnly = entries.filter((e) => !readAsMood.has(e.id));
  if (!notesOnly.length && !summary) return null;

  // Newest first until the cap, then back in time order.
  const notes: JournalNoteBrief[] = [];
  let chars = 0;
  for (const entry of [...notesOnly].reverse()) {
    const note = noteBrief(entry);
    chars += JSON.stringify(note).length;
    if (chars > BRIEF_CHARS) break;
    notes.unshift(note);
  }
  return { entries: notes, omitted: notesOnly.length - notes.length, transit: summary ? transitBrief(summary) : null };
}

/** The coach reads the frequency; the day-by-day strip is for the app. */
function transitBrief({ counts: _counts, to: _to, ...rest }: TransitSummary): JournalBrief['transit'] {
  return rest;
}
