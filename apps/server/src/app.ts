import { createApp as createApi } from '@symbiose/core';
import { users } from '@symbiose/core/db/schema';
import { JSON_BODY_LIMIT, limitBody } from '@symbiose/core/http';
import { count } from 'drizzle-orm';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { blockPending, requireAuth } from './auth';
import { signupMode, VERSION } from './env';
import type { ServerDeps } from './http';
import { landingPage } from './landing';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backup';

/**
 * The server: the Symbiose API (packages/core) behind signed tokens, plus what
 * only a server has: accounts and sign-up, the admin view, the QR page, CORS
 * and body limits.
 */
export function createApp(deps: ServerDeps, options: { log?: boolean } = {}) {
  const { db, ai, config } = deps;
  const api = { ...deps, auth: requireAuth(config.jwtSecret) };

  return createApi(api, {
    middleware(app) {
      if (options.log) app.use(logger());
      app.use('/api/*', cors({ origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins }));
      // An oversized body is refused before it is read. A new meal (its photo) and a backup set their own, larger limits.
      const jsonLimit = limitBody(JSON_BODY_LIMIT);
      const ownLimit = new Set(['/api/meals', '/api/me/restore']);
      app.use('/api/*', (c, next) => (c.req.method === 'POST' && ownLimit.has(c.req.path) ? next() : jsonLimit(c, next)));
      app.use('/api/*', blockPending(db, config.jwtSecret));
    },
    signup() {
      const hasUsers = (db.select({ n: count() }).from(users).get()?.n ?? 0) > 0;
      return { signupOpen: !hasUsers || signupMode(config) !== 'closed', signup: signupMode(config), hasUsers };
    },
    routes(app) {
      app.get('/health', (c) => c.json({ ok: true, version: VERSION }));
      app.get('/', async (c) => {
        const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '');
        const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? `localhost:${config.port}`;
        const url = config.publicUrl ?? `${proto}://${host}`;
        return c.html(await landingPage({ url, version: VERSION, aiEnabled: ai.enabled, model: ai.model }));
      });
      app.route('/api/auth', authRoutes(deps));
      app.route('/api/me', backupRoutes(deps));
      app.route('/api/admin', adminRoutes(deps));
    },
  });
}
