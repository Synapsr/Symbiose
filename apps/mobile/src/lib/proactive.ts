import {
  answerOffer,
  localTime,
  startOfWeek,
  toLocalDate,
  type CoachMessage,
  type ProactiveOffer,
  type ProactiveSchedule,
  type ProactiveSettingsPatch,
} from '@symbiose/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { useI18n } from '@/i18n';

import type { Api } from './api';
import { haptics } from './haptics';
import { useDay, useHealthSync, useToday } from './hooks';
import { askNotificationPermission, replaceScheduled, setupCategories, useNotificationResponses } from './notify';
import { morningDue, nudgeFor, planNotifications, proactiveLine, type LineKind, type PlanCopy, type ProactiveLine } from './proactive-plan';
import { useApi, useSession } from './session';
import { useSettings } from './stores';

/**
 * The proactive coach on the phone: the server's schedule, the morning
 * check-in being written, the notifications planned from both, and the
 * one sentence Today shows.
 */

const minutesNow = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/** Today's schedule: settings, times, the day's check-in once written. */
export function useProactive() {
  const { api } = useSession();
  const today = useToday();
  return useQuery({ queryKey: ['proactive', today], queryFn: () => api!.proactive(today), enabled: Boolean(api), staleTime: 5 * 60_000 });
}

function patchSchedule(old: ProactiveSchedule | undefined, patch: ProactiveSettingsPatch): ProactiveSchedule | undefined {
  if (!old) return old;
  const offers = patch.offers ? { ...old.settings.offers, ...patch.offers } : old.settings.offers;
  return { ...old, settings: { ...old.settings, ...patch, cravings: patch.cravings ?? old.settings.cravings, offers } };
}

/** Saves settings: shown at once, then the server's new schedule. Turning a feature on asks for what it needs, in context. */
export function useSaveProactive() {
  const api = useApi();
  const queryClient = useQueryClient();
  const today = useToday();
  const setSettings = useSettings((s) => s.set);
  return useMutation({
    mutationFn: (patch: ProactiveSettingsPatch) => api.saveProactive(patch, today),
    onMutate: (patch) => {
      queryClient.setQueryData<ProactiveSchedule>(['proactive', today], (old) => patchSchedule(old, patch));
      // Something that notifies was just turned on: ask now, while it makes sense.
      if (patch.enabled || patch.morning || patch.cravings || patch.weekly) void askNotificationPermission().catch(() => false);
      // The morning check-in reads the night's vitals: import their history once the store grants them.
      if (patch.enabled || patch.morning) setSettings({ lastVitalsSync: 0 });
    },
    onSuccess: (schedule) => {
      queryClient.setQueryData(['proactive', today], schedule);
      // The profile carries the settings: the health sync reads them to ask for the vitals.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: () => {
      haptics.warning();
      void queryClient.invalidateQueries({ queryKey: ['proactive'] });
    },
  });
}

/** « Oui » / « Non » to an offer of the coach line. */
export function useAnswerOffer() {
  const save = useSaveProactive();
  const schedule = useProactive().data;
  return (offer: ProactiveOffer, yes: boolean) => {
    if (!schedule) return;
    if (yes) haptics.success();
    save.mutate(answerOffer(schedule.settings, offer, yes));
  };
}

// ---------------------------------------------------------------- The morning check-in being written

interface MorningDraft {
  date: string;
  text: string;
  message: CoachMessage | null;
  writing: boolean;
}

/** Shared by the coach line, the Coach thread and the sync: one check-in, written once. */
export const useMorningDraft = create<{ draft: MorningDraft | null }>(() => ({ draft: null }));

let inFlight: { date: string; promise: Promise<CoachMessage | null> } | null = null;

/** Writes (or fetches, when already written) the day's check-in, streaming it into `useMorningDraft`. */
export function writeMorning(api: Api, queryClient: QueryClient, date: string, hideCalories: boolean): Promise<CoachMessage | null> {
  if (inFlight?.date === date) return inFlight.promise;
  const set = useMorningDraft.setState;
  set({ draft: { date, text: '', message: null, writing: true } });
  const promise = api
    .streamMorning(date, hideCalories, (delta) => set((s) => (s.draft?.date === date ? { draft: { ...s.draft, text: s.draft.text + delta } } : s)))
    .then(({ message }) => {
      set({ draft: { date, text: message.content, message, writing: false } });
      queryClient.setQueryData<ProactiveSchedule>(['proactive', date], (old) => old && { ...old, today: { messageId: message.id, content: message.content } });
      void queryClient.invalidateQueries({ queryKey: ['coach'] });
      return message;
    })
    .catch(() => {
      set({ draft: null });
      return null;
    })
    .finally(() => {
      if (inFlight?.date === date) inFlight = null;
    });
  inFlight = { date, promise };
  return promise;
}

/** The check-in was read in the app: today's notification is no longer needed. */
export function markMorningSeen(date: string) {
  const { morningSeen, set } = useSettings.getState();
  if (morningSeen !== date) set({ morningSeen: date });
}

// ---------------------------------------------------------------- Sync (mounted once, in the tabs)

function useCopy(): PlanCopy {
  const { t } = useI18n();
  return {
    morningTitle: t('proactive.notif.morningTitle'),
    morningReadyTitle: t('proactive.notif.morningReadyTitle'),
    morningBody: t('proactive.notif.morningBody'),
    morningReview: t('proactive.notif.morningReview'),
    weeklyTitle: t('proactive.notif.weeklyTitle'),
    weeklyBody: t('proactive.notif.weeklyBody'),
    cravingsTitle: t('proactive.notif.cravingsTitle'),
    cravingsFallback: [t('proactive.nudge1'), t('proactive.nudge2'), t('proactive.nudge3')],
  };
}

/**
 * Keeps the proactive coach in step: the week's nudges, the morning check-in
 * written as soon as the person is up (after a fresh sleep sync), the
 * notifications re-planned whenever anything changes, and taps on them.
 */
export function useProactiveSync() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const today = useToday();
  const schedule = useProactive().data ?? null;
  const day = useDay(today);
  const syncHealth = useHealthSync(today);
  const hideCalories = useSettings((s) => s.hideCalories);
  const morningSeen = useSettings((s) => s.morningSeen);
  const nudges = useSettings((s) => s.nudges);
  const setSettings = useSettings((s) => s.set);
  const copy = useCopy();

  // Back in the app: a new night may have landed, a craving may have been logged.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queryClient.invalidateQueries({ queryKey: ['proactive'] });
    });
    return () => sub.remove();
  }, [queryClient]);

  // The heads-up's buttons, in the person's language.
  const cravingAction = t('proactive.notif.cravingAction');
  const fineAction = t('proactive.notif.fineAction');
  useEffect(() => {
    void setupCategories({ craving: cravingAction, fine: fineAction }).catch(() => undefined);
  }, [cravingAction, fineAction]);

  // The week's nudges, written once a week by the server and kept here for the notifications ahead.
  const week = startOfWeek(today);
  const wantsNudges = Boolean(schedule?.settings.enabled && schedule.settings.cravings && schedule.cravings) && nudges?.week !== week;
  useEffect(() => {
    if (!wantsNudges) return;
    api
      .nudges(today)
      .then((fresh) => setSettings({ nudges: fresh }))
      .catch(() => undefined);
  }, [api, setSettings, today, wantsNudges]);

  // The person is up: sync the night (and its vitals) first, then write the check-in, before its notification.
  // Not once it was read, or the conversation cleared, today.
  useEffect(() => {
    if (!schedule || morningSeen === today || !morningDue(schedule, today, minutesNow())) return;
    void syncHealth()
      .catch(() => undefined)
      .then(() => writeMorning(api, queryClient, today, hideCalories));
  }, [api, hideCalories, morningSeen, queryClient, schedule, syncHealth, today]);

  // The plan, replaced whenever an input changes.
  const cravingTimes = (day.data?.cravings.items ?? []).map((c) => localTime(c.at)).join(',');
  const weekNudges = nudges?.week === week ? nudges.lines : null;
  const copyKey = JSON.stringify(copy);
  useEffect(() => {
    if (!schedule) return;
    const planned = planNotifications({
      schedule,
      today,
      nowMinutes: minutesNow(),
      morningSeen,
      cravingTimes: cravingTimes ? cravingTimes.split(',') : [],
      nudges: weekNudges ?? [],
      copy: JSON.parse(copyKey) as PlanCopy,
    });
    void replaceScheduled(planned);
  }, [copyKey, cravingTimes, morningSeen, schedule, today, weekNudges]);
  // Signed out (the tabs go away): nothing more from this account's coach.
  useEffect(() => () => void replaceScheduled([]), []);

  // Taps on the notifications and their buttons.
  useNotificationResponses(({ data, action }) => {
    if (action === 'fine') return;
    if (action === 'craving') return router.push('/craving');
    if (data.kind === 'weekly') return router.navigate('/insights');
    if (data.kind === 'morning') {
      // Lands on the check-in in the Coach thread, written now if it isn't yet.
      if (data.date === toLocalDate()) void writeMorning(api, queryClient, data.date, useSettings.getState().hideCalories);
      return router.navigate('/coach');
    }
    router.navigate('/');
  });
}

// ---------------------------------------------------------------- The coach line

/** Minutes since midnight, refreshed every minute: the heads-up has its moment. */
function useMinutes() {
  const [minutes, setMinutes] = useState(minutesNow);
  useEffect(() => {
    const timer = setInterval(() => setMinutes(minutesNow()), 60_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setMinutes(minutesNow());
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  return minutes;
}

export interface ProactiveLineState {
  line: ProactiveLine | null;
  /** The day's nudge, for the heads-up. */
  nudge: string | null;
  dismiss: (kind: LineKind) => void;
}

/** What Today's coach line says on `date`: a proactive sentence today, else nothing (the day's usual line). */
export function useProactiveLine(date: string): ProactiveLineState {
  const today = useToday();
  const nowMinutes = useMinutes();
  const schedule = useProactive().data ?? null;
  const draft = useMorningDraft((s) => s.draft);
  const day = useDay(today);
  const dismissed = useSettings((s) => s.lineDismissed);
  const nudges = useSettings((s) => s.nudges);
  const setSettings = useSettings((s) => s.set);

  const morning = draft?.date === today ? { messageId: draft.message?.id ?? null, content: draft.text, writing: draft.writing } : null;
  const line =
    date === today
      ? proactiveLine({
          schedule,
          today,
          nowMinutes,
          dismissed: (dismissed.date === today ? dismissed.kinds : []) as LineKind[],
          cravingTimes: (day.data?.cravings.items ?? []).map((c) => localTime(c.at)),
          morning,
        })
      : null;

  const dismiss = (kind: LineKind) => {
    const kinds = dismissed.date === today ? dismissed.kinds : [];
    setSettings({ lineDismissed: { date: today, kinds: [...new Set([...kinds, kind])] } });
    if (kind === 'morning') markMorningSeen(today);
  };
  return { line, nudge: nudgeFor(today, nudges?.week === startOfWeek(today) ? nudges.lines : []), dismiss };
}
