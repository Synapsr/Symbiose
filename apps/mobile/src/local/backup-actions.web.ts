import type { TranslationKey } from '@/i18n/fr';

// The web build is a development tool talking to a server: no data on the device to back up.

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function ask(title: string, message: string): Promise<boolean> {
  return Promise.resolve(Boolean(globalThis.confirm?.(`${title}\n\n${message}`)));
}
export const shareBackup = (_t: T) => Promise.resolve(false);
export const restoreBackupFromPicker = (_t: T) => Promise.resolve(false);
export const uploadToServer = (_t: T, _serverUrl: string, _token: string) => Promise.resolve(false);
export const downloadFromServer = (_t: T, _serverUrl: string, _token: string) => Promise.resolve(false);
