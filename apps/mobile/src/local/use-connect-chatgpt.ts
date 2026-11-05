import { useCallback, useState } from 'react';

import { haptics } from '@/lib/haptics';

import { useAiSettings } from './ai-settings';
import { checkChatGptPlan } from './chatgpt';
import { signInWithChatGpt, signOutOfChatGpt } from './chatgpt-auth';

export type ChatGptStage =
  | { stage: 'idle' }
  | { stage: 'signingIn' }
  | { stage: 'checking' }
  /** Signed in, and the plan can be used: the one-time « you're using your ChatGPT plan ». */
  | { stage: 'connected' }
  /** A free plan: it can sign in, not lend its usage. */
  | { stage: 'notEligible' }
  | { stage: 'failed'; message?: string }
  /** No loopback module in this build (web, Expo Go). */
  | { stage: 'unavailable' };

/**
 * « Continuer avec ChatGPT »: sign in, check the plan can be used here, and
 * keep the choice with the consent given on the screen that offered it.
 */
export function useConnectChatGpt() {
  const [state, setState] = useState<ChatGptStage>({ stage: 'idle' });
  const save = useAiSettings((s) => s.save);

  const connect = useCallback(async () => {
    setState({ stage: 'signingIn' });
    const signedIn = await signInWithChatGpt();
    if (!signedIn.ok) {
      if (signedIn.reason === 'cancelled') return setState({ stage: 'idle' });
      haptics.warning();
      return setState(signedIn.reason === 'unavailable' ? { stage: 'unavailable' } : { stage: 'failed', message: signedIn.message });
    }
    setState({ stage: 'checking' });
    const plan = await checkChatGptPlan();
    if (!plan.ok && plan.code === 'ai_not_eligible') {
      // Nothing to keep: the plan can't be used, and another account may follow.
      await signOutOfChatGpt().catch(() => false);
      haptics.warning();
      return setState({ stage: 'notEligible' });
    }
    if (!plan.ok && plan.code === 'ai_reconnect') {
      haptics.warning();
      return setState({ stage: 'failed' });
    }
    // A limit reached or no network right now still means the plan is theirs: it works when it can.
    await save({ kind: 'chatgpt' }, { provider: 'OpenAI', at: new Date().toISOString() });
    haptics.success();
    setState({ stage: 'connected' });
  }, [save]);

  const reset = useCallback(() => setState({ stage: 'idle' }), []);

  return { state, connect, reset, busy: state.stage === 'signingIn' || state.stage === 'checking' };
}
