import type { JournalEntry, JournalKind } from '@symbiose/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';

import { useI18n } from '@/i18n';

import { haptics } from './haptics';
import { useApi } from './session';
import { useToast } from './stores';

/** The notes between two days (newest first); every journal query shares the `journal` prefix. */
export function useJournal(range: { from: string; to: string; kind?: JournalKind }, options: { enabled?: boolean; keepPrevious?: boolean } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: ['journal', range.from, range.to, range.kind ?? null],
    queryFn: () => api.journal(range),
    enabled: options.enabled,
    // Loading older days keeps the list in place instead of flashing empty.
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
  });
}

/** A note already loaded by any journal query (Today, the Carnet), so the editor opens instantly. */
export function useCachedNote(id: string | undefined): JournalEntry | undefined {
  const queryClient = useQueryClient();
  if (!id) return undefined;
  return queryClient
    .getQueriesData<JournalEntry[]>({ queryKey: ['journal'] })
    .flatMap(([, entries]) => entries ?? [])
    .find((entry) => entry.id === id);
}

export function useRefreshAfterNote() {
  const queryClient = useQueryClient();
  return useCallback(() => void queryClient.invalidateQueries({ queryKey: ['journal'] }), [queryClient]);
}

/** Long-press → confirm → gone, with a toast to bring it back. */
export function useDeleteNote(onDeleted?: () => void) {
  const api = useApi();
  const { t } = useI18n();
  const refresh = useRefreshAfterNote();
  const showToast = useToast((s) => s.show);
  const { mutate: remove } = useMutation({
    mutationFn: (entry: JournalEntry) => api.deleteNote(entry.id),
    onSuccess: (_, entry) => {
      haptics.success();
      refresh();
      onDeleted?.();
      showToast({
        message: t('journal.deleted'),
        action: {
          label: t('today.undo'),
          onPress: () => void api.createNote({ at: entry.at, localDate: entry.localDate, kind: entry.kind, text: entry.text, data: entry.data }).then(refresh),
        },
      });
    },
    onError: () => haptics.warning(),
  });

  return useCallback(
    (entry: JournalEntry) => {
      haptics.impact();
      if (Platform.OS === 'web') {
        if (globalThis.confirm?.(`${t('journal.delete')}\n${t('journal.deleteBody')}`)) remove(entry);
        return;
      }
      Alert.alert(t('journal.delete'), t('journal.deleteBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => remove(entry) },
      ]);
    },
    [remove, t],
  );
}
