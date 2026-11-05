import { useSettings } from '@/lib/stores';

import { useAiSettings } from './ai-settings';
import { erasePhoneData } from './backup';
import { signOutOfChatGpt } from './chatgpt-auth';

/**
 * « Effacer toutes mes données »: the database, the photos, the AI and its
 * key or ChatGPT session. The phone is as before the first « Commencer ».
 */
export async function eraseAllPhoneData(): Promise<void> {
  if (useAiSettings.getState().choice?.kind === 'chatgpt') await signOutOfChatGpt().catch(() => false);
  await useAiSettings.getState().save(null);
  erasePhoneData();
  useSettings.getState().set({ lastBackupAt: '' });
}
