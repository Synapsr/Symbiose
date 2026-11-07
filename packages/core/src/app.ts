import type { ServerInfo } from '@symbiose/shared';
import { Hono } from 'hono';

import { VERSION } from './config';
import { HttpError } from './errors';
import type { Deps } from './http';
import { meRoutes } from './routes/account';
import { bloodPressureRoutes } from './routes/blood-pressure';
import { coachRoutes } from './routes/coach';
import { glanceRoutes } from './routes/glance';
import { goalRoutes } from './routes/goals';
import { hydrationRoutes } from './routes/hydration';
import { journalRoutes } from './routes/journal';
import { mealRoutes } from './routes/meals';
import { moodRoutes } from './routes/mood';
import { proactiveRoutes } from './routes/proactive';
import { reportRoutes } from './routes/report';
import { sleepRoutes } from './routes/sleep';
import { trackingRoutes } from './routes/tracking';
import { vitalsRoutes } from './routes/vitals';
import { workoutRoutes } from './routes/workouts';

/** What a host adds around the API. */
export interface AppOptions {
  /** Middleware in front of every route: logging, CORS, body limits on a server. */
  middleware?: (app: Hono) => void;
  /** The host's own routes (sign-up, admin, the QR page), mounted before the API's. */
  routes?: (app: Hono) => void;
  /** The sign-up part of `/api/info`; a host without accounts has nothing to sign up to. */
  signup?: () => Pick<ServerInfo, 'signupOpen' | 'signup' | 'hasUsers'>;
}

/**
 * The Symbiose API: every route the app calls, the same on a server and on
 * the phone. The host decides who is asking (`deps.auth`) and where the data,
 * the photos and the AI live.
 */
export function createApp(deps: Deps, options: AppOptions = {}) {
  const { ai } = deps;
  const app = new Hono();

  options.middleware?.(app);

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Something went wrong' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));

  app.get('/api/info', (c) =>
    c.json<ServerInfo>({
      name: 'symbiose',
      version: VERSION,
      ai: { enabled: ai.enabled, model: ai.model, provider: ai.provider ?? null },
      ...(options.signup?.() ?? { signupOpen: false, signup: 'closed', hasUsers: true }),
    }),
  );

  options.routes?.(app);

  app.route('/api/me', meRoutes(deps));
  app.route('/api/goals', goalRoutes(deps));
  app.route('/api/meals', mealRoutes(deps));
  app.route('/api/coach', coachRoutes(deps));
  app.route('/api/workouts', workoutRoutes(deps));
  app.route('/api/blood-pressure', bloodPressureRoutes(deps));
  app.route('/api/sleep', sleepRoutes(deps));
  app.route('/api/hydration', hydrationRoutes(deps));
  app.route('/api/mood', moodRoutes(deps));
  app.route('/api/glance', glanceRoutes(deps));
  app.route('/api/journal', journalRoutes(deps));
  app.route('/api/proactive', proactiveRoutes(deps));
  app.route('/api/vitals', vitalsRoutes(deps));
  app.route('/api/report', reportRoutes(deps));
  // Last: these routes sit at /api itself, behind their own authentication.
  app.route('/api', trackingRoutes(deps));

  return app;
}
