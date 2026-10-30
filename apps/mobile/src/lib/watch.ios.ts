import { WatchBridge, type WatchContext } from '../../modules/watch-bridge';

import type { GlanceContext } from '@/lib/glance';

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
