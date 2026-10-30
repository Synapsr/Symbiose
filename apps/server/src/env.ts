import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const VERSION = '0.1.0';

export interface Config {
  port: number;
  dataDir: string;
  publicUrl: string | null;
  jwtSecret: string;
  /** When false, only the very first account can be created. */
  allowSignup: boolean;
  anthropicApiKey: string | null;
  aiModel: string;
  /** Development only: canned AI answers, no API key needed. */
  aiMock: boolean;
  corsOrigins: string[];
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Reads JWT_SECRET, or generates one once and keeps it in the data volume. */
function loadSecret(dataDir: string): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = join(dataDir, '.jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(env = process.env): Config {
  const dataDir = resolve(env.DATA_DIR ?? './data');
  mkdirSync(join(dataDir, 'photos'), { recursive: true });
  return {
    port: Number(env.PORT ?? 3000),
    dataDir,
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, '') || null,
    jwtSecret: loadSecret(dataDir),
    allowSignup: bool(env.ALLOW_SIGNUP, false),
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    aiModel: env.AI_MODEL || 'claude-opus-5-5',
    aiMock: bool(env.AI_MOCK, false),
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
