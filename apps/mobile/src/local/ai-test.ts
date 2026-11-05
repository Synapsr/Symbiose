import { AI_PROVIDERS, type AiProvider } from '@symbiose/core';

import type { AiChoice } from './ai-settings';

export type AiTestResult = 'ok' | 'refused' | 'unreachable';

/**
 * Whether a key works, before keeping it: a free call that lists models (or,
 * at OpenRouter, describes the key). Nothing is analysed, nothing is billed.
 */
export async function testAiChoice(choice: Extract<AiChoice, { kind: 'key' }>): Promise<AiTestResult> {
  const { provider, apiKey } = choice;
  const request = (() => {
    if (provider === 'anthropic') {
      return {
        url: 'https://api.anthropic.com/v1/models?limit=1',
        headers: {
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
          ...(choice.workspaceId ? { 'anthropic-workspace-id': choice.workspaceId } : {}),
        },
      };
    }
    // OpenRouter lists its models to anyone: its key endpoint says whether the key is good.
    if (provider === 'openrouter') return { url: 'https://openrouter.ai/api/v1/key', headers: { authorization: `Bearer ${apiKey ?? ''}` } };
    const base = (choice.baseUrl || AI_PROVIDERS[provider].baseUrl || '').replace(/\/+$/, '');
    return { url: `${base}/models`, headers: apiKey ? { authorization: `Bearer ${apiKey}` } : ({} as Record<string, string>) };
  })();
  try {
    const res = await fetch(request.url, { headers: { accept: 'application/json', ...request.headers }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) return 'refused';
    // A local server without a model list still answers: it's there.
    return res.ok || res.status === 404 ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** Where each provider hands out keys. */
export const KEY_PAGES: Partial<Record<AiProvider, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  mistral: 'https://console.mistral.ai/api-keys',
  openrouter: 'https://openrouter.ai/settings/keys',
};
