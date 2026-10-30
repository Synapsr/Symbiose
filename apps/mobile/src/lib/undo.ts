import { useCallback } from 'react';
import { create } from 'zustand';

import { useI18n } from '@/i18n';

import { haptics } from './haptics';
import { useToast } from './stores';

/** Entries deleted but still inside their undo window: every list leaves them out. */
const useHidden = create<{ ids: Record<string, true> }>(() => ({ ids: {} }));

const setHidden = (id: string, hidden: boolean) =>
  useHidden.setState((s) => {
    const ids = { ...s.ids };
    if (hidden) ids[id] = true;
    else delete ids[id];
    return { ids };
  });

/** Which ids are waiting to be deleted, to filter lists with. */
export function useHiddenIds(): Record<string, true> {
  return useHidden((s) => s.ids);
}

export interface UndoableDelete {
  /** Hidden at once from every list that filters with `useHiddenIds`. */
  id: string;
  message: string;
  /** The real delete: it only runs once the toast is gone. */
  commit: () => Promise<unknown>;
  /** The entry is back: put back anything changed optimistically. */
  restore?: () => void;
}

/**
 * The one way to delete anything (a meal, a note, a session): it leaves at
 * once, the toast offers « Annuler », and the server only hears about it when
 * the toast leaves (timed out, replaced, or the app went to the background).
 * So « Annuler » is a real undo, never a copy. No alerts.
 */
export function useUndoableDelete() {
  const { t } = useI18n();
  const show = useToast((s) => s.show);
  return useCallback(
    ({ id, message, commit, restore }: UndoableDelete) => {
      haptics.tap();
      setHidden(id, true);
      const back = () => {
        setHidden(id, false);
        restore?.();
      };
      show({
        message,
        action: { label: t('today.undo'), onPress: back },
        onExpire: () => {
          // Still hidden on success: the refetch that follows removes it for good.
          void commit().catch(() => {
            haptics.warning();
            back();
          });
        },
      });
    },
    [show, t],
  );
}
