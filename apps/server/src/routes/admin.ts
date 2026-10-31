import type { AdminOverview, AdminPeriod } from '@symbiose/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { requireAuth, type AuthEnv } from '../auth';
import { users } from '../db/schema';
import { HttpError } from '../errors';
import { validate, type Deps } from '../http';
import { adminOverview, isAdminEmail } from '../services/admin';

/**
 * The admin's global view of the server. Every request checks the account
 * against ADMIN_EMAILS as it is now; others get a 403 (the code is open, so a
 * 404 would hide nothing, and a clear refusal helps an owner who forgot to list
 * their email). The log says who looked, never what they saw.
 */
export function adminRoutes(deps: Deps) {
  const { db, config } = deps;
  const app = new Hono<AuthEnv>();
  app.use(requireAuth(config.jwtSecret));
  app.use(async (c, next) => {
    const userId = c.get('userId');
    const row = db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();
    if (!row || !isAdminEmail(config, row.email)) {
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

  return app;
}
