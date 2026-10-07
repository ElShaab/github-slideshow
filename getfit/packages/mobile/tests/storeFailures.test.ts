/**
 * The purchase failure codes.
 *
 * App Review rejected build 9 with a photograph of "Purchase cancelled." and
 * nothing else — a sentence four different code paths could have produced,
 * with no way to tell which from the only evidence anyone had. These codes
 * exist so a screenshot names its own origin.
 *
 * Two properties matter and neither is obvious from reading the table: no two
 * failures may share a code, and no code may ever change. A duplicate makes a
 * screenshot ambiguous, which is the whole problem again; a renumbering turns
 * every screenshot taken before it into a wrong answer, which is worse.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STORE_FAILURE,
  failureCodeOf,
  withFailureCode,
  type StoreFailureCode,
} from '../src/state/storeFailures';
import {
  StorePurchaseCancelled,
  StorePurchaseDeferred,
  StoreUnavailable,
} from '../src/state/storeAdapter';

describe('the code table', () => {
  test('gives every failure its own code', () => {
    const codes = Object.values(STORE_FAILURE);
    assert.equal(new Set(codes).size, codes.length, 'two failures share a code');
  });

  test('keeps the codes it has already published', () => {
    // A screenshot taken today has to still mean the same thing next year.
    // Changing any line here invalidates evidence already in people's inboxes;
    // retire a code by leaving a gap instead.
    assert.deepEqual(STORE_FAILURE, {
      moduleMissing: 'GF-01',
      connectFailed: 'GF-02',
      productMissing: 'GF-03',
      noOffer: 'GF-04',
      cancelled: 'GF-05',
      cancelledUnavailable: 'GF-06',
      deferred: 'GF-07',
      alreadyOwned: 'GF-08',
      network: 'GF-09',
      storeError: 'GF-10',
      unverifiable: 'GF-11',
      timedOut: 'GF-12',
      notRecorded: 'GF-13',
      nothingToRestore: 'GF-14',
      unknown: 'GF-99',
    });
  });
});

describe('reading a code off an error', () => {
  test('finds the one an error was built with', () => {
    const error = new StoreUnavailable('nope', STORE_FAILURE.productMissing);
    assert.equal(failureCodeOf(error), 'GF-03');
  });

  test('falls back to unknown for anything that never carried one', () => {
    assert.equal(failureCodeOf(new Error('boom')), 'GF-99');
    assert.equal(failureCodeOf(null), 'GF-99');
    assert.equal(failureCodeOf(undefined), 'GF-99');
    assert.equal(failureCodeOf('a string'), 'GF-99');
  });

  test("ignores the store's own code, which lives on a different field", () => {
    // react-native-iap puts E_USER_CANCELLED and friends on `code`. Reading
    // that as ours would print "(E_USER_CANCELLED)" or nothing at all.
    assert.equal(failureCodeOf({ code: 'E_USER_CANCELLED' }), 'GF-99');
  });

  test('ignores a failureCode that is not one of ours', () => {
    assert.equal(failureCodeOf({ failureCode: 'GF-nonsense' }), 'GF-99');
  });
});

describe('the errors themselves', () => {
  test('a cancellation is a cancellation by default', () => {
    assert.equal(new StorePurchaseCancelled().failureCode, 'GF-05');
  });

  test('but can be built as the unavailable kind instead', () => {
    // The two are indistinguishable to StoreKit and very different to us.
    const unavailable = new StorePurchaseCancelled(STORE_FAILURE.cancelledUnavailable);
    assert.equal(unavailable.failureCode, 'GF-06');
  });

  test('a deferred purchase carries its own code', () => {
    assert.equal(new StorePurchaseDeferred().failureCode, 'GF-07');
  });

  test('an unclassified StoreUnavailable is unknown rather than a wrong guess', () => {
    assert.equal(new StoreUnavailable().failureCode, 'GF-99');
  });
});

describe('showing a code to a customer', () => {
  test('puts it in brackets at the end', () => {
    assert.equal(
      withFailureCode('Purchase cancelled.', STORE_FAILURE.cancelled),
      'Purchase cancelled. (GF-05)',
    );
  });

  test('does not add the same code twice', () => {
    // A message that has already been through here must not come out as
    // "… (GF-05) (GF-05)" if it is passed through again.
    const once = withFailureCode('Purchase cancelled.', STORE_FAILURE.cancelled);
    assert.equal(withFailureCode(once, STORE_FAILURE.cancelled), once);
  });

  test('tidies whitespace rather than stranding the code', () => {
    assert.equal(withFailureCode('  Something went wrong.  ', STORE_FAILURE.unknown), 'Something went wrong. (GF-99)');
  });

  test('every code produces a message that names it', () => {
    for (const code of Object.values(STORE_FAILURE) as StoreFailureCode[]) {
      assert.match(withFailureCode('A failure.', code), new RegExp(`\\(${code}\\)$`));
    }
  });
});
