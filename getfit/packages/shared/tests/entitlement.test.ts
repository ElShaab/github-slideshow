/**
 * Entitlement without a server.
 *
 * With no server to ask, these functions are the entire gate on the paid
 * product. Two failure directions matter and both are covered: granting access
 * that was never bought, and taking away access that was.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SUBSCRIPTION_PRODUCT_ID, YEARLY_PRODUCT_ID } from '../src/constants';
import {
  OFFLINE_TRUST_DAYS,
  entitlementFromCache,
  entitlementFromPurchases,
  mergePurchaseHistory,
  needsRevalidation,
  type ActivePurchase,
  type CachedEntitlement,
  type PurchaseRecord,
} from '../src/entitlement';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

const purchase = (over: Partial<ActivePurchase> = {}): ActivePurchase => ({
  productId: SUBSCRIPTION_PRODUCT_ID,
  platform: 'apple',
  transactionId: 'tx-1',
  purchasedAt: days(-3),
  expiresAt: null,
  autoRenewing: null,
  ...over,
});

describe('entitlement from what the store says is owned', () => {
  test('nothing owned grants nothing', () => {
    const result = entitlementFromPurchases([], NOW);
    assert.equal(result.active, false);
    assert.equal(result.status, 'none');
    assert.equal(result.productId, null);
  });

  test('an owned subscription grants access', () => {
    const result = entitlementFromPurchases([purchase()], NOW);
    assert.equal(result.active, true);
    assert.equal(result.status, 'active');
    assert.equal(result.productId, SUBSCRIPTION_PRODUCT_ID);
    assert.equal(result.platform, 'apple');
  });

  test('a product we do not sell grants nothing', () => {
    // The list comes from the device. An unrecognised id must never unlock the
    // app, or a sideloaded or spoofed purchase becomes a free membership.
    const result = entitlementFromPurchases(
      [purchase({ productId: 'getfit_membership_free' })],
      NOW,
    );
    assert.equal(result.active, false);
    assert.equal(result.status, 'none');
  });

  test('an unknown product alongside a real one does not confuse the result', () => {
    const result = entitlementFromPurchases(
      [purchase({ productId: 'pirate_unlock', purchasedAt: days(-1) }), purchase()],
      NOW,
    );
    assert.equal(result.active, true);
    assert.equal(result.productId, SUBSCRIPTION_PRODUCT_ID);
  });

  test('the most recent purchase wins an upgrade', () => {
    // Switching monthly to yearly leaves both visible for a while.
    const result = entitlementFromPurchases(
      [
        purchase({ productId: SUBSCRIPTION_PRODUCT_ID, purchasedAt: days(-40) }),
        purchase({ productId: YEARLY_PRODUCT_ID, transactionId: 'tx-2', purchasedAt: days(-1) }),
      ],
      NOW,
    );
    assert.equal(result.productId, YEARLY_PRODUCT_ID);
    assert.equal(result.active, true);
  });

  test('a store-reported expiry in the past is not entitlement', () => {
    const result = entitlementFromPurchases([purchase({ expiresAt: days(-1) })], NOW);
    assert.equal(result.active, false);
    assert.equal(result.status, 'expired');
  });

  test('cancelling keeps the period already paid for', () => {
    const result = entitlementFromPurchases(
      [purchase({ autoRenewing: false, expiresAt: days(12) })],
      NOW,
    );
    assert.equal(result.active, true, 'a cancelled subscription still has time left on it');
    assert.equal(result.status, 'cancelled');
  });
});

describe('the cached answer, when the store cannot be reached', () => {
  const cached = (over: Partial<CachedEntitlement> = {}): CachedEntitlement => ({
    entitlement: entitlementFromPurchases([purchase({ expiresAt: days(20) })], NOW),
    verifiedAt: days(-1),
    ...over,
  });

  test('a recent answer keeps the app working offline', () => {
    const result = entitlementFromCache(cached(), NOW);
    assert.equal(result.active, true);
  });

  test('no cached answer grants nothing', () => {
    const result = entitlementFromCache(null, NOW);
    assert.equal(result.active, false);
    assert.equal(result.status, 'none');
  });

  test('access lapses once the answer is too old to trust', () => {
    // Nothing else can learn about a refund, so the window is the whole
    // defence against one.
    const stale = cached({ verifiedAt: days(-(OFFLINE_TRUST_DAYS + 1)) });
    const result = entitlementFromCache(stale, NOW);
    assert.equal(result.active, false);
    // Not "expired": the subscription may be perfectly fine and unreachable.
    assert.equal(result.status, 'pending');
  });

  test('an answer just inside the window is still honoured', () => {
    const result = entitlementFromCache(cached({ verifiedAt: days(-(OFFLINE_TRUST_DAYS - 1)) }), NOW);
    assert.equal(result.active, true);
  });

  test('a period the store said had ended is over, however fresh the answer', () => {
    const ended = cached({
      entitlement: entitlementFromPurchases([purchase({ expiresAt: days(30) })], NOW),
      verifiedAt: days(-1),
    });
    // Evaluate it well after that expiry.
    const later = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    const result = entitlementFromCache({ ...ended, verifiedAt: days(30) }, later);
    assert.equal(result.active, false);
    assert.equal(result.status, 'expired');
  });

  test('a corrupt timestamp grants nothing rather than everything', () => {
    // Local storage is editable. "verifiedAt: banana" must not read as fresh.
    const result = entitlementFromCache(cached({ verifiedAt: 'banana' }), NOW);
    assert.equal(result.active, false);
    assert.equal(result.status, 'none');
  });

  test('needsRevalidation tracks the same window', () => {
    assert.equal(needsRevalidation(null, NOW), true);
    assert.equal(needsRevalidation(cached(), NOW), false);
    assert.equal(needsRevalidation(cached({ verifiedAt: days(-(OFFLINE_TRUST_DAYS + 1)) }), NOW), true);
    assert.equal(needsRevalidation(cached({ verifiedAt: 'banana' }), NOW), true);
  });
});

describe('the local purchase log', () => {
  const record = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
    productId: SUBSCRIPTION_PRODUCT_ID,
    platform: 'apple',
    transactionId: 'tx-1',
    recordedAt: days(-1),
    kind: 'purchase',
    price: '$5.00',
    ...over,
  });

  test('keeps the newest first', () => {
    const history = mergePurchaseHistory(
      [record({ transactionId: 'old', recordedAt: days(-10) })],
      record({ transactionId: 'new', recordedAt: days(0) }),
    );
    assert.equal(history[0].transactionId, 'new');
    assert.equal(history.length, 2);
  });

  test('a repeated restore does not flood the log', () => {
    let history = [record({ kind: 'restore' })];
    for (let i = 0; i < 5; i += 1) {
      history = mergePurchaseHistory(history, record({ kind: 'restore', recordedAt: days(i) }));
    }
    assert.equal(history.length, 1, 'the same restore was logged more than once');
  });

  test('a restore is kept separately from the purchase it restores', () => {
    const history = mergePurchaseHistory([record({ kind: 'purchase' })], record({ kind: 'restore' }));
    assert.equal(history.length, 2);
  });

  test('the log is bounded', () => {
    let history: PurchaseRecord[] = [];
    for (let i = 0; i < 150; i += 1) {
      history = mergePurchaseHistory(history, record({ transactionId: `tx-${i}`, recordedAt: days(i) }), 100);
    }
    assert.equal(history.length, 100);
  });

  test('no payment detail is representable in a record', () => {
    // The type is the guarantee: there is nowhere to put a card number.
    const keys = Object.keys(record()).sort();
    assert.deepEqual(keys, [
      'kind',
      'platform',
      'price',
      'productId',
      'recordedAt',
      'transactionId',
    ]);
  });
});
