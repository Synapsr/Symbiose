import { daysBetween, LocalDateSchema, REPORT_MAX_DAYS, type ReportData } from '@symbiose/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '../auth';
import { validate, type Deps } from '../http';
import { reportFor } from '../services/report';

const periodQuery = z
  .object({ from: LocalDateSchema, to: LocalDateSchema })
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] })
  .refine((q) => daysBetween(q.from, q.to) < REPORT_MAX_DAYS, { message: `A report covers ${REPORT_MAX_DAYS} days at most`, path: ['from'] });

/** The PDF report's data (« Exporter », from Tendances): one period, assembled at once; the phone draws the pages. */
export function reportRoutes({ db, auth }: Deps) {
  const app = new Hono<AuthEnv>();
  app.use(auth);

  app.get('/', validate('query', periodQuery), (c) => {
    const { from, to } = c.req.valid('query');
    return c.json<ReportData>(reportFor(db, c.get('userId'), from, to));
  });

  return app;
}
