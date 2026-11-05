import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { WatchBridge, type WatchContext, type WatchRequest } from '../../modules/watch-bridge';

import { explainApiError } from '@/lib/error-texts';
import type { GlanceContext } from '@/lib/glance';
import { useSession } from '@/lib/session';
import { LOCAL_SERVER_URL } from '@/local/constants';
import { localFetch } from '@/local/transport';

let lastSent: string | null = null;

/**
 * Hands the session and the latest glance to the watch app through the
 * WatchConnectivity application context, which keeps only the latest one and
 * delivers it when the watch wakes. The watch then talks to the server itself.
 * `null` (signed out) tells the watch to forget its credentials.
 */
export function syncWatch(context: GlanceContext | null) {
  if (!WatchBridge) return;
  const payload: WatchContext = context
    ? {
        signedIn: true,
        serverUrl: context.serverUrl,
        token: context.token,
        locale: context.locale,
        hideCalories: context.hideCalories,
        // As a string: the glance holds nulls, which a property list can't.
        glance: JSON.stringify(context.glance),
      }
    : { signedIn: false };
  const key = JSON.stringify(payload);
  if (key === lastSent) return;
  lastSent = key;
  // The watch ignores anything older than what it already applied.
  WatchBridge.updateContext({ ...payload, sentAt: Date.now() });
}

/**
 * On a phone without a server, the watch's requests come to the iPhone app
 * (modules/watch-bridge): answered through the phone's API while the app
 * runs, and the ones queued while it didn't, as soon as it does. Errors go
 * back in the person's language. Mounted with the tabs.
 */
export function useWatchRequests() {
  const { onPhone } = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    const bridge = WatchBridge;
    if (!bridge || !onPhone) return;

    const answer = async (request: WatchRequest): Promise<{ status: number; body: string }> => {
      try {
        const res = await localFetch(`${LOCAL_SERVER_URL}${request.path}`, {
          method: request.method,
          headers: { accept: 'application/json', ...(request.body ? { 'content-type': 'application/json' } : {}) },
          body: request.body || undefined,
        });
        let body = await res.text();
        if (!res.ok) {
          // The watch shows the message as is: in the person's words, like the app's.
          try {
            const error = (JSON.parse(body) as { error?: { code?: string; message?: string } }).error;
            const text = error?.code ? explainApiError({ status: res.status, code: error.code }) : null;
            if (text) body = JSON.stringify({ error: { ...error, message: text } });
          } catch {
            // Not JSON: sent as is.
          }
        }
        return { status: res.status, body };
      } catch {
        return { status: 503, body: JSON.stringify({ error: { code: 'network', message: explainApiError({ status: 0, code: 'network' }) ?? '' } }) };
      }
    };

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['day'] });
      void queryClient.invalidateQueries({ queryKey: ['insights'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    };

    // One at a time, in the order the wrist sent them.
    let chain = Promise.resolve();
    const handle = (request: WatchRequest) => {
      chain = chain.then(async () => {
        const result = await answer(request);
        if (request.queued) bridge.done(request.id);
        else bridge.reply(request.id, result.status, result.body);
        refresh();
      });
    };

    const subscription = bridge.addListener('onRequest', handle);
    const drain = () => {
      for (const request of bridge.pendingRequests()) handle({ ...request, queued: '1' });
    };
    drain();
    const appState = AppState.addEventListener('change', (state) => state === 'active' && drain());
    return () => {
      subscription.remove();
      appState.remove();
    };
  }, [onPhone, queryClient]);
}
