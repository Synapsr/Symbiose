import { createAi, createDisabledAi, createLocalApi, inProcessFetch, supportStreamingResponses, type Ai, type AiUsageListener } from '@symbiose/core';
import { createMockAi } from '@symbiose/core/ai/mock';
import * as Crypto from 'expo-crypto';

import { useAiSettings, type AiChoice } from './ai-settings';
import { createChatGptAi } from './chatgpt';
import { openPhoneDb } from './db';
import { phonePhotoFiles } from './photos';

/**
 * The app on its own: the Symbiose API (packages/core) runs here, in the
 * app's JavaScript engine, on the phone's database. Screens reach it through
 * `localFetch`, the same way they reach a server through `fetch`.
 */

/** What the core needs from this engine; done before the API's first request. */
export function installRuntime() {
  // Row and photo ids are UUIDs (core/ids.ts): Web Crypto's, from expo-crypto here.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (!g.crypto) g.crypto = {};
  if (!g.crypto.randomUUID) g.crypto.randomUUID = () => Crypto.randomUUID();
  // The coach's replies are streamed: React Native's Response needs to carry a stream.
  supportStreamingResponses();
}

/** The AI the person chose, or one that answers `ai_disabled` until they choose. */
export function aiFor(choice: AiChoice | null, onUsage?: AiUsageListener): Ai {
  if (!choice) return createDisabledAi('no AI chosen on this phone');
  if (choice.kind === 'chatgpt') return createChatGptAi(choice.model ?? null, onUsage);
  if (choice.kind === 'mock') return __DEV__ ? createMockAi() : createDisabledAi('mock AI in development only');
  return createAi(
    {
      aiProvider: choice.provider,
      aiApiKey: choice.apiKey,
      aiModel: choice.model ?? undefined,
      aiBaseUrl: choice.baseUrl ?? null,
      aiVision: choice.vision ?? true,
      anthropicWorkspaceId: choice.workspaceId ?? null,
    },
    onUsage,
  );
}

type LocalApi = ReturnType<typeof createLocalApi>;
let current: Promise<LocalApi> | null = null;

/** The API, built on first use: the database is opened and migrated, the AI is the one chosen. */
export function localApi(): Promise<LocalApi> {
  current ??= (async () => {
    installRuntime();
    const settings = useAiSettings.getState();
    if (!settings.loaded) await settings.load();
    return createLocalApi({
      db: openPhoneDb(),
      photoFiles: phonePhotoFiles,
      createAi: (onUsage) => aiFor(useAiSettings.getState().choice, onUsage),
    });
  })();
  current.catch(() => {
    current = null;
  });
  return current;
}

/** Builds the API again on next use: after the AI changed, or a backup replaced the data. */
export function resetLocalApi(): void {
  current = null;
}

// A new AI choice takes effect on the next request.
useAiSettings.subscribe((state, previous) => {
  if (state.choice !== previous.choice) resetLocalApi();
});

/**
 * `fetch` for the phone's API. An AI that can't be reached is the phone being
 * offline: the offline queue keeps the capture and sends it again later.
 */
export const localFetch: typeof fetch = inProcessFetch(async () => (await localApi()).app, { offlineCodes: ['ai_unreachable'] });
