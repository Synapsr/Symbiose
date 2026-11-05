import { createClaudeAi } from './claude';
import { createMockAi } from './mock';
import { createOpenAiCompatibleAi } from './openai';
import { resolveAi, type AiConfig } from './providers';
import { createDisabledAi } from './shared';
import type { Ai, AiUsageListener } from './types';

/** The server's AI, from its configuration. `onUsage` hears every call to the provider. */
export function createAi(config: AiConfig, onUsage?: AiUsageListener): Ai {
  if (config.aiMock) return createMockAi();
  const setup = resolveAi(config);
  if ('problem' in setup) return createDisabledAi(setup.problem);
  if (setup.provider === 'anthropic') return createClaudeAi(setup.apiKey, setup.model, setup.workspaceId, onUsage);
  return createOpenAiCompatibleAi(setup, onUsage);
}
