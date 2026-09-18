import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { Entitlement, UserProfile } from '@getfit/shared';
import { ApiError, clearCache, clearToken, loadToken, onUnauthorized } from '../api/client';
import { assessmentApi, authApi, onboardingApi } from '../api/endpoints';
import { createStoreProvider } from './billing';
import { resolveEntitlement } from './localEntitlement';

/**
 * Ends the session on this device. The offline cache holds body-composition
 * figures and workout history, so it is discarded with the token — otherwise
 * the next person to sign in on a shared device could be served the previous
 * account's data from disk.
 */
async function endLocalSession(): Promise<void> {
  await clearToken();
  await clearCache();
}

/** Where in the product journey the user currently is. */
export type SessionStage =
  | 'loading'
  | 'onboarding'
  | 'analysis'
  | 'paywall'
  | 'account'
  | 'preferences'
  | 'program'
  | 'ready'
  | 'expired';

export interface SessionState {
  stage: SessionStage;
  userId: string | null;
  isGuest: boolean;
  profile: UserProfile | null;
  entitlement: Entitlement | null;
  hasAssessment: boolean;
  hasPreferences: boolean;
  error: string | null;
}

interface SessionContextValue extends SessionState {
  /** Recomputes the stage from the server. Safe to call at any time. */
  refresh: () => Promise<void>;
  startGuestSession: () => Promise<void>;
  setStage: (stage: SessionStage) => void;
  markAssessmentComplete: () => void;
  markPreferencesComplete: () => void;
  markProgramReady: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * SessionProvider
 *
 * Owns the user's position in the journey and, critically, the membership
 * state. Entitlement comes from the store itself — what Apple or Google says
 * this customer owns — and is re-read whenever the app returns to the
 * foreground, so an expiry or a refund is caught promptly. It is never a flag
 * this app wrote for itself.
 */
export function SessionProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<SessionState>({
    stage: 'loading',
    userId: null,
    isGuest: true,
    profile: null,
    entitlement: null,
    hasAssessment: false,
    hasPreferences: false,
    error: null,
  });

  const refreshing = useRef(false);

  const resolveStage = useCallback(async (): Promise<SessionState> => {
    const token = await loadToken();
    if (!token) {
      return {
        stage: 'onboarding',
        userId: null,
        isGuest: true,
        profile: null,
        entitlement: null,
        hasAssessment: false,
        hasPreferences: false,
        error: null,
      };
    }

    const me = await authApi.me();
    const status = await onboardingApi.status();

    if (!status.profile?.onboardingCompleted) {
      return {
        stage: 'onboarding',
        userId: me.userId,
        isGuest: me.isGuest,
        profile: status.profile,
        entitlement: null,
        hasAssessment: false,
        hasPreferences: false,
        error: null,
      };
    }

    // The store is the authority on membership, so it is asked directly
    // rather than relayed through an API.
    const [assessment, entitlement] = await Promise.all([
      assessmentApi.latest(),
      resolveEntitlement(createStoreProvider({ mockAvailable: __DEV__ })),
    ]);

    const hasAssessment = Boolean(assessment.assessment);
    const base = {
      userId: me.userId,
      isGuest: me.isGuest,
      profile: status.profile,
      entitlement,
      hasAssessment,
      hasPreferences: status.hasPreferences,
      error: null,
    };

    // The body analysis comes before the paywall — that ordering is the whole
    // point of the onboarding flow, so it is enforced here too.
    if (!hasAssessment) return { ...base, stage: 'analysis' };
    if (!entitlement.active) {
      // Someone who has paid before and lapsed sees the renewal screen; a
      // first-time user sees the paywall.
      return { ...base, stage: entitlement.status === 'none' ? 'paywall' : 'expired' };
    }
    if (me.isGuest) return { ...base, stage: 'account' };
    if (!status.hasPreferences) return { ...base, stage: 'preferences' };
    return { ...base, stage: 'ready' };
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const next = await resolveStage();
      setState(next);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        await endLocalSession();
        setState((current) => ({ ...current, stage: 'onboarding', userId: null, error: null }));
      } else if (error instanceof ApiError && error.isOffline) {
        // Offline at launch: stay where we are rather than throwing the user
        // back to onboarding and losing their place.
        setState((current) => ({
          ...current,
          stage: current.stage === 'loading' ? 'onboarding' : current.stage,
          error: null,
        }));
      } else {
        setState((current) => ({
          ...current,
          stage: current.stage === 'loading' ? 'onboarding' : current.stage,
          error: 'Something went wrong.',
        }));
      }
    } finally {
      refreshing.current = false;
    }
  }, [resolveStage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-check entitlement whenever the app comes back to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    onUnauthorized(() => {
      void endLocalSession().then(() => {
        setState((current) => ({ ...current, stage: 'onboarding', userId: null }));
      });
    });
    return () => onUnauthorized(null);
  }, []);

  const startGuestSession = useCallback(async () => {
    // A fresh session must never inherit the previous account's cached data.
    await endLocalSession();
    const tokens = await authApi.startGuestSession();
    setState((current) => ({
      ...current,
      stage: 'onboarding',
      userId: tokens.userId,
      isGuest: tokens.isGuest,
      error: null,
    }));
  }, []);

  const signOut = useCallback(async () => {
    await endLocalSession();
    setState({
      stage: 'onboarding',
      userId: null,
      isGuest: true,
      profile: null,
      entitlement: null,
      hasAssessment: false,
      hasPreferences: false,
      error: null,
    });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      refresh,
      startGuestSession,
      setStage: (stage) => setState((current) => ({ ...current, stage })),
      markAssessmentComplete: () =>
        setState((current) => ({ ...current, hasAssessment: true, stage: 'paywall' })),
      markPreferencesComplete: () =>
        setState((current) => ({ ...current, hasPreferences: true, stage: 'program' })),
      markProgramReady: () => setState((current) => ({ ...current, stage: 'ready' })),
      signOut,
    }),
    [refresh, signOut, startGuestSession, state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}
