import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { createAi } from './ai';
import { describeAi } from './ai/providers';
import { createApp } from './app';
import { openDb } from './db';
import { loadConfig, signupMode, VERSION } from './env';
import { adminSetupLog } from './services/admin';
import { AI_USAGE_MONTHS, createUsageRecorder, pruneAiUsage } from './services/ai-usage';
import { PhotoStore } from './services/photos';

const SIGNUP_LOG = {
  open: 'Sign-up: open to anyone who can reach the server',
  request: 'Sign-up: on request, an admin approves each new account',
  closed: 'Sign-up: closed, only the first account (SIGNUP=open or request to change)',
} as const;

const config = loadConfig();
const db = openDb(join(config.dataDir, 'symbiose.db'));
const pruned = pruneAiUsage(db);
const ai = createAi(config, createUsageRecorder(db));
const photos = new PhotoStore(db, join(config.dataDir, 'photos'));

const app = createApp({ db, ai, photos, config }, { log: true });

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Symbiose server v${VERSION} listening on http://0.0.0.0:${info.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  if (config.aiMock) console.warn('AI_MOCK is on: AI answers are canned. Development only.');
  else {
    const { ok, lines } = describeAi(config);
    for (const line of lines) (ok ? console.log : console.warn)(line);
  }
  if (pruned) console.log(`AI usage: dropped ${pruned} rows older than ${AI_USAGE_MONTHS} months`);
  console.log(SIGNUP_LOG[signupMode(config)]);
  const admin = adminSetupLog(db, config);
  console.log(admin.info);
  for (const warning of admin.warnings) console.warn(warning);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
