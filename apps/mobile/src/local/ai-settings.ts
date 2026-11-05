import type { AiProvider } from '@symbiose/core';
import { create } from 'zustand';

import { storage } from '@/lib/storage';

/**
 * The AI the person chose on a phone without a server. Kept in the Keychain
 * (Keystore on Android) with its key: never in the App Group, never sent to
 * the watch, never logged.
 */
export type AiChoice =
  /** Their ChatGPT plan (Sign in with ChatGPT); the tokens are kept apart (`chatgpt-auth.ts`). */
  | { kind: 'chatgpt'; model?: string | null }
  /** Development builds only: canned answers, no network (like the server's AI_MOCK). */
  | { kind: 'mock' }
  /** A provider and its API key (OpenRouter's comes from its sign-in or is pasted). */
  | {
      kind: 'key';
      provider: AiProvider;
      apiKey: string | null;
      model?: string | null;
      /** Ollama and other OpenAI-compatible servers. */
      baseUrl?: string | null;
      /** False for a model that can't read photos. */
      vision?: boolean;
      /** Anthropic keys not scoped to a workspace. */
      workspaceId?: string | null;
    };

/** Who the person agreed to send their data to, and when (App Store 5.1.2(i)). */
export interface AiConsent {
  provider: string;
  at: string;
}

interface AiSettingsState {
  loaded: boolean;
  choice: AiChoice | null;
  consent: AiConsent | null;
  load: () => Promise<void>;
  /** Saves a new choice with the consent given for it; null disconnects. */
  save: (choice: AiChoice | null, consent?: AiConsent | null) => Promise<void>;
}

const KEY = 'symbiose.ai';

export const useAiSettings = create<AiSettingsState>()((set, get) => ({
  loaded: false,
  choice: null,
  consent: null,
  load: async () => {
    try {
      const raw = await storage.get(KEY);
      const stored = raw ? (JSON.parse(raw) as { choice?: AiChoice | null; consent?: AiConsent | null }) : {};
      set({ choice: stored.choice ?? null, consent: stored.consent ?? null });
    } catch {
      set({ choice: null, consent: null });
    } finally {
      set({ loaded: true });
    }
  },
  save: async (choice, consent) => {
    const next = { choice, consent: choice ? (consent ?? get().consent) : null };
    await (choice ? storage.set(KEY, JSON.stringify(next)) : storage.remove(KEY));
    set(next);
  },
}));

/** A server's AI provider (`/api/info`), as people know it; null when the server doesn't say. */
export function serverProviderName(provider: string | null | undefined): string | null {
  if (!provider || provider === 'mock') return null;
  if (provider === 'chatgpt') return 'OpenAI';
  return provider in PROVIDER_NAMES ? PROVIDER_NAMES[provider as AiProvider] : provider;
}

/** The provider's name as people know it, for the consent and the settings. */
export function providerName(choice: AiChoice | null): string {
  if (!choice) return '';
  if (choice.kind === 'chatgpt') return 'OpenAI';
  if (choice.kind === 'mock') return 'Mock';
  return PROVIDER_NAMES[choice.provider];
}

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google',
  mistral: 'Mistral AI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI-compatible',
};
