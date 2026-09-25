/**
 * Purchases as StoreKit 2 actually delivers them.
 *
 * This is the shape that broke a real build. The adapter demanded a receipt
 * before it would accept a transaction, which was right when a server had to
 * verify one — and wrong the moment StoreKit 2 engaged, because StoreKit 2 has
 * no receipt at all. react-native-iap fills the field with an empty string and
 * says so in a comment. Every genuine purchase came back looking unverifiable,
 * and the customer was told so after paying.
 *
 * Nothing in this app reads a receipt: entitlement comes from asking the store
 * what the customer owns. What matters is that the transaction can be named and
 * finished.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NativeStoreProvider, type IapModule } from '../src/state/storeAdapter';

const MONTHLY = 'getfit_membership_monthly';

/** Exactly what transactionSk2ToPurchaseMap produces: no receipt, real id. */
const sk2Transaction = (id = 'tx-2000000123') => ({
  productId: MONTHLY,
  transactionId: id,
  transactionReceipt: '',
  purchaseToken: '',
  transactionDate: Date.now(),
});

function storeKit2(owned: Array<Record<string, unknown>> = []) {
  const state = { finished: [] as string[] };
  const module = {
    setup: () => undefined,
    initConnection: async () => true,
    endConnection: async () => true,
    flushFailedPurchasesCachedAsPendingAndroid: async () => true,
    getSubscriptions: async () => [{ productId: MONTHLY, localizedPrice: '$4.99', currency: 'USD', price: '4.99' }],
    getAvailablePurchases: async () => owned,
    requestSubscription: async () => sk2Transaction(),
    finishTransaction: async ({ purchase }: { purchase: { transactionId?: string } }) => {
      state.finished.push(purchase.transactionId ?? '');
      return true;
    },
    purchaseUpdatedListener: () => ({ remove: () => undefined }),
    purchaseErrorListener: () => ({ remove: () => undefined }),
  } as unknown as IapModule;

  return { provider: new NativeStoreProvider('ios', () => module), state };
}

describe('buying under StoreKit 2', () => {
  test('a purchase with no receipt is accepted', async () => {
    // The regression: this threw "That purchase could not be verified."
    const { provider } = storeKit2();
    const purchase = await provider.purchase(MONTHLY);

    assert.equal(purchase.productId, MONTHLY);
    assert.equal(purchase.transactionId, 'tx-2000000123');
    assert.equal(purchase.platform, 'apple');
  });

  test('the empty receipt is carried through rather than invented', () => {
    // Making one up would be worse than having none: it would look like
    // something a server could check.
    return storeKit2()
      .provider.purchase(MONTHLY)
      .then((purchase) => assert.equal(purchase.receipt, ''));
  });

  test('the transaction can still be finished, which is what stops a refund', async () => {
    const { provider, state } = storeKit2();
    const purchase = await provider.purchase(MONTHLY);
    await provider.finishPurchase(purchase);
    assert.deepEqual(state.finished, ['tx-2000000123']);
  });
});

describe('restoring and reading membership under StoreKit 2', () => {
  test('an owned subscription with no receipt is found', async () => {
    const { provider } = storeKit2([sk2Transaction('tx-old')]);
    const restored = await provider.restore();
    assert.equal(restored?.transactionId, 'tx-old');
  });

  test('and counts as an active entitlement', async () => {
    const { provider } = storeKit2([sk2Transaction('tx-old')]);
    const active = await provider.getActivePurchases();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.productId, MONTHLY);
  });
});

describe('what is still refused', () => {
  test('a transaction with neither an id nor a receipt', async () => {
    // The check is not gone, only moved off the receipt: something that names
    // no transaction cannot be finished, so accepting it would mean a purchase
    // the store goes on redelivering forever.
    const { provider } = storeKit2([{ productId: MONTHLY, transactionReceipt: '', purchaseToken: '' }]);
    assert.equal(await provider.restore(), null);
  });
});
