import { join } from 'node:path';

import { serve } from '@hono/node-server';

import { createAi } from './ai';
import { createApp } from './app';
import { openDb } from './db';
import { loadConfig, VERSION } from './env';
import { adminSetupLog } from './services/admin';
import { AI_USAGE_MONTHS, createUsageRecorder, pruneAiUsage } from './services/ai-usage';
import { PhotoStore } from './services/photos';

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
  else console.log(ai.enabled ? `AI enabled with ${ai.model}` : 'AI disabled: set ANTHROPIC_API_KEY to enable photo analysis and coaching');
  if (pruned) console.log(`AI usage: dropped ${pruned} rows older than ${AI_USAGE_MONTHS} months`);
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
