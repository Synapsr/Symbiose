import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
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

export const nowIso = () => new Date().toISOString();
