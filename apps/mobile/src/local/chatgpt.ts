import { createChatGptAi as planAi, type AiUsageListener, type ChatGptAi } from '@symbiose/core';

import { chatGptAccessToken } from './chatgpt-auth';

/** The AI of the person's ChatGPT plan, with the tokens kept on this phone. */
export function createChatGptAi(model: string | null, onUsage?: AiUsageListener): ChatGptAi {
  return planAi({ model, accessToken: chatGptAccessToken }, onUsage);
}

/**
 * Right after signing in: whether this plan can be used in other apps (Plus and
 * Pro can; a free plan can't), before the person goes on thinking it works.
 */
export async function checkChatGptPlan(): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await createChatGptAi(null).ping();
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { ok: false, code: typeof code === 'string' ? code : 'ai_error' };
  }
}
