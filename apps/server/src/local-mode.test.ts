import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLocalApi, HttpError, inProcessFetch, schema, supportStreamingResponses, type Ai } from '@symbiose/core';
import { createMockAi } from '@symbiose/core/ai/mock';
import { createDisabledAi } from '@symbiose/core/ai/shared';
import type { CoachMessage, DaySummary, Meal, Profile, User } from '@symbiose/shared';
import { toLocalDate, toLocalDateTime } from '@symbiose/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
// The polyfill React Native installs as Request, Response and Headers.
import * as whatwg from 'whatwg-fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { folderPhotoFiles } from './services/photos';

// The app on its own runs the API in its JavaScript engine (apps/mobile/src/local).
// These tests run the same code the same way: React Native's fetch classes, the
// streaming patch, one person and no tokens, through `inProcessFetch`.

const native = { Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };
const dir = mkdtempSync(join(tmpdir(), 'symbiose-local-'));

beforeAll(() => {
  Object.assign(globalThis, { Request: whatwg.Request, Response: whatwg.Response, Headers: whatwg.Headers });
  supportStreamingResponses();
});
afterAll(() => {
  Object.assign(globalThis, native);
  rmSync(dir, { recursive: true, force: true });
});

const PROFILE: Profile = {
  name: 'Lou',
  sex: 'female',
  birthYear: 1992,
  heightCm: 168,
  weightKg: 63,
  activityLevel: 'moderate',
  locale: 'fr',
  timezone: 'Europe/Paris',
};

function phone(ai: Ai = createMockAi()) {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  const local = createLocalApi({ db, photoFiles: folderPhotoFiles(dir), createAi: () => ai });
  const fetch = inProcessFetch(async () => local.app, { offlineCodes: ['ai_unreachable'] });
  async function call<T>(method: string, path: string, body?: unknown) {
    const res = await fetch(`local://phone${path}`, {
      method,
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }
  return { sqlite, db, local, fetch, call };
}

describe('the app on its own', () => {
  it('uses React Native’s Response, patched to carry streams', () => {
    expect(globalThis.Response).not.toBe(whatwg.Response);
    const stream = new ReadableStream({ start: (c) => c.close() });
    expect(new Response(stream).body).toBe(stream);
    // Plain bodies keep working, and copying a response keeps its body.
    return expect(new Response(new Response('{"ok":true}').body).json()).resolves.toEqual({ ok: true });
  });

  it('has one person, created on first open, kept afterwards', async () => {
    const { call, db } = phone();
    const me = await call<User>('GET', '/api/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('local@symbiose.invalid');
    const again = createLocalApi({ db, photoFiles: folderPhotoFiles(dir), createAi: () => createMockAi() });
    expect(again.userId).toBe(me.body.id);
  });

  it('runs the whole day: profile, plan, meals, the day', async () => {
    const { call } = phone();
    expect((await call<User>('PUT', '/api/me/profile', PROFILE)).status).toBe(200);
    const draft = await call<{ plan: unknown }>('POST', '/api/goals/draft', { intentions: 'Moins de sucre l’après-midi' });
    expect(draft.status).toBe(200);
    expect((await call('PUT', '/api/goals', { plan: draft.body.plan })).status).toBe(200);

    const now = new Date();
    const meal = await call<Meal>('POST', '/api/meals', { text: 'un yaourt et une pomme', eatenAt: toLocalDateTime(now), localDate: toLocalDate(now) });
    expect(meal.status).toBe(201);
    expect(meal.body.items.length).toBeGreaterThan(0);

    const day = await call<DaySummary>('GET', `/api/days/${toLocalDate(now)}`);
    expect(day.status).toBe(200);
    expect(day.body.meals.map((m) => m.id)).toEqual([meal.body.id]);
  });

  it('keeps photos on the phone and sends them to the AI', async () => {
    const { call } = phone();
    await call('PUT', '/api/me/profile', PROFILE);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
    const now = new Date();
    const meal = await call<Meal>('POST', '/api/meals', { photoBase64: jpeg, eatenAt: toLocalDateTime(now), localDate: toLocalDate(now) });
    expect(meal.status).toBe(201);
    expect(meal.body.photoId).toBeTruthy();
  });

  it('streams the coach’s reply', async () => {
    const { fetch, call } = phone();
    await call('PUT', '/api/me/profile', PROFILE);
    const res = await fetch('local://phone/api/coach/messages/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ text: 'Une idée de goûter ?', localDate: toLocalDate(new Date()) }),
    });
    expect(res.status).toBe(200);
    // What the app does with a stream (apps/mobile/src/lib/api.ts).
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (value) text += value;
      if (done) break;
    }
    expect(text).toMatch(/event: delta/);
    const done = /event: done\ndata: (.*)/.exec(text)?.[1];
    expect((JSON.parse(done!) as { reply: CoachMessage }).reply.content.length).toBeGreaterThan(0);
  });

  it('answers errors the way the server does', async () => {
    const { call } = phone(createDisabledAi('no AI on this phone yet'));
    expect((await call('GET', '/api/glance')).status).toBe(409);
    await call('PUT', '/api/me/profile', PROFILE);
    const now = new Date();
    const meal = await call<{ error: { code: string } }>('POST', '/api/meals', { text: 'une pomme', eatenAt: toLocalDateTime(now), localDate: toLocalDate(now) });
    expect(meal.status).toBe(424);
    expect(meal.body.error.code).toBe('ai_disabled');
    expect((await call<{ error: { code: string } }>('GET', '/api/nope')).body.error.code).toBe('not_found');
  });

  it('has none of a server’s own routes', async () => {
    const { call } = phone();
    expect((await call('POST', '/api/auth/register', { email: 'a@b.c', password: 'password123' })).status).toBe(404);
    expect((await call('GET', '/api/admin/overview')).status).toBe(404);
    const info = await call<{ ai: { enabled: boolean; provider: string } }>('GET', '/api/info');
    expect(info.body.ai).toMatchObject({ enabled: true, provider: 'mock' });
  });

  it('turns an unreachable AI into no network, so the offline queue keeps the capture', async () => {
    const unreachable: Ai = { ...createMockAi(), analyzeMeal: () => Promise.reject(new HttpError(424, 'ai_unreachable', 'The AI provider could not be reached')) };
    const { fetch, call } = phone(unreachable);
    await call('PUT', '/api/me/profile', PROFILE);
    const now = new Date();
    await expect(
      fetch('local://phone/api/meals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'une pomme', eatenAt: toLocalDateTime(now), localDate: toLocalDate(now) }),
      }),
    ).rejects.toThrow('Network request failed');
  });
});
