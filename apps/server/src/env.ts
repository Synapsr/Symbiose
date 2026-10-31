import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { SignupMode } from '@symbiose/shared';

import { AI_PROVIDERS, isAiProvider } from './ai/providers';
import { parsePrices, type Rates } from './services/ai-prices';

export const VERSION = '0.1.0';

export interface Config {
  port: number;
  dataDir: string;
  publicUrl: string | null;
  jwtSecret: string;
  /** When false, only the very first account can be created. Read through `signupMode`. */
  allowSignup: boolean;
  /** SIGNUP; wins over `allowSignup` when set. */
  signup?: SignupMode;
  /** AI_PROVIDER as given (anthropic when unset): see `ai/providers.ts`. */
  aiProvider?: string;
  /** The provider's key: AI_API_KEY, else its own variable (ANTHROPIC_API_KEY, OPENAI_API_KEY…). */
  aiApiKey?: string | null;
  /** AI_BASE_URL: an OpenAI-compatible server; each named provider has a default. */
  aiBaseUrl?: string | null;
  /** AI_VISION=false for a model that can't read photos: photo meals answer `ai_no_vision`. */
  aiVision?: boolean;
  anthropicApiKey: string | null;
  /** Required by Anthropic keys that are not scoped to a workspace. */
  anthropicWorkspaceId: string | null;
  /** AI_MODEL, else the provider's default. */
  aiModel: string;
  /** Development only: canned AI answers, no API key needed. */
  aiMock: boolean;
  corsOrigins: string[];
  /** Lowercase emails of the accounts that see the admin view (ADMIN_EMAILS); none when unset. */
  adminEmails?: string[];
  /** Per-model prices from AI_PRICES, USD per million tokens; Claude's are built in. */
  aiPrices?: Record<string, Rates>;
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

const SIGNUP_MODES: readonly SignupMode[] = ['open', 'request', 'closed'];

/** How accounts after the first one get in. */
export function signupMode(config: Pick<Config, 'signup' | 'allowSignup'>): SignupMode {
  return config.signup ?? (config.allowSignup ? 'open' : 'closed');
}

/** SIGNUP=open|request|closed; before it, ALLOW_SIGNUP=true meant open. Closed by default. */
function readSignup(env: NodeJS.ProcessEnv): SignupMode {
  const value = env.SIGNUP?.trim().toLowerCase();
  if (value && SIGNUP_MODES.includes(value as SignupMode)) return value as SignupMode;
  if (value) console.warn(`SIGNUP: ignoring "${env.SIGNUP}" (expected open, request or closed)`);
  return bool(env.ALLOW_SIGNUP, false) ? 'open' : 'closed';
}

export function loadConfig(env = process.env): Config {
  const dataDir = resolve(env.DATA_DIR ?? './data');
  mkdirSync(join(dataDir, 'photos'), { recursive: true });
  const prices = parsePrices(env.AI_PRICES);
  const signup = readSignup(env);
  for (const entry of prices.invalid) console.warn(`AI_PRICES: ignoring "${entry}" (expected model=input/output, USD per million tokens)`);
  const aiProvider = env.AI_PROVIDER?.trim().toLowerCase() || undefined;
  const name = aiProvider ?? 'anthropic';
  const provider = isAiProvider(name) ? AI_PROVIDERS[name] : null;
  return {
    port: Number(env.PORT ?? 3000),
    dataDir,
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, '') || null,
    jwtSecret: loadSecret(dataDir),
    allowSignup: signup !== 'closed',
    signup,
    aiProvider,
    aiApiKey: env.AI_API_KEY || (provider?.keyVar ? env[provider.keyVar] : undefined) || null,
    aiBaseUrl: env.AI_BASE_URL?.trim() || null,
    aiVision: bool(env.AI_VISION, true),
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    anthropicWorkspaceId: env.ANTHROPIC_WORKSPACE_ID || null,
    aiModel: env.AI_MODEL?.trim() || provider?.model || '',
    aiMock: bool(env.AI_MOCK, false),
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
    adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    aiPrices: prices.prices,
  };
}
