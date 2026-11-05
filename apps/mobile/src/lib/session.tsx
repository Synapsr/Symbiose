import type { User } from '@symbiose/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { deviceLocale, translate } from '@/i18n';
import { isLocalUrl, LOCAL_SERVER_URL, LOCAL_TOKEN } from '@/local/constants';
import { phoneDataExists } from '@/local/transport';

import { ApiError, createApi, type Api } from './api';
import { storage } from './storage';
import { useToast } from './stores';

const KEY = 'symbiose.session';
/** The last known user, so the app opens without network (metro, plane) and its waiting meals stay in reach. */
const USER_KEY = 'symbiose.user';

interface StoredSession {
  serverUrl: string;
  token: string;
}

function readCachedUser(raw: string | null, session: StoredSession | null): User | null {
  try {
    const known = raw ? (JSON.parse(raw) as StoredSession & { user: User }) : null;
    return session && known?.serverUrl === session.serverUrl && known.token === session.token ? known.user : null;
  } catch {
    return null;
  }
}

interface SessionValue {
  ready: boolean;
  session: StoredSession | null;
  api: Api | null;
  user: User | null;
  userLoading: boolean;
  /** True when the data lives on this phone, without a server (`src/local`). */
  onPhone: boolean;
  signIn: (session: StoredSession, user: User) => Promise<void>;
  /** Starts (or resumes) Symbiose on this phone alone: no server, no account. */
  startOnPhone: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** The session of the app on its own: the API runs on the phone and asks for no token. */
export const PHONE_SESSION: StoredSession = { serverUrl: LOCAL_SERVER_URL, token: LOCAL_TOKEN };

const SessionContext = createContext<SessionValue | null>(null);

const isAuthError = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 404);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [cachedUser, setCachedUser] = useState<User | null>(null);

  useEffect(() => {
    Promise.all([storage.get(KEY), storage.get(USER_KEY).catch(() => null)])
      .then(([raw, rawUser]) => {
        // The data can outlive the settings (Android restores app files, not the keystore): it opens on its data.
        const stored = raw ? (JSON.parse(raw) as StoredSession) : phoneDataExists() ? PHONE_SESSION : null;
        setCachedUser(readCachedUser(rawUser, stored));
        setSession(stored);
        if (stored && !raw) void storage.set(KEY, JSON.stringify(stored)).catch(() => undefined);
      })
      .catch(() => setSession(null))
      .finally(() => setReady(true));
  }, []);

  const storedApi = useMemo(() => (session ? createApi(session.serverUrl, session.token) : null), [session]);

  const me = useQuery({
    queryKey: ['me', session?.serverUrl, session?.token],
    queryFn: async () => {
      try {
        return await storedApi!.me();
      } catch (error) {
        // A revoked token or a deleted account: forget the stored session.
        if (isAuthError(error)) await Promise.all([storage.remove(KEY), storage.remove(USER_KEY)]);
        // Gone from the server (a refused request, or deleted elsewhere): say it plainly, nothing more.
        if (error instanceof ApiError && error.status === 404) useToast.getState().show({ message: translate(deviceLocale(), 'admin.accountGone') });
        throw error;
      }
    },
    enabled: Boolean(storedApi),
    staleTime: 60_000,
    retry: (count, error) => !isAuthError(error) && count < 2,
    // Opens with the last known user when the server can't be reached; refreshed right away.
    initialData: cachedUser ?? undefined,
    initialDataUpdatedAt: 0,
  });
  // ...and treat the user as signed out right away.
  const revoked = isAuthError(me.error);
  const api = revoked ? null : storedApi;

  useEffect(() => {
    if (session && me.data) void storage.set(USER_KEY, JSON.stringify({ ...session, user: me.data })).catch(() => undefined);
  }, [session, me.data]);

  const signOut = useCallback(async () => {
    await Promise.all([storage.remove(KEY), storage.remove(USER_KEY)]);
    queryClient.clear();
    setCachedUser(null);
    setSession(null);
  }, [queryClient]);

  const signIn = useCallback(
    async (next: StoredSession, user: User) => {
      await storage.set(KEY, JSON.stringify(next));
      queryClient.setQueryData(['me', next.serverUrl, next.token], user);
      setSession(next);
    },
    [queryClient],
  );

  const startOnPhone = useCallback(async () => {
    const user = await createApi(PHONE_SESSION.serverUrl, PHONE_SESSION.token).me();
    await signIn(PHONE_SESSION, user);
  }, [signIn]);

  const value: SessionValue = {
    ready,
    session: revoked ? null : session,
    api,
    user: revoked ? null : (me.data ?? null),
    userLoading: Boolean(api) && me.isPending,
    onPhone: isLocalUrl(session?.serverUrl),
    signIn,
    startOnPhone,
    signOut,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** The API client for screens that are only reachable when signed in. */
export function useApi(): Api {
  const { api } = useSession();
  if (!api) throw new Error('Not signed in');
  return api;
}

export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('User not loaded');
  return user;
}

/** Updates the cached user after a mutation that returns it. */
export function useSetUser() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  return useCallback(
    (user: User) => queryClient.setQueryData(['me', session?.serverUrl, session?.token], user),
    [queryClient, session],
  );
}
