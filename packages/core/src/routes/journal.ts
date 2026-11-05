import { JournalEntryInputSchema, JournalEntryPatchSchema, JournalKindSchema, LocalDateSchema, type JournalEntry } from '@symbiose/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import { journalEntries } from '../db/schema';
import { notFound } from '../errors';
import { validate, type Deps } from '../http';
import { createJournalEntry, journalBetween, updateJournalEntry } from '../services/journal';

const listQuery = z
  .object({
    from: LocalDateSchema.optional(),
    to: LocalDateSchema.optional(),
    kind: JournalKindSchema.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });

/** The health journal (« Carnet »): the person's own notes, which the coach reads too. */
export function journalRoutes({ db, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  /** Newest first, optionally between two days and of one kind. */
  app.get('/', validate('query', listQuery), (c) => c.json<JournalEntry[]>(journalBetween(db, c.get('userId'), c.req.valid('query'))));

  app.post('/', validate('json', JournalEntryInputSchema), (c) => c.json<JournalEntry>(createJournalEntry(db, c.get('userId'), c.req.valid('json')), 201));

  app.patch('/:id', validate('json', JournalEntryPatchSchema), (c) => {
    const entry = updateJournalEntry(db, c.get('userId'), c.req.param('id'), c.req.valid('json'));
    if (!entry) throw notFound('Note');
    return c.json<JournalEntry>(entry);
  });

  app.delete('/:id', (c) => {
    const row = db
      .delete(journalEntries)
      .where(and(eq(journalEntries.id, c.req.param('id')), eq(journalEntries.userId, c.get('userId'))))
      .returning({ id: journalEntries.id })
      .get();
    if (!row) throw notFound('Note');
    return c.body(null, 204);
  });

  return app;
}
