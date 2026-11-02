import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { z } from 'zod';

import type { Ai } from './ai/types';
import type { Db } from './db';
import type { Config } from './env';
import { HttpError } from './errors';
import type { PhotoStore } from './services/photos';

export interface Deps {
  db: Db;
  ai: Ai;
  photos: PhotoStore;
  config: Config;
  fetch?: typeof fetch;
}

/** zod validation that reports errors in the API's error format. */
export function validate<T extends keyof ValidationTargets, S extends z.ZodType>(target: T, schema: S) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      throw new HttpError(400, 'invalid_input', `${path}${issue?.message ?? 'Invalid input'}`);
    }
  });
}

/** Refuses a request body over `maxSize` bytes before it is read, in the API's error format. */
export function limitBody(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: () => {
      throw new HttpError(413, 'too_large', 'Request body is too large');
    },
  });
}

/** Every API body but a meal photo: the biggest, a 5000-drink health import, is about 1 MB. */
export const JSON_BODY_LIMIT = 2 * 1024 * 1024;
/** A new meal can carry a photo (base64, up to 12 MB). */
export const MEAL_BODY_LIMIT = 12 * 1024 * 1024;

export const nowIso = () => new Date().toISOString();
