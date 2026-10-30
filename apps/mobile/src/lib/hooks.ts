import { shortId, toLocalDate, type CreateMealInput, type Meal } from '@symbiose/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useI18n } from '@/i18n';

import { ApiError } from './api';
import { haptics } from './haptics';
import { health } from './health';
import { useApi } from './session';
import { usePending, useSettings, useToast, type PendingMeal } from './stores';

/** Today's local date, refreshed when the app returns to the foreground. */
export function useToday(): string {
  const [today, setToday] = useState(toLocalDate);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(toLocalDate());
    });
    const timer = setInterval(() => setToday(toLocalDate()), 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);
  return today;
}

export function useDay(date: string) {
  const api = useApi();
  return useQuery({ queryKey: ['day', date], queryFn: () => api.day(date) });
}

export function errorMessage(error: unknown, fallback: string, offline: string): string {
  if (error instanceof ApiError) return error.status === 0 ? offline : error.message;
  return fallback;
}

/** Invalidates everything a meal change can affect. */
export function useRefreshAfterMeal() {
  const queryClient = useQueryClient();
  return useCallback(
    (meal: Pick<Meal, 'localDate'>) => {
      void queryClient.invalidateQueries({ queryKey: ['day', meal.localDate] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    [queryClient],
  );
}

/**
 * Optimistic meal logging: the meal shows up immediately as "analyzing" on
 * the Today screen while the server and the AI do their work.
 */
export function useMealLogger() {
  const api = useApi();
  const { t } = useI18n();
  const refresh = useRefreshAfterMeal();
  const upsert = usePending((s) => s.upsert);
  const remove = usePending((s) => s.remove);
  const showToast = useToast((s) => s.show);
  const healthEnabled = useSettings((s) => s.healthEnabled);

  const run = useCallback(
    async (entry: PendingMeal) => {
      upsert({ ...entry, status: 'analyzing', error: null });
      try {
        const meal = await api.createMeal(entry.input);
        remove(entry.id);
        refresh(meal);
        haptics.success();
        showToast({
          message: `${t('today.mealLogged')} · ${meal.title}`,
          onPress: () => router.push({ pathname: '/meal/[id]', params: { id: meal.id } }),
          action: {
            label: t('today.undo'),
            onPress: () => void api.deleteMeal(meal.id).then(() => refresh(meal)),
          },
        });
        if (healthEnabled) void health.writeMeal(meal).catch(() => undefined);
        return meal;
      } catch (error) {
        haptics.warning();
        upsert({ ...entry, status: 'error', error: errorMessage(error, t('common.error'), t('common.offline')) });
        return null;
      }
    },
    [api, healthEnabled, refresh, remove, showToast, t, upsert],
  );

  const log = useCallback(
    (input: CreateMealInput, preview: { photoUri?: string | null; label: string }) =>
      run({
        id: shortId(),
        input,
        photoUri: preview.photoUri ?? null,
        label: preview.label,
        status: 'analyzing',
        error: null,
        startedAt: Date.now(),
      }),
    [run],
  );

  return { log, retry: run, dismiss: remove };
}

/**
 * Pulls today's activity (steps, active energy, weight) from the watch via
 * the phone's health store and sends it to the server, at most every 10 min.
 */
export function useHealthSync(today: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const enabled = useSettings((s) => s.healthEnabled);
  const setSettings = useSettings((s) => s.set);

  const sync = useCallback(
    async (force = false) => {
      if (!enabled || !health.source) return;
      const { lastHealthSync } = useSettings.getState();
      if (!force && Date.now() - lastHealthSync < 10 * 60_000) return;
      try {
        const day = await health.readDay(new Date());
        await api.putActivity({ localDate: today, ...day, source: health.source });
        setSettings({ lastHealthSync: Date.now() });
        void queryClient.invalidateQueries({ queryKey: ['day', today] });
      } catch {
        // Health data is a bonus: never block the app on it.
      }
    },
    [api, enabled, queryClient, setSettings, today],
  );

  useEffect(() => {
    void sync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => sub.remove();
  }, [sync]);

  return sync;
}
