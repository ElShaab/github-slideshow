/**
 * Naming the component that threw.
 *
 * A release bundle is minified, so the error's own stack is bundle offsets.
 * React's component stack is the one thing built from names, and its first
 * useful frame is the culprit — this is what turns a screenshot from "the app
 * broke" into a file to open.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeRenderFailure, topComponentFrame } from '../src/utils/componentStack';

const REACT_STACK = `
    in PaywallScreen (at RootNavigator.tsx:142)
    in RCTView (at View.js:116)
    in ErrorBoundary (at App.tsx:40)`;

describe('finding the component that threw', () => {
  test('the first frame is the culprit', () => {
    assert.equal(topComponentFrame(REACT_STACK), 'PaywallScreen');
  });

  test('the newer "at Name" form is read too', () => {
    assert.equal(topComponentFrame('\n    at PlanOptionCard\n    at PaywallScreen'), 'PlanOptionCard');
  });

  test('the boundary itself is never named as the culprit', () => {
    assert.equal(
      topComponentFrame('\n    in ErrorBoundary (at App.tsx:40)\n    in PaywallScreen (at x:1)'),
      'PaywallScreen',
    );
  });

  test('frames that name nothing useful are skipped', () => {
    assert.equal(
      topComponentFrame('\n    in Anonymous\n    in Suspense\n    in SettingsScreen (at x:1)'),
      'SettingsScreen',
    );
  });

  test('no stack, or an unreadable one, yields nothing rather than a guess', () => {
    assert.equal(topComponentFrame(null), null);
    assert.equal(topComponentFrame(undefined), null);
    assert.equal(topComponentFrame(''), null);
    assert.equal(topComponentFrame('   '), null);
    assert.equal(topComponentFrame('garbage with no frames'), null);
  });
});

describe('what the screen ends up showing', () => {
  test('the component and the cause, together', () => {
    assert.equal(
      describeRenderFailure('TypeError: undefined is not a function', REACT_STACK),
      'PaywallScreen — TypeError: undefined is not a function',
    );
  });

  test('a known component with an unreadable cause still names the screen', () => {
    assert.equal(describeRenderFailure(null, REACT_STACK), 'Failed while rendering PaywallScreen');
  });

  test('with no stack it falls back to the cause alone', () => {
    assert.equal(
      describeRenderFailure('TypeError: undefined is not a function', null),
      'TypeError: undefined is not a function',
    );
  });

  test('nothing known at all stays null rather than inventing a line', () => {
    assert.equal(describeRenderFailure(null, null), null);
  });
});
