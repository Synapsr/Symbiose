import type { MiddlewareHandler } from 'hono';

/** Every authenticated route reads who is asking from `c.get('userId')`. */
export type AuthEnv = { Variables: { userId: string } };

/**
 * Decides who is asking, or refuses the request. The server checks a signed
 * token (apps/server/src/auth.ts); the app on its own has one person.
 */
export type Authenticate = MiddlewareHandler<AuthEnv>;

/** The app running on its own: every request is the phone's single person. */
export function singleUser(userId: string): Authenticate {
  return async (c, next) => {
    c.set('userId', userId);
    await next();
  };
}
