import type { ProviderTraits } from './openai';

/** What picks the AI: the server's environment (AI_PROVIDER, AI_API_KEY…), or the settings on the phone. */
export interface AiConfig {
  /** AI_PROVIDER as given (anthropic when unset). */
  aiProvider?: string;
  /** The provider's key. */
  aiApiKey?: string | null;
  /** An OpenAI-compatible server; each named provider has a default. */
  aiBaseUrl?: string | null;
  /** False for a model that can't read photos: photo meals answer `ai_no_vision`. */
  aiVision?: boolean;
  anthropicApiKey?: string | null;
  /** Required by Anthropic keys that are not scoped to a workspace. */
  anthropicWorkspaceId?: string | null;
  /** The model, else the provider's default. */
  aiModel?: string;
  /** Development only: canned AI answers. */
  aiMock?: boolean;
}

/**
 * The AI providers a server can use, picked with AI_PROVIDER. Anthropic is the
 * default and the reference: the prompts were tuned on Claude. Every other
 * provider goes through the OpenAI-compatible adapter.
 */
export type AiProvider = 'anthropic' | 'openai' | 'mistral' | 'gemini' | 'openrouter' | 'ollama' | 'openai-compatible';

interface ProviderInfo {
  /** Used when AI_MODEL is unset; null: AI_MODEL is required. */
  model: string | null;
  /** The provider's own key variable, read when AI_API_KEY is unset. */
  keyVar: string | null;
  keyRequired: boolean;
  /** Used when AI_BASE_URL is unset; null: AI_BASE_URL is required (Anthropic needs none). */
  baseUrl: string | null;
  /** Null for Anthropic, which has its own adapter. */
  traits: ProviderTraits | null;
}

// Defaults checked against each provider's documentation (October 2026).
export const AI_PROVIDERS: Record<AiProvider, ProviderInfo> = {
  anthropic: { model: 'claude-opus-5-5', keyVar: 'ANTHROPIC_API_KEY', keyRequired: true, baseUrl: null, traits: null },
  openai: {
    model: 'gpt-6-astra',
    keyVar: 'OPENAI_API_KEY',
    keyRequired: true,
    baseUrl: 'https://api.openai.com/v1',
    traits: { tokenLimit: 'max_completion_tokens', effort: true, streamUsage: true, strictTools: true },
  },
  // Mistral's API rejects fields it doesn't know (no stream_options) and sends usage in the stream anyway.
  mistral: {
    model: 'mistral-large-4',
    keyVar: 'MISTRAL_API_KEY',
    keyRequired: true,
    baseUrl: 'https://api.mistral.ai/v1',
    traits: { tokenLimit: 'max_tokens', effort: true, streamUsage: false, strictTools: false },
  },
  gemini: {
    model: 'gemini-3.8-flash',
    keyVar: 'GEMINI_API_KEY',
    keyRequired: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    traits: { tokenLimit: null, effort: true, streamUsage: true, strictTools: false },
  },
  // Any model on OpenRouter; the default is the one Symbiose was tuned on. Usage always ends the stream.
  openrouter: {
    model: 'anthropic/claude-opus-5.5',
    keyVar: 'OPENROUTER_API_KEY',
    keyRequired: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    traits: { tokenLimit: null, effort: false, streamUsage: false, strictTools: false },
  },
  ollama: {
    model: 'gemma4',
    keyVar: 'OLLAMA_API_KEY',
    keyRequired: false,
    baseUrl: 'http://localhost:11434/v1',
    traits: { tokenLimit: null, effort: false, streamUsage: true, strictTools: false },
  },
  // LM Studio, vLLM, llama.cpp, LiteLLM…: AI_BASE_URL and AI_MODEL say where and what.
  'openai-compatible': {
    model: null,
    keyVar: null,
    keyRequired: false,
    baseUrl: null,
    traits: { tokenLimit: null, effort: false, streamUsage: true, strictTools: false },
  },
};

export const isAiProvider = (name: string): name is AiProvider => Object.hasOwn(AI_PROVIDERS, name);

export type AiSetup =
  | { provider: 'anthropic'; model: string; apiKey: string; workspaceId: string | null }
  | { provider: Exclude<AiProvider, 'anthropic'>; model: string; apiKey: string | null; baseUrl: string; vision: boolean; traits: ProviderTraits };

/** What the configuration asks for, or what's missing for it (in words for the startup log). */
export function resolveAi(config: AiConfig): AiSetup | { problem: string } {
  const name = config.aiProvider ?? 'anthropic';
  if (!isAiProvider(name)) return { problem: `unknown AI_PROVIDER "${name}" (use ${Object.keys(AI_PROVIDERS).join(', ')})` };
  const info = AI_PROVIDERS[name];
  const apiKey = config.aiApiKey || (name === 'anthropic' ? config.anthropicApiKey : null) || null;
  const model = config.aiModel || info.model;
  const baseUrl = config.aiBaseUrl || info.baseUrl;
  const missing = [
    info.keyRequired && !apiKey ? (info.keyVar ? `AI_API_KEY or ${info.keyVar}` : 'AI_API_KEY') : null,
    info.traits && !baseUrl ? 'AI_BASE_URL' : null,
    model ? null : 'AI_MODEL',
  ].filter((what): what is string => what !== null);
  if (missing.length) {
    return {
      problem: config.aiProvider ? `AI_PROVIDER=${name} needs ${missing.join(' and ')}` : 'set ANTHROPIC_API_KEY, or AI_PROVIDER for another provider',
    };
  }
  if (name === 'anthropic') return { provider: name, model: model!, apiKey: apiKey!, workspaceId: config.anthropicWorkspaceId ?? null };
  return { provider: name, model: model!, apiKey, baseUrl: baseUrl!, vision: config.aiVision ?? true, traits: info.traits! };
}

/** The startup log's line about the AI: who answers, or what's missing. */
export function describeAi(config: AiConfig): { ok: boolean; lines: string[] } {
  const setup = resolveAi(config);
  if ('problem' in setup) return { ok: false, lines: [`AI disabled: ${setup.problem}. The app still works without it (barcodes, manual logging).`] };
  if (setup.provider === 'anthropic') return { ok: true, lines: [`AI: anthropic · ${setup.model}`] };
  const local = setup.provider === 'ollama' || setup.provider === 'openai-compatible';
  return {
    ok: true,
    lines: [
      `AI: ${setup.provider} · ${setup.model}${local || config.aiBaseUrl ? ` at ${setup.baseUrl}` : ''}${setup.vision ? '' : ' · no photos (AI_VISION=false)'}`,
      'AI: Symbiose was tuned on Claude; other models may be less precise.',
    ],
  };
}
