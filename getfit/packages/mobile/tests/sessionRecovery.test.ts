/**
 * Where a user lands when the session cannot be resolved.
 *
 * The rule that matters is that a failure must never quietly move someone
 * somewhere else. Falling back to onboarding at launch took an existing user
 * to the first screen of the product with no explanation — which, from where
 * they are standing, is indistinguishable from having lost their account. And
 * the error that explained it was set on state nothing rendered.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isBlocked, recoverFromFailure } from '../src/state/sessionRecovery';
import type { SessionStage } from '../src/state/sessionStage';

const STAGES: SessionStage[] = [
  'loading',
  'onboarding',
  'analysis',
  'paywall',
  'account',
  'preferences',
  'program',
  'ready',
  'expired',
];

describe('a failure while the app is starting', () => {
  test('stays at launch and says so, rather than landing on onboarding', () => {
    const patch = recoverFromFailure('loading', 'unknown');
    assert.equal(patch.stage, 'loading');
    assert.ok(patch.error, 'a failure at launch must explain itself');
  });

  test('being offline says so specifically, since that is actionable', () => {
    const patch = recoverFromFailure('loading', 'offline');
    assert.match(patch.error ?? '', /connection/i);
  });

  test('the result is a screen with a retry, not a spinner', () => {
    const patch = recoverFromFailure('loading', 'unknown');
    assert.equal(isBlocked(patch.stage, patch.error), true);
  });
});

describe('a failure once the user is somewhere', () => {
  test('leaves them exactly where they were', () => {
    for (const stage of STAGES.filter((s) => s !== 'loading')) {
      for (const kind of ['unknown', 'offline'] as const) {
        const patch = recoverFromFailure(stage, kind);
        assert.equal(patch.stage, stage, `${kind} moved a user off ${stage}`);
      }
    }
  });

  test('does not interrupt them with an error surface', () => {
    // A background refresh that failed is not a reason to take the screen away
    // from someone mid-workout.
    for (const stage of STAGES.filter((s) => s !== 'loading')) {
      const patch = recoverFromFailure(stage, 'unknown');
      assert.equal(isBlocked(patch.stage, patch.error), false, stage);
    }
  });
});

describe('being signed out', () => {
  test('goes to onboarding from anywhere, because there is nothing to return to', () => {
    for (const stage of STAGES) {
      const patch = recoverFromFailure(stage, 'unauthorized');
      assert.equal(patch.stage, 'onboarding');
      assert.equal(patch.error, null, 'signing out is not an error to report');
    }
  });
});

describe('when the app is blocked', () => {
  test('only while starting, and only with something to say', () => {
    assert.equal(isBlocked('loading', 'GetFit could not start.'), true);
    assert.equal(isBlocked('loading', null), false, 'a normal launch is a spinner, not an error');
    assert.equal(isBlocked('ready', 'GetFit could not start.'), false);
  });
});
