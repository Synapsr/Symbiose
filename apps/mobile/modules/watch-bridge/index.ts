import { requireOptionalNativeModule, type EventSubscription } from 'expo';

/** Property-list values only: WatchConnectivity rejects null. */
export type WatchContext = Record<string, string | number | boolean>;

/**
 * A request from the watch, on a phone without a server: the app answers it
 * through its own API. `queued`: it arrived while the app wasn't running (or
 * the watch couldn't reach the iPhone), nobody waits for the answer.
 */
export interface WatchRequest {
  id: string;
  method: string;
  path: string;
  /** JSON, or empty. */
  body: string;
  queued?: string;
}

interface WatchBridgeModule {
  /** Replaces the application context the watch app reads on its next wake. */
  updateContext(context: WatchContext): void;
  /** Answers a live request: the API's status and JSON body. */
  reply(id: string, status: number, body: string): void;
  /** Requests that arrived while the app wasn't there to answer, oldest first. */
  pendingRequests(): WatchRequest[];
  /** A queued request was handled. */
  done(id: string): void;
  addListener(event: 'onRequest', listener: (request: WatchRequest) => void): EventSubscription;
}

/** Null where the native module isn't built in (Android, web, Expo Go). */
export const WatchBridge = requireOptionalNativeModule<WatchBridgeModule>('WatchBridge');
