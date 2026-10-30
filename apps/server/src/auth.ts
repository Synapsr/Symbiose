import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';
import { sign, verify } from 'hono/jwt';

import { HttpError } from './errors';

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180;

export function issueToken(userId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, iat: now, exp: now + TOKEN_TTL_SECONDS }, secret, 'HS256');
}

export type AuthEnv = { Variables: { userId: string } };

export function requireAuth(secret: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : c.req.query('token');
    if (!token) throw new HttpError(401, 'unauthorized', 'Missing token');
    try {
      const payload = await verify(token, secret, 'HS256');
      if (typeof payload.sub !== 'string') throw new Error('bad subject');
      c.set('userId', payload.sub);
    } catch {
      throw new HttpError(401, 'unauthorized', 'Invalid or expired token');
    }
    await next();
  };
}

/** Tiny fixed-window limiter for credential endpoints. */
export function rateLimit(limit: number, windowMs: number): MiddlewareHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  return async (c, next) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
    } else if (++entry.count > limit) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts, try again in a minute');
    }
    if (hits.size > 10_000) hits.clear();
    await next();
  };
}
