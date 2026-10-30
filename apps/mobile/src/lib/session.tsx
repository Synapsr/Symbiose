import type { User } from '@symbiose/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, createApi, type Api } from './api';
import { storage } from './storage';

const KEY = 'symbiose.session';

interface StoredSession {
  serverUrl: string;
  token: string;
}

interface SessionValue {
  ready: boolean;
  session: StoredSession | null;
  api: Api | null;
  user: User | null;
  userLoading: boolean;
  signIn: (session: StoredSession, user: User) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const isAuthError = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 404);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);

  useEffect(() => {
    storage
      .get(KEY)
      .then((raw) => setSession(raw ? (JSON.parse(raw) as StoredSession) : null))
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
        if (isAuthError(error)) await storage.remove(KEY);
        throw error;
      }
    },
    enabled: Boolean(storedApi),
    staleTime: 60_000,
    retry: (count, error) => !isAuthError(error) && count < 2,
  });
  // ...and treat the user as signed out right away.
  const revoked = isAuthError(me.error);
  const api = revoked ? null : storedApi;

  const signOut = useCallback(async () => {
    await storage.remove(KEY);
    queryClient.clear();
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

  const value: SessionValue = {
    ready,
    session: revoked ? null : session,
    api,
    user: revoked ? null : (me.data ?? null),
    userLoading: Boolean(api) && me.isPending,
    signIn,
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
