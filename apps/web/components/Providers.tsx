'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Hub } from 'aws-amplify/utils';
import { type AuthUser, configureAmplify, currentUser, hasAuth, signOut } from '@/lib/auth';
import { getSavedEventIds, hasApi, saveEvent, unsaveEvent } from '@/lib/api';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  status: 'loading',
  user: null,
  refresh: async () => {},
  logOut: async () => {},
});

interface SavedContextValue {
  loaded: boolean;
  ids: ReadonlySet<string>;
  isSaved: (eventId: string) => boolean;
  toggle: (eventId: string) => Promise<void>;
}

const SavedContext = createContext<SavedContextValue>({
  loaded: false,
  ids: new Set(),
  isSaved: () => false,
  toggle: async () => {},
});

export function Providers({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(hasAuth ? 'loading' : 'signed-out');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedLoaded, setSavedLoaded] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const u = await currentUser();
    setUser(u);
    setStatus(u ? 'signed-in' : 'signed-out');
  }, []);

  useEffect(() => {
    if (!hasAuth) return;
    configureAmplify();
    void refresh();
    const stop = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signedIn':
        case 'signInWithRedirect':
        case 'tokenRefresh':
          void refresh();
          break;
        case 'signedOut':
        case 'tokenRefresh_failure':
        case 'signInWithRedirect_failure':
          setUser(null);
          setStatus('signed-out');
          break;
        default:
          break;
      }
    });
    return stop;
  }, [refresh]);

  // Saved-event ids load once per signed-in user (or once in fixture mode).
  useEffect(() => {
    const key = status === 'signed-in' ? (user?.sub ?? '') : hasApi ? null : 'fixture';
    if (key === null) {
      setSavedIds(new Set());
      setSavedLoaded(status !== 'loading');
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    let alive = true;
    getSavedEventIds()
      .then((r) => {
        if (alive) setSavedIds(new Set(r.eventIds));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setSavedLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [status, user?.sub]);

  const logOut = useCallback(async () => {
    await signOut();
    setUser(null);
    setStatus('signed-out');
  }, []);

  const toggle = useCallback(
    async (eventId: string) => {
      const was = savedIds.has(eventId);
      setSavedIds((cur) => {
        const next = new Set(cur);
        if (was) next.delete(eventId);
        else next.add(eventId);
        return next;
      });
      try {
        if (was) await unsaveEvent(eventId);
        else await saveEvent(eventId);
      } catch {
        setSavedIds((cur) => {
          const next = new Set(cur);
          if (was) next.add(eventId);
          else next.delete(eventId);
          return next;
        });
      }
    },
    [savedIds],
  );

  const auth = useMemo(() => ({ status, user, refresh, logOut }), [status, user, refresh, logOut]);
  const saved = useMemo<SavedContextValue>(
    () => ({ loaded: savedLoaded, ids: savedIds, isSaved: (id) => savedIds.has(id), toggle }),
    [savedLoaded, savedIds, toggle],
  );

  return (
    <AuthContext.Provider value={auth}>
      <SavedContext.Provider value={saved}>{children}</SavedContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function useSavedEvents(): SavedContextValue {
  return useContext(SavedContext);
}
