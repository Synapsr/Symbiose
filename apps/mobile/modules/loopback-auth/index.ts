import { requireOptionalNativeModule } from 'expo';

/**
 * A one-shot web server on 127.0.0.1 for an OAuth sign-in whose provider only
 * redirects to a loopback address (Sign in with ChatGPT): the browser opened
 * for the sign-in comes back to this phone, to the app, with the code.
 */
interface LoopbackAuthModule {
  /** Starts listening on 127.0.0.1 on a free port; returns the port. `page` is the HTML shown once the browser comes back. */
  start(path: string, page: string): Promise<number>;
  /** The request's path and query (`/auth/callback?code=…&state=…`) when the browser comes back; null after `timeoutMs` or `stop()`. */
  waitForRedirect(timeoutMs: number): Promise<string | null>;
  /** Stops listening; a pending wait resolves with null. */
  stop(): void;
  /** Android: brings the app back over the browser tab. */
  bringToFront(): void;
}

/** Null where the native module isn't built in (web, Expo Go). */
export const LoopbackAuth = requireOptionalNativeModule<LoopbackAuthModule>('LoopbackAuth');
