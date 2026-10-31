import type { Config } from '../env';
import { createClaudeAi, createDisabledAi } from './claude';
import { createMockAi } from './mock';
import type { Ai, AiUsageListener } from './types';

/** The server's AI, from its configuration. `onUsage` hears every call to the provider. */
export function createAi(config: Config, onUsage?: AiUsageListener): Ai {
  if (config.aiMock) return createMockAi();
  if (config.anthropicApiKey) return createClaudeAi(config.anthropicApiKey, config.aiModel, config.anthropicWorkspaceId, onUsage);
  return createDisabledAi();
}
