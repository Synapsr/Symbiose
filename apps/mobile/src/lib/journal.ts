import type { JournalEntry, JournalKind } from '@symbiose/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useI18n } from '@/i18n';

import { useApi } from './session';
import { useUndoableDelete } from './undo';

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

/** Gone at once, back with « Annuler » (see `useUndoableDelete`); lists hide it with `useHiddenIds`. */
export function useDeleteNote(onDeleted?: () => void) {
  const api = useApi();
  const { t } = useI18n();
  const refresh = useRefreshAfterNote();
  const remove = useUndoableDelete();
  return useCallback(
    (entry: JournalEntry) => {
      remove({ id: entry.id, message: t('journal.deleted'), commit: () => api.deleteNote(entry.id).then(refresh) });
      onDeleted?.();
    },
    [api, onDeleted, refresh, remove, t],
  );
}
