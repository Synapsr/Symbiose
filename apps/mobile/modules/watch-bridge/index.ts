import { requireOptionalNativeModule } from 'expo';

/** Property-list values only: WatchConnectivity rejects null. */
export type WatchContext = Record<string, string | number | boolean>;

interface WatchBridgeModule {
  /** Replaces the application context the watch app reads on its next wake. */
  updateContext(context: WatchContext): void;
}

/** Null where the native module isn't built in (Android, web, Expo Go). */
export const WatchBridge = requireOptionalNativeModule<WatchBridgeModule>('WatchBridge');
