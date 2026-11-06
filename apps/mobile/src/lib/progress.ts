import { milestoneDue, type ProgressSummary } from '@symbiose/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import { useEffect } from 'react';

import { useI18n } from '@/i18n';

import { useToday } from './hooks';
import { replaceNotifications } from './notify';
import { STREAK_PREFIX, streakReminders } from './progress-logic';
import { useApi } from './session';
import { useSettings } from './stores';

/**
 * « Ta progression »: the streak, its rest days and the milestones, asked
 * only while « Séries et étapes » is on. An older server answers 404: the
 * flame then falls back on the day's streak.
 */
export function useProgress() {
  const api = useApi();
  const today = useToday();
  const on = useSettings((s) => s.motivation);
  return useQuery<ProgressSummary>({ queryKey: ['progress', today], queryFn: () => api.progress(today), enabled: on, staleTime: 60_000 });
}

/** How long the moment waits after the action: the « noté » toast and its sound come first. */
const CELEBRATE_AFTER_MS = 700;

/**
 * Celebrates a milestone reached today, once, when the tabs are in front
 * (never over the capture or the craving sheet: it waits for them to close).
 * The ones found already reached (an update, another phone, a day missed)
 * are noted quietly. Mounted once, in the tabs.
 */
export function useMilestoneCelebrations() {
  const focused = useIsFocused();
  const on = useSettings((s) => s.motivation);
  const set = useSettings((s) => s.set);
  const data = useProgress().data;

  useEffect(() => {
    if (!on || !data || !focused) return;
    const seen = useSettings.getState().milestonesSeen;
    const { due, seen: next } = milestoneDue(data, seen);
    if (!due) {
      if (next.length !== seen.length) set({ milestonesSeen: next });
      return;
    }
    // Noted when it shows: leaving Today before then keeps it for the next time.
    const timer = setTimeout(() => {
      set({ milestonesSeen: next });
      router.push({ pathname: '/milestone', params: { id: due.id, celebrate: '1' } });
    }, CELEBRATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [data, focused, on, set]);
}

const minutesNow = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

/**
 * The evening reminder, re-planned whenever the streak changes: nothing when
 * « Séries et étapes » or the reminder is off, or once today counts.
 */
export function useStreakReminderSync() {
  const { t } = useI18n();
  const today = useToday();
  const on = useSettings((s) => s.motivation && s.streakReminder);
  const progress = useProgress().data;
  const streak = on && progress?.today === today ? progress.streak : null;
  const title = t('streakReminder.title', { count: '{count}' });
  const later = t('streakReminder.titleLater');
  const body = t('streakReminder.body');
  // Only what the plan depends on: the run, today, its rest days (-1: no reminder).
  const current = streak?.current ?? -1;
  const todayLogged = streak?.todayLogged ?? false;
  const restDays = streak?.restDays ?? 0;

  useEffect(() => {
    if (current < 0) return void replaceNotifications(STREAK_PREFIX, []);
    const copy = { title: (count: number) => title.replace('{count}', String(count)), later, body };
    void replaceNotifications(STREAK_PREFIX, streakReminders({ current, todayLogged, restDays }, today, minutesNow(), copy));
  }, [current, todayLogged, restDays, today, title, later, body]);
  // Signed out (the tabs go away): no reminder for an account that isn't here.
  useEffect(() => () => void replaceNotifications(STREAK_PREFIX, []), []);
}
