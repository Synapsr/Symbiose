import type { AdminOverview, AdminPeriod, AdminRequest } from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthEnv } from '@symbiose/core/auth';
import { users } from '@symbiose/core/db/schema';
import { HttpError } from '@symbiose/core/errors';
import { validate } from '@symbiose/core/http';

import { requireAuth } from '../auth';
import type { ServerDeps } from '../http';
import { adminOverview, approveRequest, isAdmin, pendingRequests, refuseRequest } from '../services/admin';

/**
 * The admin's global view of the server. Every request checks the account
 * against ADMIN_EMAILS as it is now; others get a 403 (the code is open, so a
 * 404 would hide nothing, and a clear refusal helps an owner who forgot to list
 * their email). The log says who looked, never what they saw.
 */
export function adminRoutes(deps: ServerDeps) {
  const { db, config } = deps;
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));
  app.use(async (c, next) => {
    const userId = c.get('userId');
    const row = db.select({ email: users.email, pending: users.pending }).from(users).where(eq(users.id, userId)).get();
    if (!row || !isAdmin(config, row)) {
      console.warn(`admin: refused ${c.req.method} ${c.req.path} for account ${userId}`);
      throw new HttpError(403, 'forbidden', 'Only the admins of this server can see this');
    }
    await next();
  });

  app.get('/overview', validate('query', z.object({ days: z.enum(['7', '30', '90']).default('30') })), (c) => {
    const days = Number(c.req.valid('query').days) as AdminPeriod;
    console.info(`admin: overview (${days} days) viewed by account ${c.get('userId')}`);
    return c.json<AdminOverview>(adminOverview(deps, days));
  });

  // Sign-up on request: the one place an admin sees a person, with only what it takes to decide.
  app.get('/requests', (c) => c.json<{ requests: AdminRequest[] }>({ requests: pendingRequests(db) }));

  app.post('/requests/:id/approve', (c) => {
    if (!approveRequest(db, c.req.param('id'))) throw new HttpError(404, 'not_found', 'No such request');
    console.info(`admin: request ${c.req.param('id')} approved by account ${c.get('userId')}`);
    return c.body(null, 204);
  });

  app.delete('/requests/:id', async (c) => {
    if (!(await refuseRequest(deps, c.req.param('id')))) throw new HttpError(404, 'not_found', 'No such request');
    console.info(`admin: request ${c.req.param('id')} refused (account deleted) by account ${c.get('userId')}`);
    return c.body(null, 204);
  });

  return app;
}
