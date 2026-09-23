import type { SessionStage } from './SessionProvider';

/** The parts of the session a failure is allowed to change. */
export interface RecoveryPatch {
  stage: SessionStage;
  error: string | null;
}

export type FailureKind = 'unauthorized' | 'offline' | 'unknown';

/**
 * Where a user lands when the session cannot be resolved.
 *
 * The rule that matters: a failure must never quietly move someone somewhere
 * else. Falling back to onboarding used to be the behaviour at launch, which
 * means one bad moment took an existing user back to the first screen of the
 * product with no explanation — indistinguishable, to them, from having lost
 * their account.
 *
 * So a failure at launch stays at launch and says so. The stage stays
 * `loading` and the error is set, which is what puts a retry on screen instead
 * of a spinner that never resolves. A failure during a later refresh leaves
 * the user exactly where they were, because they are already somewhere valid
 * and interrupting them to report a background failure is worse than the
 * failure.
 *
 * Being signed out is the one exception: there is genuinely nothing to return
 * to, so onboarding is the honest destination rather than a fallback.
 */
export function recoverFromFailure(current: SessionStage, kind: FailureKind): RecoveryPatch {
  if (kind === 'unauthorized') return { stage: 'onboarding', error: null };

  // Still booting: there is nowhere to stay, so report it and offer a retry.
  if (current === 'loading') {
    return {
      stage: 'loading',
      error:
        kind === 'offline'
          ? 'GetFit could not start. Check your connection and try again.'
          : 'GetFit could not start.',
    };
  }

  // Already somewhere usable. Stay there; a background refresh that failed is
  // not a reason to take the screen away from someone mid-task.
  return { stage: current, error: null };
}

/** Whether the app should show the error surface rather than a stage. */
export const isBlocked = (stage: SessionStage, error: string | null): boolean =>
  stage === 'loading' && error !== null;
