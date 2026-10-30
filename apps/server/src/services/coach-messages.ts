import type { CoachMessage } from '@symbiose/shared';

import type { CoachMessageRow } from '../db/schema';

export const toCoachMessage = (row: CoachMessageRow): CoachMessage => ({
  id: row.id,
  role: row.role,
  content: row.content,
  suggestion: row.suggestion ?? null,
  mealActions: row.mealActions ?? [],
  kind: row.kind ?? null,
  localDate: row.localDate ?? null,
  createdAt: row.createdAt,
});

/** How a proactive message enters the coach's history: after a turn that says what it is, so turns still alternate. */
export function proactiveTurn(row: Pick<CoachMessageRow, 'kind' | 'localDate'>): string | null {
  return row.kind === 'morning' ? `[Morning check-in for ${row.localDate}]` : null;
}
