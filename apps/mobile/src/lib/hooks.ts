import { shortId, toLocalDate, type CreateMealInput, type Meal } from '@symbiose/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useI18n } from '@/i18n';

import { ApiError } from './api';
import { haptics } from './haptics';
import { grantedScopes, health, HEALTH_SCOPES, healthModules, inferWalkIntensity } from './health';
import { useApi, useUser } from './session';
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

// Today and Me both mount the sync hook: one run at a time is enough.
let syncing = false;

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Noon `days` days ago: a window that starts there never cuts a night in two. */
const noonDaysAgo = (days: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12);
};

/** From noon a few days before the last sync (data may land late), `first` days back the first time. */
const sinceLastSync = (last: number, overlapDays: number, first: number) =>
  noonDaysAgo(last ? Math.min(first, Math.ceil((Date.now() - last) / DAY) + overlapDays) : first);

/**
 * Pulls the watch's data from the phone's health store and sends it to the
 * server, each kind at its own pace: today's activity and (when tracked)
 * drinks every 10 min, sleep every 30 min, workouts every hour, weights and
 * (when tracked) blood pressure every 6 hours.
 */
export function useHealthSync(today: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const user = useUser();
  const enabled = useSettings((s) => s.healthEnabled);
  const setSettings = useSettings((s) => s.set);
  const modules = healthModules(user.profile);
  const trackBp = modules.bloodPressure === true;
  const trackSleep = modules.sleep === true;
  const trackWater = modules.hydration === true;
  const weightKg = user.profile?.weightKg ?? null;

  const sync = useCallback(
    async (force = false) => {
      if (!enabled || !health.source || syncing) return;
      const source = health.source;
      const due = (last: number, every: number) => force || Date.now() - last >= every;
      syncing = true;
      try {
        await askForNewTypes();
        await syncDay();
        await syncWeights();
        await syncWorkouts();
        await syncBloodPressure();
        await syncSleep();
        await syncWater();
      } finally {
        syncing = false;
      }

      // Connected with an older version, or just turned a module on: ask once for the new types.
      async function askForNewTypes() {
        const settings = useSettings.getState();
        const wanted = grantedScopes({ bloodPressure: trackBp, sleep: trackSleep, hydration: trackWater });
        const missing = (Object.keys(wanted) as (keyof typeof wanted)[]).some((key) => settings[key] < wanted[key]!);
        if (settings.healthScopes >= HEALTH_SCOPES && !missing) return;
        await health.connect({ bloodPressure: trackBp, sleep: trackSleep, hydration: trackWater }).catch(() => false);
        setSettings({ healthScopes: HEALTH_SCOPES, ...wanted });
      }

      async function syncDay() {
        if (!due(useSettings.getState().lastHealthSync, 10 * 60_000)) return;
        try {
          const day = await health.readDay(new Date());
          await api.putActivity({ localDate: today, ...day, source });
          setSettings({ lastHealthSync: Date.now() });
          void queryClient.invalidateQueries({ queryKey: ['day', today] });
        } catch {
          // Health data is a bonus: never block the app on it.
        }
      }

      // Weight history: 90 days the first time, then the last two weeks.
      async function syncWeights() {
        const { lastWeightSync } = useSettings.getState();
        if (!due(lastWeightSync, 6 * HOUR)) return;
        try {
          const since = new Date(Date.now() - (lastWeightSync ? 14 : 90) * DAY);
          const readings = await health.readWeights(since, new Date());
          if (readings.length) {
            await api.putWeights({
              source,
              samples: readings.map((r) => ({ measuredAt: r.measuredAt.toISOString(), localDate: toLocalDate(r.measuredAt), kg: r.kg })),
            });
            void queryClient.invalidateQueries({ queryKey: ['insights'] });
            void queryClient.invalidateQueries({ queryKey: ['me'] });
          }
          setSettings({ lastWeightSync: Date.now() });
        } catch {
          // Same: weight is a bonus.
        }
      }

      // Workouts: 30 days the first time, then the last week. The server de-duplicates (and updates) by id.
      async function syncWorkouts() {
        const { lastWorkoutSync } = useSettings.getState();
        if (!due(lastWorkoutSync, HOUR)) return;
        try {
          const since = new Date(Date.now() - (lastWorkoutSync ? 7 : 30) * DAY);
          const workouts = (await health.readWorkouts(since, new Date())).map((w) => inferWalkIntensity(w, weightKg));
          for (let i = 0; i < workouts.length; i += 500) await api.putWorkouts(workouts.slice(i, i + 500));
          setSettings({ lastWorkoutSync: Date.now() });
          if (workouts.length) {
            void queryClient.invalidateQueries({ queryKey: ['day'] });
            void queryClient.invalidateQueries({ queryKey: ['insights'] });
          }
        } catch {
          // Same: workouts are a bonus.
        }
      }

      // Blood pressure, only for people who opted in: 90 days the first time, then the last two weeks.
      async function syncBloodPressure() {
        const { lastBpSync } = useSettings.getState();
        if (!trackBp || !due(lastBpSync, 6 * HOUR)) return;
        try {
          const since = new Date(Date.now() - (lastBpSync ? 14 : 90) * DAY);
          const readings = await health.readBloodPressure(since, new Date());
          for (let i = 0; i < readings.length; i += 1000) await api.putBloodPressure({ readings: readings.slice(i, i + 1000), source });
          setSettings({ lastBpSync: Date.now() });
          if (readings.length) void queryClient.invalidateQueries({ queryKey: ['insights'] });
        } catch {
          // Same.
        }
      }

      // Sleep, only for people who opted in: 30 nights the first time, then from 2 nights before the last sync (a watch may sync late).
      async function syncSleep() {
        const { lastSleepSync } = useSettings.getState();
        if (!trackSleep || !due(lastSleepSync, 30 * 60_000)) return;
        try {
          const nights = await health.readSleep(sinceLastSync(lastSleepSync, 2, 31), new Date());
          for (let i = 0; i < nights.length; i += 1000) await api.putSleep({ nights: nights.slice(i, i + 1000), source });
          setSettings({ lastSleepSync: Date.now() });
          if (nights.length) {
            void queryClient.invalidateQueries({ queryKey: ['day'] });
            void queryClient.invalidateQueries({ queryKey: ['insights'] });
          }
        } catch {
          // Same.
        }
      }

      // Drinks from other apps, only for people who opted in: 30 days the first time, then from the day before the last sync.
      async function syncWater() {
        const { lastWaterSync } = useSettings.getState();
        if (!trackWater || !due(lastWaterSync, 10 * 60_000)) return;
        try {
          const entries = await health.readWater(sinceLastSync(lastWaterSync, 1, 30), new Date());
          for (let i = 0; i < entries.length; i += 1000) await api.putWater({ entries: entries.slice(i, i + 1000), source });
          setSettings({ lastWaterSync: Date.now() });
          if (entries.length) {
            void queryClient.invalidateQueries({ queryKey: ['day'] });
            void queryClient.invalidateQueries({ queryKey: ['insights'] });
          }
        } catch {
          // Same.
        }
      }
    },
    [api, enabled, queryClient, setSettings, today, trackBp, trackSleep, trackWater, weightKg],
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

/** Invalidates everything a workout change can affect. */
export function useRefreshAfterWorkout() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['day'] });
    void queryClient.invalidateQueries({ queryKey: ['insights'] });
  }, [queryClient]);
}
