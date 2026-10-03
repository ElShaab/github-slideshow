/**
 * Rest-timer and numeric-input arithmetic.
 *
 * Both of these were wrong in ways the type checker cannot see: the timer
 * restarted instead of extending, and typed values were never clamped.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clampNumericInput, extendRestEnd } from '../src/utils/numeric';

describe('extendRestEnd (#10)', () => {
  test('adds to the time left rather than restarting the rest', () => {
    const now = 1_000_000;
    // Five seconds left of a ninety-second rest.
    const endsAt = now + 5_000;

    const extended = extendRestEnd(endsAt, now, 30);

    assert.equal(
      (extended - now) / 1000,
      35,
      'the rest restarted from its full duration instead of extending',
    );
  });

  test('a rest that already ran out restarts from now', () => {
    const now = 1_000_000;
    const endsAt = now - 20_000;

    assert.equal((extendRestEnd(endsAt, now, 30) - now) / 1000, 30);
  });

  test('successive additions accumulate', () => {
    const now = 1_000_000;
    const once = extendRestEnd(now + 10_000, now, 30);
    const twice = extendRestEnd(once, now, 30);

    assert.equal((twice - now) / 1000, 70);
  });
});

describe('clampNumericInput (#9)', () => {
  test('brings an over-long cardio entry back to the maximum', () => {
    // 30 minutes typed into a field capped at 15 previously reached the API and
    // failed validation for the entire workout, losing every logged set.
    assert.equal(clampNumericInput('30', 0, 15, false), '15');
  });

  test('raises a value below the minimum', () => {
    assert.equal(clampNumericInput('2', 5, 60, false), '5');
  });

  test('leaves an in-range value alone', () => {
    assert.equal(clampNumericInput('12', 0, 15, false), '12');
  });

  test('empty or unparseable input falls back to the minimum', () => {
    assert.equal(clampNumericInput('', 5, 60, false), '5');
    assert.equal(clampNumericInput('.', 5, 60, false), '5');
  });

  test('decimal fields keep one decimal place', () => {
    assert.equal(clampNumericInput('82.46', 30, 300, true), '82.5');
    assert.equal(clampNumericInput('999', 30, 300, true), '300');
  });
});
