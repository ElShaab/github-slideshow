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
import { ApiError, clearCache, clearToken, onUnauthorized } from '../api/client';
import { assessmentApi, authApi, onboardingApi } from '../api/endpoints';
import { createStoreProvider } from './billing';
import { resolveEntitlement } from './localEntitlement';
import { recoverFromFailure, type FailureKind } from './sessionRecovery';
import { shouldAskForAccount } from './accountSetup';
import { startCloudSync, stopCloudSync, syncNow } from '../supabase/cloud';
import type { SessionStage } from './sessionStage';

export type { SessionStage };

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
    // This used to begin by reading an access token and, without one, returning
    // straight to onboarding. Nothing has issued a token since the HTTP API was
    // replaced by local storage, so the check always failed and every cold
    // launch dropped a fully onboarded, paying user back on the welcome screen.
    // The stored profile is what says where the user is now.
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
    // Asked for after payment, and postponable. The membership itself never
    // depends on it: entitlement comes from the store and is cached here, so a
    // customer with no signal keeps the app they just paid for and is asked
    // again when they have bars. A session with no password yet is the one case
    // that is asked about every time — it looks signed in while being unable to
    // sign in anywhere else.
    if (
      shouldAskForAccount({
        signedIn: !me.isGuest,
        passwordSet: me.passwordSet,
        deferredAt: status.accountDeferredAt,
      })
    ) {
      return { ...base, stage: 'account' };
    }
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
      // Logged on every build: this is a failure the user is about to be told
      // about in the vaguest possible terms, so the cause has to go somewhere.
      console.error('GetFit session failed to resolve:', error);

      const unauthorized = error instanceof ApiError && error.isUnauthorized;
      if (unauthorized) await endLocalSession();

      const kind: FailureKind = unauthorized
        ? 'unauthorized'
        : error instanceof ApiError && error.isOffline
          ? 'offline'
          : 'unknown';

      setState((current) => ({
        ...current,
        ...recoverFromFailure(current.stage, kind),
        userId: unauthorized ? null : current.userId,
      }));
    } finally {
      refreshing.current = false;
    }
  }, [resolveStage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Starts mirroring local writes to the account, when there is one. A build
  // with no Supabase project configured makes this a no-op and the app stays
  // exactly as local as it was.
  useEffect(() => {
    startCloudSync();
    return () => stopCloudSync();
  }, []);

  // Re-check entitlement whenever the app comes back to the foreground, and
  // take the chance to reconcile with the account. The sync never blocks the
  // refresh: a phone with no signal must still open the app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      void refresh();
      void syncNow();
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
    // Takes the Supabase session with it, and the local documents too: the
    // body figures and training history on this device belong to the account
    // that just left it.
    await authApi.signOut();
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
