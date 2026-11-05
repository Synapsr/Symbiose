import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';

import type { TranslationKey } from '@/i18n/fr';
import { haptics } from '@/lib/haptics';
import { useSettings, useToast } from '@/lib/stores';

import { BackupError, makePhoneBackup, restorePhoneBackup } from './backup';
import { phoneDataExists } from './db';

/**
 * What the person does with backups, with the questions and the words around
 * the file work of `backup.ts`: back up now, restore one, move to a server and
 * back. Every replacing step asks first; nothing is replaced on a failure.
 */

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A yes/no question; resolves with the answer. */
export function ask(title: string, message: string, action: string, cancel: string, destructive = true): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(Boolean(globalThis.confirm?.(`${title}\n\n${message}`)));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}

const problemText = (t: T, error: unknown) =>
  error instanceof BackupError && error.problem === 'not_a_backup'
    ? t('backup.notBackup')
    : error instanceof BackupError && (error.problem === 'newer_app' || error.problem === 'newer_format')
      ? t('backup.newer')
      : t('backup.restoreFailed');

/** « Sauvegarder maintenant »: the backup, then the share sheet (Drive, iCloud Drive, Files…). */
export async function shareBackup(t: T): Promise<boolean> {
  try {
    const file = await makePhoneBackup();
    await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', UTI: 'public.data', dialogTitle: t('backup.shareTitle') });
    useSettings.getState().set({ lastBackupAt: new Date().toISOString() });
    return true;
  } catch {
    haptics.warning();
    useToast.getState().show({ message: t('backup.failed') });
    return false;
  }
}

/** Picks a backup file and restores it; asks first when this phone already has data. */
export async function restoreBackupFromPicker(t: T): Promise<boolean> {
  const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets[0]) return false;
  if (phoneDataExists() && !(await ask(t('me.data.restore'), t('backup.restoreConfirm'), t('backup.replace'), t('common.cancel')))) return false;
  try {
    await restorePhoneBackup(new File(picked.assets[0].uri));
    haptics.success();
    useToast.getState().show({ message: t('backup.restored') });
    return true;
  } catch (error) {
    haptics.warning();
    Alert.alert(t('me.data.restore'), problemText(t, error));
    return false;
  }
}

/**
 * « Passer sur un serveur »: this phone's backup goes into the server account
 * just signed in to. True once the server holds it all.
 */
export async function uploadToServer(t: T, serverUrl: string, token: string): Promise<boolean> {
  const file = await makePhoneBackup();
  const send = (replace: boolean) =>
    uploadAsync(`${serverUrl}/api/me/restore${replace ? '?replace=1' : ''}`, file.uri, {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    });
  try {
    let res = await send(false);
    if (res.status === 409 && res.body.includes('account_not_empty')) {
      if (!(await ask(t('me.data.toServer'), t('move.replaceConfirm'), t('backup.replace'), t('common.cancel')))) return false;
      res = await send(true);
    }
    if (res.status === 200) return true;
    Alert.alert(t('me.data.toServer'), res.body.includes('ids_taken') ? t('move.alreadyThere') : t('move.failed'));
    return false;
  } catch {
    Alert.alert(t('me.data.toServer'), t('move.failed'));
    return false;
  }
}

/** « Ramener mes données sur ce téléphone »: the account's backup from the server replaces this phone's data. */
export async function downloadFromServer(t: T, serverUrl: string, token: string): Promise<boolean> {
  if (phoneDataExists() && !(await ask(t('me.data.toPhone'), t('move.toPhoneConfirm'), t('backup.replace'), t('common.cancel')))) return false;
  const folder = new Directory(Paths.cache, 'from-server');
  try {
    if (folder.exists) folder.delete();
    folder.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(`${serverUrl}/api/me/backup`, new File(folder, 'server.symbiose'), { headers: { authorization: `Bearer ${token}` } });
    await restorePhoneBackup(file);
    return true;
  } catch (error) {
    haptics.warning();
    Alert.alert(t('me.data.toPhone'), error instanceof BackupError ? problemText(t, error) : t('move.failed'));
    return false;
  } finally {
    if (folder.exists) folder.delete();
  }
}
