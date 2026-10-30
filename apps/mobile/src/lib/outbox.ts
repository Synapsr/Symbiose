import type { DaySummary, Locale, Meal } from '@symbiose/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { translate, useI18n } from '@/i18n';

import { ApiError, type Api } from './api';
import { haptics } from './haptics';
import { health } from './health';
import { outboxPhotos } from './outbox-files';
import {
  backoffDelay,
  findSentMeal,
  isNetworkStatus,
  isRetryableStatus,
  mayStillBeProcessing,
  nextToSend,
  scopeId,
  SETTLE_DELAY,
  type OutboxEntry,
} from './outbox-logic';
import { useSession } from './session';
import { storage } from './storage';
import { useSettings, useToast } from './stores';

export type { OutboxEntry };

/**
 * The offline queue. Every capture is kept on the phone before its first
 * request; when that request hits a network wall (offline, timeout, DNS, a
 * proxy's 502/503/504) the capture waits here with its original time, and is
 * sent again one at a time, oldest first: when connectivity returns, when the
 * app comes back to the foreground, after a growing pause, or on a tap.
 */
interface OutboxState {
  /** The server + account the queue belongs to (see `scopeId`). */
  scope: string | null;
  loaded: boolean;
  items: OutboxEntry[];
  /** Captures still in their first attempt: shown as "analysing", not as waiting. */
  live: string[];
  /** The capture being sent right now. */
  sending: string | null;
  /** Connectivity as last reported by the system, null until known. */
  online: boolean | null;
}

export const useOutbox = create<OutboxState>()(() => ({ scope: null, loaded: false, items: [], live: [], sending: null, online: null }));

export const isNetworkError = (error: unknown) => error instanceof ApiError && isNetworkStatus(error.status);

// ---------------------------------------------------------------- Persistence

// One key per capture keeps every value small (the Keychain dislikes big ones); the index keeps the order.
const indexKey = (scope: string) => `symbiose.outbox.${scope}`;
const entryKey = (scope: string, id: string) => `symbiose.outbox.${scope}.${id}`;

/** Photos stay in memory too while the app runs: a failed file write can't lose them. */
const photosInMemory = new Map<string, string>();

// Writes run one after another: an index never lands before its entry, a removal never before its write.
let writes: Promise<unknown> = Promise.resolve();
function persist(task: () => Promise<unknown>): Promise<void> {
  const next = writes.then(task).catch(() => undefined);
  writes = next;
  return next.then(() => undefined);
}

function writeIndex(scope: string): Promise<void> {
  return persist(async () => {
    // Not before the saved queue is read: it would be overwritten. Loading writes it once merged.
    const { scope: current, loaded, items } = useOutbox.getState();
    if (current === scope && loaded) await storage.set(indexKey(scope), JSON.stringify(items.map((i) => i.id)));
  });
}

function parseEntry(raw: string | null): OutboxEntry | null {
  try {
    const entry = raw ? (JSON.parse(raw) as OutboxEntry) : null;
    return entry && typeof entry.id === 'string' && typeof entry.eatenAt === 'string' && typeof entry.localDate === 'string' ? entry : null;
  } catch {
    return null;
  }
}

async function loadOutbox(scope: string): Promise<void> {
  useOutbox.setState({ scope, loaded: false, items: [], live: [], sending: null });
  let entries: OutboxEntry[] = [];
  try {
    const ids = JSON.parse((await storage.get(indexKey(scope))) ?? '[]') as string[];
    const raw = await Promise.all(ids.map((id) => storage.get(entryKey(scope, id)).catch(() => null)));
    entries = raw.map(parseEntry).filter((e): e is OutboxEntry => e !== null);
  } catch {
    // An unreadable queue is an empty one.
  }
  if (useOutbox.getState().scope !== scope) return;
  // Captures made while loading go after the saved ones.
  useOutbox.setState((s) => ({ loaded: true, items: [...entries, ...s.items.filter((i) => !entries.some((e) => e.id === i.id))] }));
  void writeIndex(scope);
}

/**
 * Points the queue at the signed-in account on this server, loading its saved
 * captures. Called by the runner and before every capture: the camera can open
 * straight from a Control Center button, before the tabs (and the runner) exist.
 */
export function openOutbox(serverUrl: string, userId: string): void {
  const scope = scopeId(serverUrl, userId);
  if (useOutbox.getState().scope !== scope) void loadOutbox(scope);
}

/** Keeps a capture on the phone before its first request, so closing the app mid-way can't lose it. */
export function stashCapture(entry: OutboxEntry, photoBase64?: string): Promise<void> {
  const { scope } = useOutbox.getState();
  if (photoBase64) photosInMemory.set(entry.id, photoBase64);
  useOutbox.setState((s) => ({
    items: [...s.items.filter((i) => i.id !== entry.id), entry],
    live: s.live.includes(entry.id) ? s.live : [...s.live, entry.id],
  }));
  if (!scope) return Promise.resolve();
  return persist(async () => {
    if (photoBase64) await outboxPhotos.save(entry.id, photoBase64).catch(() => undefined);
    await storage.set(entryKey(scope, entry.id), JSON.stringify(entry));
  }).then(() => writeIndex(scope));
}

/** The first attempt hit a network wall: the capture now waits in the queue. */
export function releaseCapture(id: string): void {
  useOutbox.setState((s) => ({ live: s.live.filter((l) => l !== id) }));
}

/** Sent, refused on its first try, or deleted: forgets the capture and its photo. */
export function dropEntry(id: string): Promise<void> {
  const { scope } = useOutbox.getState();
  photosInMemory.delete(id);
  useOutbox.setState((s) => ({ items: s.items.filter((i) => i.id !== id), live: s.live.filter((l) => l !== id) }));
  if (!scope) return Promise.resolve();
  return writeIndex(scope).then(() =>
    persist(async () => {
      await storage.remove(entryKey(scope, id));
      outboxPhotos.remove(id);
    }),
  );
}

function setError(id: string, error: string | null): void {
  const { scope, items } = useOutbox.getState();
  const entry = items.find((i) => i.id === id);
  if (!entry || entry.error === error) return;
  const next: OutboxEntry = { ...entry, error };
  useOutbox.setState((s) => ({ items: s.items.map((i) => (i.id === id ? next : i)) }));
  if (scope) void persist(() => storage.set(entryKey(scope, id), JSON.stringify(next)));
}

/** Signing out forgets this account's waiting captures, photos included. */
export async function clearOutbox(): Promise<void> {
  const { scope, items } = useOutbox.getState();
  cancelTimer();
  failures = 0;
  settleUntil = 0;
  photosInMemory.clear();
  useOutbox.setState({ scope: null, loaded: false, items: [], live: [], sending: null });
  if (!scope) return;
  await persist(async () => {
    await storage.remove(indexKey(scope));
    for (const item of items) {
      await storage.remove(entryKey(scope, item.id));
      outboxPhotos.remove(item.id);
    }
  });
}

/** The waiting card's thumbnail: the saved file, or the photo still in memory. */
export function queuedPhotoUri(id: string): string | null {
  const inMemory = photosInMemory.get(id);
  return outboxPhotos.uri(id) ?? (inMemory ? `data:image/jpeg;base64,${inMemory}` : null);
}

// ---------------------------------------------------------------- Sending

class LostPhotoError extends Error {}

async function sendEntry(api: Api, entry: OutboxEntry): Promise<Meal> {
  // An earlier attempt may have reached the server and only lost its answer: look before posting again.
  const already = findSentMeal(entry, await api.meals(entry.localDate));
  if (already) return already;
  const when = { eatenAt: entry.eatenAt, localDate: entry.localDate, ...(entry.mealType ? { mealType: entry.mealType } : null) };
  switch (entry.kind) {
    case 'duplicate':
      return api.duplicateMeal(entry.sourceId, when);
    case 'barcode':
      return api.createMeal({ ...when, items: [await api.barcode(entry.code)] });
    case 'create': {
      const photoBase64 = entry.photo ? (photosInMemory.get(entry.id) ?? (await outboxPhotos.read(entry.id))) : null;
      if (entry.photo && !photoBase64) throw new LostPhotoError();
      return api.createMeal({ ...entry.input, ...when, ...(photoBase64 ? { photoBase64 } : null) });
    }
  }
}

/** Why the server refused a capture for good, in the user's words. */
function refusal(entry: OutboxEntry, error: unknown, locale: Locale): string {
  if (error instanceof LostPhotoError) return translate(locale, 'outbox.photoLost');
  if (error instanceof ApiError && error.code === 'not_food') return translate(locale, 'outbox.notFood');
  if (error instanceof ApiError && error.status === 404) {
    if (entry.kind === 'barcode') return translate(locale, 'capture.notFound');
    if (entry.kind === 'duplicate') return translate(locale, 'outbox.sourceGone');
  }
  return error instanceof ApiError ? error.message : translate(locale, 'common.error');
}

// One runner for the whole app; the hook below gives it the API and the screens to refresh.
let flushing = false;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let flushNow: (() => Promise<void>) | null = null;
// A gateway gave up on a request the server may still be finishing: nothing is checked or sent again before this.
let settleUntil = 0;

function cancelTimer() {
  clearTimeout(timer);
  timer = undefined;
}

function schedule(delay: number) {
  cancelTimer();
  timer = setTimeout(() => {
    timer = undefined;
    void flushNow?.();
  }, delay);
}

/**
 * Tries the queue right away (connectivity is back, the app is in front, a tap
 * on « Réessayer »), or after the usual pause when a capture just failed with
 * `error` (longer if the server may still be working on it).
 */
export function kickOutbox(when: 'now' | 'later', error?: unknown): void {
  if (when === 'now') {
    failures = 0;
    cancelTimer();
    void flushNow?.();
  } else if (!timer && !flushing) {
    failures = Math.max(failures, 1);
    if (error instanceof ApiError && mayStillBeProcessing(error.status)) settleUntil = Date.now() + SETTLE_DELAY;
    schedule(backoffDelay(failures));
  }
}

export function retryEntry(id: string): void {
  setError(id, null);
  kickOutbox('now');
}

/**
 * Runs the queue for the signed-in account: loads it, sends it when the
 * network comes back or the app returns to the foreground, and swaps each
 * waiting card for the real meal. Mounted once, with the tabs.
 */
export function useOutboxSync() {
  const { session, api, user } = useSession();
  const scope = session && user ? scopeId(session.serverUrl, user.id) : null;
  const queryClient = useQueryClient();
  const { locale } = useI18n();
  const showToast = useToast((s) => s.show);
  const loaded = useOutbox((s) => s.loaded && s.scope === scope);

  const serverUrl = session?.serverUrl;
  const userId = user?.id;
  useEffect(() => {
    if (serverUrl && userId) openOutbox(serverUrl, userId);
  }, [serverUrl, userId]);

  useEffect(() => {
    if (!api || !scope || !loaded) return;

    // The real meal takes the waiting card's place in the same frame; the totals follow.
    const landed = (entry: OutboxEntry, meal: Meal, count: number) => {
      queryClient.setQueryData<DaySummary>(['day', meal.localDate], (day) =>
        day && !day.meals.some((m) => m.id === meal.id) ? { ...day, meals: [...day.meals, meal].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt)) } : day,
      );
      void dropEntry(entry.id);
      void queryClient.invalidateQueries({ queryKey: ['day', meal.localDate] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      haptics.success();
      showToast({
        message: count > 1 ? translate(locale, 'outbox.sentMany', { count }) : `${translate(locale, 'today.mealLogged')} · ${meal.title}`,
        onPress: () => router.push({ pathname: '/meal/[id]', params: { id: meal.id } }),
      });
      // Same as logging online: copies aren't written to the health store.
      if (entry.kind !== 'duplicate' && useSettings.getState().healthEnabled) void health.writeMeal(meal).catch(() => undefined);
    };

    const flush = async () => {
      if (flushing) return;
      // Whatever woke us (foreground, connectivity, a tap), give a slow server time to finish first.
      const settling = settleUntil - Date.now();
      if (settling > 0) return schedule(settling);
      flushing = true;
      cancelTimer();
      let sent = 0;
      try {
        for (;;) {
          const state = useOutbox.getState();
          if (state.scope !== scope) return;
          const entry = nextToSend(state.items, new Set(state.live));
          if (!entry) {
            failures = 0;
            return;
          }
          useOutbox.setState({ sending: entry.id });
          try {
            const meal = await sendEntry(api, entry);
            failures = 0;
            landed(entry, meal, ++sent);
          } catch (error) {
            const status = error instanceof ApiError ? error.status : -1;
            if (isRetryableStatus(status)) {
              failures += 1;
              if (mayStillBeProcessing(status)) settleUntil = Date.now() + SETTLE_DELAY;
              schedule(backoffDelay(failures, Math.random, settleUntil - Date.now()));
              return;
            }
            // Refused for good: say why on the card, and go on with the next one.
            haptics.warning();
            setError(entry.id, refusal(entry, error, locale));
          }
        }
      } finally {
        useOutbox.setState({ sending: null });
        flushing = false;
      }
    };

    flushNow = flush;
    void flush();
    return () => {
      if (flushNow === flush) flushNow = null;
      cancelTimer();
    };
  }, [api, scope, loaded, queryClient, locale, showToast]);

  // Connectivity back: send now, and let Today catch up with the server.
  useEffect(() => {
    const apply = (state: Network.NetworkState) => {
      const online = state.isConnected ?? null;
      const was = useOutbox.getState().online;
      useOutbox.setState({ online });
      if (online && was === false) {
        kickOutbox('now');
        void queryClient.invalidateQueries({ queryKey: ['day'] });
      }
    };
    const subscription = Network.addNetworkStateListener(apply);
    void Network.getNetworkStateAsync()
      .then(apply)
      .catch(() => undefined);
    return () => subscription.remove();
  }, [queryClient]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') kickOutbox('now');
    });
    return () => subscription.remove();
  }, []);
}
