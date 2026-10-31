import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../env';
import { createAi } from '.';
import { describeAi, resolveAi } from './providers';

/** Picking the AI from the environment, the old ANTHROPIC_API_KEY-only setup first. */

const dir = mkdtempSync(join(tmpdir(), 'symbiose-providers-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const config = (env: Record<string, string>) => loadConfig({ DATA_DIR: dir, JWT_SECRET: 'test', ...env });
const setup = (env: Record<string, string>) => resolveAi(config(env));

describe('AI configuration', () => {
  it('keeps an existing deployment with only ANTHROPIC_API_KEY on Claude', () => {
    expect(setup({ ANTHROPIC_API_KEY: 'sk-ant-1' })).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'sk-ant-1', workspaceId: null });
    expect(setup({ ANTHROPIC_API_KEY: 'sk-ant-1', AI_MODEL: 'claude-fable-5-1', ANTHROPIC_WORKSPACE_ID: 'wrk_1' })).toEqual({
      provider: 'anthropic',
      model: 'claude-fable-5-1',
      apiKey: 'sk-ant-1',
      workspaceId: 'wrk_1',
    });
    const ai = createAi(config({ ANTHROPIC_API_KEY: 'sk-ant-1' }));
    expect([ai.enabled, ai.provider, ai.model]).toEqual([true, 'anthropic', 'claude-opus-5-5']);
  });

  it('turns the AI off, and says why, without a key', async () => {
    expect(setup({})).toEqual({ problem: 'set ANTHROPIC_API_KEY, or AI_PROVIDER for another provider' });
    const ai = createAi(config({}));
    expect([ai.enabled, ai.provider, ai.model]).toEqual([false, null, null]);
    await expect(ai.review({} as never)).rejects.toMatchObject({ status: 424, code: 'ai_disabled', message: expect.stringContaining('ANTHROPIC_API_KEY') });
    expect(describeAi(config({})).ok).toBe(false);
  });

  it('takes AI_API_KEY for any provider, before the provider’s own variable', () => {
    expect(setup({ AI_API_KEY: 'sk-ant-2', ANTHROPIC_API_KEY: 'sk-ant-1' })).toMatchObject({ provider: 'anthropic', apiKey: 'sk-ant-2' });
    expect(setup({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-1' })).toMatchObject({ provider: 'openai', apiKey: 'sk-1', model: 'gpt-6-astra', baseUrl: 'https://api.openai.com/v1', vision: true });
    expect(setup({ AI_PROVIDER: 'OpenAI', AI_API_KEY: 'sk-2', OPENAI_API_KEY: 'sk-1' })).toMatchObject({ provider: 'openai', apiKey: 'sk-2' });
  });

  it('knows each named provider’s endpoint, key variable and default model', () => {
    expect(setup({ AI_PROVIDER: 'mistral', MISTRAL_API_KEY: 'm' })).toMatchObject({ baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-4', apiKey: 'm' });
    expect(setup({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' })).toMatchObject({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-3.8-flash', apiKey: 'g' });
    expect(setup({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'o' })).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-opus-5.5', apiKey: 'o' });
  });

  it('needs no key for local servers', () => {
    expect(setup({ AI_PROVIDER: 'ollama' })).toMatchObject({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'gemma4', apiKey: null });
    expect(setup({ AI_PROVIDER: 'ollama', AI_BASE_URL: 'http://host.docker.internal:11434/v1', AI_MODEL: 'qwen3.5:9b', AI_VISION: 'false' })).toMatchObject({
      baseUrl: 'http://host.docker.internal:11434/v1',
      model: 'qwen3.5:9b',
      vision: false,
    });
    expect(setup({ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:1234/v1', AI_MODEL: 'local-model' })).toMatchObject({ provider: 'openai-compatible', apiKey: null });
  });

  it('says what is missing', () => {
    expect(setup({ AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-ant-1' })).toEqual({ problem: 'AI_PROVIDER=openai needs AI_API_KEY or OPENAI_API_KEY' });
    expect(setup({ AI_PROVIDER: 'openai-compatible' })).toEqual({ problem: 'AI_PROVIDER=openai-compatible needs AI_BASE_URL and AI_MODEL' });
    expect(setup({ AI_PROVIDER: 'chatgpt' })).toEqual({ problem: expect.stringContaining('unknown AI_PROVIDER "chatgpt" (use anthropic, openai, mistral, gemini, openrouter, ollama, openai-compatible)') });
    expect(setup({ AI_PROVIDER: 'constructor' })).toEqual({ problem: expect.stringContaining('unknown AI_PROVIDER') });
  });

  it('logs who answers at startup', () => {
    expect(describeAi(config({ ANTHROPIC_API_KEY: 'k' }))).toEqual({ ok: true, lines: ['AI: anthropic · claude-opus-5-5'] });
    expect(describeAi(config({ AI_PROVIDER: 'ollama', AI_VISION: 'false' })).lines[0]).toBe('AI: ollama · gemma4 at http://localhost:11434/v1 · no photos (AI_VISION=false)');
    expect(describeAi(config({ AI_PROVIDER: 'mistral', AI_API_KEY: 'm' })).lines).toEqual(['AI: mistral · mistral-large-4', 'AI: Symbiose was tuned on Claude; other models may be less precise.']);
  });

  it('builds the OpenAI-compatible adapter for the other providers, and the mock in development', () => {
    const ai = createAi(config({ AI_PROVIDER: 'ollama' }));
    expect([ai.enabled, ai.provider, ai.model]).toEqual([true, 'ollama', 'gemma4']);
    expect(createAi(config({ AI_MOCK: 'true', AI_PROVIDER: 'openai' })).provider).toBe('mock');
  });
});
