import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toLocalDate, toLocalDateTime, type AdminOverview, type AdminRequest, type AuthResponse, type FoodItem, type Profile, type User } from '@symbiose/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createDisabledAi } from './ai/claude';
import { createMockAi } from './ai/mock';
import type { Ai, AiUsage } from './ai/types';
import { createApp } from './app';
import { openDb } from './db';
import { aiUsage, coachMessages, cravings, journalEntries, meals, photos, users, weights } from './db/schema';
import { databaseBehind } from './db/testing';
import { loadConfig, VERSION, type Config } from './env';
import { adminSetupLog } from './services/admin';
import { costOf, parsePrices, priceOf } from './services/ai-prices';
import { createUsageRecorder, pruneAiUsage, usageRow } from './services/ai-usage';
import { PhotoStore } from './services/photos';

const dir = mkdtempSync(join(tmpdir(), 'symbiose-admin-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const BOSS = 'boss@example.com';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function makeApp(overrides: Partial<Config> = {}, ai: Ai = { ...createDisabledAi(), enabled: true, provider: 'anthropic', model: 'claude-opus-5-5' }) {
  const dataDir = mkdtempSync(join(dir, 'data-'));
  const config: Config = {
    port: 0,
    dataDir,
    publicUrl: null,
    jwtSecret: 'test-secret',
    allowSignup: true,
    anthropicApiKey: 'test-key',
    anthropicWorkspaceId: null,
    aiModel: 'claude-opus-5-5',
    aiMock: false,
    corsOrigins: ['*'],
    adminEmails: [BOSS],
    ...overrides,
  };
  const db = openDb(':memory:');
  const app = createApp({ db, ai, photos: new PhotoStore(db, dataDir), config });
  const request = async <T,>(method: string, path: string, token?: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, text };
  };
  const register = (email: string, name?: string) => request<AuthResponse & { error?: { code: string } }>('POST', '/api/auth/register', undefined, { email, password: 'password123', name });
  return { app, db, config, request, register };
}

const usage = (overrides: Partial<AiUsage> = {}): AiUsage => ({
  feature: 'meal',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  durationMs: 1000,
  ok: true,
  ...overrides,
});

describe('AI usage recording', () => {
  it('writes one row per call, with numbers only', () => {
    const db = openDb(':memory:');
    const record = createUsageRecorder(db);
    record(usage({ feature: 'coach', inputTokens: 1200, outputTokens: 340, cacheReadTokens: 5000, cacheWriteTokens: 80, durationMs: 4321 }));
    record(usage({ ok: false, error: 'Request failed: the prompt said « I ate 3 donuts »', inputTokens: -5, outputTokens: Number.NaN }));
    const rows = db.select().from(aiUsage).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ feature: 'coach', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 1200, outputTokens: 340, cacheReadTokens: 5000, cacheWriteTokens: 80, durationMs: 4321, ok: true, error: null });
    // A message is never stored as an error code; bad numbers become zeros.
    expect(rows[1]).toMatchObject({ ok: false, error: 'ai_error', inputTokens: 0, outputTokens: 0 });
    expect(usageRow(usage({ ok: false, error: 'ai_rate_limited' }), 'now').error).toBe('ai_rate_limited');
  });

  it('never throws into the AI path', () => {
    const db = openDb(':memory:');
    db.run(sql`DROP TABLE ai_usage`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => createUsageRecorder(db)(usage())).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('drops rows older than 13 months', () => {
    const db = openDb(':memory:');
    const now = new Date('2026-10-15T12:00:00.000Z');
    for (const at of ['2025-09-01T00:00:00.000Z', '2025-09-15T11:59:59.000Z', '2025-09-15T12:00:00.000Z', '2026-10-14T00:00:00.000Z']) {
      db.insert(aiUsage).values(usageRow(usage(), at)).run();
    }
    expect(pruneAiUsage(db, now)).toBe(2);
    expect(db.select({ at: aiUsage.at }).from(aiUsage).all().map((r) => r.at)).toEqual(['2025-09-15T12:00:00.000Z', '2026-10-14T00:00:00.000Z']);
    expect(pruneAiUsage(db, now)).toBe(0);
  });
});

describe('AI prices', () => {
  it("knows Claude's published prices, by alias or dated id", () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect(priceOf('claude-sonnet-5-5-20261001')).toMatchObject({ input: 2, output: 10, cacheRead: 0.2 });
    expect(priceOf('claude-opus-5')).toMatchObject({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
    expect(priceOf('claude-haiku-5-5')?.long).toMatchObject({ input: 0.5, output: 2.5 });
    expect(priceOf('gpt-test')).toBeNull();
    // 1M input + 1M output on Opus 5.5.
    expect(costOf({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 }, priceOf('claude-opus-5-5')!)).toBe(24);
  });

  it('reads AI_PRICES overrides, which win, and reports bad entries', () => {
    const { prices, invalid } = parsePrices(' gpt-test=1.25/10/0.125 , qwen2.5:7b=0/0, claude-opus-5-5=3/15, broken, nope=1, bad=a/b ');
    expect(prices['gpt-test']).toEqual({ input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 });
    expect(prices['qwen2.5:7b']).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(priceOf('claude-opus-5-5', prices)).toMatchObject({ input: 3, output: 15 });
    // Providers answer with dated ids: the alias's price applies.
    expect(priceOf('gpt-test-2026-09-01', prices)).toBe(prices['gpt-test']);
    expect(invalid).toEqual(['broken', 'nope=1', 'bad=a/b']);
  });

  it('reads ADMIN_EMAILS trimmed and lowercased', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = loadConfig({ DATA_DIR: mkdtempSync(join(dir, 'env-')), JWT_SECRET: 'x', ADMIN_EMAILS: ' Boss@Example.com , ,Other@X.io ', AI_PRICES: 'gpt-test=1/2,oops' });
    expect(config.adminEmails).toEqual(['boss@example.com', 'other@x.io']);
    expect(config.aiPrices).toEqual({ 'gpt-test': { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('oops'));
    expect(loadConfig({ DATA_DIR: mkdtempSync(join(dir, 'env-')), JWT_SECRET: 'x' }).adminEmails).toEqual([]);
  });
});

describe('admin access', () => {
  it('lets only listed accounts in, checked on every request', async () => {
    const { request, register, config } = makeApp();
    const boss = await register('Boss@Example.com');
    expect(boss.status).toBe(201);
    expect(boss.body.user.isAdmin).toBe(true);
    const someone = await register('someone@example.com');
    expect(someone.body.user.isAdmin).toBe(false);

    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await request('GET', '/api/admin/overview')).status).toBe(401);
    const refused = await request<{ error: { code: string } }>('GET', '/api/admin/overview', someone.body.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('forbidden');
    // The refusal is logged by account id, never by email.
    expect(warn.mock.calls.flat().join(' ')).toContain(someone.body.user.id);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('someone@example.com');

    expect((await request('GET', '/api/admin/overview?days=7', boss.body.token)).status).toBe(200);
    expect((await request('GET', '/api/admin/overview?days=12', boss.body.token)).status).toBe(400);
    expect((await request<User>('GET', '/api/me', boss.body.token)).body.isAdmin).toBe(true);
    expect((await request<User>('GET', '/api/me', someone.body.token)).body.isAdmin).toBe(false);

    // Taken off the list: no access from the next request on, same token.
    config.adminEmails = [];
    expect((await request('GET', '/api/admin/overview', boss.body.token)).status).toBe(403);
    expect((await request<User>('GET', '/api/me', boss.body.token)).body.isAdmin).toBe(false);
  });

  it('keeps listed emails out of open sign-up, except as the first account', async () => {
    // Nobody can register the admin's email before its owner does, in any case.
    const open = makeApp({ adminEmails: [BOSS, 'second@example.com'] });
    expect((await open.register('first@example.com')).status).toBe(201);
    for (const email of [BOSS, ' BOSS@example.com', 'Second@Example.com']) {
      const res = await open.register(email);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('email_reserved');
    }
    expect((await open.register('friend@example.com')).status).toBe(201);
    expect(open.db.select({ email: users.email }).from(users).all().map((u) => u.email)).toEqual(['first@example.com', 'friend@example.com']);

    // The startup log warns about each listed email still without an account.
    const log = adminSetupLog(open.db, open.config);
    expect(log.info).toContain('2 emails');
    expect(log.warnings).toHaveLength(2);
    expect(log.warnings[0]).toContain(BOSS);

    // The server's very first account may be a listed one: whoever creates it owns the server anyway.
    const fresh = makeApp();
    const boss = await fresh.register(BOSS);
    expect(boss.status).toBe(201);
    expect(boss.body.user.isAdmin).toBe(true);
    expect(adminSetupLog(fresh.db, fresh.config).warnings).toEqual([]);
    // An existing account keeps its email: the usual answer, nothing about admins.
    expect((await fresh.register(BOSS)).body.error?.code).toBe('email_taken');

    expect(adminSetupLog(fresh.db, { ...fresh.config, adminEmails: [] }).info).toMatch(/off/);
  });
});

describe('admin overview', () => {
  const prices = { 'qwen2.5:7b': { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 } };
  const ctx = makeApp({ aiPrices: prices });
  const { db, request, register } = ctx;
  const secrets = ['Zoé Secretname', 'Bastien Hiddenname', 'zoe@example.com', 'bastien@example.com', 'carla@example.com', 'Tartine secrète', 'deux tartines au miel secret', 'Café croissant', 'un café et un croissant secret', 'note privée du repas', 'chocolat-secret', 'note-du-journal-secrète', 'message-au-coach-secret', 'réponse-du-coach-secrète'];
  let bossToken = '';
  let ids: string[] = [];

  const meal = (userId: string, createdAt: string, fields: Partial<typeof meals.$inferInsert> & { source?: FoodItem['source'] } = {}) => {
    const { source = 'ai', ...rest } = fields;
    const item: FoodItem = { id: randomUUID().slice(0, 8), name: 'Tartine secrète', emoji: '🍞', portion: '1', grams: 50, per100g: { kcal: 250 }, source, confidence: null, brand: null, barcode: null } as FoodItem;
    db.insert(meals)
      .values({ id: randomUUID(), userId, eatenAt: '2026-10-31T08:00:00+01:00', localDate: createdAt.slice(0, 10), mealType: 'breakfast', title: 'Tartine secrète', items: [item], photoId: null, inputText: null, note: 'note privée du repas', insight: null, favorite: false, createdAt, updatedAt: createdAt, ...rest })
      .run();
  };

  it('seeds the instance', async () => {
    const boss = await register(BOSS, 'Boss');
    bossToken = boss.body.token;
    const zoe = (await register('zoe@example.com', 'Zoé Secretname')).body.user.id;
    const bastien = (await register('bastien@example.com', 'Bastien Hiddenname')).body.user.id;
    const carla = (await register('carla@example.com')).body.user.id;
    ids = [boss.body.user.id, zoe, bastien, carla];
    // Bastien joined 40 days ago and did nothing since; Carla 10 days ago, last seen 3 days ago.
    db.update(users).set({ createdAt: ago(2 * DAY) }).where(eq(users.id, zoe)).run();
    db.update(users).set({ createdAt: ago(40 * DAY) }).where(eq(users.id, bastien)).run();
    db.update(users).set({ createdAt: ago(10 * DAY) }).where(eq(users.id, carla)).run();
    db.insert(weights).values({ userId: carla, localDate: '2026-10-28', kg: 61, measuredAt: ago(3 * DAY), source: 'manual', updatedAt: ago(3 * DAY) }).run();
    db.insert(cravings).values({ id: randomUUID(), userId: carla, at: ago(3 * DAY), localDate: '2026-10-28', what: 'chocolat-secret', outcome: 'resisted', createdAt: ago(3 * DAY) }).run();

    // Zoé's meals: a photo and its relog, words and theirs, a scan, the library, by hand; one older photo.
    db.insert(photos).values([
      { id: 'photo-1', userId: zoe, mime: 'image/jpeg', size: 120_000, createdAt: ago(3 * HOUR) },
      { id: 'photo-2', userId: zoe, mime: 'image/jpeg', size: 80_000, createdAt: ago(20 * DAY) },
    ]).run();
    meal(zoe, ago(3 * HOUR), { photoId: 'photo-1' });
    meal(zoe, ago(2 * HOUR), { photoId: 'photo-1' });
    meal(zoe, ago(90 * 60_000), { inputText: 'un café et un croissant secret', title: 'Café croissant' });
    meal(zoe, ago(80 * 60_000), { inputText: 'un café et un croissant secret', title: 'Café croissant' });
    meal(zoe, ago(70 * 60_000), { source: 'barcode' });
    meal(zoe, ago(60 * 60_000), { source: 'library' });
    meal(zoe, ago(50 * 60_000), { source: 'manual' });
    meal(zoe, ago(20 * DAY), { photoId: 'photo-2' });
    // The same words, analysed again as a new meal, would read as a relog only with the same title.
    meal(zoe, ago(40 * 60_000), { inputText: 'deux tartines au miel secret', title: 'Tartines' });

    for (const at of [ago(HOUR), ago(30 * 60_000)]) db.insert(cravings).values({ id: randomUUID(), userId: zoe, at, localDate: at.slice(0, 10), what: 'chocolat-secret', intensity: 2, createdAt: at }).run();
    db.insert(journalEntries).values({ id: randomUUID(), userId: zoe, at: ago(HOUR), localDate: ago(HOUR).slice(0, 10), kind: 'other', text: 'note-du-journal-secrète', data: {}, createdAt: ago(HOUR), updatedAt: ago(HOUR) }).run();
    db.insert(coachMessages).values([
      { id: randomUUID(), userId: zoe, role: 'user', content: 'message-au-coach-secret', createdAt: ago(HOUR) },
      { id: randomUUID(), userId: zoe, role: 'assistant', content: 'réponse-du-coach-secrète', createdAt: ago(HOUR - 1000) },
      { id: randomUUID(), userId: zoe, role: 'user', content: 'message-au-coach-secret', createdAt: ago(HOUR - 2000) },
    ]).run();

    const record = (u: Partial<AiUsage>, at: string) => db.insert(aiUsage).values(usageRow(usage(u), at)).run();
    record({ feature: 'meal', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 3000, durationMs: 2000 }, ago(3 * HOUR));
    record({ feature: 'meal', inputTokens: 2000, outputTokens: 1000, cacheWriteTokens: 4000, durationMs: 4000 }, ago(2 * HOUR));
    record({ feature: 'coach', inputTokens: 500, outputTokens: 200, cacheReadTokens: 1000, durationMs: 1000 }, ago(HOUR));
    record({ feature: 'coach', ok: false, error: 'ai_rate_limited', durationMs: 30_000 }, ago(HOUR));
    record({ feature: 'craving', provider: 'openai', model: 'gpt-test', inputTokens: 100, outputTokens: 50, durationMs: 500 }, ago(HOUR));
    record({ feature: 'review', provider: 'ollama', model: 'qwen2.5:7b', inputTokens: 1000, outputTokens: 1000, durationMs: 3000 }, ago(HOUR));
    record({ feature: 'meal', inputTokens: 1000, durationMs: 1500 }, ago(10 * DAY));

    // Two copies kept before migrations.
    mkdirSync(join(ctx.config.dataDir, 'backups'));
    writeFileSync(join(ctx.config.dataDir, 'backups', 'symbiose-before-0009_a.db'), 'x');
    writeFileSync(join(ctx.config.dataDir, 'backups', 'symbiose-before-0009_b.db'), 'xx');
    utimesSync(join(ctx.config.dataDir, 'backups', 'symbiose-before-0009_a.db'), new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'));
    utimesSync(join(ctx.config.dataDir, 'backups', 'symbiose-before-0009_b.db'), new Date('2026-10-20T10:00:00Z'), new Date('2026-10-20T10:00:00Z'));
  });

  const overview = async (days: number) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const res = await request<AdminOverview>('GET', `/api/admin/overview?days=${days}`, bossToken);
    expect(res.status).toBe(200);
    return res;
  };

  it('sums the AI calls: tokens, cost, errors, latency, cache', async () => {
    const { body } = await overview(7);
    const { ai } = body;
    expect(body.days).toBe(7);
    expect(ai.daily).toHaveLength(7);
    expect(ai.daily.at(-1)!.date).toBe(new Date().toISOString().slice(0, 10));
    expect(ai).toMatchObject({ calls: 6, errors: 1, inputTokens: 4600, outputTokens: 2750, cacheReadTokens: 4000, cacheWriteTokens: 4000, unpricedCalls: 1 });
    // Opus 5.5: 0.0146 + 0.048 + 0.0062; qwen at its AI_PRICES price: 0.003; gpt-test has no price.
    expect(ai.costUsd).toBeCloseTo(0.0718, 6);
    expect(ai.errorRate).toBeCloseTo(1 / 6);
    expect(ai.cacheHitShare).toBeCloseTo(4000 / 12_600);
    expect(ai.latencyMs).toEqual({ p50: 2000, p95: 4000 });
    expect(ai.topErrors).toEqual([{ code: 'ai_rate_limited', count: 1 }]);
    expect(ai.daily.reduce((sum, d) => sum + d.calls, 0)).toBe(6);
    expect(ai.daily.reduce((sum, d) => sum + (d.costUsd ?? 0), 0)).toBeCloseTo(0.0718, 6);

    const feature = (name: string) => ai.byFeature.find((f) => f.feature === name);
    expect(ai.byFeature.map((f) => f.calls)).toEqual([2, 2, 1, 1]);
    expect(feature('meal')).toMatchObject({ calls: 2, inputTokens: 3000, outputTokens: 1500 });
    expect(feature('meal')!.costUsd).toBeCloseTo(0.0626, 6);
    expect(feature('craving')!.costUsd).toBeNull();
    const model = (name: string) => ai.byModel.find((m) => m.model === name);
    expect(ai.byModel[0]).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', calls: 4 });
    expect(model('claude-opus-5-5')!.costUsd).toBeCloseTo(0.0688, 6);
    expect(model('gpt-test')).toMatchObject({ provider: 'openai', costUsd: null });
    expect(model('qwen2.5:7b')!.costUsd).toBeCloseTo(0.003, 6);

    // The 30-day view reaches the older call.
    const month = (await overview(30)).body.ai;
    expect(month.calls).toBe(7);
    expect(month.daily).toHaveLength(30);
    expect(month.costUsd).toBeCloseTo(0.0758, 6);
  });

  it('counts people and what they log, never who', async () => {
    const { body } = await overview(7);
    expect(body.people).toEqual({ accounts: 4, pending: 0, active: { day: 2, week: 3, month: 3 }, new: { week: 2, month: 3 } });
    expect(body.usage).toMatchObject({
      meals: 8,
      mealSources: { photo: 1, relog: 2, text: 2, barcode: 1, library: 1, manual: 1 },
      cravings: 3,
      notes: 1,
      coachMessages: 2,
    });
    expect(body.usage.daily).toHaveLength(7);
    expect(body.usage.daily.reduce((sum, d) => sum + d.meals, 0)).toBe(8);
    expect((await overview(30)).body.usage.mealSources.photo).toBe(2);
  });

  it('describes the system', async () => {
    const { system } = (await overview(7)).body;
    expect(system).toMatchObject({
      version: VERSION,
      photos: 2,
      photosBytes: 200_000,
      backups: { count: 2, lastAt: '2026-10-20T10:00:00.000Z' },
      ai: { enabled: true, provider: 'anthropic', model: 'claude-opus-5-5' },
      signup: 'open',
    });
    expect(system.dbBytes).toBeGreaterThan(0);
    expect(system.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('holds no email, name, id or words from anyone', async () => {
    for (const days of [7, 30, 90]) {
      const { text } = await overview(days);
      for (const secret of [...secrets, ...ids, 'photo-1', 'photo-2', BOSS]) expect(text).not.toContain(secret);
      expect(text).not.toMatch(/@/);
    }
  });

  it('logs who looked, not what they saw', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await request('GET', '/api/admin/overview?days=30', bossToken);
    const line = info.mock.calls.flat().join(' ');
    expect(line).toContain('overview (30 days)');
    expect(line).not.toMatch(/@|claude|tokens/);
  });
});

describe('sign-up on request', () => {
  /** Every AI method counts its calls: a waiting account must never reach one. */
  const aiCalls: string[] = [];
  const mock = createMockAi();
  const spyAi = new Proxy(mock, {
    get: (target, key) => {
      const value = target[key as keyof Ai];
      return typeof value === 'function' ? (...args: unknown[]) => (aiCalls.push(String(key)), (value as (...a: unknown[]) => unknown).apply(target, args)) : value;
    },
  });
  const profile: Profile = { name: 'Inès', sex: 'female', birthYear: 1992, heightCm: 165, weightKg: 60, activityLevel: 'light', locale: 'fr', timezone: 'Europe/Paris' };

  it('reads SIGNUP, and ALLOW_SIGNUP as before', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const read = (env: Record<string, string>) => {
      const config = loadConfig({ DATA_DIR: mkdtempSync(join(dir, 'env-')), JWT_SECRET: 'x', ...env });
      return [config.signup, config.allowSignup];
    };
    expect(read({})).toEqual(['closed', false]);
    expect(read({ ALLOW_SIGNUP: 'true' })).toEqual(['open', true]);
    expect(read({ ALLOW_SIGNUP: 'false' })).toEqual(['closed', false]);
    expect(read({ SIGNUP: 'request' })).toEqual(['request', true]);
    expect(read({ SIGNUP: 'Closed', ALLOW_SIGNUP: 'true' })).toEqual(['closed', false]);
    expect(read({ SIGNUP: 'maybe', ALLOW_SIGNUP: 'true' })).toEqual(['open', true]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('maybe'));
  });

  it('approves the first account, and keeps the next ones waiting, away from the AI and the data', async () => {
    const { request, register } = makeApp({ signup: 'request', adminEmails: [BOSS] }, spyAi);
    const first = await register('first@example.com');
    expect(first.body.user.pending).toBe(false);
    const ines = await register('ines@example.com', 'Inès');
    expect(ines.status).toBe(201);
    expect(ines.body.user.pending).toBe(true);
    const token = ines.body.token;
    expect((await request('GET', '/api/info')).body).toMatchObject({ signupOpen: true, signup: 'request' });

    // Their own account and the onboarding's profile: yes.
    expect((await request<User>('GET', '/api/me', token)).body.pending).toBe(true);
    expect((await request<User>('PUT', '/api/me/profile', token, profile)).status).toBe(200);
    expect((await request('GET', '/api/me/export', token)).status).toBe(200);

    // Everything else, AI first: no.
    const today = toLocalDate();
    const blocked: [string, string, unknown?][] = [
      ['POST', '/api/goals/draft', { intentions: 'Moins de sucre' }],
      ['PUT', '/api/goals', {}],
      ['GET', `/api/goals?date=${today}`],
      ['POST', '/api/meals', { eatenAt: toLocalDateTime(), localDate: today, text: 'une pomme' }],
      ['POST', '/api/coach/messages', { text: 'Salut', localDate: today }],
      ['POST', '/api/coach/messages/stream', { text: 'Salut', localDate: today }],
      ['POST', '/api/cravings', { at: toLocalDateTime(), localDate: today, what: 'chocolat' }],
      ['POST', '/api/insights/review', { days: 7, to: today }],
      ['GET', `/api/insights?days=7&to=${today}`],
      ['GET', `/api/glance?date=${today}`],
      ['GET', `/api/days/${today}`],
      ['GET', `/api/proactive?date=${today}`],
      ['POST', '/api/journal', { at: toLocalDateTime(), localDate: today, kind: 'other', text: 'x' }],
      ['GET', '/api/foods/library'],
      ['GET', '/api/admin/overview'],
    ];
    for (const [method, path, body] of blocked) {
      const res = await request<{ error: { code: string } }>(method, path, token, body);
      expect([path, res.status, res.body.error.code]).toEqual([path, 403, 'account_pending']);
    }
    expect(aiCalls).toEqual([]);

    // Leaving is always possible.
    expect((await request('DELETE', '/api/me', token)).status).toBe(204);
  });

  it('lets an admin approve or refuse, seeing only the email, the first name and the date', async () => {
    const { db, request, register } = makeApp({ signup: 'request', adminEmails: [BOSS, 'late-admin@example.com'] }, spyAi);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boss = (await register(BOSS)).body;
    expect(boss.user).toMatchObject({ pending: false, isAdmin: true });
    const ines = (await register('ines@example.com', 'Inès')).body;
    const tom = (await register('tom@example.com')).body;
    await request('PUT', '/api/me/profile', ines.token, profile);

    // A listed email that signs up waits too, and is no admin while it waits: nobody can squat it.
    const late = (await register('late-admin@example.com')).body;
    expect(late.user).toMatchObject({ pending: true, isAdmin: false });
    expect((await request('GET', '/api/admin/requests', late.token)).status).toBe(403);
    expect((await request('POST', `/api/admin/requests/${tom.user.id}/approve`, ines.token)).status).toBe(403);

    const list = await request<{ requests: AdminRequest[] }>('GET', '/api/admin/requests', boss.token);
    expect(list.body.requests.map((r) => r.email)).toEqual(['ines@example.com', 'tom@example.com', 'late-admin@example.com']);
    expect(list.body.requests[0]).toEqual({ id: ines.user.id, email: 'ines@example.com', name: 'Inès', requestedAt: expect.any(String) });
    // Nothing of the profile: no body data, no goals.
    expect(list.text).not.toMatch(/165|1992|female|weight|Europe/);
    expect((await request<AdminOverview>('GET', '/api/admin/overview', boss.token)).body.people.pending).toBe(3);

    // Approved: the account gets everything, the AI included.
    expect((await request('POST', `/api/admin/requests/${ines.user.id}/approve`, boss.token)).status).toBe(204);
    expect((await request<User>('GET', '/api/me', ines.token)).body.pending).toBe(false);
    expect((await request('GET', `/api/goals?date=${toLocalDate()}`, ines.token)).status).toBe(200);
    expect((await request('POST', `/api/admin/requests/${ines.user.id}/approve`, boss.token)).status).toBe(404);

    // Refused: the account and what it saved are gone; its next request finds no account.
    expect((await request('DELETE', `/api/admin/requests/${tom.user.id}`, boss.token)).status).toBe(204);
    expect((await request('GET', '/api/me', tom.token)).status).toBe(404);
    expect(db.select().from(users).where(eq(users.id, tom.user.id)).get()).toBeUndefined();
    // An approved account can't be deleted this way.
    expect((await request('DELETE', `/api/admin/requests/${ines.user.id}`, boss.token)).status).toBe(404);
    expect(db.select().from(users).where(eq(users.id, ines.user.id)).get()).toBeDefined();

    // Once approved, a listed email is an admin.
    await request('POST', `/api/admin/requests/${late.user.id}/approve`, boss.token);
    expect((await request<User>('GET', '/api/me', late.token)).body.isAdmin).toBe(true);
    expect((await request<{ requests: AdminRequest[] }>('GET', '/api/admin/requests', late.token)).body.requests).toEqual([]);
  });

  it('warns at startup when nobody can approve requests', async () => {
    const { db, config, register } = makeApp({ signup: 'request', adminEmails: [BOSS] });
    await register('first@example.com');
    expect(adminSetupLog(db, config).warnings).toEqual([expect.stringContaining('no email in ADMIN_EMAILS has an approved account')]);
    // The squatting warning is for open sign-up only: on request, a listed email just waits.
    expect(adminSetupLog(db, config).warnings.join()).not.toContain('refuses');
  });

  it('keeps every account from before the migration approved', () => {
    const file = join(mkdtempSync(join(dir, 'migrate-')), 'symbiose.db');
    const old = databaseBehind(file);
    old.prepare("INSERT INTO users (id, email, password_hash, name, is_admin, created_at) VALUES ('u1', 'old@example.com', 'x', 'Old', 1, '2026-01-01T00:00:00.000Z'), ('u2', 'friend@example.com', 'x', '', 0, '2026-02-01T00:00:00.000Z')").run();
    old.close();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const db = openDb(file);
    expect(db.select({ id: users.id, pending: users.pending }).from(users).all()).toEqual([
      { id: 'u1', pending: false },
      { id: 'u2', pending: false },
    ]);
    expect(db.select().from(aiUsage).all()).toEqual([]);
  });
});
