import { count } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { ServerInfo } from '@symbiose/shared';

import { users } from './db/schema';
import { VERSION } from './env';
import { HttpError } from './errors';
import type { Deps } from './http';
import { landingPage } from './landing';
import { authRoutes, meRoutes } from './routes/account';
import { bloodPressureRoutes } from './routes/blood-pressure';
import { coachRoutes } from './routes/coach';
import { goalRoutes } from './routes/goals';
import { mealRoutes } from './routes/meals';
import { trackingRoutes } from './routes/tracking';
import { workoutRoutes } from './routes/workouts';

export function createApp(deps: Deps, options: { log?: boolean } = {}) {
  const { db, ai, config } = deps;
  const app = new Hono();

  if (options.log) app.use(logger());
  app.use('/api/*', cors({ origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins }));

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));

  app.get('/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/', async (c) => {
    const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '');
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? `localhost:${config.port}`;
    const url = config.publicUrl ?? `${proto}://${host}`;
    return c.html(await landingPage({ url, version: VERSION, aiEnabled: ai.enabled, model: ai.model }));
  });

  app.get('/api/info', (c) => {
    const hasUsers = (db.select({ n: count() }).from(users).get()?.n ?? 0) > 0;
    return c.json<ServerInfo>({
      name: 'symbiose',
      version: VERSION,
      ai: { enabled: ai.enabled, model: ai.model },
      signupOpen: !hasUsers || config.allowSignup,
      hasUsers,
    });
  });

  app.route('/api/auth', authRoutes(deps));
  app.route('/api/me', meRoutes(deps));
  app.route('/api/goals', goalRoutes(deps));
  app.route('/api/meals', mealRoutes(deps));
  app.route('/api/coach', coachRoutes(deps));
  app.route('/api/workouts', workoutRoutes(deps));
  app.route('/api/blood-pressure', bloodPressureRoutes(deps));
  app.route('/api', trackingRoutes(deps));

  return app;
}
