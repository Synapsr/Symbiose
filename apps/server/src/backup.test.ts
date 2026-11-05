import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalApi, readBackupMeta, schema, sealBackup, unsealBackup } from '@symbiose/core';
import { createMockAi } from '@symbiose/core/ai/mock';
import type { AuthResponse, DaySummary, Meal, Profile } from '@symbiose/shared';
import { toLocalDate, toLocalDateTime } from '@symbiose/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { openDb } from './db';
import type { Config } from './env';
import { sqlOf } from './routes/backup';
import { folderPhotoFiles, PhotoStore } from './services/photos';

// A backup is one file that moves an account between a server and a phone
// without a server, both ways, photos included (packages/core/src/backup.ts).

const dirs: string[] = [];
const tempDir = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `symbiose-${name}-`));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const PROFILE: Profile = { name: 'Lou', sex: 'female', birthYear: 1992, heightCm: 168, weightKg: 63, activityLevel: 'moderate', locale: 'fr', timezone: 'Europe/Paris' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]);

function server() {
  const dir = tempDir('server');
  const config: Config = {
    port: 0,
    dataDir: dir,
    publicUrl: null,
    jwtSecret: 'test-secret',
    allowSignup: true,
    signup: 'open',
    anthropicApiKey: null,
    anthropicWorkspaceId: null,
    aiModel: 'mock',
    aiMock: true,
    corsOrigins: ['*'],
  };
  mkdirSync(join(dir, 'photos'));
  const db = openDb(join(dir, 'symbiose.db'));
  const app = createApp({ db, ai: createMockAi(), photos: new PhotoStore(db, join(dir, 'photos')), config });
  return { app, db, dir };
}

async function account(app: ReturnType<typeof server>['app'], email: string) {
  const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  const { token } = (await res.json()) as AuthResponse;
  const call = async <T,>(method: string, path: string, body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = r.headers.get('content-type')?.includes('json') ? await r.text() : '';
    return { status: r.status, body: (text ? JSON.parse(text) : null) as T, res: r };
  };
  const raw = (method: string, path: string, body?: Uint8Array) => app.request(path, { method, headers: { authorization: `Bearer ${token}` }, body });
  return { token, call, raw };
}

async function fill(call: Awaited<ReturnType<typeof account>>['call']) {
  await call('PUT', '/api/me/profile', PROFILE);
  const now = new Date();
  const meal = await call<Meal>('POST', '/api/meals', { photoBase64: JPEG.toString('base64'), eatenAt: toLocalDateTime(now), localDate: toLocalDate(now) });
  expect(meal.status).toBe(201);
  await call('POST', '/api/meals', { text: 'un yaourt', eatenAt: toLocalDateTime(new Date(now.getTime() - 3_600_000)), localDate: toLocalDate(now) });
  const weight = await call('PUT', '/api/weights', { source: 'healthkit', samples: [{ measuredAt: now.toISOString(), localDate: toLocalDate(now), kg: 62.5 }] });
  expect(weight.status).toBe(200);
  return meal.body;
}

/** A phone: its database file restored from a backup, then the API on it (apps/mobile/src/local). */
async function phoneFrom(backup: Uint8Array) {
  const dir = tempDir('phone');
  const file = join(dir, 'symbiose.db');
  writeFileSync(file, backup);
  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');
  const files = folderPhotoFiles(join(dir, 'photos'));
  mkdirSync(join(dir, 'photos'));
  await unsealBackup(sqlOf(sqlite), (id, data) => files.writeBytes(id, data));
  const local = createLocalApi({ db: drizzle(sqlite, { schema }), photoFiles: files, createAi: () => createMockAi() });
  return { sqlite, dir, files, local };
}

// Three accounts, real password hashing and the mock AI's pauses: heavier than the API tests.
describe('backups', { timeout: 30_000 }, () => {
  it('moves an account from a server to a phone and back to another server', async () => {
    const first = server();
    const lou = await account(first.app, 'lou@example.com');
    const other = await account(first.app, 'other@example.com');
    const meal = await fill(lou.call);
    await fill(other.call);

    // The server's file: only Lou's rows, their photo inside.
    const res = await lou.raw('GET', '/api/me/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/symbiose-\d{4}-\d{2}-\d{2}\.symbiose/);
    const fromServer = new Uint8Array(await res.arrayBuffer());
    const check = new Database(Buffer.from(fromServer));
    const meta = readBackupMeta(sqlOf(check))!;
    expect(meta).toMatchObject({ app: 'symbiose', origin: 'server', format: 1 });
    expect(meta.counts).toMatchObject({ users: 1, meals: 2, photos: 1, weights: 1 });
    expect(check.prepare('SELECT count(*) AS n FROM ai_usage').get()).toEqual({ n: 0 });
    check.close();

    // On a phone: the same day, the photo back as a file.
    const phone = await phoneFrom(fromServer);
    const day = (await (await phone.local.app.request(`/api/days/${toLocalDate()}`)).json()) as DaySummary;
    expect(day.meals.map((m) => m.id).sort()).toContain(meal.id);
    expect(await phone.files.readBytes(meal.photoId!)).toEqual(new Uint8Array(JPEG));

    // The phone's own backup (what « Sauvegarder maintenant » makes).
    const copy = join(phone.dir, 'copy.symbiose');
    phone.sqlite.prepare('VACUUM INTO ?').run(copy);
    const sealed = new Database(copy);
    await sealBackup(sqlOf(sealed), { userId: phone.local.userId, origin: 'phone', readPhoto: (id) => phone.files.readBytes(id) });
    sealed.close();
    const fromPhone = new Uint8Array(readFileSync(copy));

    // « Passer sur un serveur »: a new account on another server takes it all.
    const second = server();
    const moved = await account(second.app, 'lou@example.com');
    const restored = await moved.raw('POST', '/api/me/restore', fromPhone);
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { restored: Record<string, number> }).restored).toMatchObject({ meals: 2, photos: 1, weights: 1 });
    const me = await moved.call<{ profile: Profile }>('GET', '/api/me');
    expect(me.body.profile.name).toBe('Lou');
    const movedDay = await moved.call<DaySummary>('GET', `/api/days/${toLocalDate()}`);
    expect(movedDay.body.meals.map((m) => m.id)).toContain(meal.id);
    const photo = await moved.raw('GET', `/api/photos/${meal.photoId}`);
    expect(photo.status).toBe(200);
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(new Uint8Array(JPEG));
  });

  it('never mixes accounts: refuses an account with data, and a backup already on the server', async () => {
    const { app } = server();
    const lou = await account(app, 'lou@example.com');
    await fill(lou.call);
    const file = new Uint8Array(await (await lou.raw('GET', '/api/me/backup')).arrayBuffer());

    // Lou's account has data: only an explicit replace.
    const notEmpty = await lou.raw('POST', '/api/me/restore', file);
    expect(notEmpty.status).toBe(409);
    expect(((await notEmpty.json()) as { error: { code: string } }).error.code).toBe('account_not_empty');
    expect((await lou.raw('POST', '/api/me/restore?replace=1', file)).status).toBe(200);
    expect((await lou.call<DaySummary>('GET', `/api/days/${toLocalDate()}`)).body.meals).toHaveLength(2);

    // The same rows can't land in a second account of the same server.
    const twin = await account(app, 'twin@example.com');
    const taken = await twin.raw('POST', '/api/me/restore', file);
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: { code: string } }).error.code).toBe('ids_taken');
    expect((await twin.call<DaySummary>('GET', `/api/days/${toLocalDate()}`)).status).toBe(409);
  });

  it('refuses what isn’t a backup', async () => {
    const { app } = server();
    const lou = await account(app, 'lou@example.com');
    const junk = await lou.raw('POST', '/api/me/restore', new TextEncoder().encode('not a database at all'));
    expect(junk.status).toBe(400);
    const empty = new Database(':memory:').serialize();
    expect((await lou.raw('POST', '/api/me/restore', new Uint8Array(empty))).status).toBe(400);
  });
});
