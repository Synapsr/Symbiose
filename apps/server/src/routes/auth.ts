import { newId } from '@symbiose/core';
import { users } from '@symbiose/core/db/schema';
import { HttpError } from '@symbiose/core/errors';
import { nowIso, validate } from '@symbiose/core/http';
import { isAdminEmail, toUser } from '@symbiose/core/services/users';
import { CredentialsSchema, type AuthResponse } from '@symbiose/shared';
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { hashPassword, issueToken, rateLimit, verifyPassword } from '../auth';
import { signupMode } from '../env';
import type { ServerDeps } from '../http';

/** Sign-up and sign-in: the server's accounts, each with a signed token. */
export function authRoutes({ db, config }: ServerDeps) {
  const app = new Hono();
  const limiter = rateLimit(10, 60_000);

  app.post('/register', limiter, validate('json', CredentialsSchema), async (c) => {
    const { email, password, name } = c.req.valid('json');
    const existingUsers = db.select({ n: count() }).from(users).get()?.n ?? 0;
    const mode = signupMode(config);
    if (existingUsers > 0 && mode === 'closed') {
      throw new HttpError(403, 'signup_closed', 'Sign-ups are closed on this server');
    }
    if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
      throw new HttpError(409, 'email_taken', 'An account already exists with this email');
    }
    // No email verification: an admin email can't be claimed through open sign-up, only as the first account.
    // On request, it simply waits for an admin like any other (and is no admin until approved).
    if (existingUsers > 0 && mode === 'open' && isAdminEmail(config, email)) {
      throw new HttpError(403, 'email_reserved', 'This email is reserved on this server');
    }
    const row = db
      .insert(users)
      .values({
        id: newId(),
        email,
        passwordHash: await hashPassword(password),
        name: name ?? '',
        isAdmin: existingUsers === 0,
        // The very first account is always approved.
        pending: existingUsers > 0 && mode === 'request',
        createdAt: nowIso(),
      })
      .returning()
      .get();
    return c.json<AuthResponse>({ token: await issueToken(row.id, config.jwtSecret), user: toUser(row, config) }, 201);
  });

  app.post('/login', limiter, validate('json', CredentialsSchema.pick({ email: true, password: true })), async (c) => {
    const { email, password } = c.req.valid('json');
    const row = db.select().from(users).where(eq(users.email, email)).get();
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      throw new HttpError(401, 'invalid_credentials', 'Wrong email or password');
    }
    return c.json<AuthResponse>({ token: await issueToken(row.id, config.jwtSecret), user: toUser(row, config) });
  });

  return app;
}

