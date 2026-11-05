import {
  createAi,
  createChatGptAi,
  createDisabledAi,
  createLocalApi,
  inProcessFetch,
  readBackupMeta,
  schema,
  sealBackup,
  type Ai,
  type Db,
  type PhotoFiles,
} from '@symbiose/core';
import { createMockAi } from '@symbiose/core/ai/mock';
import { toLocalDate, toLocalDateTime } from '@symbiose/shared';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';

import { LoopbackAuth } from '../../modules/loopback-auth';

import { sqlOf } from './backup';
import { installRuntime } from './host';

/**
 * Development only (src/app/dev-check.tsx, `symbiose://dev-check`): runs the
 * API the way the app runs it, in this JavaScript engine, on a database of its
 * own, and logs each check. Never touches the person's data.
 */

type Log = (line: string) => void;

const PROFILE = { name: 'Lou', sex: 'female', birthYear: 1992, heightCm: 168, weightKg: 63, activityLevel: 'moderate', locale: 'fr', timezone: 'Europe/Paris' } as const;
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8=';

function folderFiles(dir: Directory): PhotoFiles {
  const file = (id: string) => new File(dir, `${id}.jpg`);
  return {
    async write(id, photo) {
      await file(id).write(photo.base64, { encoding: 'base64' });
    },
    async writeBytes(id, bytes) {
      file(id).write(bytes);
    },
    async readBase64(id) {
      return file(id).exists ? file(id).base64() : null;
    },
    async readBytes(id) {
      return file(id).exists ? file(id).bytes() : null;
    },
    async remove(id) {
      if (file(id).exists) file(id).delete();
    },
  };
}

export async function runDevCheck(log: Log): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const check = async (name: string, run: () => Promise<string | void>) => {
    try {
      const detail = await run();
      passed += 1;
      log(`✅ ${name}${detail ? ` · ${detail}` : ''}`);
    } catch (error) {
      failed += 1;
      log(`❌ ${name} · ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    }
  };
  const expect = (ok: unknown, what: string) => {
    if (!ok) throw new Error(what);
  };

  const dir = new Directory(Paths.cache, 'dev-check');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  const photos = new Directory(dir, 'photos');
  photos.create({ idempotent: true });
  // The runtime the app installs (crypto.randomUUID, a Response that carries streams).
  installRuntime();

  let ai: Ai = createMockAi();
  const sqlite = openDatabaseSync('check.db', {}, decodeURIComponent(dir.uri.replace(/^file:\/\//, '')));
  sqlite.execSync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  const local = createLocalApi({ db, photoFiles: folderFiles(photos), createAi: () => ai });
  const fetchLocal = inProcessFetch(async () => local.app, { offlineCodes: ['ai_unreachable'] });
  const call = async <T,>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetchLocal(`local://phone${path}`, {
      method,
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };

  await check('runtime: crypto.randomUUID', async () => crypto.randomUUID());
  await check('migrations on expo-sqlite', async () => {
    const rows = sqlite.getAllSync<{ n: number }>('SELECT count(*) AS n FROM __drizzle_migrations');
    expect(rows[0]!.n >= 11, `only ${rows[0]?.n} migrations`);
    return `${rows[0]!.n} applied`;
  });
  await check('engine: Intl and normalize', async () => {
    const weekday = new Date('2026-11-05T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    expect(weekday === 'Thursday', `weekday ${weekday}`);
    expect('Pâte'.normalize('NFD').length === 5, 'NFD');
    return weekday;
  });
  await check('GET /api/me (one person)', async () => {
    const me = await call<{ email: string }>('GET', '/api/me');
    expect(me.status === 200, `status ${me.status}`);
    return me.body.email;
  });
  await check('PUT /api/me/profile', async () => {
    expect((await call('PUT', '/api/me/profile', PROFILE)).status === 200, 'profile');
  });
  await check('plan drafted without AI (keyword planner)', async () => {
    ai = createDisabledAi('none');
    const off = createLocalApi({ db, photoFiles: folderFiles(photos), createAi: () => ai });
    const res = await off.app.request('/api/goals/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intentions: 'Moins de sucre, plus de légumes' }) });
    const body = (await res.json()) as { aiGenerated: boolean };
    expect(res.status === 200 && body.aiGenerated === false, `status ${res.status}`);
    ai = createMockAi();
  });
  await check('POST /api/goals/draft + PUT /api/goals (mock AI)', async () => {
    const draft = await call<{ plan: unknown }>('POST', '/api/goals/draft', { intentions: 'Moins de sucre l’après-midi' });
    expect(draft.status === 200, `draft ${draft.status}`);
    expect((await call('PUT', '/api/goals', { plan: draft.body.plan })).status === 200, 'save');
  });
  const now = new Date();
  await check('POST /api/meals (text)', async () => {
    const meal = await call<{ title: string }>('POST', '/api/meals', { text: 'un yaourt et une pomme', eatenAt: toLocalDateTime(now), localDate: toLocalDate(now) });
    expect(meal.status === 201, `status ${meal.status}`);
    return meal.body.title;
  });
  await check('POST /api/meals (photo kept on the phone)', async () => {
    const meal = await call<{ photoId: string }>('POST', '/api/meals', { photoBase64: JPEG, eatenAt: toLocalDateTime(new Date(now.getTime() - 60_000)), localDate: toLocalDate(now) });
    expect(meal.status === 201, `status ${meal.status}`);
    expect(new File(photos, `${meal.body.photoId}.jpg`).exists, 'photo file');
  });
  await check('GET /api/days/:date', async () => {
    const day = await call<{ meals: unknown[] }>('GET', `/api/days/${toLocalDate(now)}`);
    expect(day.status === 200 && day.body.meals.length === 2, `meals ${day.body.meals?.length}`);
  });
  await check('coach reply streamed', async () => {
    const res = await fetchLocal('local://phone/api/coach/messages/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ text: 'Une idée de goûter ?', localDate: toLocalDate(now) }),
    });
    expect(res.body, 'no stream body');
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    let deltas = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        text += value;
        deltas += 1;
      }
      if (done) break;
    }
    expect(/event: done/.test(text), 'no done event');
    return `${deltas} chunks`;
  });
  await check('GET /api/glance + insights', async () => {
    expect((await call('GET', `/api/glance?date=${toLocalDate(now)}`)).status === 200, 'glance');
    expect((await call('GET', `/api/insights?days=7`)).status === 200, 'insights');
  });
  await check('proactive: nudges', async () => {
    const res = await call('POST', '/api/proactive/nudges', { localDate: toLocalDate(now) });
    expect([200, 409].includes(res.status), `status ${res.status}`);
    return String(res.status);
  });
  await check('backup sealed on the phone', async () => {
    const copy = new File(dir, 'copy.symbiose');
    sqlite.runSync('VACUUM INTO ?', [decodeURIComponent(copy.uri.replace(/^file:\/\//, ''))]);
    const sealed = openDatabaseSync('copy.symbiose', {}, decodeURIComponent(dir.uri.replace(/^file:\/\//, '')));
    try {
      const meta = await sealBackup(sqlOf(sealed), { userId: local.userId, origin: 'phone', readPhoto: (id) => folderFiles(photos).readBytes(id) });
      expect(meta.counts.meals === 2 && meta.counts.photos === 1, JSON.stringify(meta.counts));
      expect(readBackupMeta(sqlOf(sealed))?.origin === 'phone', 'meta');
      const blobs = sealed.getAllSync<{ n: number }>('SELECT count(*) AS n FROM backup_photos');
      return `${copy.size} bytes, ${blobs[0]?.n} photo`;
    } finally {
      sealed.closeSync();
    }
  });
  await check('Anthropic SDK on Hermes (a refused key, nothing billed)', async () => {
    const claude = createAi({ aiProvider: 'anthropic', aiApiKey: 'sk-ant-invalid-dev-check', aiModel: 'claude-haiku-5-5' });
    try {
      await claude.cravingNudges({ locale: 'fr', profile: null, plan: null, targets: null, cravingWindow: { start: '15:00', end: '17:00', source: 'cravings' }, topCravings: [] });
      throw new Error('answered with an invalid key');
    } catch (error) {
      const code = (error as { code?: string }).code;
      expect(code === 'ai_misconfigured', `code ${code} (${error instanceof Error ? error.message : ''})`);
      return code;
    }
  });
  await check('OpenAI SDK on Hermes (a refused key, nothing billed)', async () => {
    const gpt = createAi({ aiProvider: 'openai', aiApiKey: 'sk-invalid-dev-check' });
    try {
      await gpt.cravingTip({ locale: 'fr', profile: null, plan: null, targets: null, what: 'chocolat', intensity: 2, hour: 16, recentCravings: [], todaySugar: null } as never);
      throw new Error('answered with an invalid key');
    } catch (error) {
      const code = (error as { code?: string }).code;
      expect(code === 'ai_misconfigured', `code ${code} (${error instanceof Error ? error.message : ''})`);
      return code;
    }
  });
  await check('ChatGPT plan adapter on Hermes (a refused token)', async () => {
    const plan = createChatGptAi({ model: 'gpt-6.1-sol', accessToken: async () => 'invalid-dev-check' });
    try {
      await plan.ping();
      throw new Error('answered with an invalid token');
    } catch (error) {
      const code = (error as { code?: string }).code;
      expect(code === 'ai_reconnect' || code === 'ai_not_eligible', `code ${code} (${error instanceof Error ? error.message : ''})`);
      return code;
    }
  });
  await check('loopback server on 127.0.0.1 (ChatGPT, OpenRouter sign-in)', async () => {
    expect(LoopbackAuth, 'native module missing');
    const port = await LoopbackAuth!.start('/auth/callback', '<p>ok</p>');
    expect(port > 0, `port ${port}`);
    const redirect = LoopbackAuth!.waitForRedirect(10_000);
    // What a browser does when the sign-in page sends it back.
    const page = await fetch(`http://127.0.0.1:${port}/auth/callback?code=abc&state=xyz`).then(
      (res) => `page ${res.status}`,
      (error: unknown) => `page failed (${error instanceof Error ? error.message : String(error)})`,
    );
    const target = await redirect;
    expect(target === '/auth/callback?code=abc&state=xyz', `target ${target}, ${page}`);
    expect(page === 'page 200', page);
    return `port ${port}`;
  });

  sqlite.closeSync();
  if (dir.exists) dir.delete();
  log(`dev-check: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
