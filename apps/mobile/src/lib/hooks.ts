import { shortId, toLocalDate, type CreateMealInput, type DaySummary, type Meal } from '@symbiose/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useI18n } from '@/i18n';

import { ApiError } from './api';
import { haptics } from './haptics';
import { grantedScopes, health, HEALTH_SCOPES, healthModules, inferWalkIntensity } from './health';
import { dropEntry, isNetworkError, kickOutbox, openOutbox, releaseCapture, stashCapture, useOutbox, type OutboxEntry } from './outbox';
import { uniqueEatenAt } from './outbox-logic';
import { useApi, useSession, useUser } from './session';
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

/** Every time already used that day, so a new capture gets its own (see `uniqueEatenAt`). */
function takenTimes(queryClient: QueryClient, localDate: string): string[] {
  return [
    ...useOutbox.getState().items.map((i) => i.eatenAt),
    ...usePending.getState().items.map((p) => p.input.eatenAt),
    ...(queryClient.getQueryData<DaySummary>(['day', localDate])?.meals.map((m) => m.eatenAt) ?? []),
  ];
}

/** A capture as the offline queue keeps it: everything but the photo bytes, which go to a file. */
function captureEntry({ id, input, label, startedAt }: PendingMeal): OutboxEntry {
  const { eatenAt, localDate, mealType, text, items, title, photoBase64 } = input;
  const emoji = photoBase64 ? null : (items?.find((i) => i.emoji)?.emoji ?? (text ? '✍️' : '🍽️'));
  return { id, kind: 'create', createdAt: startedAt, eatenAt, localDate, mealType, label, emoji, error: null, input: { text, items, title }, photo: Boolean(photoBase64) };
}

/**
 * Optimistic meal logging: the meal shows up immediately as "analyzing" on
 * the Today screen while the server and the AI do their work. Without
 * network, it waits on the phone instead and leaves on its own later.
 */
export function useMealLogger() {
  const api = useApi();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const refresh = useRefreshAfterMeal();
  const upsert = usePending((s) => s.upsert);
  const remove = usePending((s) => s.remove);
  const showToast = useToast((s) => s.show);
  const healthEnabled = useSettings((s) => s.healthEnabled);
  const { session, user } = useSession();
  const serverUrl = session?.serverUrl;
  const userId = user?.id;

  // Kept on the phone before the first request, in this account's queue: closing the app mid-way can't lose it.
  const keep = useCallback(
    (entry: OutboxEntry, photoBase64?: string) => {
      if (serverUrl && userId) openOutbox(serverUrl, userId);
      void stashCapture(entry, photoBase64);
    },
    [serverUrl, userId],
  );

  // No network: nothing went wrong, the meal just waits for it.
  const park = useCallback(
    (id: string, error?: unknown) => {
      remove(id);
      releaseCapture(id);
      haptics.tap();
      showToast({ message: t('outbox.queued') });
      kickOutbox('later', error);
      return null;
    },
    [remove, showToast, t],
  );

  const run = useCallback(
    async (entry: PendingMeal) => {
      keep(captureEntry(entry), entry.input.photoBase64);
      if (useOutbox.getState().online === false) return park(entry.id);
      upsert({ ...entry, status: 'analyzing', error: null });
      try {
        const meal = await api.createMeal(entry.input);
        void dropEntry(entry.id);
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
        if (isNetworkError(error)) return park(entry.id, error);
        // Validation and AI errors show on the card, as before.
        void dropEntry(entry.id);
        haptics.warning();
        upsert({ ...entry, status: 'error', error: errorMessage(error, t('common.error'), t('common.offline')) });
        return null;
      }
    },
    [api, healthEnabled, keep, park, refresh, remove, showToast, t, upsert],
  );

  const log = useCallback(
    (input: CreateMealInput, preview: { photoUri?: string | null; label: string }) =>
      run({
        id: shortId(),
        input: { ...input, eatenAt: uniqueEatenAt(input.eatenAt, takenTimes(queryClient, input.localDate)) },
        photoUri: preview.photoUri ?? null,
        label: preview.label,
        status: 'analyzing',
        error: null,
        startedAt: Date.now(),
      }),
    [queryClient, run],
  );

  /** "Same again": copies a meal to a new time, or queues the copy without network. Other errors are thrown. */
  const relog = useCallback(
    async (source: Meal, at: { eatenAt: string; localDate: string }) => {
      const entry: OutboxEntry = {
        id: shortId(),
        kind: 'duplicate',
        createdAt: Date.now(),
        eatenAt: uniqueEatenAt(at.eatenAt, takenTimes(queryClient, at.localDate)),
        localDate: at.localDate,
        label: source.title,
        emoji: source.items.find((i) => i.emoji)?.emoji ?? '🍽️',
        error: null,
        sourceId: source.id,
        photoId: source.photoId,
      };
      keep(entry);
      if (useOutbox.getState().online === false) return park(entry.id);
      try {
        const copy = await api.duplicateMeal(source.id, { eatenAt: entry.eatenAt, localDate: entry.localDate });
        void dropEntry(entry.id);
        haptics.success();
        refresh(copy);
        showToast({ message: `${t('detail.relogged')} · ${copy.title}` });
        return copy;
      } catch (error) {
        if (isNetworkError(error)) return park(entry.id, error);
        void dropEntry(entry.id);
        throw error;
      }
    },
    [api, keep, park, queryClient, refresh, showToast, t],
  );

  /** A product scanned without network: looked up, then logged at its standard portion, once back online. */
  const queueBarcode = useCallback(
    (code: string, at: { eatenAt: string; localDate: string }) => {
      const id = shortId();
      const eatenAt = uniqueEatenAt(at.eatenAt, takenTimes(queryClient, at.localDate));
      keep({ id, kind: 'barcode', createdAt: Date.now(), eatenAt, localDate: at.localDate, label: t('outbox.barcodeLabel', { code }), emoji: '🏷️', error: null, code });
      park(id);
    },
    [keep, park, queryClient, t],
  );

  return { log, retry: run, dismiss: remove, relog, queueBarcode };
}

// Today, Me and the proactive coach all mount the sync hook: one run at a time, which the others wait for.
let syncing: Promise<void> | null = null;

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
 * drinks every 10 min, sleep and (with the morning check-in) nightly vitals
 * every 30 min, workouts every hour, weights and (when tracked) blood
 * pressure every 6 hours.
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
  const trackVitals = modules.vitals === true;
  const weightKg = user.profile?.weightKg ?? null;

  const sync = useCallback(
    async (force = false): Promise<void> => {
      if (!enabled || !health.source) return;
      if (syncing) return syncing;
      const source = health.source;
      const due = (last: number, every: number) => force || Date.now() - last >= every;
      syncing = (async () => {
        await askForNewTypes();
        await syncDay();
        await syncWeights();
        await syncWorkouts();
        await syncBloodPressure();
        await syncSleep();
        await syncVitals();
        await syncWater();
      })().finally(() => {
        syncing = null;
      });
      return syncing;

      // Connected with an older version, or just turned a module on: ask once for the new types.
      async function askForNewTypes() {
        const settings = useSettings.getState();
        const asked = { bloodPressure: trackBp, sleep: trackSleep, hydration: trackWater, vitals: trackVitals };
        const wanted = grantedScopes(asked);
        const missing = (Object.keys(wanted) as (keyof typeof wanted)[]).some((key) => settings[key] < wanted[key]!);
        if (settings.healthScopes >= HEALTH_SCOPES && !missing) return;
        await health.connect(asked).catch(() => false);
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

      // Nightly HRV and resting heart rate, only with the morning check-in: 31 days the first time (its baseline needs two weeks), then from 2 nights before the last sync.
      async function syncVitals() {
        const { lastVitalsSync } = useSettings.getState();
        if (!trackVitals || !due(lastVitalsSync, 30 * 60_000)) return;
        try {
          const from = sinceLastSync(lastVitalsSync, 2, 31);
          // The sleep windows say which HRV readings were taken asleep; without sleep tracking, the early hours stand in.
          const nights = trackSleep ? await health.readSleep(from, new Date()).catch(() => []) : [];
          const days = await health.readVitals(from, new Date(), nights);
          for (let i = 0; i < days.length; i += 1000) await api.putVitals({ days: days.slice(i, i + 1000), source });
          setSettings({ lastVitalsSync: Date.now() });
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
    [api, enabled, queryClient, setSettings, today, trackBp, trackSleep, trackVitals, trackWater, weightKg],
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
