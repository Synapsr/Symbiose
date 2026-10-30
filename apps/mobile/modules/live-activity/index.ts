import { requireOptionalNativeModule } from 'expo';

/** Every word the activity shows, from the app's i18n (craving.activity.*). */
export interface CravingActivityCopy {
  title: string;
  line: string;
  staleTitle: string;
  staleLine: string;
  resisted: string;
  gaveIn: string;
  resistedDone: string;
  gaveInDone: string;
}

export interface StartCravingOptions {
  cravingId: string;
  /** Milliseconds since 1970. */
  startedAt: number;
  endsAt: number;
  copy: CravingActivityCopy;
}

interface LiveActivityModule {
  /** False when the person turned Live Activities off for Symbiose. */
  areEnabled(): boolean;
  /** The activity id, or null when Live Activities are off. */
  startCraving(options: StartCravingOptions): Promise<string | null>;
  /** With an outcome, the activity shows it for a few seconds before leaving. */
  endCraving(cravingId: string, outcome: 'resisted' | 'gave_in' | null): Promise<void>;
  /** Ends the activities whose countdown ended more than `graceSeconds` ago. */
  endStale(graceSeconds: number): Promise<void>;
}

/** The « surfer l'envie » Live Activity (iOS only): null on Android and on the web. */
export const LiveActivity = requireOptionalNativeModule<LiveActivityModule>('SymbioseLiveActivity');
