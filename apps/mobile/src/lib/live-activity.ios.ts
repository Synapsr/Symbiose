import { ExtensionStorage } from '@bacons/apple-targets';
import type { CravingOutcome } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

import { LiveActivity } from '../../modules/live-activity';

type Translate = ReturnType<typeof useI18n>['t'];
type Settled = Exclude<CravingOutcome, 'pending'>;

/** An urge usually rises and fades within minutes: ten minutes of company. */
const SURF_MS = 10 * 60_000;
/** How long « C'est passé ? » may wait before the app clears it. */
const CHECK_IN_GRACE_S = 20 * 60;
const LINES = ['craving.activity.line1', 'craving.activity.line2', 'craving.activity.line3'] as const;

/** Written by the Live Activity buttons (targets/controls/_shared/CravingIntents.swift). */
const appGroup = new ExtensionStorage('group.io.synapsr.symbiose');

/** « Surfer l'envie »: a ten-minute countdown on the Lock Screen and in the Dynamic Island. */
export function startCravingActivity(cravingId: string, t: Translate) {
  if (!LiveActivity?.areEnabled()) return;
  const startedAt = Date.now();
  LiveActivity.startCraving({
    cravingId,
    startedAt,
    endsAt: startedAt + SURF_MS,
    copy: {
      title: t('craving.activity.title'),
      line: t(LINES[Math.floor(Math.random() * LINES.length)]!),
      staleTitle: t('craving.activity.staleTitle'),
      staleLine: t('craving.activity.staleLine'),
      resisted: t('craving.resisted'),
      gaveIn: t('craving.gaveIn'),
      resistedDone: t('craving.activity.resistedDone'),
      gaveInDone: t('craving.activity.gaveInDone'),
    },
  }).catch(() => {
    // A bonus, never a blocker: the craving is logged either way.
  });
}

/** The outcome was recorded in the app: the activity says so briefly, then leaves. */
export function endCravingActivity(cravingId: string, outcome: Settled | null) {
  LiveActivity?.endCraving(cravingId, outcome).catch(() => {});
}

/**
 * Each time the app comes back: sends the outcomes tapped on the Lock Screen
 * while offline, refreshes the day they changed, and clears activities whose
 * « C'est passé ? » was left unanswered (iOS cannot end them on a timer).
 */
export function useCravingActivitySync() {
  const { api } = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!LiveActivity) return;
    const sync = async () => {
      LiveActivity?.endStale(CHECK_IN_GRACE_S).catch(() => {});
      const changed = appGroup.get('craving.changed');
      const pending = parsePending(appGroup.get('craving.pendingOutcomes'));
      if (!changed && !Object.keys(pending).length) return;
      appGroup.remove('craving.changed');
      appGroup.remove('craving.pendingOutcomes');

      const retry: Record<string, Settled> = {};
      for (const [id, outcome] of Object.entries(pending)) {
        try {
          await api?.updateCraving(id, { outcome });
        } catch (error) {
          // Still offline: next time. Any other answer is final.
          if (error instanceof ApiError && error.status === 0) retry[id] = outcome;
        }
      }
      if (Object.keys(retry).length) appGroup.set('craving.pendingOutcomes', JSON.stringify(retry));
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['progress'] });
    };

    void sync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => sub.remove();
  }, [api, queryClient]);
}

function parsePending(raw: string | null): Record<string, Settled> {
  if (!raw) return {};
  try {
    const entries = Object.entries(JSON.parse(raw) as Record<string, unknown>);
    return Object.fromEntries(entries.filter((entry): entry is [string, Settled] => entry[1] === 'resisted' || entry[1] === 'gave_in'));
  } catch {
    return {};
  }
}
